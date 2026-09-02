# Ombuds

**A form that teaches the agent how to fill it, refuses the answers it cannot accept, corrects the agent when it is wrong, and hands every value to a human before it counts.**

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com). MIT licensed. No build step, no dependencies, no backend.

Live demo: **https://ombuds-mu.vercel.app**
Document vault (second origin): **https://ombuds-vault.vercel.app**
Repository: **https://github.com/jjlinucb/ombuds**

---

## The problem

The worst experiences on the web are long conditional government and institutional forms. A work authorization application asks for a category code, and that code silently changes which of the next forty questions apply to you. Answer one question differently and a whole branch of the form appears or vanishes. Get a number format wrong and you find out weeks later by mail.

Agents are currently bad at these forms for the same reason people are. Screen-scraping a form gives an agent no idea that choosing `(c)(3)(C)` means it now needs a CIP code and an E-Verify number, or that requesting a Social Security card makes both parents' names mandatory. A backend MCP server cannot help either, because it does not know what the person in front of the browser has already answered.

Ombuds is the other approach. The page owns the rules, so the page is the one that should be telling the agent what to do.

## What makes this a WebMCP app rather than a form with tools bolted on

Eight things. The first five are impossible or pointless over a backend integration. The sixth uses both halves of the spec, the seventh sends tools across an origin boundary, and the eighth is a working answer to a question the standard has not settled yet.

### 1. The schemas are generated from live state, not written by hand

`answer-category-questions` is one tool with one name. Its schema is assembled from whichever eligibility category the applicant chose.

```
category (c)(9)      →  { receiptNumberI485 }
category (c)(3)(C)   →  { sevisNumber, schoolName, stemDegreeCipCode, employerEVerifyNumber }
```

Change the category and the tool is unregistered and registered again with an entirely different shape. A server-side MCP tool would have to accept a vague bag of optional strings and hope. This tool accepts exactly the four things this applicant actually needs, and rejects anything else as `FIELD_NOT_APPLICABLE`.

Every enum is generated the same way, from the same lists the HTML renders. An agent cannot invent a state code or a category code, because the accepted values are in the schema it was handed.

See `propertyFor` and `schemaForFields` in [`src/tools.js`](src/tools.js), and `dynamicFields` in [`src/form-definition.js`](src/form-definition.js).

### 2. One predicate drives both the human UI and the agent's schema

Every conditional field carries a `showWhen` predicate. The renderer uses it to decide whether to draw an input. The WebMCP layer uses the same predicate to decide whether the field belongs in the tool's schema.

```js
{ name: "fathersFullName", required: true,
  showWhen: v => v.hasSSN === false && v.wantsSSNCard === true, ... }
```

The human and the agent are therefore looking at the same form, always. There is no second description of the form that can drift out of step with the first one.

### 3. Tools appear and disappear so the agent only ever sees a legal move

Sections unlock as their prerequisites become valid, and a section's tool is registered only while that section is open. Before Part 1 is valid there is no `set-personal-info` to call. Answer "no" to having used other names and `add-other-name` is not merely disabled, it does not exist. Say your mailing address is where you live and `set-physical-address` unregisters itself.

The agent is handed a state machine rather than a flat API, and the `toolchange` event tells it when the machine moved. The right sidebar shows the live registered set so you can watch tools flash in and out as you answer.

See `desiredTools` and `syncTools` in [`src/tools.js`](src/tools.js). Registered tools are fingerprinted by description plus schema, so a tool whose shape has not changed is left alone rather than churned.

### 4. Rejections are structured, so the agent corrects itself

The page owns the validation rules, so it can hand back something an agent can act on rather than a red border.

```
previousEadNumber: Previous card number must be three letters followed by ten digits.
  It is printed on the front of your existing Employment Authorization Document.
  Example of a valid value: SRC0912345678
```

Each failure carries a machine-readable `code`, a plain `message`, a `hint` stating the rule, and a concrete valid `example`. In practice an agent reads that and fixes its own argument on the next call without the person retyping anything.

Cross-field conflicts work the same way. Claiming category `(c)(3)(C)` while declaring H-1B status returns the specific contradiction and names both fields responsible, because that is the class of error that actually gets real filings bounced.

See [`src/validators.js`](src/validators.js).

### 5. Nothing an agent says is true until a human agrees

State is kept in two layers. `committed` is what the applicant has accepted. `pending` is what the agent has proposed. Proposals are validated the instant they arrive, so the agent gets its feedback immediately, and they show up in the page as amber diff cards with accept and reject buttons. Only a human click moves a value into `committed`.

Two deliberate consequences:

