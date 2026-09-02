// Chrome's tool security guidance budgets individual tool output at about 1.5K
// characters. Anything past that risks being truncated on its way to the model,
// and a truncated validation rule is worse than no rule.
import * as store from "../src/store.js";
import { initTools } from "../src/tools.js";
import { getTools, executeTool } from "../src/webmcp-adapter.js";

const LIMIT = 1500;
await initTools();

const fill = async () => {
  store.propose("reason", { reasonForApplying: "Initial permission to accept employment" }, "human");
  store.propose("identity", { familyName:"Sok", givenName:"Dara", middleName:"Vuthy", hasOtherNames:false, dateOfBirth:"03/14/1998", countryOfBirth:"Cambodia", cityOfBirth:"Battambang", countryOfCitizenship:"Cambodia", gender:"Male", maritalStatus:"Single" }, "human");
  store.propose("mailing", { mailingStreet:"1420 Wolfe Road", mailingUnitType:"Apt", mailingUnitNumber:"12B", mailingCity:"Sunnyvale", mailingState:"CA", mailingZip:"94086", mailingSameAsPhysical:true }, "human");
  store.propose("numbers", { aNumber:"A012345678", uscisAccountNumber:"123456789012", hasSSN:true, ssn:"123456789" }, "human");
  store.propose("eligibility", { eligibilityCategory:"(c)(3)(C)" }, "human");
  store.propose("category-details", { sevisNumber:"N0012345678", schoolName:"San Jose State University", stemDegreeCipCode:"11.0701", employerEVerifyNumber:"123456" }, "human");
  store.propose("history", { dateOfLastEntry:"08/20/2023", placeOfLastEntry:"San Francisco, CA", statusAtLastEntry:"F-1 student", currentImmigrationStatus:"F-1 student" }, "human");
  store.propose("contact", { daytimePhone:"4085551234", email:"dara@example.com", preferredLanguage:"Khmer" }, "human");
  store.setCertified(true);
  await new Promise(r => setTimeout(r, 120));
};
await fill();

const call = async (name, args = {}) => {
  const tool = (await getTools()).find(t => t.name === name);
  if (!tool) return null;
  return executeTool(tool, args);
};

// The worst case for each tool: a fully populated form.
const probes = [
  ["get-form-status", {}],
  ["list-eligibility-categories", {}],
  ["explain-field", { field: "sevisNumber" }],
  ["get-proposed-changes", {}],
  ["run-eligibility-precheck", {}],
  ["generate-filing-packet", {}],
  ["set-personal-info", { familyName: "Sok" }]
];

let over = 0;
console.log(`\nWorst-case output size per tool, limit ${LIMIT}\n`);
for (const [name, args] of probes) {
  const res = await call(name, args);
  if (!res) { console.log(`  skip  ${name} (not registered)`); continue; }
  const len = (res.content?.[0]?.text || "").length;
  const flag = len > LIMIT;
  if (flag) over++;
  console.log(`  ${flag ? "OVER" : "ok  "}  ${name.padEnd(30)} ${len}`);
}
console.log(`\n${over} tool(s) over the output budget\n`);
if (over) process.exit(1);
