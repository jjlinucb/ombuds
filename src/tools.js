import { SECTIONS, SECTION_BY_ID, fieldsFor, descriptionFor } from "./form-definition.js";
import { ELIGIBILITY_CATEGORIES, getCategory, searchCategories } from "./reference-data.js";
import * as store from "./store.js";
import { registerTool, onToolChange, init as initAdapter, getMode } from "./webmcp-adapter.js";

// ---------------------------------------------------------------------------
// Schema generation
// ---------------------------------------------------------------------------

// A field becomes a JSON Schema property. Enums carry the full accepted list, so
// an agent picking a state or a category cannot produce a value the form will
// reject. This is generated from live state on every sync, never hand-written.
// Chrome's tool security guidance publishes character budgets: 30 for names,
// 500 for a tool description, 150 for a parameter description. An earlier
// version appended each field's human-facing `help` text to its agent-facing
// `description`, which pushed seven parameters past the 150 limit and risked
// truncation mid-sentence.
//
// They are two audiences, so they are two fields now. `description` is written
// for the agent and stays inside the budget. `help` stays in the page for the
// person filling the form, and an agent that wants it can ask `explain-field`.
export const BUDGET = { name: 30, description: 500, paramDescription: 150, output: 1500 };

function clamp(text, limit) {
  const t = String(text || "").trim();
  if (t.length <= limit) return t;
  // Trim at a sentence boundary where possible so the agent never reads half a rule.
  const cut = t.slice(0, limit - 1);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (stop > limit * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd()).trim();
}

function propertyFor(field) {
  const p = {};

  switch (field.type) {
    case "boolean":
      p.type = "boolean";
      break;
    case "enum":
      p.type = "string";
      p.enum = field.options;
      break;
    case "date":
      p.type = "string";
      p.pattern = "^\\d{2}/\\d{2}/\\d{4}$";
      break;
    default:
      p.type = "string";
      if (field.maxLength) p.maxLength = field.maxLength;
  }

  p.description = clamp(field.description, BUDGET.paramDescription);
  return p;
}

