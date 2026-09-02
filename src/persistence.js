import * as store from "./store.js";

// Opt-in local persistence.
//
// This form collects immigration status, government file numbers, and in some
// branches a Social Security Number. Saving that by default would be the wrong
// call, so persistence is off until the applicant turns it on, it never leaves
// the browser, and clearing it is one click.
//
// Every access is wrapped, because a private window, cleared site data, or a
// browser configured to block storage makes localStorage throw on access rather
// than returning null.

const KEY = "ombuds.draft.v1";
const FLAG = "ombuds.persist.v1";

function safeGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeRemove(key) {
  try { window.localStorage.removeItem(key); } catch { /* nothing to do */ }
}

export const isEnabled = () => safeGet(FLAG) === "1";
export const hasSavedDraft = () => safeGet(KEY) !== null;

export function storageAvailable() {
  try {
    const probe = "ombuds.probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// Only committed answers are saved. Pending proposals are a live artifact of a
// conversation with an agent, and restoring a stale review queue into a fresh
// session would ask the applicant to rule on something they no longer remember.
function snapshot() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    committed: store.state.committed,
    otherNames: store.state.otherNames,
    certified: store.state.certified
  };
}

let writeTimer = null;

export function save() {
  if (!isEnabled()) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    safeSet(KEY, JSON.stringify(snapshot()));
  }, 300);
}

export function restore() {
  const raw = safeGet(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.version !== 1 || typeof data.committed !== "object" || data.committed === null) return null;
    store.state.committed = { ...data.committed };
    store.state.otherNames = Array.isArray(data.otherNames) ? data.otherNames : [];
    // A signature is an attestation made at a moment in time, so it does not
    // survive a reload. The applicant re-affirms it against what they now see.
    store.state.certified = false;
    store.emit();
    return data.savedAt || null;
  } catch {
    // A corrupt draft is worse than none, since it would silently seed the form
    // with values the applicant never entered.
    safeRemove(KEY);
    return null;
  }
}

export function enable() {
  safeSet(FLAG, "1");
  safeSet(KEY, JSON.stringify(snapshot()));
}

export function disable() {
  safeRemove(FLAG);
  safeRemove(KEY);
}

export function clearSaved() {
  safeRemove(KEY);
}

export function initPersistence() {
  const restoredAt = isEnabled() ? restore() : null;
  store.subscribe(save);
  return restoredAt;
}
