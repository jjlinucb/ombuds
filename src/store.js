import { SECTIONS, SECTION_BY_ID, fieldsFor, SENSITIVE_FIELDS } from "./form-definition.js";
import { validateField, crossFieldErrors } from "./validators.js";

// Two layers of truth.
//
// `committed` is what the applicant has actually accepted. `pending` is what the
// agent has proposed and nobody has approved yet. Every read that decides what
// the form looks like uses the merged view, so the agent sees the consequences
// of its own proposals immediately and can keep working. Nothing reaches
// `committed` without a human clicking accept.

const listeners = new Set();

export const state = {
  committed: {},
  pending: {},          // field name -> { value, at, note }
  otherNames: [],       // committed repeatable rows
  pendingRows: [],      // { collection, value, at }
  certified: false,
  autoAccept: false,
  toolLog: [],
  registeredToolNames: [],
  // An in-flight request for a human decision. The agent's tool call is
  // genuinely suspended while this is set.
  elicitation: null,
  // Committed changes, newest first, so a mistake that was already accepted can
  // still be walked back. Withdrawing a proposal only helps before someone
  // clicks accept; this covers after.
  history: []
};

let elicitationId = 0;

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach(fn => fn());

// The view every consumer should read: committed values overlaid with proposals.
export function values() {
  const merged = { ...state.committed };
  for (const [k, p] of Object.entries(state.pending)) merged[k] = p.value;
  return merged;
}

export function visibleFields(sectionId) {
  const section = SECTION_BY_ID[sectionId];
  return section ? fieldsFor(section, values()) : [];
}

// A section is available when its prerequisites are complete and its own
// `availableWhen` guard passes. Availability is what drives tool registration,
// so an agent literally cannot reach into a section the form has not opened.
export function isSectionAvailable(section) {
  const v = values();
  if (section.availableWhen && !section.availableWhen(v)) return false;
  return section.requires.every(id => sectionStatus(id).satisfied);
}

export function sectionStatus(sectionId) {
  const section = SECTION_BY_ID[sectionId];
  const v = values();
  const fields = fieldsFor(section, v);
  const errors = [];
  let filled = 0;

  for (const f of fields) {
    const raw = v[f.name];
    const r = validateField(f, raw);
    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (!empty) filled++;
    if (!r.ok) errors.push({ field: f.name, label: f.label, ...r });
  }

  const relevant = new Set(fields.map(f => f.name));
  const cross = crossFieldErrors(v)
    .filter(e => e.fields.some(f => relevant.has(f)))
    .map(e => ({ field: e.fields[0], label: section.title, code: e.code, message: e.message, hint: e.hint, cross: true }));

  return {
    id: sectionId,
    title: section.title,
    part: section.part,
    total: fields.length,
    filled,
    errors: [...errors, ...cross],
    fieldErrors: errors,
    crossErrors: cross,
    // `complete` drives the progress display and the final packet gate.
    complete: fields.length > 0 && errors.length === 0 && cross.length === 0,
    // `satisfied` drives tool registration, and deliberately ignores cross-field
    // conflicts. A conflict spans two sections, so counting it against either one
    // would unregister the tool the agent needs in order to fix the conflict,
    // leaving it with a reported problem and no way to act on it.
    satisfied: fields.length > 0 && errors.length === 0,
    empty: filled === 0
  };
}

export function availableSections() {
  return SECTIONS.filter(isSectionAvailable);
}

export function formStatus() {
  const avail = availableSections();
  const statuses = avail.map(s => sectionStatus(s.id));
  const complete = statuses.filter(s => s.complete);
  const blocking = statuses.flatMap(s =>
    s.errors.filter(e => e.code !== "REQUIRED" || !s.empty).map(e => ({ section: s.id, ...e }))
  );
  // Two different reasons a section can be closed, and an agent needs to tell
  // them apart: one will open later, the other never applies to this applicant.
  const locked = SECTIONS.filter(s => !isSectionAvailable(s)).map(s => {
    const prereqsMet = s.requires.every(id => sectionStatus(id).satisfied);
    const notApplicable = prereqsMet && Boolean(s.availableWhen);
    return {
      section: s.id,
      title: s.title,
      reason: notApplicable ? "does-not-apply" : "prerequisites-incomplete",
      unlocksAfter: notApplicable ? [] : s.requires,
      explanation: notApplicable
        ? "an earlier answer means this section does not apply to this applicant"
        : `waiting on ${s.requires.join(" and ")}`
    };
  });

  const nextIncomplete = statuses.find(s => !s.complete);
  const pendingCount = Object.keys(state.pending).length + state.pendingRows.length;

  return {
    percentComplete: statuses.length ? Math.round((complete.length / statuses.length) * 100) : 0,
    sectionsComplete: complete.length,
    sectionsAvailable: statuses.length,
    sections: statuses.map(s => ({
      section: s.id, part: s.part, title: s.title,
      complete: s.complete, filled: s.filled, total: s.total,
      errorCount: s.errors.length
    })),
    lockedSections: locked,
    pendingReviewCount: pendingCount,
    blockingIssues: blocking,
    certified: state.certified,
    readyToGeneratePacket: statuses.length > 0 && statuses.every(s => s.complete) &&
                           pendingCount === 0 && state.certified,
    nextAction: nextAction(nextIncomplete, pendingCount)
  };
}