function schemaForFields(fields) {
  const properties = {};
  const required = [];
  for (const f of fields) {
    properties[f.name] = propertyFor(f);
    if (f.required) required.push(f.name);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

// Every tool answers in the same shape: human-readable text for the agent's
// narration, plus structuredContent it can act on programmatically.
function result(text, structured) {
  return {
    content: [{ type: "text", text }],
    structuredContent: structured
  };
}

function describeOutcome(sectionTitle, outcome, status) {
  const lines = [];
  const { accepted, rejected, flagged } = outcome;

  if (accepted.length) {
    const verb = store.state.autoAccept ? "applied" : "proposed for the applicant's review";
    lines.push(`${accepted.length} value${accepted.length === 1 ? "" : "s"} ${verb} in ${sectionTitle}: ${accepted.map(a => a.field).join(", ")}.`);
  }

  if (rejected.length) {
    lines.push(`${rejected.length} value${rejected.length === 1 ? " was" : "s were"} not accepted. Correct these and call this tool again with only the corrected fields:`);
    for (const r of rejected) {
      let line = `  - ${r.field}: ${r.message}`;
      if (r.hint) line += ` ${r.hint}`;
      if (r.example) line += ` Example of a valid value: ${r.example}`;
      lines.push(line);
    }
  }

  if (flagged.length) {
    for (const f of flagged) lines.push(`  - ${f.field}: ${f.message} ${f.hint}`);
  }

  if (!accepted.length && !rejected.length && !flagged.length) {
    lines.push("No values were supplied, so nothing changed.");
  }

  const sec = status.sections.find(s => s.title === sectionTitle);
  if (sec) {
    lines.push(sec.complete
      ? `${sectionTitle} is now complete (${sec.filled} of ${sec.total} fields).`
      : `${sectionTitle} is at ${sec.filled} of ${sec.total} fields with ${sec.errorCount} outstanding issue${sec.errorCount === 1 ? "" : "s"}.`);
  }

  lines.push(status.nextAction);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Static tools
// ---------------------------------------------------------------------------

function statusTool() {
  return {
    name: "get-form-status",
    title: "Check application progress",
    annotations: { readOnlyHint: true },
    description:
      "Report the state of the whole application: which sections are complete, which are still locked and what unlocks them, every outstanding validation issue, how many proposed changes are waiting for the applicant to review, and the single recommended next action. Call this first on any new conversation, and again whenever a tool result is surprising, because it is the cheapest way to find out what the form wants next.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute() {
      const status = store.formStatus();
      const lines = [
        `Application is ${status.percentComplete}% complete: ${status.sectionsComplete} of ${status.sectionsAvailable} open sections done.`
      ];
      for (const s of status.sections) {
        lines.push(`  ${s.complete ? "done" : "open"}  ${s.part} ${s.title} (${s.filled}/${s.total} fields${s.errorCount ? `, ${s.errorCount} issue${s.errorCount === 1 ? "" : "s"}` : ""})`);
      }
      if (status.lockedSections.length) {
        lines.push(`Not registered, so unreachable right now: ${status.lockedSections.map(l => `${l.title} (${l.explanation})`).join("; ")}.`);
      }
      if (status.blockingIssues.length) {
        lines.push("Outstanding issues:");
        for (const b of status.blockingIssues) {
          lines.push(`  - [${b.section}] ${b.field}: ${b.message}${b.hint ? ` ${b.hint}` : ""}`);
        }
      }
      lines.push(`Next: ${status.nextAction}`);
      return result(lines.join("\n"), status);
    }
  };
}

function categoriesTool() {
  return {
    name: "list-eligibility-categories",
    title: "Browse eligibility categories",
    annotations: { readOnlyHint: true },
    description:
      "List every work authorization eligibility category this form accepts, with the plain-language situation each one covers and the extra evidence each one will then ask for. Call this before set-eligibility-category whenever the applicant describes their situation in their own words rather than naming a category code, because picking the wrong code is the most common reason a real filing is rejected.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Optional free text to narrow the list, for example \"student\", \"asylum\", or \"spouse\"."
        }
      },
      additionalProperties: false
    },
    execute({ search } = {}) {
      const matches = searchCategories(search);

      // Output stays inside the 1.5K budget. A narrowed search gets the full
      // detail for each hit, because that is when the agent is deciding. The
      // unfiltered list gets one line each, because ten full entries overran
      // the budget and would have been truncated on the way to the model.
      const narrowed = Boolean(search) && matches.length && matches.length < ELIGIBILITY_CATEGORIES.length;

      let text;
      if (!matches.length) {
        text = `Nothing matched "${search}". Call this tool with no arguments to see all ${ELIGIBILITY_CATEGORIES.length} categories.`;
      } else if (narrowed) {
        text = `${matches.length} of ${ELIGIBILITY_CATEGORIES.length} categories match "${search}", best first:\n\n` +
          matches.map(c =>
            `${c.code}  ${c.label}\n    ${c.blurb}\n    Then requires: ${c.extraFields.map(f => f.label).join(", ")}`
          ).join("\n\n");
      } else {
        text = `All ${matches.length} categories. Call this tool with a search term to get the evidence each one requires.\n\n` +
          matches.map(c => `${c.code.padEnd(10)} ${c.label}`).join("\n");
      }

      return result(
        text,
        {
          categories: matches.map(c => ({
            code: c.code, label: c.label, situation: c.blurb,
            additionalEvidence: c.extraFields.map(f => ({ field: f.name, label: f.label }))
          }))
        }
      );
    }
  };
}

const FIELD_INDEX = (() => {
  const idx = new Map();
  for (const section of SECTIONS) {
    const all = section.dynamicFields
      ? ELIGIBILITY_CATEGORIES.flatMap(c => c.extraFields)
      : section.fields;
    for (const f of all) {
      if (!idx.has(f.name)) idx.set(f.name, { field: f, section });
    }
  }
  return idx;
})();

