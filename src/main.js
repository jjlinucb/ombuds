import { initTools, onToolsSynced } from "./tools.js";
import { getTools, executeTool } from "./webmcp-adapter.js";
import { initUI, renderAll } from "./ui.js";

const mode = await initTools();
initUI();

// The tool set changing is its own signal, separate from the form's state
// changing, so the pane refreshes on both.
onToolsSynced(() => {
  const ev = new CustomEvent("ombuds:tools");
  window.dispatchEvent(ev);
});
window.addEventListener("ombuds:tools", () => renderAll());

// Exposed so the tools can be driven straight from the devtools console, which
// is handy when checking behaviour without an agent attached:
//   await ombuds.call("get-form-status")
//   await ombuds.schema("answer-category-questions")
window.ombuds = {
  mode,
  tools: () => getTools(),
  schema: async name => (await getTools()).find(t => t.name === name)?.inputSchema,
  async call(name, args = {}, options) {
    const tool = (await getTools()).find(t => t.name === name);
    if (!tool) throw new Error(`Not registered right now: ${name}`);
    return executeTool(tool, args, options);
  }
};

console.log(`[ombuds] WebMCP mode: ${mode}. Try: await ombuds.call("get-form-status")`);
