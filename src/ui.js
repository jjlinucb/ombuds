import { SECTIONS, SECTION_BY_ID, fieldsFor, allFieldsFor, descriptionFor } from "./form-definition.js";
import * as store from "./store.js";
import { getTools, executeTool, getMode, getNativeError } from "./webmcp-adapter.js";
import { declarativeToolIsLive } from "./declarative.js";
import * as persist from "./persistence.js";
import * as federation from "./federation.js";
import * as walk from "./walkthrough.js";

const $ = id => document.getElementById(id);
const displayValue = (field, value) => {
  if (value === undefined || value === null || value === "") return "\u2014";
  if (field.type === "boolean") return value ? "Yes" : "No";
  return String(value);
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let selectedTool = null;
let knownTools = new Set();
let seenFields = new Set();

// ---------------------------------------------------------------------------
// Progress rail
// ---------------------------------------------------------------------------

function renderRail() {
  const rail = $("progress-rail");
  rail.textContent = "";
  const firstOpen = SECTIONS.find(s => store.isSectionAvailable(s) && !store.sectionStatus(s.id).complete);

  for (const section of SECTIONS) {
    const available = store.isSectionAvailable(section);
    const st = store.sectionStatus(section.id);
    const step = el("div", "rail-step", section.title);
    if (!available) step.classList.add("locked");
    else if (st.complete) step.classList.add("done");
    else if (section === firstOpen) step.classList.add("active");
    step.title = available
      ? `${section.part} ${section.title} — ${st.filled} of ${st.total} fields`
      : `${section.part} ${section.title} — locked until ${section.requires.join(" and ")} are valid`;
    rail.append(step);
  }
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function renderField(field, section) {
  const v = store.values();
  const pending = store.state.pending[field.name];
  const value = v[field.name];

  const wrap = el("div", "field" + (field.type === "boolean" || field.maxLength > 40 ? " wide" : ""));
  if (pending) wrap.classList.add("proposed");

  const key = `${section.id}:${field.name}`;
  if (!seenFields.has(key)) {
    seenFields.add(key);
    if (store.state.everRendered) wrap.classList.add("new-field");
  }

  const errId = `err-${field.name}`;
  const helpId = `help-${field.name}`;
  const st = store.sectionStatus(section.id);
  const err = st.fieldErrors.find(e => e.field === field.name && e.code !== "REQUIRED");
  const describedBy = err ? errId : field.help ? helpId : null;

  const label = el(field.type === "boolean" ? "span" : "label", "field-label");
  label.append(document.createTextNode(field.label));
  if (field.required) {
    // Purely decorative. An aria-label on a roleless span is not dependably
    // announced, so requiredness is carried by aria-required / the required
    // attribute on the control itself.
    const req = el("span", "req", "*");
    req.setAttribute("aria-hidden", "true");
    label.append(req);
  }
  if (pending) label.append(el("span", "proposed-tag", "proposed"));
  // A boolean renders as a pair of buttons rather than one labelable control, so
  // the group is named by its text instead of a `for` pointing at nothing.
  if (field.type !== "boolean") label.htmlFor = `f-${field.name}`;
  else label.id = `lbl-${field.name}`;
  wrap.append(label);

  if (field.type === "boolean") {
    const row = el("div", "bool-row");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-labelledby", `lbl-${field.name}`);
    if (describedBy) row.setAttribute("aria-describedby", describedBy);
    if (field.required) row.setAttribute("aria-required", "true");
    for (const [txt, val] of [["Yes", true], ["No", false]]) {
      const b = el("button", null, txt);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(value === val));
      // Only the selected option, or the first when nothing is chosen, is a tab
      // stop. Arrow keys move within the group, which is how a radiogroup is
      // expected to behave.
      b.tabIndex = value === val || (value === undefined && val === true) ? 0 : -1;
      b.onclick = () => store.setHuman(field.name, value === val ? undefined : val);
      b.onkeydown = ev => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
          ev.preventDefault();
          store.setHuman(field.name, !val);
        }
      };
      row.append(b);
    }
    wrap.append(row);
  } else if (field.type === "enum") {
    const sel = el("select");
    sel.id = `f-${field.name}`;
    const blank = el("option", null, field.required ? "Select..." : "(leave blank)");
    blank.value = "";
    sel.append(blank);
    for (const opt of field.options) {
      const o = el("option", null, opt);
      o.value = opt;
      if (opt === value) o.selected = true;
      sel.append(o);
    }
    if (describedBy) sel.setAttribute("aria-describedby", describedBy);
    if (field.required) sel.required = true;
    if (err) sel.setAttribute("aria-invalid", "true");
    sel.onchange = () => store.setHuman(field.name, sel.value || undefined);
    wrap.append(sel);
  } else {
    const inp = el("input");
    inp.type = "text";
    inp.id = `f-${field.name}`;
    inp.value = value === undefined ? "" : value;
    if (field.type === "date") inp.placeholder = "MM/DD/YYYY";
    if (field.maxLength) inp.maxLength = field.maxLength;
    if (describedBy) inp.setAttribute("aria-describedby", describedBy);
    if (field.required) inp.required = true;
    if (err) inp.setAttribute("aria-invalid", "true");
    inp.onchange = () => store.setHuman(field.name, inp.value.trim() || undefined);
    wrap.append(inp);
  }

  if (err) {
    const node = el("div", "err", err.message);
    node.id = errId;
    node.setAttribute("role", "alert");
    wrap.append(node);
  } else if (field.help) {
    const node = el("div", "help", field.help);
    node.id = helpId;
    wrap.append(node);
  }

  return wrap;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderSection(section) {
  const available = store.isSectionAvailable(section);
  const st = store.sectionStatus(section.id);
  const v = store.values();

  const card = el("section", "card section" + (available ? "" : " locked"));
  card.id = `section-${section.id}`;

  const head = el("div", "section-head");
  head.append(el("span", "section-part", section.part));
  head.append(el("h3", null, section.title));
  const toolTag = el("span", "section-tool" + (available ? "" : " off"), section.tool);
  toolTag.title = available
    ? "This tool is registered and an agent can call it now"
    : "Not registered: an agent cannot reach this section yet";
  head.append(toolTag);
  card.append(head);

  if (!available) {
    card.setAttribute("aria-disabled", "true");
    const why = section.availableWhen && section.requires.every(id => store.sectionStatus(id).satisfied)
      ? "An earlier answer means this section does not apply to you, so its tool is not registered."
      : `Locked until ${section.requires.map(id => SECTION_BY_ID[id].title).join(" and ")} ${section.requires.length > 1 ? "are" : "is"} valid. Its tool is not registered, so an agent cannot fill it out of order.`;
    const banner = el("div", "locked-banner", why);
    banner.id = `locked-${section.id}`;
    card.append(banner);
    card.setAttribute("aria-describedby", banner.id);
    return card;
  }

  card.append(el("p", "section-note", descriptionFor(section, v)));

  const visible = new Set(fieldsFor(section, v).map(f => f.name));
  const grid = el("div", "grid");
  for (const field of allFieldsFor(section, v)) {
    if (!visible.has(field.name)) continue;
    grid.append(renderField(field, section));
  }
  card.append(grid);

  if (section.repeatable) {
    const rows = el("div", "rows");
    const committed = store.state[section.collection] || [];
    committed.forEach((row, i) => {
      const chip = el("div", "row-chip");
      chip.append(el("span", null, [row.givenName, row.middleName, row.familyName].filter(Boolean).join(" ")));
      chip.append(el("span", "spacer"));
      const del = el("button", "btn btn-tiny", "remove");
      del.onclick = () => { committed.splice(i, 1); store.emit(); };
      chip.append(del);
      rows.append(chip);
    });
    store.state.pendingRows.forEach((row, i) => {
      if (row.collection !== section.collection) return;
      const chip = el("div", "row-chip pending");
      chip.append(el("span", null, [row.value.givenName, row.value.middleName, row.value.familyName].filter(Boolean).join(" ")));
      chip.append(el("span", "spacer"));
      const a = el("button", "btn btn-tiny", "accept");
      a.onclick = () => store.acceptPendingRow(i);
      const r = el("button", "btn btn-tiny", "reject");
      r.onclick = () => store.rejectPendingRow(i);
      chip.append(a, r);
      rows.append(chip);
    });
    if (rows.childElementCount) card.append(rows);
  }

  if (st.crossErrors.length) {
    const box = el("div", "cross-errors");
    for (const e of st.crossErrors) {
      const item = el("div", "cross-error");
      item.append(el("strong", null, e.message));
      if (e.hint) item.append(el("span", null, e.hint));
      box.append(item);
    }
    card.append(box);
  }

  return card;
}