function explainTool() {
  return {
    name: "explain-field",
    title: "Explain a question",
    annotations: { readOnlyHint: true },
    description:
      "Explain what a specific field on this form means in plain language, where the applicant can find the answer on their own documents, and the exact format the form requires. Use this when the applicant asks what a question means or says they do not know where to find something, instead of guessing on their behalf. The page is the authority on its own wording, so this is more reliable than inferring from the field name.",
    inputSchema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "The field name to explain, as it appears in a section tool's inputSchema, for example \"sevisNumber\" or \"aNumber\".",
          enum: [...FIELD_INDEX.keys()]
        }
      },
      required: ["field"],
      additionalProperties: false
    },
    execute({ field }) {
      const hit = FIELD_INDEX.get(field);
      if (!hit) {
        return result(
          `"${field}" is not a field on this form. The explain-field schema lists every valid field name.`,
          { found: false }
        );
      }
      const { field: f, section } = hit;
      const lines = [
        `${f.label} (field name "${f.name}", ${section.part} ${section.title})`,
        f.help || f.description
      ];
      if (f.type === "enum") lines.push(`Accepted values: ${f.options.join(", ")}.`);
      if (f.type === "date") lines.push("Format: MM/DD/YYYY.");
      if (f.validate) lines.push(`This field is format-checked by the page, so a malformed value will be returned to you with the exact rule it broke.`);
      lines.push(f.required ? "This field is required." : "This field is optional and is safe to leave blank.");
      return result(lines.join("\n"), {
        found: true, field: f.name, label: f.label, section: section.id,
        required: Boolean(f.required), type: f.type, options: f.options || null,
        guidance: f.help || f.description
      });
    }
  };
}

function pendingTool() {
  return {
    name: "get-proposed-changes",
    title: "Review pending proposals",
    annotations: { readOnlyHint: true },
    description:
      "List the values you have proposed that the applicant has not yet accepted or rejected. Use this to check whether your earlier proposals went through before assuming a section is finished, and to see which of your own suggestions the applicant turned down.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute() {
      const entries = Object.entries(store.state.pending);
      const rows = store.state.pendingRows;
      if (!entries.length && !rows.length) {
        return result(
          "Nothing is waiting for review. Every value you proposed has been either accepted or rejected by the applicant.",
          { pending: [], pendingRows: [] }
        );
      }
      const lines = entries.map(([k, p]) => `  ${k} = ${JSON.stringify(p.value)}`);
      for (const r of rows) lines.push(`  ${r.collection} += ${JSON.stringify(r.value)}`);
      return result(
        `${entries.length + rows.length} change${entries.length + rows.length === 1 ? "" : "s"} awaiting the applicant's decision in the page:\n${lines.join("\n")}\n\nThe applicant reviews these by hand. You can keep filling other sections in the meantime.`,
        {
          pending: entries.map(([k, p]) => ({ field: k, value: p.value })),
          pendingRows: rows.map(r => ({ collection: r.collection, value: r.value }))
        }
      );
    }
  };
}

function withdrawTool() {
  const names = Object.keys(store.state.pending);
  return {
    name: "withdraw-proposed-change",
    title: "Withdraw a proposal",
    annotations: { readOnlyHint: false },
    description:
      "Withdraw a value you proposed before the applicant acts on it. Use this when you realise a value you suggested was wrong, so the applicant is not asked to rule on something you already know is a mistake.",
    inputSchema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description: "The proposed field to withdraw. Only fields currently awaiting review can be withdrawn.",
          enum: names
        }
      },
      required: ["field"],
      additionalProperties: false
    },
    execute({ field }) {
      const done = store.rejectPending(field);
      return result(
        done
          ? `Withdrew the proposed value for "${field}". It is no longer in the applicant's review queue.`
          : `"${field}" was not awaiting review, so there was nothing to withdraw. Call get-proposed-changes to see the current queue.`,
        { withdrawn: done, field }
      );
    }
  };
}