function nextAction(nextIncomplete, pendingCount) {
  if (pendingCount > 0) {
    return `${pendingCount} proposed change${pendingCount === 1 ? " is" : "s are"} waiting for the applicant to accept or reject in the page. You can keep working on other sections, but the applicant must clear the review queue before the packet can be generated.`;
  }
  if (nextIncomplete) {
    const s = nextIncomplete;
    if (s.empty) return `Section "${s.title}" (${s.part}) has not been started. Its tool is registered and ready.`;
    const first = s.errors[0];
    return first
      ? `Section "${s.title}" needs attention: ${first.message}`
      : `Continue with section "${s.title}".`;
  }
  if (!state.certified) {
    return "Every available section is complete. The applicant must now check the certification box in the page themselves. That step is intentionally not available as a tool, because only the person filing can attest to their own application.";
  }
  return "The form is complete and certified. Call generate-filing-packet to produce the review summary.";
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Proposals are validated on arrival so the agent gets its feedback in the tool
// result, not after a human round trip.
export function propose(sectionId, patch, source = "agent") {
  const section = SECTION_BY_ID[sectionId];
  const accepted = [];
  const rejected = [];
  const flagged = [];

  // Apply against a scratch copy so conditional fields that this very patch
  // unlocks are considered valid targets within the same call.
  const scratch = { ...values() };
  for (const [k, val] of Object.entries(patch)) {
    if (val !== undefined) scratch[k] = val;
  }
  const allowed = new Set(fieldsFor(section, scratch).map(f => f.name));

  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    if (!allowed.has(name)) {
      rejected.push({
        field: name,
        code: "FIELD_NOT_APPLICABLE",
        message: `"${name}" is not a field this section is asking for right now.`,
        hint: "The form's current answers mean this field does not apply. Re-read this tool's inputSchema, which lists exactly the fields that are in scope."
      });
      continue;
    }

    const field = fieldsFor(section, scratch).find(f => f.name === name);
    const r = validateField(field, value);
    if (!r.ok) {
      rejected.push({ field: name, label: field.label, ...r });
      continue;
    }

    if (source === "agent" && SENSITIVE_FIELDS.has(name)) {
      flagged.push({
        field: name,
        label: field.label,
        code: "NEEDS_HUMAN_AFFIRMATION",
        message: `${field.label} is a legal consent, so it was not applied.`,
        hint: "An agent cannot consent on the applicant's behalf. The applicant must tick this box in the page."
      });
      continue;
    }

    if (source === "human" || state.autoAccept) {
      recordChange(name, value, source);
      delete state.pending[name];
    } else {
      state.pending[name] = { value, at: Date.now() };
    }
    accepted.push({ field: name, label: field.label, value });
  }

  emit();
  return { accepted, rejected, flagged };
}

export function proposeRow(collection, row, source = "agent") {
  const section = SECTIONS.find(s => s.collection === collection);
  const rejected = [];
  for (const f of fieldsFor(section, values())) {
    const r = validateField(f, row[f.name]);
    if (!r.ok) rejected.push({ field: f.name, label: f.label, ...r });
  }
  if (rejected.length) return { accepted: [], rejected, flagged: [] };

  if (source === "human" || state.autoAccept) {
    state[collection].push(row);
  } else {
    state.pendingRows.push({ collection, value: row, at: Date.now() });
  }
  emit();
  return { accepted: [{ field: collection, value: row }], rejected: [], flagged: [] };
}

