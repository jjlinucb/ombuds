import * as store from "../src/store.js";
import { initTools } from "../src/tools.js";
import { getTools } from "../src/webmcp-adapter.js";

const LIMITS = { name: 30, description: 500, paramDescription: 150, output: 1500 };

await initTools();
// drive the form far enough that every tool registers at least once
const call = async (n, a) => {
  const t = (await getTools()).find(x => x.name === n);
  if (!t) return null;
  return t.execute ? null : null;
};
const seen = new Map();
const capture = async () => { for (const t of await getTools()) seen.set(t.name, t); };
await capture();

store.propose("reason", { reasonForApplying: "Initial permission to accept employment" }, "human"); await capture();
store.propose("identity", { familyName:"Sok", givenName:"Dara", hasOtherNames:true, dateOfBirth:"03/14/1998", countryOfBirth:"Cambodia", cityOfBirth:"Battambang", countryOfCitizenship:"Cambodia", gender:"Male", maritalStatus:"Single" }, "human");
await new Promise(r=>setTimeout(r,60)); await capture();
store.propose("mailing", { mailingStreet:"1 A St", mailingUnitType:"None", mailingCity:"Sunnyvale", mailingState:"CA", mailingZip:"94086", mailingSameAsPhysical:false }, "human");
await new Promise(r=>setTimeout(r,60)); await capture();
store.propose("eligibility", { eligibilityCategory:"(c)(3)(C)" }, "human");
await new Promise(r=>setTimeout(r,60)); await capture();
store.propose("numbers", { aNumber:"A012345678", hasSSN:false, wantsSSNCard:true, fathersFullName:"Sok Vuthy", mothersFullName:"Chan Sophea", consentToDisclosure:true }, "human");
await new Promise(r=>setTimeout(r,60)); await capture();
store.propose("history", { dateOfLastEntry:"08/20/2023", placeOfLastEntry:"SFO, CA", statusAtLastEntry:"F-1 student", currentImmigrationStatus:"F-1 student" }, "human");
await new Promise(r=>setTimeout(r,60)); await capture();
store.propose("category-details", { sevisNumber:"N0012345678", schoolName:"SJSU", stemDegreeCipCode:"11.0701", employerEVerifyNumber:"123456", currentEadExpires:"12/31/2026" }, "human");
await new Promise(r=>setTimeout(r,60)); await capture();
store.propose("contact", { daytimePhone:"4085551234", email:"a@b.co" }, "human");
await new Promise(r=>setTimeout(r,60)); await capture();
// The undo tool needs history and the certification tool needs a wholly
// finished form, so drive the form to completion and capture again. Without
// this the audit silently skipped two tools, which is the failure mode a budget
// test exists to prevent.
store.propose("identity", { middleName: "Vuthy" }, "human");
await new Promise(r=>setTimeout(r,80)); await capture();

store.propose("physical", { physicalStreet:"9 B St", physicalUnitType:"None", physicalCity:"Sunnyvale", physicalState:"CA", physicalZip:"94086" }, "human");
store.proposeRow("otherNames", { familyName:"Chan", givenName:"Dara" }, "human");
await new Promise(r=>setTimeout(r,80)); await capture();

const done = store.formStatus();
if (done.sectionsComplete !== done.sectionsAvailable) {
  console.log(`  !! form did not reach completion (${done.sectionsComplete}/${done.sectionsAvailable}), so gated tools were not audited`);
  for (const sec of done.sections.filter(x => !x.complete)) {
    console.log(`     incomplete: ${sec.section} (${sec.errorCount} issues)`);
  }
  process.exit(1);
}
await capture();

let violations = 0;
let annotationGaps = 0;
console.log(`\nAudited ${seen.size} distinct tools against the documented budgets\n`);
console.log("TOOL NAME".padEnd(32) + "NAME".padEnd(7) + "DESC".padEnd(8) + "WORST PARAM");
console.log("-".repeat(72));
for (const [name, t] of [...seen].sort()) {
  const nameLen = name.length;
  const descLen = (t.description || "").length;
  const params = Object.entries(t.inputSchema?.properties || {});
  let worst = 0, worstName = "-";
  for (const [pn, p] of params) {
    const l = (p.description || "").length;
    if (l > worst) { worst = l; worstName = pn; }
    if (pn.length > LIMITS.name) { console.log(`  !! param name too long: ${pn} (${pn.length})`); violations++; }
  }
  if (!t.annotations || typeof t.annotations.readOnlyHint !== "boolean") {
    console.log(`  !! ${name} is missing a readOnlyHint annotation`);
    annotationGaps++;
  }
  if (!t.title) {
    console.log(`  !! ${name} is missing a title`);
    annotationGaps++;
  }
  const nf = nameLen > LIMITS.name ? "OVER" : "ok";
  const df = descLen > LIMITS.description ? "OVER" : "ok";
  const pf = worst > LIMITS.paramDescription ? "OVER" : "ok";
  if (nf === "OVER" || df === "OVER" || pf === "OVER") violations++;
  console.log(
    name.padEnd(32) +
    `${nameLen}${nf === "OVER" ? "!" : ""}`.padEnd(7) +
    `${descLen}${df === "OVER" ? "!" : ""}`.padEnd(8) +
    `${worst}${pf === "OVER" ? "!" : ""} (${worstName})`
  );
}
console.log("-".repeat(72));
console.log(`limits: name<=${LIMITS.name}  description<=${LIMITS.description}  param description<=${LIMITS.paramDescription}`);
console.log(`\n${violations} tool(s) over budget, ${annotationGaps} annotation/title gap(s)\n`);
if (violations || annotationGaps) process.exit(1);