// A deliberately slow tool, so cancellation is real rather than decorative.
function precheckTool() {
  return {
    name: "run-eligibility-precheck",
    title: "Run consistency checks",
    annotations: { readOnlyHint: true },
    description:
      "Run the page's consistency checks across every section at once and return the supporting documents this specific applicant will need to file, based on their eligibility category and answers. This takes a few seconds and honours cancellation, so a stop request will abort it cleanly. Run it once the main sections are filled and before generating the packet.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute(_args, options = {}) {
      const signal = options.signal;
      const steps = [
        "checking name and birth details",
        "cross-checking dates against each other",
        "validating government file numbers",
        "matching the eligibility category to the declared status",
        "assembling the document checklist"
      ];

      for (const step of steps) {
        if (signal?.aborted) throw new DOMException("Precheck cancelled by the user.", "AbortError");
        store.logToolCall({ tool: "run-eligibility-precheck", phase: step, kind: "progress" });
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 450);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new DOMException("Precheck cancelled by the user.", "AbortError"));
          }, { once: true });
        });
      }

      const v = store.values();
      const status = store.formStatus();
      const cat = getCategory(v.eligibilityCategory);

      const docs = [
        "A copy of the photo page of your passport",
        "Two identical passport-style photographs",
        "A copy of your most recent I-94 arrival record"
      ];
      if (cat?.code.startsWith("(c)(3)")) {
        docs.push("A copy of your Form I-20 with the OPT recommendation on page 2");
        docs.push("A copy of any previously issued Employment Authorization Document");
      }
      if (cat?.code === "(c)(3)(C)") {
        docs.push("A copy of your STEM degree certificate or diploma");
        docs.push("Your employer's completed training plan, Form I-983");
      }
      if (cat?.code === "(c)(9)") docs.push("A copy of your I-485 receipt notice");
      if (cat?.code === "(c)(8)") docs.push("A copy of your asylum application receipt notice");
      if (cat?.code === "(c)(26)") docs.push("A copy of your spouse's I-140 approval notice and current H-1B approval");
      if (cat?.code === "(a)(12)") docs.push("A copy of your Temporary Protected Status approval notice");
      if (v.reasonForApplying !== "Initial permission to accept employment") {
        docs.push("A copy of the front and back of the card being renewed or replaced");
      }

      const text = [
        status.blockingIssues.length
          ? `Precheck found ${status.blockingIssues.length} issue${status.blockingIssues.length === 1 ? "" : "s"} to resolve:\n${status.blockingIssues.map(b => `  - ${b.field}: ${b.message}`).join("\n")}`
          : "Precheck found no inconsistencies across the sections that are filled in.",
        "",
        `Documents this applicant needs, based on category ${v.eligibilityCategory || "not yet chosen"}:`,
        ...docs.map(d => `  - ${d}`)
      ].join("\n");

      return result(text, { issues: status.blockingIssues, documentChecklist: docs, category: v.eligibilityCategory || null });
    }
  };
}