function recordChange(name, value, source) {
  const from = state.committed[name];
  if (from === value) return;
  state.history.unshift({ field: name, from, to: value, source, at: Date.now() });
  if (state.history.length > 40) state.history.pop();
  state.committed[name] = value;
}

export function acceptPending(name) {
  const p = state.pending[name];
  if (!p) return false;
  recordChange(name, p.value, "agent");
  delete state.pending[name];
  emit();
  return true;
}

export function rejectPending(name) {
  if (!(name in state.pending)) return false;
  delete state.pending[name];
  emit();
  return true;
}

export function acceptAllPending() {
  const n = Object.keys(state.pending).length + state.pendingRows.length;
  for (const [k, p] of Object.entries(state.pending)) recordChange(k, p.value, "agent");
  state.pending = {};
  for (const row of state.pendingRows) state[row.collection].push(row.value);
  state.pendingRows = [];
  emit();
  return n;
}

export function rejectAllPending() {
  const n = Object.keys(state.pending).length + state.pendingRows.length;
  state.pending = {};
  state.pendingRows = [];
  emit();
  return n;
}

export function acceptPendingRow(i) {
  const row = state.pendingRows[i];
  if (!row) return false;
  state[row.collection].push(row.value);
  state.pendingRows.splice(i, 1);
  emit();
  return true;
}

export function rejectPendingRow(i) {
  if (!state.pendingRows[i]) return false;
  state.pendingRows.splice(i, 1);
  emit();
  return true;
}

export function setHuman(name, value) {
  if (value === undefined || value === null || value === "") {
    const from = state.committed[name];
    if (from !== undefined) {
      state.history.unshift({ field: name, from, to: undefined, source: "human", at: Date.now() });
      if (state.history.length > 40) state.history.pop();
    }
    delete state.committed[name];
  } else {
    recordChange(name, value, "human");
  }
  delete state.pending[name];
  emit();
}

// Walk back the most recent committed change. Returns what was undone so the
// caller can say so plainly rather than reporting a silent success.
export function undoLastChange() {
  const last = state.history.shift();
  if (!last) return null;
  if (last.to === undefined && last.from !== undefined) {
    state.committed[last.field] = last.from;
  } else if (last.from === undefined) {
    delete state.committed[last.field];
  } else {
    state.committed[last.field] = last.from;
  }
  emit();
  return last;
}

export function setCertified(v) { state.certified = v; emit(); }
export function setAutoAccept(v) { state.autoAccept = v; emit(); }

// Elicitation.
//
// WebMCP Issue #165 is open on how a tool should prompt the user for explicit
// authorization mid-execution. No API for it is standardized yet, so this is a
// working answer built from what the spec already provides: `execute` may return
// a promise, and it receives an AbortSignal.
//
// The tool call does not resolve until a person clicks. The agent is left
// genuinely pending, cancellation propagates, and there is no code path by which
// the agent produces its own approval. That last property is the point. An
// agent may ask for a signature; only a human can supply one.
export function requestUserDecision({ title, detail, confirmLabel, declineLabel, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled before the applicant was asked.", "AbortError"));
      return;
    }

    const id = ++elicitationId;
    state.elicitation = {
      id, title, detail,
      confirmLabel: confirmLabel || "Approve",
      declineLabel: declineLabel || "Decline",
      resolve, reject,
      at: Date.now()
    };

    signal?.addEventListener("abort", () => {
      if (state.elicitation?.id !== id) return;
      state.elicitation = null;
      emit();
      reject(new DOMException("The applicant was still deciding when the request was cancelled.", "AbortError"));
    }, { once: true });

    emit();
  });
}

export function settleElicitation(approved) {
  const pending = state.elicitation;
  if (!pending) return false;
  state.elicitation = null;
  emit();
  pending.resolve({ approved, decidedAt: new Date().toISOString() });
  return true;
}

export function logToolCall(entry) {
  state.toolLog.unshift({ ...entry, at: Date.now() });
  if (state.toolLog.length > 60) state.toolLog.pop();
  emit();
}

export function reset() {
  // A pending question has to be released, or the agent waits forever on a form
  // that no longer exists.
  if (state.elicitation) {
    state.elicitation.reject(new DOMException("The form was reset while the applicant was deciding.", "AbortError"));
    state.elicitation = null;
  }
  state.committed = {};
  state.pending = {};
  state.otherNames = [];
  state.pendingRows = [];
  state.certified = false;
  state.toolLog = [];
  state.history = [];
  emit();
}
