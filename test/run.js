// Headless walk-through of the agent's path, using the same adapter surface a
// real agent uses: getTools() to discover, executeTool() to invoke.
import * as store from "../src/store.js";
import { initTools, syncTools } from "../src/tools.js";
import { getTools, executeTool } from "../src/webmcp-adapter.js";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label} ${extra}`); }
};
const names = async () => (await getTools()).map(t => t.name).sort();
const call = async (name, args) => {
  const tools = await getTools();
  const t = tools.find(x => x.name === name);
  if (!t) throw new Error(`tool not registered: ${name}. Registered: ${tools.map(x=>x.name).join(", ")}`);
  return executeTool(t, args);
};
const schemaOf = async name => (await getTools()).find(t => t.name === name)?.inputSchema;
// Human-side store writes notify subscribers, which schedule a tool sync. A real
// agent's next call always lands after that settles; the test has to await it.
const acceptAll = async () => { store.acceptAllPending(); await syncTools(); };
const setHuman = async (k, v) => { store.setHuman(k, v); await syncTools(); };

console.log("\n== initial tool surface ==");
await initTools();
let n = await names();
console.log("  " + n.join(", "));
ok("status tool always present", n.includes("get-form-status"));
ok("part 1 tool present", n.includes("set-reason-for-applying"));
ok("part 2 tool NOT yet present", !n.includes("set-personal-info"));
ok("packet tool NOT present", !n.includes("generate-filing-packet"));

console.log("\n== dynamic schema: renewal unlocks the prior-card field ==");
let s = await schemaOf("set-reason-for-applying");
ok("previousEadNumber absent before a reason is chosen", !("previousEadNumber" in s.properties));
await call("set-reason-for-applying", { reasonForApplying: "Renewal of permission to work" });
await acceptAll();
s = await schemaOf("set-reason-for-applying");
ok("previousEadNumber appears after choosing renewal", "previousEadNumber" in s.properties);
ok("and it is required", s.required.includes("previousEadNumber"));

console.log("\n== self-correction from a structured error ==");
let r = await call("set-reason-for-applying", { previousEadNumber: "12345" });
const rej = r.structuredContent.rejected[0];
ok("bad card number rejected", rej?.code === "EAD_FORMAT", JSON.stringify(rej));
ok("error carries a usable example", rej?.example === "SRC0912345678");
ok("agent text includes the rule", r.content[0].text.includes("three letters followed by ten digits"));
r = await call("set-reason-for-applying", { previousEadNumber: "SRC0912345678" });
ok("corrected value accepted", r.structuredContent.accepted.length === 1);

console.log("\n== human approval gate ==");
ok("value is pending, not committed", store.state.pending.previousEadNumber !== undefined);
ok("committed does not have it yet", store.state.committed.previousEadNumber === undefined);
n = await names();
ok("withdraw tool registered while a proposal is open", n.includes("withdraw-proposed-change"));
r = await call("get-proposed-changes", {});
ok("agent can see its own queue", r.structuredContent.pending.length === 1);
await acceptAll();
ok("accepting moves it to committed", store.state.committed.previousEadNumber === "SRC0912345678");
n = await names();
ok("withdraw tool unregistered when queue empties", !n.includes("withdraw-proposed-change"));

console.log("\n== progressive registration ==");
n = await names();
ok("part 2 tool now registered", n.includes("set-personal-info"));
ok("eligibility still locked", !n.includes("set-eligibility-category"));

await call("set-personal-info", {
  familyName: "Sok", givenName: "Dara", hasOtherNames: false,
  dateOfBirth: "03/14/1996", countryOfBirth: "Cambodia", cityOfBirth: "Battambang",
  countryOfCitizenship: "Cambodia", gender: "Male", maritalStatus: "Single"
});
await acceptAll();
n = await names();
ok("eligibility unlocked after identity is valid", n.includes("set-eligibility-category"));
ok("mailing unlocked too", n.includes("set-mailing-address"));
ok("other-names tool absent because hasOtherNames is false", !n.includes("add-other-name"));

console.log("\n== a boolean answer conjures a whole tool ==");
await call("set-personal-info", { hasOtherNames: true });
await acceptAll();
n = await names();
ok("add-other-name appears", n.includes("add-other-name"));
await call("set-personal-info", { hasOtherNames: false });
await acceptAll();
n = await names();
ok("and disappears again", !n.includes("add-other-name"));

console.log("\n== per-category schema generation ==");
await call("set-eligibility-category", { eligibilityCategory: "(c)(9)" });
await acceptAll();
let cs = await schemaOf("answer-category-questions");
ok("(c)(9) asks only for the I-485 receipt", JSON.stringify(Object.keys(cs.properties)) === '["receiptNumberI485"]', JSON.stringify(Object.keys(cs.properties)));

await call("set-eligibility-category", { eligibilityCategory: "(c)(3)(C)" });
await acceptAll();
cs = await schemaOf("answer-category-questions");
ok("(c)(3)(C) asks four different questions", Object.keys(cs.properties).length === 4, JSON.stringify(Object.keys(cs.properties)));
ok("same tool name, different schema", cs.properties.stemDegreeCipCode !== undefined);

console.log("\n== the form refuses out-of-scope fields ==");
r = await call("answer-category-questions", { receiptNumberI485: "IOE0912345678" });
ok("a field from the other category is refused", r.structuredContent.rejected[0]?.code === "FIELD_NOT_APPLICABLE");

console.log("\n== enum constraint ==");
r = await call("set-eligibility-category", { eligibilityCategory: "(c)(99)" });
ok("invented category code rejected", r.structuredContent.rejected[0]?.code === "NOT_IN_ENUM");
await call("set-eligibility-category", { eligibilityCategory: "(c)(3)(C)" });
await acceptAll();

console.log("\n== cross-field conflict detection ==");
await call("answer-category-questions", {
  sevisNumber: "N0012345678", schoolName: "San Jose State University",
  stemDegreeCipCode: "11.0701", employerEVerifyNumber: "123456"
});
await acceptAll();
await call("set-immigration-history", {
  dateOfLastEntry: "08/20/2019", placeOfLastEntry: "San Francisco, CA",
  statusAtLastEntry: "F-1 student", currentImmigrationStatus: "H-1B worker"
});
await acceptAll();
r = await call("get-form-status", {});
const mismatch = r.structuredContent.blockingIssues.find(b => b.code === "CATEGORY_STATUS_MISMATCH");
ok("category/status mismatch reported", Boolean(mismatch), JSON.stringify(r.structuredContent.blockingIssues.map(b=>b.code)));
ok("mismatch names both culprits", mismatch?.message.includes("(c)(3)(C)") && mismatch?.message.includes("H-1B"));
n = await names();
ok("a conflict does NOT unregister the tool needed to fix it", n.includes("set-immigration-history"));
ok("nor the other side of the conflict", n.includes("set-eligibility-category"));
await call("set-immigration-history", { currentImmigrationStatus: "F-1 student" });
await acceptAll();
r = await call("get-form-status", {});
ok("mismatch clears once corrected", !r.structuredContent.blockingIssues.some(b => b.code === "CATEGORY_STATUS_MISMATCH"));

console.log("\n== sensitive field is not agent-writable ==");
await call("set-government-numbers", { hasSSN: false, wantsSSNCard: true });
await acceptAll();
r = await call("set-government-numbers", { consentToDisclosure: true });
ok("consent refused for the agent", r.structuredContent.needsHumanAffirmation[0]?.code === "NEEDS_HUMAN_AFFIRMATION");
ok("consent did not land", store.values().consentToDisclosure !== true);
await setHuman("consentToDisclosure", true);
ok("human can set it", store.values().consentToDisclosure === true);

console.log("\n== explain-field ==");
r = await call("explain-field", { field: "sevisNumber" });
ok("explains where to find it", r.content[0].text.includes("I-20"));
ok("enum of valid field names in schema", (await schemaOf("explain-field")).properties.field.enum.length > 20);

console.log("\n== cancellation ==");
const ac = new AbortController();
const tools = await getTools();
const pre = tools.find(t => t.name === "run-eligibility-precheck");
ok("precheck registered after 3 sections", Boolean(pre));
const p = executeTool(pre, {}, { signal: ac.signal });
setTimeout(() => ac.abort(), 120);
let aborted = false;
try { await p; } catch (e) { aborted = e.name === "AbortError"; }
ok("precheck aborts cleanly", aborted);

console.log("\n== precheck produces a category-specific checklist ==");
r = await executeTool(pre, {});
ok("STEM checklist includes I-983", r.structuredContent.documentChecklist.some(d => d.includes("I-983")));

console.log("\n== packet gated on human certification ==");
n = await names();
ok("packet tool still absent", !n.includes("generate-filing-packet"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
