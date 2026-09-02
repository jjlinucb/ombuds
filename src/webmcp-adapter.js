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

export const hasNativeWebMCP = () =>
  typeof document !== "undefined" && "modelContext" in document && document.modelContext;

let mode = "unknown";
export const getMode = () => mode;

export function init() {
  mode = hasNativeWebMCP() ? "native" : "shim";
  return mode;
}

export async function registerTool(descriptor, options = {}) {
  if (hasNativeWebMCP()) {
    return document.modelContext.registerTool(descriptor, options);
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
