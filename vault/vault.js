import { DOCUMENTS, statusOf, findFor } from "./vault-data.js";

// The document vault, running on its own origin inside an iframe.
//
// It registers WebMCP tools with `exposedTo` naming exactly the form's origin,
// which is what lets a tool cross an origin boundary at all. The form then
// discovers them with getTools({ fromOrigins: [...] }) and runs them through
// executeTool, and the browser refuses the call unless both sides agree.
//
// The point of the split is that the form never holds the documents. It asks
// whether one exists and when it expires, and gets an answer back. That is a
// different trust boundary from a form that stores your passport scan, and it
// is only expressible because tools carry an origin.

// Only these origins may ever see this vault's tools.
const ALLOWED_HOSTS = [
  "https://ombuds-mu.vercel.app",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

const params = new URLSearchParams(location.search);
const requestedHost = params.get("host") || "";
const hostOrigin = ALLOWED_HOSTS.includes(requestedHost) ? requestedHost : null;

const log = [];
function note(text) {
  log.unshift({ text, at: new Date() });
  if (log.length > 12) log.pop();
  render();
}

// ---------------------------------------------------------------------------
// Tool definitions, shared by the WebMCP path and the postMessage fallback
// ---------------------------------------------------------------------------

const result = (text, structured) => ({
  content: [{ type: "text", text }],
  structuredContent: structured
});

const TOOLS = [
  {
    name: "vault-list-documents",
    title: "List stored documents",
    // Read-only, and the records are things the applicant uploaded rather than
    // text this service authored, so a form receiving them across the origin
    // boundary is told to treat the payload as data. Chrome's tool security
    // guidance asks for exactly this on externally sourced content.
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description:
      "List the supporting documents the applicant has stored in their document vault, with the issuer, a masked identifier, and the expiry status of each. This runs on the vault's own origin, so the form never receives the documents themselves, only whether they exist and when they lapse. Use it to tell the applicant which items on their filing checklist they already have.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute() {
      note("vault-list-documents called");
      const rows = DOCUMENTS.map(d => {
        const st = statusOf(d);
        return { id: d.id, type: d.type, label: d.label, issuer: d.issuer, expires: d.expires, state: st.state, note: st.note };
      });
      const text = rows.map(r =>
        `${r.type}: ${r.label}\n    Issued by ${r.issuer}. ${r.note}`).join("\n");
      return result(`The vault holds ${rows.length} documents:\n${text}`, { documents: rows });
    }
  },
  {
    name: "vault-check-requirement",
    title: "Check one checklist line",
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    description:
      "Check whether the applicant's vault holds a document that satisfies one specific line from their filing checklist, and report whether it is still valid. Pass the checklist line exactly as run-eligibility-precheck returned it. Use this to turn a generic checklist into a list of what this applicant is actually missing.",
    inputSchema: {
      type: "object",
      properties: {
        requirement: {
          type: "string",
          description: "One checklist line, for example \"A copy of your Form I-20 with the OPT recommendation on page 2\"."
        }
      },
      required: ["requirement"],
      additionalProperties: false
    },
    execute({ requirement }) {
      note(`vault-check-requirement: ${String(requirement).slice(0, 48)}`);
      const doc = findFor(requirement);
      if (!doc) {
        return result(
          `The vault has nothing on file that satisfies "${requirement}". The applicant needs to obtain this before filing.`,
          { requirement, held: false, document: null }
        );
      }
      const st = statusOf(doc);
      const verdict = st.state === "expired"
        ? `The vault holds ${doc.label}, but it is out of date. ${st.note} It must be replaced before filing.`
        : st.state === "expiring"
          ? `The vault holds ${doc.label}. ${st.note} That is tight for a filing timeline and worth flagging to the applicant.`
          : `The vault holds ${doc.label}, issued by ${doc.issuer}. ${st.note}`;
      return result(verdict, {
        requirement, held: true,
        document: { id: doc.id, type: doc.type, label: doc.label, issuer: doc.issuer, expires: doc.expires },
        state: st.state
      });
    }
  }
];

// ---------------------------------------------------------------------------
// Native WebMCP registration
// ---------------------------------------------------------------------------