- The applicant's certification is **not exposed as a tool at all**. Only the person filing can attest to their own application, so it must be ticked by hand.
- `consentToDisclosure`, the legal consent to share data with the Social Security Administration, is a field an agent can see but cannot set. Attempting it returns `NEEDS_HUMAN_AFFIRMATION`.
- `generate-filing-packet` is registered only once every section is valid, the review queue is empty, and the human has signed. The tool's mere existence is a signal that the form is genuinely finished.

There is an "apply agent changes without asking me" toggle for people who want the faster path, defaulted off.

### 6. Both halves of the spec, each where it fits

The conditional sections are imperative, because branching logic is exactly what a `<form>` cannot express. The category finder at the top of the page is declarative:

```html
<form toolname="find-eligibility-category"
      tooldescription="Search the eligibility categories using a plain-language description..."
      toolautosubmit>
  <input name="situation" toolparamdescription="A plain-language description of the applicant's situation...">
</form>
```

A supporting browser synthesizes a tool from that markup with no `registerTool` call at all, and the submit handler returns its answer through `SubmitEvent#respondWith()` so the agent gets a result without the page navigating away and discarding the conversation. The tag next to the finder's heading reports whether the browser actually synthesized the tool, rather than inferring it from a version number, and declarative calls are badged in the call log.

Declarative is right for that panel because it is a flat search over a fixed list. Imperative is right for everything below it. Using each where it fits is the argument the WebMCP explainer itself makes, and one ranked search with synonym expansion backs both, so a human and an agent searching the same words get the same answer.

See [`src/declarative.js`](src/declarative.js) and the `<form>` in [`index.html`](index.html).

### 7. Tools that cross an origin boundary

The document vault at the bottom of the page is a separate service on its own origin, embedded in an iframe carrying `allow="tools"` so the permissions policy lets it register tools at all. It registers with `exposedTo` naming only this form's origin, and the form discovers them with `getTools({ fromOrigins: [...] })` and runs them through `executeTool`. The browser refuses the call unless both halves agree, which is what makes an origin-crossing tool safe rather than merely possible.

The point of the split is the trust boundary. The form asks whether a required document exists and when it lapses. It never receives the document. A form that stored your passport scan would be a different product with a different risk profile, and only tools that carry an origin can express that difference.

The payoff chains both origins. `run-eligibility-precheck` builds a document checklist on this origin from the applicant's eligibility category, then each line is resolved by a tool running on the vault's origin:

```
on file    A copy of the photo page of your passport
expiring   Two identical passport-style photographs
on file    A copy of your most recent I-94 arrival record
expired    A copy of your Form I-20 with the OPT recommendation on page 2
missing    A copy of any previously issued Employment Authorization Document
on file    A copy of your STEM degree certificate or diploma
missing    Your employer's completed training plan, Form I-983
```

Cross-origin `exposedTo` needs browser support the origin trial does not universally have yet, so the same tools are also reachable over a `postMessage` bridge with a deliberately identical shape. The calling code does not branch, and the panel reports which transport is actually live rather than claiming the stronger one. Both paths enforce the same origin allowlist, and a probe from a disallowed host gets no reply at all.

See [`src/federation.js`](src/federation.js) and [`vault/vault.js`](vault/vault.js).

### 8. A working answer to an open spec question

