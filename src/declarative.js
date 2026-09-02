import { searchCategories } from "./reference-data.js";
import * as store from "./store.js";
import { getTools } from "./webmcp-adapter.js";

// The declarative half of WebMCP.
//
// The markup in index.html carries `toolname`, `tooldescription` and
// `toolparamdescription`, which is enough for a supporting browser to
// synthesize a tool with no registerTool call. This module supplies the two
// things markup alone cannot: the search itself, and the response that goes
// back to the agent through SubmitEvent#respondWith() so the page does not
// navigate away mid-conversation.

const RESULT_LIMIT = 5;

function describe(matches, query) {
  if (!matches.length) {
    return `Nothing matched "${query}". Try naming the visa status or the situation, for example "F-1 student", "asylum pending", or "spouse of an H-1B worker". Calling list-eligibility-categories with no arguments returns the full list.`;
  }
  const lines = matches.map(c =>
    `${c.code}  ${c.label}\n    ${c.blurb}\n    Then requires: ${c.extraFields.map(f => f.label).join(", ")}`);
  return `${matches.length} matching categor${matches.length === 1 ? "y" : "ies"} for "${query}", best first:\n\n${lines.join("\n\n")}\n\nPass the chosen code to set-eligibility-category exactly as written, parentheses included.`;
}

function renderResults(matches, query) {
  const host = document.getElementById("finder-results");
  host.textContent = "";

  if (!query) return;

  if (!matches.length) {
    const p = document.createElement("p");
    p.className = "finder-empty";
    p.textContent = `Nothing matched "${query}". Try naming your visa status, for example "F-1 student" or "asylum pending".`;
    host.append(p);
    return;
  }

  for (const c of matches) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "finder-hit";

    const code = document.createElement("span");
    code.className = "fh-code";
    code.textContent = c.code;

    const body = document.createElement("span");
    body.className = "fh-body";
    const label = document.createElement("strong");
    label.textContent = c.label;
    const blurb = document.createElement("span");
    blurb.textContent = c.blurb;
    body.append(label, blurb);

    const use = document.createElement("span");
    use.className = "fh-use";
    use.textContent = "use this";

    row.append(code, body, use);
    row.title = `Requires: ${c.extraFields.map(f => f.label).join(", ")}`;
    row.onclick = () => {
      store.setHuman("eligibilityCategory", c.code);
      // Rendering is synchronous on the store notification, so the section card
      // exists by the time this looks for it.
      document.getElementById("section-eligibility")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    host.append(row);
  }
}

export function initDeclarative() {
  const form = document.getElementById("category-finder");
  if (!form) return;

  form.addEventListener("submit", event => {
    // Always prevent the default navigation. A form tool that navigated the
    // page would throw away the agent's context along with the user's answers.
    event.preventDefault();

    const query = new FormData(form).get("situation") || "";
    const matches = searchCategories(query).slice(0, RESULT_LIMIT);

    renderResults(matches, String(query).trim());
    store.logToolCall({
      tool: "find-eligibility-category",
      kind: "call",
      args: { situation: query },
      declarative: true
    });

    const payload = {
      content: [{ type: "text", text: describe(matches, query) }],
      structuredContent: {
        query,
        matches: matches.map(c => ({
          code: c.code,
          label: c.label,
          situation: c.blurb,
          additionalEvidence: c.extraFields.map(f => ({ field: f.name, label: f.label }))
        }))
      }
    };

    store.logToolCall({
      tool: "find-eligibility-category",
      kind: "result",
      text: payload.content[0].text,
      structured: payload.structuredContent,
      declarative: true
    });

    // Present only when the browser routed this submit from an agent's tool
    // call. A human clicking Search reaches the same code path and simply has
    // nothing to respond to.
    if (typeof event.respondWith === "function") {
      event.respondWith(payload);
    }
  });
}

// A supporting browser lists the synthesized tool in getTools() even though the
// page never registered it, so its presence is a direct signal that declarative
// WebMCP is live rather than something to infer from a version number.
export async function declarativeToolIsLive() {
  try {
    const tools = await getTools();
    return tools.some(t => t.name === "find-eligibility-category");
  } catch {
    return false;
  }
}
