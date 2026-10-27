---
feature_name: view_composition
status: approved
module_blueprints: []
dependencies: [reusable_lit_adapter, reusable_mcp_connector, content_safety_levels, application_setup]
date_added: 2026-10-21
---

# SDK-owned view composition

A notes application should decide which note an Archive button affects without also ordering an MCP handshake, decoding A2UI messages or rebuilding its controls for every result. The application states what its domain data means; the SDK composes how that data is rendered and delivered. An application installs one stack package, `@saga-a2ui/react-mcp-stack` or `@saga-a2ui/lit-mcp-stack`, plus its framework peers, and imports from the stack only. The SDK holds no domain schema and hardcodes no answer schema.

## Status

**Approved and implemented for both React and Lit MCP stacks; application and host acceptance remain scoped.** Both stacks provide typed own-catalog surfaces, in-place updates, action integration and optional FaithfulCard applications. They own MCP readiness and delivery, result handling and teardown. The approved fourth design revision is [`7a78e7eae99285174a11c62d43c1f0035658ec96`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7a78e7eae99285174a11c62d43c1f0035658ec96/blueprints/features/view_composition.blueprint.md). Its delivery includes the definition-owned result reader, stack-only recipe, ordered teardown and Lit's default session. The final branded-card stack qualification landed at `e62514504f7501ef20d9cfeed319ded6159f42b6`; [independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/248#pullrequestreview-5621359008) covered `e3a04efdb07ba807723c18e6b865bba71f10ee8c`. [The design and delivery history](#design-and-delivery-history) records the separate design, review and landed revisions for every slice.

