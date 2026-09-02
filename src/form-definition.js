import { US_STATES, COUNTRIES, IMMIGRATION_STATUSES, CATEGORY_CODES, getCategory } from "./reference-data.js";

// One form definition, two consumers.
//
// `showWhen` is evaluated against the current merged values. The HTML renderer
// uses it to show or hide a field. The WebMCP layer uses the same predicate to
// decide whether the field belongs in the tool's generated inputSchema.
//
// That single shared predicate is why the agent never sees a question that does
// not apply: the schema it receives is a snapshot of what this form wants right
// now, not a static description of every branch the form could ever take.

const REASONS = [
  "Initial permission to accept employment",
  "Renewal of permission to work",
  "Replacement of a lost, stolen, or damaged card"
];

export const SECTIONS = [
  {
    id: "reason",
    part: "Part 1",
    title: "Reason for Applying",
    requires: [],
    tool: "set-reason-for-applying",
    toolDescription:
      "Record why the applicant is requesting work authorization. This is the first question on the form and it gates every later section, so call it first. Choosing a renewal or a replacement will cause a follow-up field for the previous card number to become required.",
    fields: [
      { name: "reasonForApplying", label: "I am applying for", type: "enum", options: REASONS, required: true,
        description: "Why the applicant needs work authorization. Must be exactly one of the three allowed values.",
        help: "Choose Initial if this is your first request. Choose Renewal if you already have a card that is expiring. Choose Replacement if your card was lost, stolen, or printed with an error." },
      { name: "previousEadNumber", label: "Previous card number", type: "string", validate: "eadNumber", required: true,
        showWhen: v => v.reasonForApplying === "Renewal of permission to work" ||
                       v.reasonForApplying === "Replacement of a lost, stolen, or damaged card",
        description: "Card number of the existing Employment Authorization Document. Three letters followed by ten digits.",
        help: "Printed on the front of your current card. If the card was lost, the number is on your approval notice." }
    ]
  },

  {
    id: "identity",
    part: "Part 2",
    title: "Your Legal Name and Birth",
    requires: ["reason"],
    tool: "set-personal-info",
    toolDescription:
      "Record the applicant's legal name, birth details, and citizenship. Names must match the applicant's passport or birth certificate exactly. Setting hasOtherNames to true will unlock a separate tool for recording former names such as a maiden name.",
    fields: [
      { name: "familyName", label: "Family name (last name)", type: "string", required: true, maxLength: 40,
        description: "Legal family name or surname, spelled as it appears on the passport.",
        help: "If your legal name is a single name with no surname, put it here and leave the given name blank." },
      { name: "givenName", label: "Given name (first name)", type: "string", required: false, maxLength: 40,
        description: "Legal given name or first name.",
        help: "Leave blank only if you legally have no given name." },
      { name: "middleName", label: "Middle name", type: "string", required: false, maxLength: 40,
        description: "Middle name, if the applicant has one. Omit rather than guessing." },
      { name: "hasOtherNames", label: "Have you used any other names?", type: "boolean", required: true,
        description: "True if the applicant has ever used another legal name, including a maiden name, a name from a prior marriage, or a legal name change.",
        help: "Answer yes for maiden names and legal name changes. Nicknames do not count." },
      { name: "dateOfBirth", label: "Date of birth", type: "date", required: true,
        description: "Date of birth in MM/DD/YYYY format.",
        help: "Use the date on your birth certificate, even if another document disagrees." },
      { name: "countryOfBirth", label: "Country of birth", type: "enum", options: COUNTRIES, required: true,
        description: "Country where the applicant was born. Must be one of the listed values.",
        help: "Use the country's current name, even if it had a different name when you were born." },
      { name: "cityOfBirth", label: "City or town of birth", type: "string", required: true, maxLength: 40,
        description: "City, town, or village of birth." },
      { name: "countryOfCitizenship", label: "Country of citizenship", type: "enum", options: COUNTRIES, required: true,
        description: "Country of citizenship or nationality. May differ from country of birth.",
        help: "If you are stateless, choose the country of your last residence." },
      { name: "gender", label: "Gender", type: "enum", options: ["Male", "Female", "Another gender identity"], required: true,
        description: "Gender as the applicant wishes it recorded." },
      { name: "maritalStatus", label: "Marital status", type: "enum",
        options: ["Single", "Married", "Divorced", "Widowed"], required: true,
        description: "Current marital status." }
    ]
  },

  {
    id: "other-names",
    part: "Part 2",
    title: "Other Names You Have Used",
    requires: ["identity"],
    availableWhen: v => v.hasOtherNames === true,
    tool: "add-other-name",
    repeatable: true,
    collection: "otherNames",
    toolDescription:
      "Record one former or alternate legal name for the applicant. This tool exists only because the applicant answered yes to having used other names. Call it once per former name.",
    fields: [
      { name: "familyName", label: "Family name", type: "string", required: true, maxLength: 40,
        description: "Family name used under the former name." },
      { name: "givenName", label: "Given name", type: "string", required: false, maxLength: 40,
        description: "Given name used under the former name." },
      { name: "middleName", label: "Middle name", type: "string", required: false, maxLength: 40,
        description: "Middle name used under the former name." }
    ]
  },

  {
    id: "mailing",
    part: "Part 2",
    title: "U.S. Mailing Address",
    requires: ["identity"],
    tool: "set-mailing-address",
    toolDescription:
      "Record the U.S. mailing address where the applicant wants their documents and card delivered. Setting mailingSameAsPhysical to false will register a separate tool for the physical address.",
    fields: [
      { name: "inCareOf", label: "In care of name", type: "string", required: false, maxLength: 40,
        description: "Optional. Only include if mail must be addressed to another person at this address." },
      { name: "mailingStreet", label: "Street number and name", type: "string", required: true, maxLength: 60,
        description: "Street number and street name of the mailing address." },
      { name: "mailingUnitType", label: "Unit type", type: "enum", options: ["None", "Apt", "Ste", "Flr"], required: true,
        description: "Type of secondary unit designator. Use \"None\" for a single-family address." },
      { name: "mailingUnitNumber", label: "Unit number", type: "string", required: true, maxLength: 10,
        showWhen: v => v.mailingUnitType && v.mailingUnitType !== "None",
        description: "The apartment, suite, or floor number. Required because a unit type was selected." },
      { name: "mailingCity", label: "City or town", type: "string", required: true, maxLength: 40,
        description: "City or town of the mailing address." },
      { name: "mailingState", label: "State", type: "enum", options: US_STATES, required: true,
        description: "Two-letter USPS state or territory code.",
        help: "Two letters only. The full list of accepted codes is in this tool's schema." },
      { name: "mailingZip", label: "ZIP code", type: "string", validate: "zip", required: true,
        description: "Five-digit ZIP code, or nine digits for ZIP+4. Digits only, no dash." },
      { name: "mailingSameAsPhysical", label: "Is this also where you live?", type: "boolean", required: true,
        description: "True if the applicant physically lives at the mailing address. False will require a separate physical address.",
        help: "Answer no if you use a P.O. box, a relative's address, or an attorney's address for mail." }
    ]
  },

  {
    id: "physical",
    part: "Part 2",
    title: "Physical Address",
    requires: ["mailing"],
    availableWhen: v => v.mailingSameAsPhysical === false,
    tool: "set-physical-address",
    toolDescription:
      "Record where the applicant actually lives. This tool is registered only because the applicant said their mailing address is not their residence. It disappears again if that answer changes.",
    fields: [
      { name: "physicalStreet", label: "Street number and name", type: "string", required: true, maxLength: 60,
        description: "Street number and street name of the residence." },
      { name: "physicalUnitType", label: "Unit type", type: "enum", options: ["None", "Apt", "Ste", "Flr"], required: true,
        description: "Type of secondary unit designator at the residence." },
      { name: "physicalUnitNumber", label: "Unit number", type: "string", required: true, maxLength: 10,
        showWhen: v => v.physicalUnitType && v.physicalUnitType !== "None",
        description: "Apartment, suite, or floor number of the residence." },
      { name: "physicalCity", label: "City or town", type: "string", required: true, maxLength: 40,
        description: "City or town of the residence." },
      { name: "physicalState", label: "State", type: "enum", options: US_STATES, required: true,
        description: "Two-letter USPS state or territory code for the residence." },
      { name: "physicalZip", label: "ZIP code", type: "string", validate: "zip", required: true,
        description: "ZIP code of the residence. Digits only." }
    ]
  },

  {
    id: "numbers",
    part: "Part 2",
    title: "Government File Numbers",
    requires: ["identity"],
    tool: "set-government-numbers",
    toolDescription:
      "Record the applicant's government identifiers and decide whether to request a Social Security card. Requesting a card makes both parents' names and a disclosure consent required, because those are what the Social Security Administration needs to issue one.",
    fields: [
      { name: "aNumber", label: "Alien Registration Number (A-Number)", type: "string", validate: "aNumber", required: false,
        description: "The applicant's A-Number. The letter A followed by 8 or 9 digits. Omit entirely if the applicant has never been issued one.",
        help: "Look on a prior approval notice, a green card, or an immigration court document. Not everyone has one." },
      { name: "uscisAccountNumber", label: "USCIS Online Account Number", type: "string", validate: "uscisAccountNumber", required: false,
        description: "Twelve-digit USCIS online account number. Omit if the applicant has never filed online.",
        help: "This is different from your A-Number. It only exists if you made an account on the USCIS website." },
      { name: "hasSSN", label: "Have you been issued a Social Security Number?", type: "boolean", required: true,
        description: "True if the Social Security Administration has ever issued this applicant an SSN." },
      { name: "ssn", label: "Social Security Number", type: "string", validate: "ssn", required: true,
        showWhen: v => v.hasSSN === true,
        description: "The applicant's nine-digit Social Security Number, digits only.",
        help: "Required because you indicated you already have one." },
      { name: "wantsSSNCard", label: "Do you want us to request a Social Security card for you?", type: "boolean", required: true,
        showWhen: v => v.hasSSN === false,
        description: "True to have a Social Security card requested alongside this application. Setting this true makes both parents' names and consent to disclosure required.",
        help: "Saying yes saves you a separate trip to a Social Security office." },
      { name: "fathersFullName", label: "Father's full birth name", type: "string", required: true, maxLength: 60,
        showWhen: v => v.hasSSN === false && v.wantsSSNCard === true,
        description: "Father's full name at birth. Required by the Social Security Administration when a card is requested." },
      { name: "mothersFullName", label: "Mother's full birth name", type: "string", required: true, maxLength: 60,
        showWhen: v => v.hasSSN === false && v.wantsSSNCard === true,
        description: "Mother's full name at birth, including her maiden name. Required by the Social Security Administration when a card is requested." },
      { name: "consentToDisclosure", label: "Consent to share information with the Social Security Administration", type: "boolean", required: true,
        showWhen: v => v.hasSSN === false && v.wantsSSNCard === true,
        description: "Must be true to request a Social Security card. This is a legal consent and the user should confirm it themselves rather than the agent assuming it.",
        sensitive: true,
        help: "This authorizes the two agencies to share your information for the sole purpose of issuing your card." }
    ]
  },

  {
    id: "eligibility",
    part: "Part 3",
    title: "Eligibility Category",
    requires: ["identity"],
    tool: "set-eligibility-category",
    toolDescription:
      "Record which legal category the applicant is requesting work authorization under. The category code determines which follow-up questions exist, so after this call a new tool appears whose schema is built specifically for the chosen category. Call list-eligibility-categories first if the correct code is not already known.",
    fields: [
      { name: "eligibilityCategory", label: "Eligibility category", type: "enum", options: CATEGORY_CODES, required: true,
        description: "The eligibility category code. Must be one of the listed codes exactly, including parentheses.",
        help: "This is the single most common place applications go wrong. If you are unsure, ask for the category list and pick the description that matches your situation." }
    ]
  },

  {
    id: "category-details",
    part: "Part 3",
    title: "Category Requirements",
    requires: ["eligibility"],
    availableWhen: v => Boolean(v.eligibilityCategory),
    tool: "answer-category-questions",
    // The schema for this section is not fixed. It is assembled from whichever
    // category the applicant selected, which is the clearest demonstration of
    // why these tools live in the page instead of on a server.
    dynamicFields: v => {
      const cat = getCategory(v.eligibilityCategory);
      return cat ? cat.extraFields : [];
    },
    toolDescription: v => {
      const cat = getCategory(v.eligibilityCategory);
      if (!cat) return "Answer the follow-up questions required by the selected eligibility category.";
      return `Answer the follow-up questions that category ${cat.code}, ${cat.label}, specifically requires. ${cat.blurb} This tool's schema was generated for this category alone and will change entirely if the category changes.`;
    },
    fields: []
  },

  {
    id: "history",
    part: "Part 4",
    title: "Immigration History",
    requires: ["eligibility"],
    tool: "set-immigration-history",
    toolDescription:
      "Record the applicant's most recent arrival in the United States and their current immigration status. These answers are cross-checked against the date of birth and the eligibility category, so a mismatch here will be reported back with the specific conflict.",
    fields: [
      { name: "dateOfLastEntry", label: "Date of last entry into the U.S.", type: "date", required: true,
        description: "The date the applicant most recently arrived in the United States, MM/DD/YYYY.",
        help: "On your I-94 arrival record. If you have never left since arriving, this is your original arrival date." },
      { name: "placeOfLastEntry", label: "Place of last entry", type: "string", required: true, maxLength: 40,
        description: "City and state of the port of entry where the applicant last arrived.",
        help: "The airport or border crossing, for example \"San Francisco, CA\"." },
      { name: "statusAtLastEntry", label: "Immigration status at last entry", type: "enum", options: IMMIGRATION_STATUSES, required: true,
        description: "The immigration status the applicant held when they last entered the country." },
      { name: "currentImmigrationStatus", label: "Current immigration status", type: "enum", options: IMMIGRATION_STATUSES, required: true,
        description: "The applicant's immigration status today. This is cross-checked against the eligibility category and a mismatch will be reported.",
        help: "This may differ from your status at entry if you changed status while in the country." }
    ]
  },

  {
    id: "contact",
    part: "Part 5",
    title: "Contact and Signature",
    requires: ["history"],
    tool: "set-contact-details",
    toolDescription:
      "Record how the applicant can be reached about this application. The final certification is deliberately not exposed as a tool: only the person filing can sign, so it must be checked by hand in the page.",
    fields: [
      { name: "daytimePhone", label: "Daytime phone number", type: "string", validate: "phone", required: true,
        description: "Ten-digit U.S. daytime phone number, digits only." },
      { name: "email", label: "Email address", type: "string", validate: "email", required: true,
        description: "Email address for notices about this application." },
      { name: "preferredLanguage", label: "Preferred language for notices", type: "enum",
        options: ["English", "Spanish", "Khmer", "Vietnamese", "Mandarin", "Tagalog", "Arabic", "Haitian Creole", "Other"],
        required: false,
        description: "Optional. The language the applicant would prefer for written communication." }
    ]
  }
];

export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

// Fields that an agent must never fill on the user's behalf. A tool that touches
// one of these is registered, but the value lands in the review queue flagged so
// the human has to affirm it themselves.
export const SENSITIVE_FIELDS = new Set(["consentToDisclosure"]);

// Resolve the field list for a section against the current values. Sections with
// `dynamicFields` build their list from live state.
export function fieldsFor(section, values) {
  const base = section.dynamicFields ? section.dynamicFields(values) : section.fields;
  return base.filter(f => !f.showWhen || f.showWhen(values));
}

// Every field a section could ever show, used by the renderer so hidden inputs
// keep their DOM node and their value.
export function allFieldsFor(section, values) {
  return section.dynamicFields ? section.dynamicFields(values) : section.fields;
}

export function descriptionFor(section, values) {
  return typeof section.toolDescription === "function"
    ? section.toolDescription(values)
    : section.toolDescription;
}