function renderSections() {
  const host = $("sections");
  host.textContent = "";
  for (const section of SECTIONS) host.append(renderSection(section));
}

// ---------------------------------------------------------------------------
// Agent pane
// ---------------------------------------------------------------------------

async function renderTools() {
  const own = await getTools();
  const fed = federation.federationState();
  // Tools the browser already federated into this document would otherwise be
  // listed twice, so only bridge-discovered ones are appended here.
  const ownNames = new Set(own.map(t => t.name));
  const crossNames = new Set(fed.tools.filter(t => !ownNames.has(t.name)).map(t => t.name));
  const tools = [...own, ...fed.tools.filter(t => crossNames.has(t.name))];

  const list = $("tool-list");
  const names = tools.map(t => t.name);
  $("tool-count").textContent = String(names.length);

  const gone = [...knownTools].filter(n => !names.includes(n));
  list.textContent = "";

  for (const tool of tools) {
    const li = el("li");
    if (!knownTools.has(tool.name)) li.classList.add("entering");
    if (selectedTool === tool.name) li.classList.add("selected");
    if (tool.name.startsWith("vault-")) li.classList.add("cross");

    const btn = el("button", "tool-btn");
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(selectedTool === tool.name));
    btn.append(el("span", "dot"));
    btn.append(el("span", "n", tool.name));
    btn.title = tool.description;
    btn.setAttribute("aria-label", `${tool.name}. ${tool.description}`);
    btn.onclick = () => { selectedTool = tool.name; showSchema(tool); renderTools(); };

    li.append(btn);
    list.append(li);
  }

  for (const name of gone) {
    const li = el("li", "leaving");
    li.setAttribute("aria-hidden", "true");
    const ghost = el("span", "tool-btn");
    ghost.append(el("span", "dot"));
    ghost.append(el("span", "n", name));
    li.append(ghost);
    list.append(li);
    setTimeout(() => li.remove(), 430);
  }

  knownTools = new Set(names);

  const locked = SECTIONS.filter(s => !store.isSectionAvailable(s));
  $("locked-note").textContent = locked.length
    ? `Not registered yet: ${locked.map(s => s.tool).join(", ")}.`
    : "Every section tool is registered.";

  if (selectedTool) {
    const still = tools.find(t => t.name === selectedTool);
    if (still) showSchema(still);
  }
}

