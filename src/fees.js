// Filing fees and fee waivers.
//
// Whether an applicant owes a fee depends on their eligibility category, and
// whether they can have it waived depends on their household size and income
// against a poverty guideline. Sending the wrong amount is one of the most
// common reasons a filing is returned unprocessed.
//
// IMPORTANT: the amounts and thresholds below are a snapshot for a worksheet,
// not an authoritative fee schedule. They change, sometimes mid-year. Every
// answer this module produces says so, because a prep tool that states a stale
// number with confidence is worse than one that admits it is a starting point.

export const FEE_SNAPSHOT_LABEL = "representative figures, verify against the current official fee schedule before filing";

const STANDARD_FEE = 470;
const ONLINE_DISCOUNT = 50;      // filing online has been cheaper than paper
const BIOMETRICS_FEE = 85;

// Categories that have historically carried no filing fee for an initial
// request. A renewal in the same category may still be chargeable.
const EXEMPT_INITIAL = new Set(["(a)(3)", "(a)(5)", "(c)(8)"]);

// Categories where a fee waiver is not available even if income qualifies.
const NO_WAIVER = new Set(["(c)(33)"]);

// Categories that require biometrics collection on top of the filing fee.
const NEEDS_BIOMETRICS = new Set(["(c)(33)"]);

// 150% of the federal poverty guideline, the usual fee-waiver income test.
// Snapshot figures for the 48 contiguous states.
const WAIVER_BASE_150 = 23475;
const WAIVER_PER_EXTRA_PERSON = 8250;

export function waiverIncomeCeiling(householdSize) {
  const n = Math.max(1, Math.floor(Number(householdSize) || 1));
  return WAIVER_BASE_150 + (n - 1) * WAIVER_PER_EXTRA_PERSON;
}

export function feeAssessment(values, opts = {}) {
  const code = values.eligibilityCategory;
  const isInitial = values.reasonForApplying === "Initial permission to accept employment";
  const filingOnline = opts.filingOnline !== false;

  if (!code) {
    return {
      determined: false,
      reason: "The fee depends on the eligibility category, which has not been chosen yet.",
      caveat: FEE_SNAPSHOT_LABEL
    };
  }

  const exempt = EXEMPT_INITIAL.has(code) && isInitial;
  const biometrics = NEEDS_BIOMETRICS.has(code) ? BIOMETRICS_FEE : 0;
  const base = exempt ? 0 : STANDARD_FEE - (filingOnline ? ONLINE_DISCOUNT : 0);
  const total = base + biometrics;

  const out = {
    determined: true,
    category: code,
    exempt,
    filingOnline,
    baseFee: base,
    biometricsFee: biometrics,
    total,
    waiverAvailable: !exempt && !NO_WAIVER.has(code),
    caveat: FEE_SNAPSHOT_LABEL
  };

  if (exempt) {
    out.summary = `Category ${code} carries no filing fee for an initial request, so nothing is owed. Do not send a payment, since an unexpected payment can itself delay processing.`;
    return out;
  }

  out.summary = biometrics
    ? `Category ${code} owes ${money(base)} to file${filingOnline ? " online" : " on paper"} plus a ${money(biometrics)} biometrics fee, ${money(total)} in total.`
    : `Category ${code} owes ${money(base)} to file${filingOnline ? " online" : " on paper"}.`;

  if (!out.waiverAvailable) {
    out.waiverNote = `A fee waiver is not available for category ${code} regardless of income.`;
  }

  // Waiver math only runs when the applicant has actually supplied the inputs.
  const size = opts.householdSize;
  const income = opts.annualHouseholdIncome;
  if (out.waiverAvailable && size !== undefined && income !== undefined) {
    const ceiling = waiverIncomeCeiling(size);
    const qualifiesByIncome = Number(income) <= ceiling;
    out.waiver = {
      householdSize: Math.max(1, Math.floor(Number(size) || 1)),
      annualHouseholdIncome: Number(income),
      incomeCeiling: ceiling,
      qualifiesByIncome,
      alsoQualifiesIf: [
        "anyone in the household receives a means-tested benefit",
        "the household has a documented financial hardship such as medical debt"
      ]
    };
    out.waiverNote = qualifiesByIncome
      ? `At a household of ${out.waiver.householdSize} and ${money(income)} a year, the income is at or below the ${money(ceiling)} ceiling, so a fee waiver request is worth filing alongside this application. That would reduce the amount owed to nothing if granted.`
      : `At a household of ${out.waiver.householdSize} and ${money(income)} a year, the income is above the ${money(ceiling)} ceiling, so a waiver would not be granted on income alone. It may still be granted for a means-tested benefit or a documented hardship.`;
  } else if (out.waiverAvailable) {
    out.waiverNote = `A fee waiver may be available. Supply householdSize and annualHouseholdIncome to check the income test.`;
  }

  return out;
}

function money(n) {
  return `$${Number(n).toLocaleString("en-US")}`;
}
