// Thin adapter over document.modelContext.
//
// When WebMCP is present the calls go straight through. When it is absent the
// same surface is served by a local registry, so the page's own agent panel and
// the automated tests exercise the identical code path an agent would take.
// Nothing in the app above this file knows which one is in use.

const local = {
  tools: new Map(),
  listeners: new Set()
};

// Set if the browser advertises modelContext but then refuses to use it, for
// example when the `tools` permissions policy is disabled. In that case the page
// falls back to its own registry so the interface still works, rather than
// leaving the user with a form whose tools silently do nothing.
let nativeDisabled = false;
let nativeError = null;

export const hasNativeWebMCP = () =>
  !nativeDisabled &&
  typeof document !== "undefined" && "modelContext" in document && Boolean(document.modelContext);

let mode = "unknown";
export const getMode = () => mode;
export const getNativeError = () => nativeError;

export function init() {
  mode = hasNativeWebMCP() ? "native" : "shim";
  return mode;
}

function demoteToShim(err) {
  nativeDisabled = true;
  nativeError = err;
  mode = "shim-fallback";
  console.warn("[ombuds] WebMCP refused registration, falling back to the page's own registry", err);
}

export async function registerTool(descriptor, options = {}) {
  if (hasNativeWebMCP()) {
    try {
      return await document.modelContext.registerTool(descriptor, options);
    } catch (err) {
      demoteToShim(err);
      // fall through and register locally instead
    }
  }
  local.tools.set(descriptor.name, descriptor);
  if (options.signal) {
    options.signal.addEventListener("abort", () => {
      local.tools.delete(descriptor.name);
      fireToolChange();
    }, { once: true });
  }
  fireToolChange();
}

export async function getTools(options) {
  if (hasNativeWebMCP()) {
    return document.modelContext.getTools(options);
  }
  return [...local.tools.values()].map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    origin: typeof location !== "undefined" ? location.origin : "shim://local"
  }));
}

export async function executeTool(tool, args, options = {}) {
  if (hasNativeWebMCP()) {
    return document.modelContext.executeTool(tool, args, options);
  }
  const impl = local.tools.get(tool.name);
  if (!impl) throw new Error(`Unknown tool: ${tool.name}`);
  return impl.execute(args, options);
}

export function onToolChange(fn) {
  if (hasNativeWebMCP()) {
    document.modelContext.addEventListener("toolchange", fn);
    return () => document.modelContext.removeEventListener("toolchange", fn);
  }
  local.listeners.add(fn);
  return () => local.listeners.delete(fn);
}

function fireToolChange() {
  for (const fn of local.listeners) fn(new Event("toolchange"));
}
