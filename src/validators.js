// Validators return either { ok: true } or a structured failure.
//
// The structured failure shape is the reason this app works well with an agent.
// A backend MCP server would have to guess at these rules; the page already
// owns them, so it can hand the agent back a machine-readable `code`, a plain
// `message`, a `hint` describing the rule, and a concrete `example`. The agent
// reads that and fixes its own argument without the user retyping anything.

const fail = (code, message, hint, example) => ({ ok: false, code, message, hint, example });
const ok = () => ({ ok: true });

const digitsOnly = s => String(s).replace(/\D/g, "");

export const VALIDATORS = {
  aNumber(value) {
    const raw = String(value).trim().toUpperCase().replace(/[\s-]/g, "");
    if (!/^A?\d{8,9}$/.test(raw)) {
      return fail(
        "A_NUMBER_FORMAT",
        "Alien Registration Number must be the letter A followed by 8 or 9 digits.",
        "Strip spaces and dashes. Leading zeros count toward the digit total.",
        "A012345678"
      );
    }
    return ok();
  },

  ssn(value) {
    const d = digitsOnly(value);
    if (d.length !== 9) {
      return fail("SSN_LENGTH", "Social Security Number must be exactly 9 digits.",
        "Send the digits without dashes.", "123456789");
    }
    if (/^000/.test(d) || d.slice(3, 5) === "00" || d.slice(5) === "0000") {
      return fail("SSN_INVALID_GROUP", "That Social Security Number uses a group of all zeros, which is never issued.",
        "No group of an SSN may be all zeros.", "123456789");
    }
    if (d.startsWith("666") || Number(d.slice(0, 3)) >= 900) {
      return fail("SSN_INVALID_AREA", "Social Security Numbers do not begin with 666 or with 900 through 999.",
        "Check the first three digits against the card.", "123456789");
    }
    return ok();
  },

  uscisAccountNumber(value) {
    const d = digitsOnly(value);
    if (d.length !== 12) {
      return fail("USCIS_ACCOUNT_LENGTH", "USCIS Online Account Number must be exactly 12 digits.",
        "This is not the same as your A-Number. Leave it blank if you have never created a USCIS online account.",
        "123456789012");
    }
    return ok();
  },

  sevisNumber(value) {
    const raw = String(value).trim().toUpperCase().replace(/[\s-]/g, "");
    if (!/^N\d{10}$/.test(raw)) {
      return fail("SEVIS_FORMAT", "SEVIS number must be the letter N followed by exactly 10 digits.",
        "Copy it from the top left of your Form I-20, including leading zeros.",
        "N0012345678");
    }
    return ok();
  },

  receiptNumber(value) {
    const raw = String(value).trim().toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-Z]{3}\d{10}$/.test(raw)) {
      return fail("RECEIPT_FORMAT", "Receipt number must be three letters followed by ten digits.",
        "Valid prefixes include IOE, EAC, WAC, LIN, SRC, MSC, and NBC.",
        "IOE0912345678");
    }
    return ok();
  },

  eadNumber(value) {
    const raw = String(value).trim().toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-Z]{3}\d{10}$/.test(raw)) {
      return fail("EAD_FORMAT", "Previous card number must be three letters followed by ten digits.",
        "It is printed on the front of your existing Employment Authorization Document.",
        "SRC0912345678");
    }
    return ok();
  },

  cipCode(value) {
    const raw = String(value).trim();
    if (!/^\d{2}\.\d{4}$/.test(raw)) {
      return fail("CIP_FORMAT", "CIP code must be two digits, a period, then four digits.",
        "Do not drop the leading zero or the period.", "11.0701");
    }
    return ok();
  },

  everify(value) {
    const d = digitsOnly(value);
    if (d.length < 4 || d.length > 7) {
      return fail("EVERIFY_FORMAT", "E-Verify company identification number must be 4 to 7 digits.",
        "Your employer's HR team can provide this.", "123456");
    }
    return ok();
  },

  zip(value) {
    const d = digitsOnly(value);
    if (d.length !== 5 && d.length !== 9) {
      return fail("ZIP_FORMAT", "ZIP code must be 5 digits, or 9 digits for ZIP+4.",
        "Send digits only, with no dash.", "94086");
    }
    return ok();
  },

  phone(value) {
    const d = digitsOnly(value);
    if (d.length !== 10) {
      return fail("PHONE_FORMAT", "Daytime phone number must be 10 digits including area code.",
        "US numbers only. Send digits without punctuation or a country code.", "4085551234");
    }
    return ok();
  },

  email(value) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value).trim())) {
      return fail("EMAIL_FORMAT", "That does not look like a valid email address.",
        "Include a single @ and a domain with a dot.", "name@example.com");
    }
    return ok();
  },

  date(value) {
    const raw = String(value).trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
    if (!m) {
      return fail("DATE_FORMAT", "Dates must use MM/DD/YYYY.",
        "Two-digit month, two-digit day, four-digit year, separated by slashes.",
        "03/14/1998");
    }
    const [, mo, da, yr] = m.map(Number);
    const d = new Date(yr, mo - 1, da);
    if (d.getMonth() !== mo - 1 || d.getDate() !== da || d.getFullYear() !== yr) {
      return fail("DATE_NOT_REAL", `${raw} is not a real calendar date.`,
        "Check the number of days in that month, including leap years.",
        "02/29/2024");
    }
    return ok();
  }
};

