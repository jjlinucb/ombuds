import * as store from "./store.js";
import { getTools, executeTool } from "./webmcp-adapter.js";
import * as federation from "./federation.js";

// A guided walkthrough.
//
// Every step below performs a real tool call through the same getTools() and
// executeTool() path an agent uses. Nothing is faked or replayed: the schemas
// shown are generated live, the rejections come from the real validators, and
// the cross-origin step really crosses the boundary.
//
// It exists for two reasons. A judge without an agent attached can still see
// what the page does, and a demonstration does not have to depend on a model
// behaving predictably while someone is recording.

const call = async (name, args = {}) => {
  const tool = (await getTools()).find(t => t.name === name);
  if (!tool) throw new Error(`Not registered right now: ${name}`);
  return executeTool(tool, args);
};

const acceptAll = () => store.acceptAllPending();
const pause = ms => new Promise(r => setTimeout(r, ms));

const selectTool = name => {
  const btn = [...document.querySelectorAll("#tool-list .tool-btn")]
    .find(b => b.textContent.trim() === name);
  btn?.click();
  return Boolean(btn);
};

const scrollTo = id => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });

// Each step says what a viewer should be looking at, then does it.
export const STEPS = [
  {
    caption: "Five tools registered. Only Part 1 is open, so that is all an agent can reach.",
    holdSeconds: 16,
    watch: "tool-surface",
    async run() { scrollTo("section-reason"); }
  },
  {
    caption: "The agent answers Part 1. Watch two new tools appear in the sidebar.",
    holdSeconds: 13,
    watch: "tool-surface",
    async run() {
      await call("set-reason-for-applying", { reasonForApplying: "Initial permission to accept employment" });
      acceptAll();
      await pause(500);
    }
  },
  {
    caption: "It fills the name and birth section. More sections unlock, so more tools register.",
    holdSeconds: 9,
    watch: "tool-surface",
    async run() {
      await call("set-personal-info", {
        familyName: "Sok", givenName: "Dara", hasOtherNames: false,
        dateOfBirth: "03/14/1998", countryOfBirth: "Cambodia", cityOfBirth: "Battambang",
        countryOfCitizenship: "Cambodia", gender: "Male", maritalStatus: "Single"
      });
      acceptAll();
      await pause(500);
    }
  },
  {
    caption: "Category (c)(9), a pending green card. Look at the schema: it asks for one thing.",
    holdSeconds: 11,
    watch: "schema",
    async run() {
      await call("set-eligibility-category", { eligibilityCategory: "(c)(9)" });
      acceptAll();
      await pause(600);
      selectTool("answer-category-questions");
      await pause(300);
    }
  },
  {
    caption: "Same tool, same name. Switch to STEM OPT and its schema becomes four different fields.",
    holdSeconds: 16,
    watch: "schema",
    async run() {
      await call("set-eligibility-category", { eligibilityCategory: "(c)(3)(C)" });
      acceptAll();
      await pause(700);
      selectTool("answer-category-questions");
      await pause(300);
    }
  },
  {
    caption: "The agent sends a malformed SEVIS number. The page rejects it with the rule and an example.",
    holdSeconds: 16,
    watch: "log",
    async run() {
      await call("answer-category-questions", { sevisNumber: "12345" });
      await pause(500);
    }
  },
  {
    caption: "It reads that and fixes its own argument. Nobody retyped anything.",
    holdSeconds: 6,
    watch: "log",
    async run() {
      await call("answer-category-questions", {
        sevisNumber: "N0012345678", schoolName: "San Jose State University",
        stemDegreeCipCode: "11.0701", employerEVerifyNumber: "123456",
        currentEadExpires: "11/30/2026"
      });
      await pause(400);
    }
  },
  {
    caption: "Its answers are proposals, sitting in the review queue until a person accepts them.",
    holdSeconds: 10,
    watch: "queue",
    async run() { await pause(900); }
  },
  {
    caption: "Accepted. Now the rest of the form, so we can get to the interesting part.",
    holdSeconds: 4,
    watch: "tool-surface",
    async run() {
      acceptAll();
      await pause(300);
      await call("set-mailing-address", {
        mailingStreet: "1420 Wolfe Road", mailingUnitType: "None", mailingCity: "Sunnyvale",
        mailingState: "CA", mailingZip: "94086", mailingSameAsPhysical: true
      });
      await call("set-government-numbers", { hasSSN: true, ssn: "123456789" });
      await call("set-immigration-history", {
        dateOfLastEntry: "08/20/2023", placeOfLastEntry: "San Francisco, CA",
        statusAtLastEntry: "F-1 student", currentImmigrationStatus: "F-1 student"
      });
      await call("set-contact-details", { daytimePhone: "4085551234", email: "dara@example.com" });
      acceptAll();
      await pause(500);
    }
  },
  {
    caption: "One question, four sources: this form, a filing window, a fee, and documents on another origin.",
    holdSeconds: 12,
    watch: "log",
    async run() {
      await call("assess-rejection-risk", {});
      await pause(600);
    }
  },
  {
    caption: "That expired I-20 came from a vault on a different origin, which publishes tools only to this page.",
    holdSeconds: 18,
    watch: "vault",
    async run() {
      scrollTo("vault-card");
      await pause(900);
    }
  },
  {
    caption: "Now it asks for a signature. Its tool call is suspended right now, waiting on a person.",
    holdSeconds: 13,
    watch: "ask",
    async run() {
      // Deliberately not awaited. The point of the step is that the call hangs.
      call("request-certification", { note: "Checked every section, your filing window, and your documents." })
        .then(res => { window.__walkthroughSignature = res; })
        .catch(() => {});
      await pause(700);
    }
  },
  {
    caption: "It can ask. It cannot sign. Only this click resolves that call.",
    holdSeconds: 23,
    watch: "ask",
    async run() { await pause(400); },
    waitsForHuman: true
  }
];