function showSchema(tool) {
  $("schema-block").hidden = false;
  $("schema-desc").textContent = tool.description;
  // Annotations sit alongside the schema, since readOnlyHint and
  // untrustedContentHint are the part an agent uses to decide how much to
  // trust a result and whether to confirm before acting on it.
  const shown = {
    title: tool.title,
    annotations: tool.annotations || {},
    inputSchema: tool.inputSchema
  };
  if (tool.origin && tool.origin !== location.origin) shown.origin = tool.origin;
  $("schema-view").textContent = JSON.stringify(shown, null, 2);
}

function renderPending() {
  const host = $("pending-list");
  host.textContent = "";
  const entries = Object.entries(store.state.pending);
  const rows = store.state.pendingRows;
  $("pending-count").textContent = String(entries.length + rows.length);

  if (!entries.length && !rows.length) {
    host.append(el("div", "empty-note", "Nothing waiting. Values an agent proposes will queue up here for you."));
    return;
  }

  const bulk = el("div", "pending-bulk");
  const accAll = el("button", "btn btn-tiny", `Accept all ${entries.length + rows.length}`);
  accAll.onclick = () => store.acceptAllPending();
  const rejAll = el("button", "btn btn-tiny", "Reject all");
  rejAll.onclick = () => store.rejectAllPending();
  bulk.append(accAll, rejAll);
  host.append(bulk);

  for (const [name, p] of entries) {
    const item = el("div", "pending-item");
    item.append(el("div", "pf", name));
    const pv = el("div", "pv");
    const was = store.state.committed[name];
    if (was !== undefined) pv.append(el("span", "was", String(was)));
    pv.append(document.createTextNode(String(p.value)));
    item.append(pv);
    const acts = el("div", "pending-actions");
    const a = el("button", "btn btn-tiny", "Accept");
    a.onclick = () => store.acceptPending(name);
    const r = el("button", "btn btn-tiny", "Reject");
    r.onclick = () => store.rejectPending(name);
    acts.append(a, r);
    item.append(acts);
    host.append(item);
  }

  rows.forEach((row, i) => {
    const item = el("div", "pending-item");
    item.append(el("div", "pf", `${row.collection}[]`));
    item.append(el("div", "pv", JSON.stringify(row.value)));
    const acts = el("div", "pending-actions");
    const a = el("button", "btn btn-tiny", "Accept");
    a.onclick = () => store.acceptPendingRow(i);
    const r = el("button", "btn btn-tiny", "Reject");
    r.onclick = () => store.rejectPendingRow(i);
    acts.append(a, r);
    item.append(acts);
    host.append(item);
  });
}