// Field-level validation: presence, type, enum membership, then the named rule.
export function validateField(field, value) {
  const empty = value === undefined || value === null || String(value).trim() === "";

  if (empty) {
    return field.required
      ? fail("REQUIRED", `${field.label} is required.`,
          field.help || "This field must be filled in before the section can be completed.", null)
      : ok();
  }

  if (field.type === "enum") {
    const options = field.options || [];
    if (!options.includes(value)) {
      const sample = options.slice(0, 6).join(", ");
      return fail("NOT_IN_ENUM", `"${value}" is not an accepted value for ${field.label}.`,
        `Choose exactly one of the ${options.length} allowed values. The full list is in this tool's inputSchema.`,
        sample);
    }
    return ok();
  }

  if (field.type === "boolean" && typeof value !== "boolean") {
    return fail("NOT_BOOLEAN", `${field.label} must be true or false.`,
      "Send a JSON boolean, not the string \"yes\" or \"no\".", "true");
  }

  if (field.type === "date") {
    const r = VALIDATORS.date(value);
    if (!r.ok) return r;
  }

  if (field.validate && VALIDATORS[field.validate]) {
    const r = VALIDATORS[field.validate](value);
    if (!r.ok) return r;
  }

  if (field.maxLength && String(value).length > field.maxLength) {
    return fail("TOO_LONG", `${field.label} must be ${field.maxLength} characters or fewer.`,
      "Shorten the value or use an abbreviation the form accepts.", null);
  }

  return ok();
}

const parseDate = v => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v).trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
};

// Cross-field rules. These are the checks a field-by-field validator cannot see,
// and they are the ones that most often bounce a real filing back.
export function crossFieldErrors(values) {
  const errors = [];
  const push = (fields, code, message, hint) => errors.push({ fields, code, message, hint });

  const dob = parseDate(values.dateOfBirth);
  const entry = parseDate(values.dateOfLastEntry);
  const today = new Date();

  if (dob && dob > today) {
    push(["dateOfBirth"], "DOB_IN_FUTURE", "Date of birth is in the future.",
      "Check the year. A common slip is typing the current year instead of the birth year.");
  }
  if (dob && today.getFullYear() - dob.getFullYear() > 120) {
    push(["dateOfBirth"], "DOB_IMPLAUSIBLE", "Date of birth is more than 120 years ago.",
      "Confirm the year on the birth certificate or passport.");
  }
  if (dob && entry && entry < dob) {
    push(["dateOfLastEntry", "dateOfBirth"], "ENTRY_BEFORE_BIRTH",
      "Date of last entry to the United States is before the date of birth.",
      "One of these two dates has the wrong year.");
  }
  if (entry && entry > today) {
    push(["dateOfLastEntry"], "ENTRY_IN_FUTURE", "Date of last entry is in the future.",
      "Use the date you most recently arrived, not a planned trip.");
  }

  const programEnd = parseDate(values.programEndDate);
  if (programEnd && dob && programEnd < dob) {
    push(["programEndDate"], "PROGRAM_END_BEFORE_BIRTH", "Program end date is before the date of birth.",
      "Check the year on your I-20.");
  }

  if (values.wantsSSNCard === true) {
    if (!values.fathersFullName) {
      push(["fathersFullName"], "SSN_PARENTS_REQUIRED",
        "Requesting a Social Security card requires both parents' names.",
        "The Social Security Administration needs both parent names to issue a card. Set wantsSSNCard to false if you already have a card.");
    }
    if (!values.mothersFullName) {
      push(["mothersFullName"], "SSN_PARENTS_REQUIRED",
        "Requesting a Social Security card requires both parents' names.",
        "Provide the mother's full birth name, including her maiden name.");
    }
    if (values.consentToDisclosure !== true) {
      push(["consentToDisclosure"], "SSN_CONSENT_REQUIRED",
        "Requesting a Social Security card requires consent to share your information with the Social Security Administration.",
        "Set consentToDisclosure to true, or set wantsSSNCard to false.");
    }
  }

  if (values.reasonForApplying === "Renewal of permission to work" && !values.previousEadNumber) {
    push(["previousEadNumber"], "RENEWAL_NEEDS_PRIOR_CARD",
      "A renewal requires the card number of your current Employment Authorization Document.",
      "Copy the number from the front of your existing card.");
  }

  if (values.reasonForApplying === "Replacement of a lost, stolen, or damaged card" && !values.previousEadNumber) {
    push(["previousEadNumber"], "REPLACEMENT_NEEDS_PRIOR_CARD",
      "A replacement requires the number of the card being replaced.",
      "If the card was lost, the number appears on your prior approval notice.");
  }

  if (values.mailingSameAsPhysical === false && !values.physicalStreet) {
    push(["physicalStreet"], "PHYSICAL_ADDRESS_REQUIRED",
      "You indicated your mailing address differs from where you live, so a physical address is required.",
      "Either provide the physical address, or set mailingSameAsPhysical to true.");
  }

  const cat = values.eligibilityCategory;
  if (cat && cat.startsWith("(c)(3)") && values.currentImmigrationStatus &&
      !String(values.currentImmigrationStatus).startsWith("F-1")) {
    push(["currentImmigrationStatus", "eligibilityCategory"], "CATEGORY_STATUS_MISMATCH",
      `Category ${cat} is only available to F-1 students, but the current status is "${values.currentImmigrationStatus}".`,
      "Either correct the current immigration status, or choose a category that matches it.");
  }

  if (cat === "(c)(26)" && values.currentImmigrationStatus &&
      values.currentImmigrationStatus !== "H-4 dependent") {
    push(["currentImmigrationStatus", "eligibilityCategory"], "CATEGORY_STATUS_MISMATCH",
      "Category (c)(26) requires H-4 dependent status.",
      "Correct the current immigration status or choose a different category.");
  }

  return errors;
}