All seven packages are published at [`0.7.7-rc.1`](https://github.com/MachineWisdomAI/saga-a2ui/releases/tag/v0.7.7-rc.1), available under npm `next` on 27 October 2026. The [installation guide](../../docs/public-install.md) owns the public recipe. The implemented and qualified composition surface above is available in either stack. The [source generator](application_setup.blueprint.md) currently offers Lit templates only; that is a tooling limit, separate from React stack support. Publication does not establish adoption by the motivating application or a new named-host run; those require the exact application and built resource. Qualification covers MCP delivery and the behaviors listed below, not equivalence across every renderer feature or runtime.

## Ownership and example

Every versioned package shares one major.minor; patch may vary, and the version check enforces it. The retired integration pin remains historical; ordinary changes follow the [version policy](../../docs/version-policy.md).

The SDK owns the ordering between rendering and delivery; the application owns every domain schema and the whole-result logic. Dependencies point one way. Core imports no MCP, renderer or DOM. Components imports no DOM, MCP or renderer. Among SDK packages, MCP and components depend on core, not on one another or on the renderers; renderer packages consume core and components. `@saga-a2ui/react` and `@saga-a2ui/mcp` stay independent; only a stack connects a renderer to a delivery.

The maintained starter uses this composition. Its application defines a catalog (the available component types), a layout (which components appear), and a data schema (what may be displayed). The surface is defined once, and the stack mounts it and routes each tool result to the application's update. The id constants are application-owned; the clear-action binding is omitted here.

```ts
const CLEAR_ID = 'clear';
const layout = defineSurface({
  surfaceId: 'starter', catalogId: CATALOG_ID,
  data: z.object({headline: z.string()}), initial: {headline: ''},
  root: {component: 'Column', bind: {}, props: {children: ['headline', CLEAR_ID]}},
  components: [
    {id: 'headline', component: 'Line', kind: 'title', text: {path: '/headline'}},
    {id: CLEAR_ID, component: 'ActionButton', child: 'clear-label'},
    {id: 'clear-label', component: 'Line', kind: 'body', text: 'Clear'},
  ],
});
const view = startA2uiView({
  container, layout, catalog: starterCatalog,
  onToolResult: (result, {surface}) => surface.update({headline: headlineFor(result)}),
});
await view.ready;
```

When the host delivers a result, `headlineFor` interprets its application contract and returns the next headline. `surface.update` validates that value against the schema and changes the existing surface. The Clear button keeps its instance, binding and focus; the application attaches its Clear definition separately through the action integration. When the application ends this view, `view.dispose()` retires its presentation and delivery. The complete catalog, action attachment and result reader live together in the [maintained starter](../../templates/lit-node/src/view.ts).

## Layers

**A. Surface authoring** (`@saga-a2ui/core/protocols/a2ui/v0_9`). `defineSurface({surfaceId, catalogId, data, root, components?, initial})` returns a `SurfaceLayout<TData>` holding the opening messages and typed, validated `update(data)` messages. `data` is a Zod 3 schema. `root` is one component object `{component, bind, props}` with no `id` and no top-level `children`; child ids go in `props`. `components` lists the rest. The root is never a string id and never repeats a root id.

**B. Bound surface** (`@saga-a2ui/react/a2ui`, `@saga-a2ui/lit`). In React, `openSurface(layout, catalog)` returns a `BoundSurface<TData>` with `update(data)` and `dispose`, rendered by `<Surface of={handle}/>`. In Lit, `createA2uiAppElement({catalog, layout, actions?})` builds an element that exposes `updateData(data)`. Each connect creates a default session from catalog and layout using the SDK decoder; injecting a session is an optional advanced choice. An update validates against the layout schema and applies in place, so mounted controls, focus, component state and action bindings survive. A rejected update returns `{ok: false, failure}` in both renderers, with `failure` as `{kind, message}`, and changes nothing. Presenting an equal answer again is a selection, not an update (layer C).

**C. Card conveniences** (`@saga-a2ui/{react,lit,components}/faithful-card`). Both renderers provide `createFaithfulCardView({dialect, maxLength, policy, contentSecurityPolicies, hostLinks})`, `openFaithfulCardSurface()` (a `CardSurface` with `present(content)` and `clear()`) and a host-link helper (React `useHostLink`, Lit `bindHostLink`). The stack reads the document, including the embedded policy and the CSP meta values, and passes them in; the renderer establishes image enforcement from them and takes no document.

`present` revokes image consent, retires late link and image outcomes of the previous presentation and advances a presentation token, even for equal text. `present` itself leaves the previous presentation untouched when it rejects content; the card-app stack handles that rejection by calling `clear()` before showing the problem.

The public semantic content set includes `strong`, `em` and `hr`. No weight, size or colour is imposed on `strong` or `em`, and a closing strong footer inherits the footer treatment. `hr` is a divider, and one divider remains possible. The closing marker `data-saga-closing="paragraph"` goes on the final top-level block only when it is a paragraph; a trailing list, quote or table gets none, nested paragraphs are never marked, and the SDK gives the marker no attribution meaning. The private `data-testid` and `data-annotation` attributes are not styling contracts; styling follows the [faithful-card styling guide](../../docs/faithful-card-styling.md).

**D. Delivery and transport.** Core owns `HostLinks`, `LinkOpenOutcome` and `DeliveredResult`. `@saga-a2ui/mcp/view` provides `runToolResultView`, `hostLinksFromApp`, `startOwnSizing` and `readingProfile`. `@saga-a2ui/mcp/server` provides `operationViewFromHtml` with a structural CSP value, so mcp never imports components. Components owns the one policy transport pair, `embedContentPolicy(html, policy)` and `contentPolicyFromEmbedded(text)`:

- The configuration JSON writes every less-than sign as the six ASCII characters backslash, `u`, `0`, `0`, `3`, `c`, and JSON decoding restores it. A `</script>` inside a value stays inert, and a round trip returns an equal policy.
- The charset meta, if any, comes first, then the CSP meta and the configuration script, all before any other script. Insertion is immediately after `<head …>`, or after a `<meta charset>` only when that meta is head's first element.
- Rejected: no `<head>`, any `<script` before the insertion point, a charset meta after a script, and a double quote in the CSP value.

**E. Card application.** E1, in `@saga-a2ui/components/faithful-card`, is `FaithfulCardApp.define(identity).reader(...).policy('document').result(read).texts({waiting, problem, connectFailure, readyFailure, policyFailure}).build()`, an immutable value that `build()` validates once. The result reader is `read: (DeliveredResult) => {kind: 'content', content} | {kind: 'rejected', text?}`, specified below. E2, in the stacks, is `startFaithfulCardApp(definition, {container, readyWhen, sizing, hostContext, chrome, onError})` and `startA2uiView({container, layout, catalog, actions, readyWhen, sizing, hostContext, onToolResult, onError})`. Each returns `{ready, dispose}` at once, and the A2UI view also exposes its `BoundSurface`. A second start on a busy container throws `container-busy` and keeps the first view. Builder or start misuse throws naming the field and leaves a running view alone.

A card application supplies its own reader and texts; its startup stays small (the named values are application-owned):

```ts
import {FaithfulCardApp, startFaithfulCardApp} from '@saga-a2ui/react-mcp-stack/faithful-card';
const definition = FaithfulCardApp.define(identity)
  .reader(readerOptions).policy('document')
  .result(read).texts(texts).build();
const card = startFaithfulCardApp(definition, {container, readyWhen, sizing: 'own'});
await card.ready;
```

## Whole-result reading

`DeliveredResult` is `{isError: boolean, content: ContentBlock[], structuredContent?: unknown}`. `content` keeps every block in delivered order. Each block keeps its `type`; a text block also keeps its `text`, and any other block is opaque and carried as supplied. `structuredContent` is unchecked, and an absent field, a present `null` and malformed data stay distinct. MCP view maps `ToolResult` to this value, and the stacks pass it unchanged to the definition's single `result` reader; there is no `classifyResult` override.

Schema, fallback and wording belong to the application's reader, and the SDK enforces none of them. The motivating application's reader keeps these rules, in order of precedence:

- An error result rejects with zero cards, even beside valid structured content. Its text is its first usable error text, otherwise the application's unsupported wording.
- For any other result, the text comes from the first text block, which is then tested for a nonempty string; an empty first text block is not skipped.
- Absent or `null` structured data may show the application's exact fallback text with an empty heading.
- Present but malformed structured data, or an empty answer, rejects even beside fallback text.

The stack owns what follows: if the reader rejects or `present` rejects its content, the stack calls `clear()` to remove the stale card, image consent and link state, then shows the rejection text, or `texts.problem` when there is none. A reader that throws is reported with phase `result` and gets the same clearing and `texts.problem`; so does a throwing result map. The next valid result recovers.

## Startup and failure

After reading the policy and installing handlers, the stack starts the bridge handshake and `readyWhen` concurrently. Once both succeed, it applies the negotiated host context, then delivers held input and the latest result. Host context is applied before `ready` resolves and before anything is shown. The font gate receives an abort signal. A result that arrives before `ready` is held, a later one replaces it, and only the latest is shown, once, when the view is ready. Each failure rejects `ready` with its own kind:

- An absent policy means Standard with empty lists. A malformed or invalid policy gives kind `policy` and shows `texts.policyFailure`; no view mounts on a guessed policy.
- A connect rejection gives kind `connect` and shows `texts.connectFailure`.
- A `readyWhen` rejection disposes the connection and gives kind `ready` and `texts.readyFailure`.
- An application callback that throws during startup completes connection, listener and sizing cleanup, then gives kind `application`.
- `dispose()`, teardown or `pagehide` during startup aborts the readiness signal, drops held results and gives kind `disposed`. It shows nothing, and a late readiness outcome never remounts, delivers or shows a failure.

Teardown in any state retires consent, the host-context hook and the unmount once, before the connection closes. Cleanup runs even when `onTeardown`, the chrome unmount or the reporter throws, and never skips connection disposal. It releases the container and removes the `pagehide` listener, so a later `pagehide` calls no retired callback and a restart works.

After `ready`, a throwing callback is reported to `onError(error, phase)`, which defaults to `console.error`. The rest of that event's work is skipped and what the callback already changed stays, because the stack cannot roll back application side effects. A throwing ordinary host-context callback leaves the view running with its listeners in place.

## Exports and installation

Each stack's convenience entries export exactly these sets, re-exporting existing owners, so browser imports reach no server module and server imports reach no browser code:

- `content-policy`: `createContentPolicy`, `embedContentPolicy`; types `ContentPolicy`, `CreatePolicyResult`, `PolicyConfiguration`, `PolicyFailure`.
- `server`: `attachRequestLifetime`, `createServerBudgets`, `operationViewFromHtml`, `registerPublicOperation`, `viewUriForHtml`; types `OperationView`, `RequestLifetime`.
- Card entry: `FaithfulCardApp`, `CardContent`, `CardResultOutcome`, `startFaithfulCardApp`, `RunningView`, `StartFailure`; React also exposes `/faithful-card.css` (Lit styles its card internally); React `useHostLink`, `HostLink`, `HostLinkOutcome`; Lit `bindHostLink`, `HostLinkBinding`, `HostLinkOutcome`; both `readingProfile` and `ReadingProfile`.

The main entry exports `startA2uiView`, `defineSurface`, `SurfaceLayout`, `z`, the renderer's action helpers and catalog types, plus `readingProfile`, `ReadingProfile` and delivery callback types. Its browser module graph exports nothing card-specific and does not import components. The stack's package manifest still declares components for its separate card entry.

A stack connects the renderer and delivery, amending the [package layout](../../packages/README.md). `@saga-a2ui/components` and `@modelcontextprotocol/ext-apps` are regular stack dependencies so one install suffices under strict resolution. Components and markdown-it are expected in an installed full application, but the emitted browser graph of an own-catalog application excludes components, markdown-it and the server entry. Server-only consumers keep `@saga-a2ui/mcp/server` and install without a renderer. A renderer-named stack keeps its renderer install and peer obligations even for its `server` subpath, which makes no renderer-free promise; full applications such as Ansari may use it.

Host aliases cover `HTMLFragmentWrapper`, the retained Alexa and mobile reading cases and Echo Show classes. `echo_show` and `echo_show_15` match a whole underscore-separated word, not a substring. These are recorded observations, not fresh host acceptance.

## Acceptance

Acceptance is a working Ansari build on the latest `0.7.x` release candidate, covering font gate, branding and attribution, consent reset, sizing, and failure and recovery. Its behavioral assertions stay, and mechanical selector changes are recorded as a before-and-after mapping. Stable promotion, publication and host acceptance need their own evidence. The checks below are separate; passing one does not stand in for another.

- **Boundary scan.** One known-bad consumer line per rule is reported, and the near-misses (a `before` fence, an excluded fixture, an exempted line naming its rule, a `pagehide` listener) are not. The include list covers consumer source, documentation and server code, with zero hits. Consumers may not import `@modelcontextprotocol/ext-apps` or `@saga-a2ui/mcp/view`, nor use A2UI wire literals, `createMessageSession`, `a2uiV0_9Decoder` or `IngestResult`. The supported `@saga-a2ui/mcp/server` is allowed, and blanket `@a2ui` imports are prohibited except qualified catalog authoring under justified, reviewed-line exemptions.
- **Exports and directions.** Each stack subpath export set is tested individually in that stack's `exports.test.ts`, apart from the dependency-direction check. Every package's `exports.test.ts` also asserts its own row of `scripts/package-direction.ts` (core imports no delivery, renderer or DOM; MCP imports core only; components import core only; a stack alone joins a renderer to a delivery) and fails on a deliberate wrong-direction import and manifest dependency.
- **Install.** Both recipes (one stack plus framework peers) install under strict pnpm 10 from packed tarballs with sibling packages supplied by overrides only, one React instance and the stack's declared dependencies present (`npm run test:pnpm-react`, `scripts/check-react-pnpm.ts`). A separate server-only consumer installs and compiles `@saga-a2ui/mcp/server` with no renderer peer. This is an installed-tree check; it says nothing about the emitted bundle.
- **Bundle.** The own-catalog emitted browser graph excludes components, markdown-it and the server entry. Each stack's `exports.test.ts` bundles the module graph of every entry from workspace source. `scripts/pack1.test.ts` builds the own-catalog and card pages from the packed copies and shows that only the card page carries the optional parser and catalog entry. Core plus Lit without a stack is the earlier `packed-consumer.test.ts` check, which makes no claim about a stack.
- **Policy transport.** Verify charset/CSP/configuration/script ordering, an inert closing-script string, equal round trip, all four input rejections, and invalid policy rejection at `createContentPolicy`.
- **Result reading.** Both stacks show valid structured heading/Markdown and preserve exact fallback bytes, including a terminal newline. Every reader rule runs through both stacks: an error beside valid structured content, an empty first text block, absent versus `null` versus malformed structured data, and a reader that throws with phase `result`.
- **Browser lifecycle, both stacks.** Early result, dispose during startup, late readiness outcome, duplicate start, restart after dispose, concurrent handshake/font preparation with `readyFailure`, invalid policy, host theme on the first shown result and on change, own sizing, and a host-context callback that changes a CSS variable then throws (error reported, change left, cleanup intact). Pagehide removal after a throwing cleanup is checked in startup and after `ready`.
- **Branding in a stack-started card.** Computed styles for `strong` (including a closing strong footer), `em`, `hr`, the closing marker, right-to-left text and fonts match layer C. `apps/lit-host/e2e/card-app-stack.spec.ts` runs these through `startFaithfulCardApp` of both stacks; `card-styling.spec.ts` is the lower-level evidence from the renderers' own card surfaces and is not credited with stack-level behavior.
- **Update versus selection.** An own-catalog label update keeps the control, binding and focus; presenting an equal answer again resets consent. The renderer packages' bound-surface tests (`packages/react/src/bound-surface.test.ts`, `packages/lit/src/a2ui/app-element.test.ts`) cover the update side, and the card-app stack spec covers the equal-answer reset.

## Replacement scope

Revision `7a78e7e` replaced the previous text of this Blueprint and carried forward its unchanged obligations. It changed the definition-owned whole-result reader (replacing the stack override), the E2 exports, aliases and styling, and the Lit API (from required `createSession` to `catalog`/`layout`, with a default SDK session and optional advanced injection). `updateData` and the root example corrected earlier wording. Integration-branch mechanics and the historical per-consumer glue counts stay in the [record at `a4ec1ab`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a4ec1abfeb6a0c098e39bf86aaab3e0e299a3a78/blueprints/features/view_composition.blueprint.md), and the per-change delivery narration is in the linked pull requests. The five layers and their policy, lifecycle and export contracts need more than the usual single-feature length.

## Design and delivery history

The records below retain each approval and implementation boundary. Their earlier candidate observations remain tied to their original revisions.

**Design: approved.** The human owner approved the whole fourth revision at [`7a78e7e`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7a78e7eae99285174a11c62d43c1f0035658ec96/blueprints/features/view_composition.blueprint.md) (commit [`7a78e7eae99285174a11c62d43c1f0035658ec96`](https://github.com/MachineWisdomAI/saga-a2ui/commit/7a78e7eae99285174a11c62d43c1f0035658ec96)). It was proposed in [PR #237](https://github.com/MachineWisdomAI/saga-a2ui/pull/237) and merged into `main` at `4d70df2d001511050d3dff578c3885ce2557058b`; that merge commit is not the reviewed revision. This one decision covers the entire E2 amendment: the definition-owned neutral whole-result reader, the `content-policy` and `server` subpaths and their exports, the `readingProfile` host and device aliases, the `strong`, `em` and `hr` styling additions, the named Lit construction API, and the server-only dependency trade-off in [Exports and installation](#exports-and-installation). It approves no code head. The earlier approvals stay in the history: the baseline ([`db83e84`](https://github.com/MachineWisdomAI/saga-a2ui/blob/db83e84a7d8d6d9527c5ab350472e82809afd609/blueprints/features/view_composition.blueprint.md)), the revision ([`4b1215a`](https://github.com/MachineWisdomAI/saga-a2ui/blob/4b1215a4d588f537e93e8a4099cdfc5268a26ab3/blueprints/features/view_composition.blueprint.md)) and the correction ([`49e39bd`](https://github.com/MachineWisdomAI/saga-a2ui/blob/49e39bdb434f5848ded9c042e425c5cefe735b31/blueprints/features/view_composition.blueprint.md)). An earlier delivery scope record for the E2 additions in [PR #229](https://github.com/MachineWisdomAI/saga-a2ui/pull/229) was never an approval; the decision above is the authority for that whole scope.

**Implementation: source implemented on `main`; acceptance open.** Each row records the Blueprint revision implemented at the landed `MachineWisdomAI/saga-a2ui` commit. The independent review links carry the exact verification.

| Scope | Revision | Landed at | PR, review and reviewed head |
| --- | --- | --- | --- |
| Layers A to E, both stacks, the five starters, the consumer migration and the boundary scan, plus the E2 subpaths, aliases and styling first landed by PR #229 | `49e39bd` (E2 additions: `7a78e7e`) | [`18153793795d4ecfc12d2785d96422d2e397a3b2`](https://github.com/MachineWisdomAI/saga-a2ui/commit/18153793795d4ecfc12d2785d96422d2e397a3b2) | [PR #234](https://github.com/MachineWisdomAI/saga-a2ui/pull/234), integrating children #221 to #229 |
| Renderer update-failure parity and the Lit default session (layer B) | `7a78e7e` | [`6b2aabf8a73e47347f70ade99d7584227c6e943b`](https://github.com/MachineWisdomAI/saga-a2ui/commit/6b2aabf8a73e47347f70ade99d7584227c6e943b) | [PR #238](https://github.com/MachineWisdomAI/saga-a2ui/pull/238), [review](https://github.com/MachineWisdomAI/saga-a2ui/pull/238#pullrequestreview-5617059507), `cfdf45a1cf048d2034b6d445d13fbb39800b41fe` |
| Definition-owned whole-result reader; `classifyResult` removed | `7a78e7e` | [`3a37b200e44ba36fa785202d1b63498a4ac70be1`](https://github.com/MachineWisdomAI/saga-a2ui/commit/3a37b200e44ba36fa785202d1b63498a4ac70be1) | [PR #240](https://github.com/MachineWisdomAI/saga-a2ui/pull/240), [review](https://github.com/MachineWisdomAI/saga-a2ui/pull/240#pullrequestreview-5618100272), `3d3cad3266e1eb0f96c26745411fc8893869c749` |
| Stack-only public consumer recipe and the server-only entry | `7a78e7e` | [`d465ab394f801c8a6e800af738438b7dbf6133da`](https://github.com/MachineWisdomAI/saga-a2ui/commit/d465ab394f801c8a6e800af738438b7dbf6133da) | [PR #242](https://github.com/MachineWisdomAI/saga-a2ui/pull/242), [review](https://github.com/MachineWisdomAI/saga-a2ui/pull/242#pullrequestreview-5619017679), `1fc4aa41c02cb9b757531bab373e3e914c9af90c` |
| Boundary scan on documentation-only changes and server consumers | `7a78e7e` | [`39777a6b81ff2a4757f58232686dc1e31b9c7080`](https://github.com/MachineWisdomAI/saga-a2ui/commit/39777a6b81ff2a4757f58232686dc1e31b9c7080) | [PR #244](https://github.com/MachineWisdomAI/saga-a2ui/pull/244), [review](https://github.com/MachineWisdomAI/saga-a2ui/pull/244#pullrequestreview-5620133622), `349fda2e24964408b2a7cc228c2bff30ee870955` |
| Starting views retire and unmount before the connection closes; throwing cleanup | `7a78e7e` | [`d0f04f1ee213075c7c611eb9c1b348f6f0dcc0f7`](https://github.com/MachineWisdomAI/saga-a2ui/commit/d0f04f1ee213075c7c611eb9c1b348f6f0dcc0f7) | [PR #245](https://github.com/MachineWisdomAI/saga-a2ui/pull/245), [review](https://github.com/MachineWisdomAI/saga-a2ui/pull/245#pullrequestreview-5620594181), `a6a427915eb09450d3662c40d5279d0da710b836` |
| Branded card qualified through both public stack starts; the Lit start forwards application stylesheets | `7a78e7e` | [`e62514504f7501ef20d9cfeed319ded6159f42b6`](https://github.com/MachineWisdomAI/saga-a2ui/commit/e62514504f7501ef20d9cfeed319ded6159f42b6) | [PR #248](https://github.com/MachineWisdomAI/saga-a2ui/pull/248), [review](https://github.com/MachineWisdomAI/saga-a2ui/pull/248#pullrequestreview-5621359008), `e3a04efdb07ba807723c18e6b865bba71f10ee8c` |

The landed-revision records themselves were separate status-only pull requests: #235, #239, #241, #243, #246, #247 and #249. This record was reconciled against `main` at `78223b5b26751e90ad86f83aa9b2c851411ae2b4`. That reconciliation predates the seven-package `0.7.7-rc.1` release. All seven packages, including Lit and its stack, are now public; the [release receipt](https://github.com/MachineWisdomAI/saga-a2ui/releases/tag/v0.7.7-rc.1) and [installation guide](../../docs/public-install.md) own the publication and installation evidence.

**Acceptance remains scoped.** Public package availability is established: on 27 October 2026, all seven npm packages expose `0.7.7-rc.1` under `next`. This does not establish a new application adoption or host run. Adoption by the motivating application and runs in the named assistant hosts (including Arabic right-to-left text and image consent) require evidence for the exact application and resource involved. An earlier first-load observation on a frozen earlier snapshot is not evidence for the final revision. The published version is a release candidate; this record does not establish a stable release. Two earlier records stay historical: the motivating application's rehearsal against a packed candidate from `20b370df`, and the SDK's own qualification of a packed candidate from `a4ec1ab`.

**Known gaps, kept deliberate.** The two stacks hold the same lifecycle modules as copies. That duplication alone is not a defect and is not a gate for this design; each stack's own tests cover its copy. MCP is the qualified delivery for both stacks. Other delivery integrations and behavior beyond the listed composition checks require their own evidence.
