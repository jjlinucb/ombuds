// Rejection-risk assessment.
//
// This is the composing tool, and the argument for WebMCP in one function. To
// answer "can this person file today" you need the form's own validation state,
// a filing window computed from a date on their I-20, a fee determination that
// depends on their category, and the expiry status of documents held on a
// different origin. All four live in or reach through the browser. A server
// asked the same question would have to be handed every input and trust that
// each one arrived intact.

const SEVERITY_ORDER = { blocking: 0, high: 1, medium: 2, low: 3 };

export async function assessRisk({ status, window, fee, values, otherNames = [], checkDocument, checklist = [] }) {
  const findings = [];
  const add = (severity, code, title, detail) => findings.push({ severity, code, title, detail });

  // 1. The form's own rules come first. Nothing else matters if a field is invalid.
  for (const issue of status.blockingIssues.slice(0, 6)) {
    add("blocking", issue.code || "VALIDATION", `${issue.field}: ${issue.message}`, issue.hint || "");
  }

  // 2. Unreviewed proposals. Filing values nobody looked at is how a wrong
  //    answer becomes a signed statement.
  if (status.pendingReviewCount > 0) {
    add("blocking", "UNREVIEWED",
      `${status.pendingReviewCount} proposed change${status.pendingReviewCount === 1 ? "" : "s"} not yet reviewed`,
      "The applicant should accept or reject each one before signing.");
  }

  // 3. Filing window.
  if (window?.applicable) {
    if (window.state === "closed") {
      add("blocking", "WINDOW_CLOSED", `The filing window closed on ${window.closes}`,
        "Confirm the anchor date is right before accepting this. A mistyped year produces exactly this result.");
    } else if (window.state === "not-yet-open") {
      add("high", "WINDOW_NOT_OPEN", `Too early to file. The window opens ${window.opens}`,
        `That is ${window.daysUntilOpen} days away. Filing now would be rejected as premature.`);
    } else if (window.state === "closing") {
      add("high", "WINDOW_CLOSING", `Only ${window.daysUntilClose} days left in the filing window`,
        `The window closes ${window.closes}. Treat the remaining steps as urgent.`);
    }
  } else if (window?.needs) {
    add("medium", "WINDOW_UNKNOWN", "The filing window cannot be calculated yet",
      window.reason);
  }

  // 4. Documents, resolved across the origin boundary when a vault is reachable.
  if (typeof checkDocument === "function" && checklist.length) {
    for (const requirement of checklist) {
      let res;
      try {
        res = await checkDocument(requirement);
      } catch {
        add("low", "VAULT_UNREACHABLE", "Could not check documents against the vault",
          "Verify the checklist by hand.");
        break;
      }
      const sc = res?.structuredContent || {};
      if (!sc.held) {
        add("high", "DOC_MISSING", `Missing: ${requirement}`, "Obtain this before filing.");
      } else if (sc.state === "expired") {
        add("blocking", "DOC_EXPIRED", `Out of date: ${sc.document?.label || requirement}`,
          "A lapsed document will have the filing returned. Replace it first.");
      } else if (sc.state === "expiring") {
        add("medium", "DOC_EXPIRING", `Close to lapsing: ${sc.document?.label || requirement}`,
          "It is valid today, which may not hold by the time this is adjudicated.");
      }
    }
  }

  // 5. Name consistency. A name that does not match the passport is a routine
  //    reason a filing is returned, and it is invisible to field validation.
  const primary = [values.givenName, values.middleName, values.familyName].filter(Boolean).join(" ").toLowerCase();
  for (const alt of otherNames) {
    const altName = [alt.givenName, alt.middleName, alt.familyName].filter(Boolean).join(" ").toLowerCase();
    if (altName && altName === primary) {
      add("medium", "NAME_DUPLICATE", "A former name is identical to the current legal name",
        "Remove the duplicate entry, or correct whichever one is wrong.");
    }
  }
  if (values.familyName && values.familyName === values.givenName) {
    add("low", "NAME_SAME_BOTH", "The family name and given name are identical",
      "Confirm this is right rather than a field filled twice.");
  }

  // 6. Fee.
  if (fee?.determined) {
    if (fee.waiver?.qualifiesByIncome) {
      add("low", "FEE_WAIVER_WORTH_FILING", "A fee waiver looks worth requesting",
        fee.waiverNote);
    }
    if (fee.total > 0) {
      add("low", "FEE_DUE", `${fee.summary}`, fee.caveat);
    }
  } else {
    add("medium", "FEE_UNKNOWN", "The filing fee has not been determined", fee?.reason || "");
  }

  // 7. Signature last, because it should be the last thing that happens.
  if (!status.certified) {
    add("high", "UNSIGNED", "The applicant has not signed the certification",
      "Only they can. Ask once the rest is clear.");
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const blocking = findings.filter(f => f.severity === "blocking");
  const high = findings.filter(f => f.severity === "high");

  const verdict = blocking.length
    ? "not-ready"
    : high.length
      ? "risky"
      : "ready";

  const headline = {
    "not-ready": `Not ready to file. ${blocking.length} issue${blocking.length === 1 ? "" : "s"} would have this returned.`,
    "risky": `Filing is possible but ${high.length} thing${high.length === 1 ? "" : "s"} should be resolved first.`,
    "ready": "Nothing found that would have this filing returned."
  }[verdict];

  return { verdict, headline, findings, counts: countBy(findings) };
}

function countBy(findings) {
  const out = { blocking: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}