let registeredNatively = false;
let registrationError = null;

async function registerNatively() {
  if (!hostOrigin) {
    registrationError = new Error(`Refusing to expose tools: "${requestedHost}" is not an allowed host origin.`);
    return false;
  }
  if (!("modelContext" in document) || !document.modelContext) return false;
  try {
    for (const tool of TOOLS) {
      // `exposedTo` is the whole mechanism. Without it these tools would be
      // visible only to this iframe and to the browser's own agent, never to
      // the form embedding it.
      await document.modelContext.registerTool(tool, { exposedTo: [hostOrigin] });
    }
    registeredNatively = true;
    note(`Registered ${TOOLS.length} tools, exposed to ${hostOrigin}`);
    return true;
  } catch (err) {
    registrationError = err;
    note(`Native registration refused: ${err.name}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// postMessage fallback
// ---------------------------------------------------------------------------
//
// Origin-crossing WebMCP needs both the `tools` permissions policy and browser
// support for `exposedTo`. When either is missing the federation story would be
// invisible, so the same tool objects are also reachable over postMessage. The
// protocol mirrors getTools and executeTool on purpose, so the form's calling
// code is identical either way and the origin check is still enforced here.

function serializable(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    origin: location.origin
  };
}

window.addEventListener("message", async event => {
  if (!hostOrigin || event.origin !== hostOrigin) return;
  const msg = event.data;
  if (!msg || msg.ombuds !== "vault" || typeof msg.id !== "number") return;

  const reply = payload => event.source.postMessage({ ombuds: "vault", ...payload }, hostOrigin);

  if (msg.op === "list-tools") {
    reply({ id: msg.id, ok: true, tools: TOOLS.map(serializable), native: registeredNatively });
    return;
  }

  if (msg.op === "call") {
    const tool = TOOLS.find(t => t.name === msg.name);
    if (!tool) {
      reply({ id: msg.id, ok: false, error: `Unknown vault tool: ${msg.name}` });
      return;
    }
    try {
      const res = await tool.execute(msg.args || {});
      reply({ id: msg.id, ok: true, result: res });
    } catch (err) {
      reply({ id: msg.id, ok: false, error: String(err?.message || err) });
    }
  }
});

// ---------------------------------------------------------------------------
// The vault's own small interface
// ---------------------------------------------------------------------------

function render() {
  const list = document.getElementById("docs");
  list.textContent = "";
  for (const d of DOCUMENTS) {
    const st = statusOf(d);
    const row = document.createElement("div");
    row.className = `doc ${st.state}`;
    const head = document.createElement("div");
    head.className = "doc-head";
    const t = document.createElement("strong");
    t.textContent = d.type;
    const badge = document.createElement("span");
    badge.className = "doc-badge";
    badge.textContent = st.state;
    head.append(t, badge);
    const sub = document.createElement("div");
    sub.className = "doc-sub";
    sub.textContent = `${d.label} · ${d.issuer}`;
    const exp = document.createElement("div");
    exp.className = "doc-exp";
    exp.textContent = st.note;
    row.append(head, sub, exp);
    list.append(row);
  }

  const status = document.getElementById("vault-status");
  status.textContent = !hostOrigin
    ? `Not connected. "${requestedHost || "no host"}" is not an allowed origin.`
    : registeredNatively
      ? `WebMCP tools exposed to ${hostOrigin}`
      : `Bridged to ${hostOrigin}. Native exposedTo unavailable in this browser.`;
  status.className = "vault-status" + (registeredNatively ? " live" : "");

  const logHost = document.getElementById("vault-log");
  logHost.textContent = "";
  for (const entry of log) {
    const li = document.createElement("div");
    li.className = "vlog";
    li.textContent = `${entry.at.toLocaleTimeString()}  ${entry.text}`;
    logHost.append(li);
  }
}

await registerNatively();
render();

// Tell the parent the vault is ready, so it does not have to poll.
if (hostOrigin && window.parent !== window) {
  window.parent.postMessage({ ombuds: "vault", op: "ready", native: registeredNatively }, hostOrigin);
}
