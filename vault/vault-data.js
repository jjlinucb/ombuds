// The vault's own records. These deliberately live on a different origin from
// the form: the form asks whether a document exists and when it expires, and
// never receives the document itself.

// Expiry dates are computed relative to today rather than hardcoded, so the
// demonstration always shows one valid document, one close to lapsing, and one
// already out of date. Fixed dates would all drift into "expired" and the
// distinction the vault exists to report would disappear.
const dayOffset = days => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

export const DOCUMENTS = [
  {
    id: "passport",
    type: "Passport",
    label: "Passport photo page",
    issuer: "Kingdom of Cambodia",
    number: "N••••••42",
    expires: dayOffset(1180),
    pages: 1,
    satisfies: ["A copy of the photo page of your passport"]
  },
  {
    id: "i20",
    type: "Form I-20",
    label: "Form I-20 with OPT recommendation",
    issuer: "San Jose State University",
    number: "N0012345678",
    expires: dayOffset(-93),
    pages: 3,
    satisfies: [
      "A copy of your Form I-20 with the OPT recommendation on page 2",
      "A copy of your Form I-20"
    ]
  },
  {
    id: "i94",
    type: "Form I-94",
    label: "Most recent I-94 arrival record",
    issuer: "U.S. Customs and Border Protection",
    number: "A••••••19",
    expires: null,
    pages: 1,
    satisfies: ["A copy of your most recent I-94 arrival record"]
  },
  {
    id: "photos",
    type: "Photographs",
    label: "Two passport-style photographs",
    issuer: "Sunnyvale Photo",
    number: null,
    expires: dayOffset(41),
    pages: 1,
    satisfies: ["Two identical passport-style photographs"]
  },
  {
    id: "diploma",
    type: "Diploma",
    label: "Master of Science diploma",
    issuer: "San Jose State University",
    number: null,
    expires: null,
    pages: 1,
    satisfies: ["A copy of your STEM degree certificate or diploma"]
  }
];

const parse = v => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || ""));
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
};

export function statusOf(doc, today = new Date()) {
  const exp = parse(doc.expires);
  if (!exp) return { state: "valid", note: "No expiry date." };
  const days = Math.round((exp - today) / 86400000);
  if (days < 0) return { state: "expired", note: `Expired ${Math.abs(days)} days ago.`, days };
  if (days <= 90) return { state: "expiring", note: `Expires in ${days} days.`, days };
  return { state: "valid", note: `Valid for another ${days} days.`, days };
}

// Match a checklist line from the form against what the vault holds.
//
// Ranked rather than first-match. An earlier version walked the list and
// returned the first document satisfying any clause, so the checklist line
// "Two identical passport-style photographs" matched the Passport because the
// loose type-substring test saw "passport" inside "passport-style" and the
// Passport happened to come first. Specificity has to beat array order.
const TIER = {
  EXACT: 100,        // the requirement is verbatim one of the document's satisfies lines
  CONTAINS: 50,      // one string fully contains the other
  TYPE: 10           // the requirement mentions the document type at all
};

export function scoreFor(doc, need) {
  const sats = doc.satisfies.map(x => x.toLowerCase());
  if (sats.includes(need)) return TIER.EXACT;
  if (sats.some(s => s.includes(need) || need.includes(s))) return TIER.CONTAINS;
  if (need.includes(doc.type.toLowerCase())) return TIER.TYPE;
  return 0;
}

export function findFor(requirement) {
  const need = String(requirement || "").trim().toLowerCase();
  if (!need) return null;

  let best = null;
  let bestScore = 0;
  for (const doc of DOCUMENTS) {
    const score = scoreFor(doc, need);
    if (score > bestScore) { best = doc; bestScore = score; }
  }
  return best;
}