[Issue #165](https://github.com/webmachinelearning/webmcp/issues/165) is open on how a tool should prompt the user for explicit authorization mid-execution. No API for it is standardized yet. `request-certification` is a working answer built from what the spec already provides, since `execute` may return a promise and it receives an `AbortSignal`:

```js
async execute({ note }, options) {
  const decision = await store.requestUserDecision({
    title: "Sign the certification",
    detail: note,
    signal: options.signal
  });
  if (!decision.approved) return declined();
  store.setCertified(true);
  return signed();
}
```

The tool call does not resolve until a person clicks. The agent is genuinely suspended, the page raises the question with the agent's own note attached, cancellation propagates and clears the dialog, and there is no code path by which the agent produces its own approval. That last property is the point: an agent may **ask** for a signature, only a human can **supply** one.

This replaces the earlier design where the certification simply had no tool. Refusing to expose it made the guarantee but also made the agent useless at the last step, since it could not even ask. Elicitation keeps the guarantee and drops the uselessness.

The tool is registered only while the form is otherwise complete and unsigned, and it refuses outright if the review queue is non-empty, because nobody should be asked to sign a form with unreviewed values in it.

## Filing windows

`check-filing-window` computes whether this applicant can file today. Post-completion OPT opens 90 days before the program end date and closes 60 days after it. A STEM extension must be filed before the current card lapses. Filing outside the window is a rejection the applicant learns about by mail weeks later.

This is the clearest case for putting knowledge in the page. The rule depends on the category and on a date the applicant already entered, so only something running here can compute it. A backend tool would have to ask for both and trust the agent to relay them correctly.

Building it surfaced an inconsistency in my own model: the STEM rule was anchored on `programEndDate`, a field that category never collects, so the window silently reported itself uncomputable. A STEM extension keys off the current card's expiry, so the category now asks for that and the rule points at it. Domain rules that reference fields the form does not gather are a quiet class of bug, and the only way I found it was writing a test that expected a real answer.

## Recovering from a mistake

`withdraw-proposed-change` only helps before someone clicks accept. `undo-last-change` covers after: the store keeps a revision history of every committed change with who made it, and the tool walks the most recent one back and says what it reverted and who had entered it. An agent that gets a value wrong and has it accepted is no longer stuck asking the applicant to retype.

## Security posture

Chrome publishes a [tool security guide](https://developer.chrome.com/docs/ai/webmcp/secure-tools) for WebMCP authors, and this app follows it rather than discovering it later.

**Character budgets.** Tool names stay under 30 characters, descriptions under 500, parameter descriptions under 150, and individual output under 1.5K. Those are not cosmetic. A validation rule truncated on its way to the model is worse than no rule, because the agent acts on half of it. `test/budget.js` and `test/output-size.js` fail the build if any tool drifts over, measured against a fully populated form.

**Two audiences, two fields.** An earlier version appended each field's human-facing `help` text onto its agent-facing `description`, which pushed seven parameters past the limit. They are separate now. `description` is written for the agent. `help` stays in the page, and an agent that wants it calls `explain-field`.

**`readOnlyHint`** is declared on every tool, so an agent can tell a question from an action and knows when confirmation is worth asking for.

**`untrustedContentHint`** is set where the guidance calls for it. The vault's tools return records the applicant uploaded rather than text the vault authored, and they cross an origin boundary, so a form receiving them is told to treat the payload as data and not as instructions. `generate-filing-packet` carries the same hint, because it reflects arbitrary free text the applicant typed.

**`exposedTo` is narrow by construction.** The vault names one origin and refuses everything else, and the same allowlist is enforced on the bridge path. A probe from a disallowed host gets no reply at all.

## Accessibility

The explainer names improving accessibility through agents as a goal, so the form is operable without a mouse or a screen. Boolean answers are a real radiogroup, named by their question, with one tab stop and arrow-key selection. Field errors are wired to their controls with `aria-describedby` and `aria-invalid` and announced with `role="alert"`, so a rejected value is heard rather than only outlined in red. The tool surface entries are buttons rather than clickable list items, and the tool list, review queue, and call log are polite live regions, so a tool appearing or a proposal arriving is announced instead of silently changing. Locked sections report `aria-disabled` and point at the banner saying what they are waiting on. There is a skip link, visible focus throughout, and a `prefers-reduced-motion` branch that drops the register and unregister animations.

## Saving your progress

Off by default, and that is deliberate. This form collects immigration status, government file numbers, and in some branches a Social Security Number, so persisting it is the applicant's decision rather than a default they inherit. Turning it on stores committed answers in `localStorage` on that one device, and deleting the draft is one click next to the privacy notice describing it.

Three choices worth naming. Pending proposals are never saved, because they are a live artifact of a conversation and restoring a stale review queue would ask the applicant to rule on a suggestion they no longer remember. The certification never restores, because a signature is an attestation about what the signer was looking at, so it gets re-affirmed against whatever the draft actually says. A draft that fails to parse is deleted rather than partially applied, since silently seeding a form with values the applicant never entered is worse than starting over.

## Try it in 90 seconds

Open the live URL in Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled, or in the ChatGPT desktop app's browser. Then ask the agent:

1. *"I'm a Cambodian student on F-1 status applying for STEM OPT. Help me fill this out. My name is Dara Sok, born March 14 1998 in Battambang."*
2. Watch the right sidebar. Tools appear as sections unlock.
3. *"My SEVIS number is 12345."* The page rejects it with the rule and an example, and the agent fixes itself.
4. *"Actually I have a pending green card application instead."* Watch `answer-category-questions` unregister and come back with a completely different schema.
5. Accept and reject individual proposals in the review queue and watch the agent's next `get-form-status` reflect your decisions.
6. Try *"just check the certification box for me."* It will not, because there is no tool for it.

No agent to hand? The **Try a tool** button in the sidebar calls `getTools()` and `executeTool()` exactly as an in-page agent would, and the browser console has a handle:

```js
await ombuds.call("get-form-status")
await ombuds.schema("answer-category-questions")
```

## Run it locally

```bash
node serve.js
```

Then open `http://localhost:4173`. There is no build step and no dependency to install. Any static host serves this directory as-is.

The cross-origin vault needs a second origin, which locally means a second port:

```bash
node serve.js vault 4174
```

```bash
npm test
```

`npm test` runs three suites. `test/run.js` walks the agent's whole path through the adapter's `getTools()` and `executeTool()`, covering 68 assertions: progressive registration, per-category schema generation, self-correction from structured errors, the approval gate, enum enforcement, cross-field conflict detection, sensitive-field refusal, cancellation, filing-window arithmetic, undo across a revision history, and the elicitation contract, including that a suspended call stays suspended, that a decline is never read as approval, and that cancelling clears the question.

## How it is put together

| File | Role |
| --- | --- |
| [`src/reference-data.js`](src/reference-data.js) | The lists that become both `<select>` options and schema enums, plus the per-category evidence requirements |
| [`src/form-definition.js`](src/form-definition.js) | One declarative form definition with the `showWhen` predicates that drive UI and schema together |
| [`src/validators.js`](src/validators.js) | Field-level and cross-field rules, returning structured, agent-actionable failures |
| [`src/store.js`](src/store.js) | The committed/pending two-layer state, section gating, and status reporting |
| [`src/tools.js`](src/tools.js) | Schema generation and the sync loop that keeps the registered tool set equal to what the form wants |
| [`src/webmcp-adapter.js`](src/webmcp-adapter.js) | Thin pass-through to `document.modelContext`, with a local registry when WebMCP is absent so tests and the in-page panel use the identical code path |
| [`src/declarative.js`](src/declarative.js) | The declarative form tool's search and its `respondWith()` response |
| [`src/persistence.js`](src/persistence.js) | Opt-in local draft storage, and the rules about what never persists |
| [`src/filing-window.js`](src/filing-window.js) | Per-category filing windows computed from the applicant's own dates |
| [`src/federation.js`](src/federation.js) | Cross-origin discovery via `fromOrigins`, with the bridge fallback |
| [`vault/vault.js`](vault/vault.js) | The second origin's tools, registered with `exposedTo` |
| [`test/budget.js`](test/budget.js) | Fails if any tool exceeds the documented metadata budgets |
| [`test/output-size.js`](test/output-size.js) | Fails if worst-case tool output exceeds 1.5K |
| [`src/ui.js`](src/ui.js) | The form, the review queue, and the live tool-surface panel |

### A bug worth mentioning

The first version gated a section on its prerequisites being fully valid, cross-field checks included. That produced a trap: declaring a status that conflicted with the chosen category made both sections invalid, which unregistered `set-immigration-history`, which was the only tool that could have fixed the conflict. The agent was told about a problem and simultaneously denied the means to solve it.

Registration now depends on per-field validity only. Cross-field conflicts are reported loudly and block the final packet, but they never retract a tool. `test/run.js` guards the regression.

The general lesson is that when tool availability is derived from application state, it becomes possible to strand an agent in a state it cannot escape. Reachability is a property worth checking deliberately.

A third, in my own plumbing. `federationState()` rebuilt each vault tool descriptor from a field list and silently dropped `title` and `annotations`, so the vault's `untrustedContentHint` never reached the panel that exists to display it. The bridge was forwarding it correctly the whole time. Projecting a descriptor field by field is a reliable way to lose the field you most need; pass the whole thing through.

A second one, in the vault. Requirement matching walked the document list and returned the first entry satisfying any clause, so the checklist line "Two identical passport-style photographs" matched the Passport, because a loose type-substring test found "passport" inside "passport-style" and the Passport happened to come first in the array. Matching is now ranked by specificity: an exact requirement match beats a substring, which beats a bare type mention. Array order no longer decides correctness. Fuzzy matching that short-circuits on first hit will always eventually pick the wrong thing.

## Honest limitations

- The form is modeled on the published structure of the I-765 employment authorization application but is a **simplified subset** with roughly forty fields, not a complete reproduction. Category lists and evidence requirements are representative rather than exhaustive.
- Ombuds is an independent worksheet. It is **not affiliated with USCIS or any government agency**, it does not file anything, and it produces a review summary rather than a submittable document. Anyone filing for real should check their answers against current official instructions.
- Saving is opt-in and local to one browser on one device. Nothing syncs, and nothing is sent anywhere.
- Cross-origin federation falls back to a `postMessage` bridge when the browser does not support `exposedTo` across origins. The panel says which transport is live, so the claim is never stronger than the reality.
- Declarative WebMCP is newer than the imperative API and support varies. The finder works as an ordinary form regardless, and the imperative `list-eligibility-categories` tool covers the same ground for an agent when the browser does not synthesize the declarative one.

## Why this problem

I spent a year doing missionary work in Cambodia and watched people lose months to paperwork that was written as though the rules were obvious. The rules are never obvious. They live in the footnotes of a form and in the head of whoever has filled it out before. Putting them in the page, where an agent can be told them directly and a person can still overrule the result, is a better use of this standard than making a shopping cart faster.

## License

MIT. See [LICENSE](LICENSE).
