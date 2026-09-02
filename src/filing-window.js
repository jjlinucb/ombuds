import { getCategory } from "./reference-data.js";

// Filing windows.
//
// Work authorization categories do not all accept an application at any time.
// Post-completion OPT has a window that opens 90 days before the program end
// date and closes 60 days after it. A STEM extension must be filed before the
// current card lapses. Filing outside the window is a rejection, and the
// applicant finds out by mail weeks later.
//
// This is the clearest example of knowledge that belongs in the page. The rule
// depends on the category and on a date the applicant has already entered, so
// only something running here can compute it. A backend tool would have to ask
// for both and hope the agent relayed them correctly.

const parse = v => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || "").trim());
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
};

const fmt = d => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
const shift = (d, days) => { const n = new Date(d); n.setDate(n.getDate() + days); return n; };
const daysBetween = (a, b) => Math.round((b - a) / 86400000);

// Per-category window rules, expressed against whichever date the category
// actually keys off.
const RULES = {
  "(c)(3)(A)": {
    anchorField: "programEndDate",
    anchorLabel: "program end date on your I-20",
    opensDaysBefore: 90,
    closesDaysAfter: 0,
    note: "Pre-completion OPT is filed while you are still studying, so the window closes when your program ends."
  },
  "(c)(3)(B)": {
    anchorField: "programEndDate",
    anchorLabel: "program end date on your I-20",
    opensDaysBefore: 90,
    closesDaysAfter: 60,
    note: "Post-completion OPT accepts filings from 90 days before your program ends until 60 days after."
  },
  "(c)(3)(C)": {
    // A STEM extension keys off the current card, not the program end date. An
    // earlier version anchored it on programEndDate, a field this category
    // never collects, so the window silently reported itself uncomputable.
    anchorField: "currentEadExpires",
    anchorLabel: "expiry date on your current OPT card",
    opensDaysBefore: 90,
    closesDaysAfter: 0,
    note: "A STEM extension accepts filings in the 90 days before your current card expires, and not after it lapses."
  }
};

export function filingWindow(values, today = new Date()) {
  const code = values.eligibilityCategory;
  if (!code) {
    return { applicable: false, reason: "No eligibility category has been chosen yet, and the window depends on it." };
  }

  const cat = getCategory(code);
  const rule = RULES[code];
  if (!rule) {
    return {
      applicable: false,
      category: code,
      reason: `Category ${code}${cat ? `, ${cat.label},` : ""} has no fixed filing window in this worksheet. It can generally be filed once you are eligible.`
    };
  }

  const anchor = parse(values[rule.anchorField]);
  if (!anchor) {
    return {
      applicable: false,
      category: code,
      needs: rule.anchorField,
      reason: `The window for ${code} is calculated from your ${rule.anchorLabel}, which has not been entered yet.`
    };
  }

  const opens = shift(anchor, -rule.opensDaysBefore);
  const closes = shift(anchor, rule.closesDaysAfter);
  const toOpen = daysBetween(today, opens);
  const toClose = daysBetween(today, closes);

  let state, headline;
  if (toOpen > 0) {
    state = "not-yet-open";
    headline = `Too early. The window for ${code} opens on ${fmt(opens)}, which is ${toOpen} days from now.`;
  } else if (toClose < 0) {
    state = "closed";
    headline = `The window for ${code} closed on ${fmt(closes)}, ${Math.abs(toClose)} days ago. This category can no longer be filed against that ${rule.anchorLabel}.`;
  } else if (toClose <= 14) {
    state = "closing";
    headline = `Open but closing. The window for ${code} closes on ${fmt(closes)}, in ${toClose} days. File now.`;
  } else {
    state = "open";
    headline = `Open. The window for ${code} runs ${fmt(opens)} to ${fmt(closes)}. You have ${toClose} days left.`;
  }

  return {
    applicable: true,
    category: code,
    state,
    headline,
    opens: fmt(opens),
    closes: fmt(closes),
    daysUntilOpen: toOpen > 0 ? toOpen : 0,
    daysUntilClose: toClose,
    anchor: fmt(anchor),
    anchorLabel: rule.anchorLabel,
    note: rule.note
  };
}