export const TOTAL_SECONDS = STEPS.reduce((n, s) => n + s.holdSeconds, 0);

// `current` is the step being displayed, not the next one queued. An earlier
// version incremented after running, so the caption flipped to the next step's
// text the instant a step finished and then held there. Every caption described
// the frame after the one on screen. The pointer advances at the start of a step
// now, so a caption and the thing it describes are the same moment.
let current = -1;
let running = false;
let autoTimer = null;
let auto = false;
const listeners = new Set();

export const walkthroughState = () => ({
  index: current,
  total: STEPS.length,
  running,
  auto,
  step: STEPS[current] || null,
  started: current >= 0,
  done: current >= STEPS.length - 1 && !running,
  elapsedSeconds: current > 0 ? STEPS.slice(0, current).reduce((n, s) => n + s.holdSeconds, 0) : 0,
  totalSeconds: TOTAL_SECONDS
});

export const onWalkthrough = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const announce = () => listeners.forEach(fn => fn(walkthroughState()));

export async function nextStep() {
  if (running) return;
  const next = current + 1;
  if (next >= STEPS.length) return;

  current = next;
  const step = STEPS[current];
  running = true;
  announce();

  const startedAt = Date.now();
  try {
    await step.run();
  } catch (err) {
    console.warn("[ombuds] walkthrough step failed", step.caption, err);
  }
  const ranFor = Date.now() - startedAt;

  running = false;
  announce();

  // Auto-play holds this step for the time the narration script allots it, with
  // the step's own execution time subtracted so wall-clock matches the script.
  // It stops at a step that waits on a person, because that is the point of
  // that step.
  if (auto && current < STEPS.length - 1) {
    if (step.waitsForHuman) { auto = false; announce(); return; }
    const remaining = Math.max(400, step.holdSeconds * 1000 - ranFor);
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => nextStep(), remaining);
  }
}

export function setAuto(on) {
  auto = on;
  clearTimeout(autoTimer);
  announce();
  if (auto && !running && current < STEPS.length - 1) nextStep();
}

export function resetWalkthrough() {
  clearTimeout(autoTimer);
  auto = false;
  current = -1;
  running = false;
  delete window.__walkthroughSignature;
  announce();
}

export function startWalkthrough() {
  store.reset();
  resetWalkthrough();
}