function renderLog() {
  const host = $("log");
  host.textContent = "";
  if (!store.state.toolLog.length) {
    host.append(el("div", "empty-note", "No tool calls yet."));
    return;
  }
  for (const entry of store.state.toolLog.slice(0, 24)) {
    const item = el("div", `log-item ${entry.kind}`);
    const head = el("div");
    head.append(el("span", "lt", entry.tool));
    if (entry.declarative) head.append(el("span", "decl", "declarative"));
    if (entry.waiting) head.append(el("span", "decl", "awaiting you"));
    if (entry.crossOrigin) {
      const tag = el("span", "xo", "cross-origin");
      tag.title = `Ran on ${entry.crossOrigin}, not on this page.`;
      head.append(tag);
    }
    head.append(document.createTextNode(
      entry.kind === "call" ? "  called" :
      entry.kind === "result" ? "  returned" :
      entry.kind === "progress" ? `  ${entry.phase}` : "  failed"
    ));
    item.append(head);

    if (entry.kind === "call" && Object.keys(entry.args || {}).length) {
      item.append(el("pre", null, JSON.stringify(entry.args)));
    }
    if (entry.kind === "result") {
      const rej = entry.structured?.rejected || [];
      const line = el("pre", rej.length ? "rejected" : null,
        (entry.text || "").split("\n").slice(0, 4).join("\n"));
      item.append(line);
    }
    if (entry.kind === "error") item.append(el("pre", null, entry.text));
    host.append(item);
  }
}

// ---------------------------------------------------------------------------
// Try-a-tool panel: the same calls an in-page agent would make
// ---------------------------------------------------------------------------

let tryController = null;

async function openTry() {
  const tools = await getTools();
  const sel = $("try-tool");
  sel.textContent = "";
  for (const t of tools) {
    const o = el("option", null, t.name);
    o.value = t.name;
    if (t.name === selectedTool) o.selected = true;
    sel.append(o);
  }
  $("try-result").hidden = true;
  $("try-modal").hidden = false;
}

async function runTry() {
  const name = $("try-tool").value;
  let args;
  try {
    args = JSON.parse($("try-args").value || "{}");
  } catch (e) {
    $("try-result").hidden = false;
    $("try-result").textContent = `Arguments are not valid JSON: ${e.message}`;
    return;
  }
  const tools = await getTools();
  const tool = tools.find(t => t.name === name);
  tryController = new AbortController();
  $("btn-try-abort").hidden = false;
  $("try-result").hidden = false;
  $("try-result").textContent = "running...";
  try {
    const res = await executeTool(tool, args, { signal: tryController.signal });
    $("try-result").textContent = res.content?.[0]?.text || JSON.stringify(res, null, 2);
  } catch (err) {
    $("try-result").textContent = `${err.name}: ${err.message}`;
  } finally {
    $("btn-try-abort").hidden = true;
    tryController = null;
  }
}

// ---------------------------------------------------------------------------
// Packet
// ---------------------------------------------------------------------------

