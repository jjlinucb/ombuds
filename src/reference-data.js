// Reference lists used to build both the human UI and the agent-facing JSON Schemas.
// Keeping these as data means an agent can never invent an invalid value: the
// generated inputSchema carries the exact enum the form accepts right now.

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","PR","RI","SC","SD","TN","TX","UT","VT","VA",
  "WA","WV","WI","WY"
];

export const COUNTRIES = [
  "Afghanistan","Argentina","Australia","Bangladesh","Brazil","Cambodia","Cameroon",
  "Canada","Chile","China","Colombia","Cuba","Egypt","El Salvador","Ethiopia","France",
  "Germany","Ghana","Guatemala","Haiti","Honduras","India","Indonesia","Iran","Iraq",
  "Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kenya","Laos","Lebanon",
  "Malaysia","Mexico","Myanmar","Nepal","Nigeria","Pakistan","Peru","Philippines",
  "Poland","Romania","Russia","Somalia","South Korea","Spain","Sudan","Syria","Taiwan",
  "Thailand","Turkey","Ukraine","United Kingdom","United States","Venezuela","Vietnam",
  "Yemen","Zimbabwe","Other"
];

export const IMMIGRATION_STATUSES = [
  "F-1 student","F-2 dependent","J-1 exchange visitor","J-2 dependent","H-1B worker",
  "H-4 dependent","L-1 worker","L-2 dependent","B-1/B-2 visitor","Asylum applicant",
  "Asylee","Refugee","Parolee","Temporary Protected Status","Deferred Action",
  "Adjustment of status applicant","Entered without inspection","Other"
];

