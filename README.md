# Ombuds

**A form that teaches the agent how to fill it, refuses the answers it cannot accept, corrects the agent when it is wrong, and hands every value to a human before it counts.**

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com). MIT licensed. No build step, no dependencies, no backend.

Live demo: `<paste your deployed URL here>`

---

## The problem

The worst experiences on the web are long conditional government and institutional forms. A work authorization application asks for a category code, and that code silently changes which of the next forty questions apply to you. Answer one question differently and a whole branch of the form appears or vanishes. Get a number format wrong and you find out weeks later by mail.

Agents are currently bad at these forms for the same reason people are. Screen-scraping a form gives an agent no idea that choosing `(c)(3)(C)` means it now needs a CIP code and an E-Verify number, or that requesting a Social Security card makes both parents' names mandatory. A backend MCP server cannot help either, because it does not know what the person in front of the browser has already answered.

Ombuds is the other approach. The page owns the rules, so the page is the one that should be telling the agent what to do.

## What makes this a WebMCP app rather than a form with tools bolted on

Five things, each of which is impossible or pointless over a backend integration.

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

```bash
npm test
```

`test/run.js` walks the agent's whole path through the adapter's `getTools()` and `executeTool()`, covering 43 assertions: progressive registration, per-category schema generation, self-correction from structured errors, the approval gate, enum enforcement, cross-field conflict detection, sensitive-field refusal, and cancellation.

## How it is put together

| File | Role |
| --- | --- |
| [`src/reference-data.js`](src/reference-data.js) | The lists that become both `<select>` options and schema enums, plus the per-category evidence requirements |
| [`src/form-definition.js`](src/form-definition.js) | One declarative form definition with the `showWhen` predicates that drive UI and schema together |
| [`src/validators.js`](src/validators.js) | Field-level and cross-field rules, returning structured, agent-actionable failures |
| [`src/store.js`](src/store.js) | The committed/pending two-layer state, section gating, and status reporting |
| [`src/tools.js`](src/tools.js) | Schema generation and the sync loop that keeps the registered tool set equal to what the form wants |
| [`src/webmcp-adapter.js`](src/webmcp-adapter.js) | Thin pass-through to `document.modelContext`, with a local registry when WebMCP is absent so tests and the in-page panel use the identical code path |
| [`src/ui.js`](src/ui.js) | The form, the review queue, and the live tool-surface panel |

### A bug worth mentioning

The first version gated a section on its prerequisites being fully valid, cross-field checks included. That produced a trap: declaring a status that conflicted with the chosen category made both sections invalid, which unregistered `set-immigration-history`, which was the only tool that could have fixed the conflict. The agent was told about a problem and simultaneously denied the means to solve it.

Registration now depends on per-field validity only. Cross-field conflicts are reported loudly and block the final packet, but they never retract a tool. `test/run.js` guards the regression.

The general lesson is that when tool availability is derived from application state, it becomes possible to strand an agent in a state it cannot escape. Reachability is a property worth checking deliberately.

## Honest limitations

- The form is modeled on the published structure of the I-765 employment authorization application but is a **simplified subset** with roughly forty fields, not a complete reproduction. Category lists and evidence requirements are representative rather than exhaustive.
- Ombuds is an independent worksheet. It is **not affiliated with USCIS or any government agency**, it does not file anything, and it produces a review summary rather than a submittable document. Anyone filing for real should check their answers against current official instructions.
- All state is in-memory and per-tab. Reloading starts over. Nothing is sent anywhere, which is the right default for this data but does mean there is no save.
- `exposedTo` and cross-origin tool federation are implemented in the adapter surface but not exercised, since the app is a single origin.

## Why this problem

I spent a year doing missionary work in Cambodia and watched people lose months to paperwork that was written as though the rules were obvious. The rules are never obvious. They live in the footnotes of a form and in the head of whoever has filled it out before. Putting them in the page, where an agent can be told them directly and a person can still overrule the result, is a better use of this standard than making a shopping cart faster.

## License

MIT. See [LICENSE](LICENSE).