function renderPacket() {
  const v = store.values();
  const body = $("packet-body");
  body.textContent = "";
  for (const section of store.availableSections()) {
    const fields = fieldsFor(section, v);
    if (!fields.length) continue;
    const block = el("div", "packet-section");
    block.append(el("h4", null, `${section.part} — ${section.title}`));
    for (const f of fields) {
      const row = el("div", "packet-row");
      row.append(el("span", "pl", f.label));
      row.append(el("span", "pvv", displayValue(f, v[f.name])));
      block.append(row);
    }
    body.append(block);
  }
  if (store.state.otherNames.length) {
    const block = el("div", "packet-section");
    block.append(el("h4", null, "Other names used"));
    for (const n of store.state.otherNames) {
      const row = el("div", "packet-row");
      row.append(el("span", "pl", "Former name"));
      row.append(el("span", "pvv", [n.givenName, n.middleName, n.familyName].filter(Boolean).join(" ")));
      block.append(row);
    }
    body.append(block);
  }
  $("packet-modal").hidden = false;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function renderElicitation() {
  const ask = store.state.elicitation;
  const modal = $("ask-modal");
  if (!ask) {
    modal.hidden = true;
    return;
  }
  $("ask-title").textContent = ask.title;
  $("ask-detail").textContent = ask.detail;
  $("btn-ask-confirm").textContent = ask.confirmLabel;
  $("btn-ask-decline").textContent = ask.declineLabel;
  const wasHidden = modal.hidden;
  modal.hidden = false;
  // Move focus into the dialog the first time it opens, so a keyboard user is
  // not left tabbing behind a modal that is blocking their agent.
  if (wasHidden) $("btn-ask-confirm").focus();
}

export function renderAll() {
  renderElicitation();
  renderRail();
  renderSections();
  renderPending();
  renderLog();
  $("certify").checked = store.state.certified;
  $("auto-accept").checked = store.state.autoAccept;
  store.state.everRendered = true;
}

export function initUI() {
  refreshBadge();

  initPersistenceControls();
  initWalkthrough();
  $("btn-vault-audit").onclick = runVaultAudit;

  // Only these two clicks can settle a suspended tool call.
  $("btn-ask-confirm").onclick = () => store.settleElicitation(true);
  $("btn-ask-decline").onclick = () => store.settleElicitation(false);
  $("ask-modal").addEventListener("keydown", ev => {
    if (ev.key === "Escape") store.settleElicitation(false);
  });

  $("certify").onchange = e => store.setCertified(e.target.checked);
  $("auto-accept").onchange = e => store.setAutoAccept(e.target.checked);
  $("btn-reset").onclick = () => { seenFields = new Set(); store.reset(); };
  $("btn-demo").onclick = loadSample;

  $("btn-try").onclick = openTry;
  $("btn-try-cancel").onclick = () => { $("try-modal").hidden = true; };
  $("btn-try-run").onclick = runTry;
  $("btn-try-abort").onclick = () => tryController?.abort();
  $("btn-close-schema").onclick = () => { selectedTool = null; $("schema-block").hidden = true; renderTools(); };

  $("btn-packet-close").onclick = () => { $("packet-modal").hidden = true; };
  $("btn-packet-print").onclick = () => window.print();
  window.addEventListener("ombuds:packet", renderPacket);

  store.subscribe(() => { refreshBadge(); refreshVaultPanel(); renderAll(); renderTools(); });
  renderAll();
  renderTools();
  refreshFinderTag();
  refreshVaultPanel();
}

// Which panel the current step is talking about, so a viewer's eye goes to the
// right place without the narrator having to say "look at the sidebar".
const WATCH_TARGETS = {
  "tool-surface": () => document.querySelector(".pane-block"),
  schema: () => $("schema-block"),
  queue: () => $("pending-list")?.closest(".pane-block"),
  log: () => $("log")?.closest(".pane-block"),
  vault: () => $("vault-card"),
  ask: () => null
};

function spotlight(watch) {
  for (const el of document.querySelectorAll(".spotlight")) el.classList.remove("spotlight");
  const target = WATCH_TARGETS[watch]?.();
  if (!target) return;
  target.classList.add("spotlight");
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderWalkthrough(state) {
  const bar = $("walkbar");
  if (!state || (!state.started && !walkActive)) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.classList.toggle("busy", state.running);

  const pct = Math.round(((state.index + 1) / state.total) * 100);
  $("walk-fill").style.width = `${pct}%`;

  // Before the first step there is no step to describe. The reset that starts a
  // run announces exactly that state, and reading through it threw, which killed
  // the click handler before it could advance to step one.
  if (!state.step) {
    $("walk-count").textContent = `0/${state.total}`;
    $("walk-caption").textContent = "Ready. Every step below is a real tool call through getTools() and executeTool().";
    $("btn-walk-next").hidden = false;
    $("btn-walk-next").disabled = false;
    $("btn-walk-next").textContent = "Next step";
    $("btn-walk-auto").hidden = false;
    $("walk-fill").style.width = "0%";
    bar.classList.remove("waiting");
    return;
  }

  if (state.done) {
    $("walk-count").textContent = "done";
    $("btn-walk-auto").hidden = true;
    $("walk-caption").textContent =
      "That was every step, and each one was a real tool call. The tool surface, the schemas, the rejections, and the cross-origin lookup are all live.";
    $("btn-walk-next").hidden = true;
    bar.classList.remove("waiting");
    spotlight(null);
    return;
  }

  const mm = Math.floor(state.elapsedSeconds / 60);
  const ss = String(state.elapsedSeconds % 60).padStart(2, "0");
  $("walk-count").textContent = `${state.index + 1}/${state.total}  ${mm}:${ss}`;
  $("btn-walk-auto").textContent = state.auto ? "Pause" : "Auto-play";
  $("walk-caption").textContent = state.step.caption;
  $("btn-walk-next").hidden = false;
  $("btn-walk-next").textContent = state.running ? "Running..." : "Next step";
  $("btn-walk-next").disabled = state.running;
  bar.classList.toggle("waiting", Boolean(state.step.waitsForHuman));
  if (!state.running) spotlight(state.step.watch);
}

let walkActive = false;

function initWalkthrough() {
  walk.onWalkthrough(renderWalkthrough);

  $("btn-walk").onclick = () => {
    walkActive = true;
    seenFields = new Set();
    walk.startWalkthrough();
    renderWalkthrough(walk.walkthroughState());
    walk.nextStep();
  };

  $("btn-walk-next").onclick = () => walk.nextStep();

  // Auto-play holds each step for the time the narration script allots it, so a
  // single take needs no clicking.
  $("btn-walk-auto").onclick = () => {
    const on = !walk.walkthroughState().auto;
    walk.setAuto(on);
  };

  $("btn-walk-exit").onclick = () => {
    walkActive = false;
    walk.resetWalkthrough();
    $("walkbar").hidden = true;
    for (const el of document.querySelectorAll(".spotlight")) el.classList.remove("spotlight");
  };

  // Space advances the walkthrough, so a narrator can drive it without hunting
  // for a button mid-sentence.
  document.addEventListener("keydown", ev => {
    if (!walkActive || $("walkbar").hidden) return;
    if (ev.key !== " " || ev.target.matches("input, textarea, select, button")) return;
    ev.preventDefault();
    walk.nextStep();
  });
}

function initPersistenceControls() {
  const toggle = $("persist-toggle");
  const clear = $("btn-clear-saved");

  if (!persist.storageAvailable()) {
    toggle.disabled = true;
    setPersistState("Saving is unavailable in this browser or window.", true);
    return;
  }

  toggle.checked = persist.isEnabled();

  toggle.onchange = () => {
    if (toggle.checked) {
      persist.enable();
      setPersistState("Saved in this browser only.");
    } else {
      persist.disable();
      setPersistState("Saving off. Nothing is stored.");
    }
    clear.hidden = !toggle.checked;
  };

  clear.hidden = !persist.isEnabled();
  clear.onclick = () => {
    persist.clearSaved();
    seenFields = new Set();
    store.reset();
    setPersistState("Saved draft deleted.");
  };
}

function setPersistState(text, warn = false) {
  const node = $("persist-state");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("warn", warn);
}

export function announceRestore(savedAt) {
  if (!savedAt) return;
  const when = new Date(savedAt);
  const stamp = Number.isNaN(when.getTime()) ? "earlier" : when.toLocaleString();
  setPersistState(`Draft restored from ${stamp}. Re-check the certification before filing.`);
}

async function refreshFinderTag() {
  const tag = document.getElementById("finder-tool-tag");
  if (!tag) return;
  const live = await declarativeToolIsLive();
  tag.classList.toggle("off", !live);
  tag.textContent = live ? "declarative tool" : "declarative tool";
  tag.title = live
    ? "The browser synthesized find-eligibility-category from this form's markup. The page never called registerTool for it."
    : "This browser did not synthesize a tool from the form markup, so declarative WebMCP is unavailable here. The form still works for you, and the imperative list-eligibility-categories tool covers the same ground for an agent.";
}

function refreshVaultPanel() {
  const state = federation.federationState();
  const tag = $("vault-transport");
  const hint = $("vault-hint");
  if (!tag) return;

  const labels = {
    webmcp: ["exposedTo + fromOrigins", "The browser federated the vault's tools across the origin boundary."],
    bridge: ["bridged", "This browser did not federate tools across origins, so the vault is answering over a postMessage bridge with the same shape."],
    none: ["not connected", "The vault has not published any tools to this origin."]
  };
  const [label, why] = labels[state.transport] || labels.none;
  tag.textContent = label;
  tag.classList.toggle("off", state.transport === "none");
  tag.title = why;
  hint.textContent = state.origin
    ? `${state.tools.length} tool${state.tools.length === 1 ? "" : "s"} from ${state.origin}`
    : "No vault is configured for this origin.";
  $("btn-vault-audit").disabled = state.transport === "none";
}

async function runVaultAudit() {
  const host = $("vault-audit");
  host.textContent = "";
  const btn = $("btn-vault-audit");
  btn.disabled = true;
  btn.textContent = "Checking...";

  try {
    // The checklist comes from this page's own precheck, and each line is then
    // resolved by a tool running on the vault's origin.
    const pre = await executeNamed("run-eligibility-precheck");
    const checklist = pre?.structuredContent?.documentChecklist || [];
    if (!checklist.length) {
      host.append(el("div", "empty-note", "Fill in more of the form first so there is a checklist to check."));
      return;
    }

    for (const requirement of checklist) {
      const res = await federation.callVaultTool("vault-check-requirement", { requirement });
      const sc = res?.structuredContent || {};
      const state = !sc.held ? "missing" : sc.state === "expired" ? "expired" : sc.state === "expiring" ? "expiring" : "held";
      const row = el("div", `va-row ${state}`);
      row.append(el("span", "va-state", state === "held" ? "on file" : state));
      const body = el("div", "va-body");
      body.append(el("strong", null, requirement));
      body.append(el("span", null, res?.content?.[0]?.text || ""));
      row.append(body);
      host.append(row);
    }
  } catch (err) {
    host.append(el("div", "empty-note", `The vault could not be reached: ${err.message}`));
  } finally {
    btn.disabled = false;
    btn.textContent = "Check my checklist against the vault";
  }
}

async function executeNamed(name, args = {}) {
  const tools = await getTools();
  const tool = tools.find(t => t.name === name);
  if (!tool) return null;
  return executeTool(tool, args);
}

function refreshBadge() {
  const mode = getMode();
  const badge = $("mode-badge");
  if (mode === "native") {
    badge.textContent = "WebMCP live";
    badge.classList.add("live");
    badge.title = "document.modelContext is available, so a real agent can discover and call these tools.";
  } else if (mode === "shim-fallback") {
    badge.classList.remove("live");
    badge.textContent = "WebMCP refused";
    badge.title = `The browser exposes document.modelContext but refused to register tools (${getNativeError()?.name || "error"}). This usually means the "tools" permissions policy is disabled. The page has fallen back to its own registry so the interface still works.`;
  } else {
    badge.classList.remove("live");
    badge.textContent = "WebMCP shim active";
    badge.title = "document.modelContext is unavailable, so the page is serving its own tool registry. Enable chrome://flags/#enable-webmcp-testing, or use the Try a tool panel, which exercises the identical code path.";
  }
}

function loadSample() {
  seenFields = new Set();
  store.reset();
  const sample = {
    reasonForApplying: "Initial permission to accept employment",
    familyName: "Sok", givenName: "Dara", hasOtherNames: false,
    dateOfBirth: "03/14/1998", countryOfBirth: "Cambodia", cityOfBirth: "Battambang",
    countryOfCitizenship: "Cambodia", gender: "Male", maritalStatus: "Single",
    mailingStreet: "1420 Wolfe Road", mailingUnitType: "Apt", mailingUnitNumber: "12B",
    mailingCity: "Sunnyvale", mailingState: "CA", mailingZip: "94086",
    mailingSameAsPhysical: true,
    hasSSN: false, wantsSSNCard: false
  };
  for (const [k, val] of Object.entries(sample)) store.state.committed[k] = val;
  store.emit();
}
