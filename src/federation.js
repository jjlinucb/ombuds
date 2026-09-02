import * as store from "./store.js";
import { hasNativeWebMCP } from "./webmcp-adapter.js";

// Cross-origin tool federation.
//
// The vault is a separate service on its own origin, embedded in an iframe that
// carries `allow="tools"` so the permissions policy lets it register tools at
// all. It registers with `exposedTo: [this origin]`, and this side discovers
// them with getTools({ fromOrigins: [vault origin] }) and runs them through
// executeTool. The browser refuses the call unless both halves agree, which is
// the part that makes this safe rather than merely possible.
//
// When a browser lacks that support the same tools are reachable over a
// postMessage bridge with an identical shape, so the calling code below does
// not branch and the demonstration still holds.

const VAULT_ORIGINS = {
  "https://ombuds-mu.vercel.app": "https://ombuds-vault.vercel.app",
  "http://localhost:4173": "http://localhost:4174",
  "http://127.0.0.1:4173": "http://127.0.0.1:4174"
};

export const vaultOrigin = () => VAULT_ORIGINS[location.origin] || null;

let frame = null;
let discovered = [];
let transport = "none";     // "webmcp" | "bridge" | "none"
let nextId = 1;
const waiting = new Map();

export const federationState = () => ({
  origin: vaultOrigin(),
  transport,
  // Pass the tool descriptors through whole. An earlier version rebuilt each
  // one from a field list and silently dropped `title` and `annotations`, so
  // the vault's untrustedContentHint never reached the surface that is supposed
  // to display it. Projecting a descriptor is a good way to lose the field you
  // most need.
  tools: discovered.map(t => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
    origin: t.origin || vaultOrigin()
  }))
});

// ---------------------------------------------------------------------------
// Bridge transport
// ---------------------------------------------------------------------------

function bridgeSend(op, payload = {}) {
  const target = vaultOrigin();
  if (!frame?.contentWindow || !target) return Promise.reject(new Error("Vault is not embedded."));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("The vault did not answer in time."));
    }, 6000);
    waiting.set(id, { resolve, reject, timer });
    frame.contentWindow.postMessage({ ombuds: "vault", op, id, ...payload }, target);
  });
}

function onMessage(event) {
  if (event.origin !== vaultOrigin()) return;
  const msg = event.data;
  if (!msg || msg.ombuds !== "vault") return;

  if (msg.op === "ready") {
    discover();
    return;
  }

  const pending = waiting.get(msg.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  waiting.delete(msg.id);
  if (msg.ok) pending.resolve(msg);
  else pending.reject(new Error(msg.error || "The vault refused the call."));
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export async function discover() {
  const origin = vaultOrigin();
  if (!origin) { transport = "none"; return []; }

  // Preferred path: ask the browser for the iframe's tools by origin.
  if (hasNativeWebMCP()) {
    try {
      const all = await document.modelContext.getTools({ fromOrigins: [origin] });
      const fromVault = all.filter(t => t.origin === origin || String(t.name).startsWith("vault-"));
      if (fromVault.length) {
        discovered = fromVault;
        transport = "webmcp";
        store.emit();
        return discovered;
      }
    } catch (err) {
      // A browser without exposedTo support rejects or returns nothing. Fall
      // through rather than treating it as fatal.
      console.info("[ombuds] cross-origin getTools unavailable, using the bridge", err?.name || err);
    }
  }

  try {
    const res = await bridgeSend("list-tools");
    discovered = res.tools || [];
    transport = discovered.length ? "bridge" : "none";
  } catch {
    discovered = [];
    transport = "none";
  }
  store.emit();
  return discovered;
}

export async function callVaultTool(name, args = {}) {
  const tool = discovered.find(t => t.name === name);
  if (!tool) throw new Error(`The vault is not exposing "${name}" right now.`);

  store.logToolCall({ tool: name, kind: "call", args, crossOrigin: vaultOrigin() });

  let res;
  if (transport === "webmcp") {
    res = await document.modelContext.executeTool(tool, args);
  } else {
    const reply = await bridgeSend("call", { name, args });
    res = reply.result;
  }

  store.logToolCall({
    tool: name, kind: "result",
    text: res?.content?.[0]?.text || "",
    structured: res?.structuredContent,
    crossOrigin: vaultOrigin()
  });
  return res;
}

export function initFederation() {
  const origin = vaultOrigin();
  const host = document.getElementById("vault-frame-host");
  if (!origin || !host) return;

  window.addEventListener("message", onMessage);

  frame = document.createElement("iframe");
  // `allow="tools"` delegates the tools permissions policy to this cross-origin
  // frame. Without it, registerTool inside the vault rejects with NotAllowedError.
  frame.setAttribute("allow", "tools");
  frame.setAttribute("title", "Document vault, a separate service on its own origin");
  frame.src = `${origin}/?host=${encodeURIComponent(location.origin)}`;
  frame.className = "vault-frame";
  frame.loading = "lazy";
  host.append(frame);

  frame.addEventListener("load", () => { discover(); });
}