function packetTool() {
  return {
    name: "generate-filing-packet",
    title: "Generate the filing packet",
    // The packet echoes back every free-text answer the applicant typed. Those
    // strings were not written by this page, so an agent should treat them as
    // data rather than as instructions it has just been given.
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    description:
      "Produce the final review summary of the completed application, ready for the applicant to check against their documents before they file. This tool is only registered once every section is valid, the review queue is empty, and the applicant has personally signed the certification, so its presence is itself a signal that the form is genuinely finished.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute() {
      const v = store.values();
      const sections = [];
      let answered = 0;

      for (const section of store.availableSections()) {
        const fields = fieldsFor(section, v);
        if (!fields.length) continue;
        const filled = fields.filter(f => {
          const raw = v[f.name];
          return raw !== undefined && raw !== null && String(raw) !== "";
        }).length;
        answered += filled;
        sections.push(`  ${section.part} ${section.title} (${filled}/${fields.length})`);
      }

      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ombuds:packet"));

      // The packet itself is rendered in the page for the applicant to read
      // against their documents, so echoing every answer back as text would
      // blow the output budget to tell the agent something the person is
      // already looking at. Full values travel in structuredContent instead.
      const text = [
        `Filing packet generated and opened in the page for the applicant to review against their documents.`,
        `${answered} answers across ${sections.length} sections:`,
        ...sections,
        store.state.otherNames.length
          ? `Plus ${store.state.otherNames.length} former name${store.state.otherNames.length === 1 ? "" : "s"}.`
          : null,
        `Every value is in this result's structuredContent if you need to read one back.`
      ].filter(Boolean).join("\n");

      return result(text, {
        packet: v,
        otherNames: store.state.otherNames,
        generatedAt: new Date().toISOString()
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Section tools, built from whatever the form is currently asking
// ---------------------------------------------------------------------------

function sectionTool(section) {
  const v = store.values();
  const fields = fieldsFor(section, v);

  if (section.repeatable) {
    return {
      name: section.tool,
      title: `${section.part}: ${section.title}`,
      annotations: { readOnlyHint: false },
      description: clamp(descriptionFor(section, v), BUDGET.description),
      inputSchema: schemaForFields(fields),
      execute(args) {
        const outcome = store.proposeRow(section.collection, args);
        const status = store.formStatus();
        if (outcome.rejected.length) {
          return result(
            `That entry was not accepted:\n${outcome.rejected.map(r => `  - ${r.field}: ${r.message} ${r.hint || ""}`).join("\n")}`,
            { accepted: false, rejected: outcome.rejected }
          );
        }
        return result(
          `Added a former name to the applicant's review queue. ${status.nextAction}`,
          { accepted: true, status }
        );
      }
    };
  }

  return {
    name: section.tool,
    title: `${section.part}: ${section.title}`,
    annotations: { readOnlyHint: false },
    description: clamp(descriptionFor(section, v), BUDGET.description),
    inputSchema: schemaForFields(fields),
    execute(args) {
      const outcome = store.propose(section.id, args || {});
      const status = store.formStatus();
      return result(
        describeOutcome(section.title, outcome, status),
        {
          section: section.id,
          accepted: outcome.accepted,
          rejected: outcome.rejected,
          needsHumanAffirmation: outcome.flagged,
          status
        }
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Sync: the loop that keeps the registered tool set equal to what the form wants
// ---------------------------------------------------------------------------

// Registered tools are keyed by name and fingerprinted by their description plus
// their generated schema. When state changes, tools whose fingerprint moved are
// unregistered and registered again, which fires `toolchange` and hands the
// agent a fresh schema. Tools whose fingerprint is unchanged are left alone so
// the agent is not churned needlessly.
const registered = new Map(); // name -> { fingerprint, controller }

// Tool-set changes are announced on their own channel. Routing them through the
// store instead would be circular: syncing would notify the store, the store
// would ask for another sync, and so on.
const toolListeners = new Set();
export const onToolsSynced = fn => { toolListeners.add(fn); return () => toolListeners.delete(fn); };

function desiredTools() {
  const tools = [statusTool(), categoriesTool(), explainTool(), pendingTool()];

  for (const section of store.availableSections()) {
    const fields = fieldsFor(section, store.values());
    if (fields.length) tools.push(sectionTool(section));
  }

  if (Object.keys(store.state.pending).length) tools.push(withdrawTool());

  const status = store.formStatus();
  if (status.sectionsComplete >= 3) tools.push(precheckTool());
  if (status.readyToGeneratePacket) tools.push(packetTool());

  return tools;
}

const fingerprint = t => JSON.stringify([t.description, t.inputSchema, t.annotations]);

// Syncs are serialized on a promise chain. Awaiting syncTools() therefore always
// resolves after a sync that began no earlier than the call, so a caller can
// rely on the registered tool set being settled once its await returns. An
// earlier version guarded with a boolean and returned early while a sync was
// still in flight, which let callers observe a stale tool list.
let chain = Promise.resolve();

export function syncTools() {
  chain = chain.then(doSync, doSync).catch(err => {
    // A throw here would leave the registered set out of step with what the form
    // wants, so it must be loud rather than swallowed.
    console.error("[ombuds] tool sync failed", err);
    store.logToolCall({ tool: "(sync)", kind: "error", text: String(err?.message || err) });
  });
  return chain;
}

async function doSync() {
  {
    const desired = desiredTools();
    const desiredByName = new Map(desired.map(t => [t.name, t]));

    for (const [name, entry] of [...registered.entries()]) {
      const next = desiredByName.get(name);
      if (!next || fingerprint(next) !== entry.fingerprint) {
        entry.controller.abort();
        registered.delete(name);
      }
    }

    for (const tool of desired) {
      if (registered.has(tool.name)) continue;
      const controller = new AbortController();
      const wrapped = { ...tool, execute: instrument(tool) };
      await registerTool(wrapped, { signal: controller.signal });
      registered.set(tool.name, { fingerprint: fingerprint(tool), controller });
    }

    store.state.registeredToolNames = [...registered.keys()];
    for (const fn of toolListeners) fn();
  }
}

// Wrap every execute so the page can show the agent's activity to the human.
function instrument(tool) {
  return async (args, options) => {
    store.logToolCall({ tool: tool.name, kind: "call", args: args || {} });
    try {
      const res = await tool.execute(args, options);
      store.logToolCall({
        tool: tool.name, kind: "result",
        text: res.content?.[0]?.text || "",
        structured: res.structuredContent
      });
      await syncTools();
      return res;
    } catch (err) {
      store.logToolCall({ tool: tool.name, kind: "error", text: String(err?.message || err) });
      await syncTools();
      throw err;
    }
  };
}

export async function initTools() {
  const mode = initAdapter();
  onToolChange(() => store.emit());
  store.subscribe(() => { syncTools(); });
  await syncTools();
  return mode;
}

export { getMode };