// Eligibility categories modeled on the published I-765 category list.
// `extraFields` is the heart of the demo: choosing a category rewrites the
// schema of the follow-up tool, so the agent is asked only the questions that
// this specific category actually requires.
export const ELIGIBILITY_CATEGORIES = [
  {
    code: "(a)(3)",
    label: "Refugee",
    blurb: "You were admitted to the United States as a refugee.",
    extraFields: [
      { name: "refugeeAdmissionDate", label: "Date admitted as a refugee", type: "date", required: true,
        description: "The date you were admitted to the US as a refugee, MM/DD/YYYY.",
        help: "This is on your I-94 arrival record or your refugee travel document." }
    ]
  },
  {
    code: "(a)(5)",
    label: "Asylee",
    blurb: "You have been granted asylum.",
    extraFields: [
      { name: "asylumGrantDate", label: "Date asylum was granted", type: "date", required: true,
        description: "The date your asylum was granted, MM/DD/YYYY.",
        help: "Look for the decision date on the approval notice you received." }
    ]
  },
  {
    code: "(a)(12)",
    label: "Temporary Protected Status granted",
    blurb: "You have an approved Temporary Protected Status designation.",
    extraFields: [
      { name: "tpsCountry", label: "TPS designated country", type: "enum", options: COUNTRIES, required: true,
        description: "The TPS-designated country your status is based on.",
        help: "The country the TPS designation was issued for, not necessarily your citizenship." },
      { name: "tpsApprovalNotice", label: "TPS approval receipt number", type: "string", validate: "receiptNumber", required: true,
        description: "Receipt number from your TPS approval notice. Three letters followed by ten digits, for example IOE0912345678.",
        help: "Starts with three letters such as IOE, EAC, WAC, LIN, or SRC." }
    ]
  },
  {
    code: "(c)(3)(A)",
    label: "F-1 student, pre-completion OPT",
    blurb: "Optional Practical Training before you finish your program.",
    extraFields: [
      { name: "sevisNumber", label: "SEVIS number", type: "string", validate: "sevisNumber", required: true,
        description: "Your SEVIS identification number. The letter N followed by exactly 10 digits, for example N0012345678.",
        help: "Printed in the upper left of your Form I-20, labeled SEVIS ID." },
      { name: "schoolName", label: "School name", type: "string", required: true,
        description: "Full name of the school listed on your Form I-20.",
        help: "Use the school's full legal name exactly as it appears on the I-20." },
      { name: "degreeLevel", label: "Degree level", type: "enum",
        options: ["Associate","Bachelor","Master","Doctorate","Certificate"], required: true,
        description: "The degree level of the program on your I-20." },
      { name: "programEndDate", label: "Program end date", type: "date", required: true,
        description: "Program completion date from your I-20, MM/DD/YYYY." }
    ]
  },
  {
    code: "(c)(3)(B)",
    label: "F-1 student, post-completion OPT",
    blurb: "Optional Practical Training after you finish your program.",
    extraFields: [
      { name: "sevisNumber", label: "SEVIS number", type: "string", validate: "sevisNumber", required: true,
        description: "Your SEVIS identification number. The letter N followed by exactly 10 digits, for example N0012345678.",
        help: "Printed in the upper left of your Form I-20, labeled SEVIS ID." },
      { name: "schoolName", label: "School name", type: "string", required: true,
        description: "Full name of the school listed on your Form I-20." },
      { name: "degreeLevel", label: "Degree level", type: "enum",
        options: ["Associate","Bachelor","Master","Doctorate","Certificate"], required: true,
        description: "The degree level of the program on your I-20." },
      { name: "programEndDate", label: "Program end date", type: "date", required: true,
        description: "Program completion date from your I-20, MM/DD/YYYY.",
        help: "Post-completion OPT requests must be filed within a window around this date." }
    ]
  },
  {
    code: "(c)(3)(C)",
    label: "F-1 student, 24-month STEM extension",
    blurb: "STEM extension of post-completion OPT.",
    extraFields: [
      { name: "sevisNumber", label: "SEVIS number", type: "string", validate: "sevisNumber", required: true,
        description: "Your SEVIS identification number. The letter N followed by exactly 10 digits." },
      { name: "schoolName", label: "School name", type: "string", required: true,
        description: "Full name of the school that recommended the STEM extension." },
      { name: "stemDegreeCipCode", label: "STEM degree CIP code", type: "string", validate: "cipCode", required: true,
        description: "The CIP code of your STEM degree, formatted as two digits, a period, then four digits, for example 11.0701.",
        help: "Your school's international office lists the CIP code on your I-20." },
      { name: "employerEVerifyNumber", label: "Employer E-Verify company ID", type: "string", validate: "everify", required: true,
        description: "Your employer's E-Verify company identification number, 4 to 7 digits.",
        help: "Ask your employer's HR team. STEM extensions require an E-Verify employer." }
    ]
  },
  {
    code: "(c)(8)",
    label: "Pending asylum application",
    blurb: "You have a pending asylum application and the waiting period has passed.",
    extraFields: [
      { name: "asylumReceiptNumber", label: "Asylum application receipt number", type: "string", validate: "receiptNumber", required: true,
        description: "Receipt number for your pending asylum application. Three letters followed by ten digits.",
        help: "On the I-589 receipt notice, Form I-797C." },
      { name: "asylumFilingDate", label: "Asylum application filing date", type: "date", required: true,
        description: "The date your asylum application was received, MM/DD/YYYY.",
        help: "The clock for work authorization eligibility runs from this date." }
    ]
  },
  {
    code: "(c)(9)",
    label: "Pending adjustment of status",
    blurb: "You have a pending Form I-485 application to adjust status.",
    extraFields: [
      { name: "receiptNumberI485", label: "I-485 receipt number", type: "string", validate: "receiptNumber", required: true,
        description: "Receipt number of your pending I-485. Three letters followed by ten digits, for example IOE0912345678.",
        help: "On your I-485 receipt notice, Form I-797C." }
    ]
  },
  {
    code: "(c)(26)",
    label: "H-4 spouse of an H-1B worker",
    blurb: "You are an H-4 dependent spouse of an H-1B nonimmigrant.",
    extraFields: [
      { name: "principalSpouseAName", label: "Spouse's full name", type: "string", required: true,
        description: "Full legal name of your H-1B spouse." },
      { name: "principalReceiptNumber", label: "Spouse's I-140 receipt number", type: "string", validate: "receiptNumber", required: true,
        description: "Receipt number of your spouse's approved I-140. Three letters followed by ten digits.",
        help: "H-4 work authorization depends on your spouse having an approved I-140." }
    ]
  },
  {
    code: "(c)(33)",
    label: "Deferred Action for Childhood Arrivals",
    blurb: "You have been granted deferred action under DACA.",
    extraFields: [
      { name: "dacaApprovalDate", label: "DACA approval date", type: "date", required: true,
        description: "The date your most recent DACA request was approved, MM/DD/YYYY." }
    ]
  }
];

export const CATEGORY_CODES = ELIGIBILITY_CATEGORIES.map(c => c.code);
export const getCategory = code => ELIGIBILITY_CATEGORIES.find(c => c.code === code);
