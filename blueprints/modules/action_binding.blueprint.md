---
name: action_binding
type: module
status: approved
description: Defines how application code builds an action with a fluent builder, attaches it directly to one rendered component instance in Lit, React or Lynx, and what prerequisite, hook, cancellation and cleanup behavior that action has.
---

# Action binding

Build an action once and bind it to each rendered control that uses it. The shared runtime keeps each activation's prerequisites, outcome and cleanup separate; the application keeps authorization and effect reporting.

## Status

Design approved. Implementation is partial against the full design but accepted for each slice below. Lit, React and a Lynx Web qualification fixture consume one core runtime; a production Lynx adapter is not implemented and the owner retired the Lynx delivery chain on 2026-10-19.

**Design**

| Design revision | Decision |
| --- | --- |
| [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | Approved by the human owner on 2026-10-17: fluent builder, direct attachment to a renderer-created instance or its handle, no action registry, handler-name lookup at activation or global action bus, and `before` meaning reusable asynchronous prerequisites. A public interface for composing operations was considered and rejected. The approval includes the Lit, React and Lynx attachment proposals; open decisions and feasibility questions stay open and approval supplies no runtime evidence. This revision also holds the [declaration and evidence companion](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.evidence.md) and the diagram bundle ([Mermaid](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/diagrams/action-binding.mmd), [Excalidraw](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/diagrams/action-binding.excalidraw), [SVG](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/diagrams/action-binding.svg), [PNG](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/diagrams/action-binding.png)). A later terminology edit ("rendered component instance") did not change the approved design. Merged as `8b5daf04478593271831d08a9e11c7c2bff0f566` in [PR #73](https://github.com/MachineWisdomAI/saga-a2ui/pull/73). |
| [`564bcb2a13dd162515a80e7f491d2870990958ab`](https://github.com/MachineWisdomAI/saga-a2ui/blob/564bcb2a13dd162515a80e7f491d2870990958ab/blueprints/modules/action_binding.blueprint.md) | Bounded amendment approved by the human owner on 2026-10-19: independently resolved defaults (30,000 ms work; 5,000 ms per hook or cleanup step), instance-owned configuration, explicit overrides, extensible error categories and honest effect reporting. The coordinator attests that this revision records the approved scope; independent documentation review is separate from design approval. ACT4–ACT6 receipts remain historical evidence for the earlier explicit-limit runtime. |
| [`1e02dc6a67f3781344dd5c476cc6ea64073a37d3`](https://github.com/MachineWisdomAI/saga-a2ui/blob/1e02dc6a67f3781344dd5c476cc6ea64073a37d3/blueprints/features/request_view_lifetimes.blueprint.md) | Earlier lifetime reconciliation; historical draft. Its [lifetime Status](https://github.com/MachineWisdomAI/saga-a2ui/blob/1e02dc6a67f3781344dd5c476cc6ea64073a37d3/blueprints/features/request_view_lifetimes.blueprint.md#status) is historical. |
| [`7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/request_view_lifetimes.blueprint.md) | Request/view-lifetime design approved on 2026-10-17 in [PR #69](https://github.com/MachineWisdomAI/saga-a2ui/pull/69); it applies this module. Its STATE1 subset landed at `b84276d6efa90379436cf92ee9f3311327be8ebd`; label-loss policy (2026-10-19) is tracked in [#105](https://github.com/MachineWisdomAI/saga-a2ui/issues/105). |

**Implementation**

| Scope | Design implemented | Landed code | PR / issue | Review and checks | Limits and what it does not show |
| --- | --- | --- | --- | --- | --- |
| ACT1: immutable synchronous local actions, `bindAction`, discovery, Lit `ActionButton` (#77) | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | [`a7ab7c7baa381fb8f5c9bac5d743fcf9bb9ed865`](https://github.com/MachineWisdomAI/saga-a2ui/commit/a7ab7c7baa381fb8f5c9bac5d743fcf9bb9ed865) | [#86](https://github.com/MachineWisdomAI/saga-a2ui/pull/86)<br>[#77](https://github.com/MachineWisdomAI/saga-a2ui/issues/77) | [review 5561253326](https://github.com/MachineWisdomAI/saga-a2ui/pull/86#pullrequestreview-5561253326)<br>[CI 39093053418](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39093053418)<br>reviewed head `bc5e09fd88e4036a494090244b438245d82d8812` | Provisional subset, 2026-10-18. Local Chromium via Playwright; no React/Lynx or named-host qualification. Review 5561253326 followed one repair. |
| ACT2: React attachment (`@saga-a2ui/react/actions`) | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | [`2537f78528750924dafe69f4a31247ef9fc4d0dd`](https://github.com/MachineWisdomAI/saga-a2ui/commit/2537f78528750924dafe69f4a31247ef9fc4d0dd) | [#88](https://github.com/MachineWisdomAI/saga-a2ui/pull/88) | [review 5561432883](https://github.com/MachineWisdomAI/saga-a2ui/pull/88#pullrequestreview-5561432883)<br>[CI 39096889263](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39096889263)<br>reviewed head `393ab88bd3541ded6dfdb491762b3edbecdb72df` | Private, unreleased export; not full React parity. The first head failed on pinned Node 22.12 before repair. |
| ACT3: Lynx Web qualification fixture | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | [`71a6dea9ec5c0f558d7f97c1d8df0567f3080cf7`](https://github.com/MachineWisdomAI/saga-a2ui/commit/71a6dea9ec5c0f558d7f97c1d8df0567f3080cf7) | [#89](https://github.com/MachineWisdomAI/saga-a2ui/pull/89) | [review 5561579715](https://github.com/MachineWisdomAI/saga-a2ui/pull/89#pullrequestreview-5561579715)<br>[CI 39100017877](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39100017877)<br>reviewed head `6a7781a7dc810d81196e8229c18be0a8064f34dd` | Private qualification fixture, not a supported production adapter. GenUI still owns its A2UI 0.10.6 interpreter beside saga a2ui's 0.13.0; the production choice is unresolved. Lynx delivery chain retired by the owner on 2026-10-19. |
| ACT4: asynchronous local actions, prerequisites, hooks, `whenBusy('replace')` | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | [`6c5382322c8a1dae7ae5555653fcd906e587dfe1`](https://github.com/MachineWisdomAI/saga-a2ui/commit/6c5382322c8a1dae7ae5555653fcd906e587dfe1) | [#92](https://github.com/MachineWisdomAI/saga-a2ui/pull/92) | [review 5562703674](https://github.com/MachineWisdomAI/saga-a2ui/pull/92#pullrequestreview-5562703674)<br>[CI 39122460754](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39122460754)<br>reviewed head `a43f2d25b2228d6f71e78e8af98d17a86c27795e` | Original runtime-before-tests chronology gap recorded in the PR. The explicit-limit runtime was later replaced by the defaults amendment. |
| ACT5: activation-time resource ownership and transfer | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | [`78f3087543abc91d5bd5bacb2bd9ee4ddffda7d5`](https://github.com/MachineWisdomAI/saga-a2ui/commit/78f3087543abc91d5bd5bacb2bd9ee4ddffda7d5) | [#94](https://github.com/MachineWisdomAI/saga-a2ui/pull/94) | [review 5562964438](https://github.com/MachineWisdomAI/saga-a2ui/pull/94#pullrequestreview-5562964438)<br>[CI 39126710028](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39126710028)<br>reviewed head `41287ed587fde814aa3b0cf140e4343c4f8d1570` | No dedicated resource-ownership fixtures for React or Lynx. |
| ACT6: server actions and shared-contract join | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | [`591cb21e3e897f9cce9d1d06cab925e20953234b`](https://github.com/MachineWisdomAI/saga-a2ui/commit/591cb21e3e897f9cce9d1d06cab925e20953234b) | [#96](https://github.com/MachineWisdomAI/saga-a2ui/pull/96) | [review 5563140016](https://github.com/MachineWisdomAI/saga-a2ui/pull/96#pullrequestreview-5563140016)<br>[CI 39130173119](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39130173119)<br>reviewed head `db276a40cd0f5c019833edb725c70b83e1df2ee3` | Does not show actual-host cancellation forwarding or acceptance, native or full renderer parity. Lynx has no dedicated server-action fixture. |
| Action defaults: 30,000 ms work, 5,000 ms per hook step (#110) | [`564bcb2a13dd162515a80e7f491d2870990958ab`](https://github.com/MachineWisdomAI/saga-a2ui/blob/564bcb2a13dd162515a80e7f491d2870990958ab/blueprints/modules/action_binding.blueprint.md) | [`c45992d61426b9707f199b57fa567e4222d29306`](https://github.com/MachineWisdomAI/saga-a2ui/commit/c45992d61426b9707f199b57fa567e4222d29306) | [#113](https://github.com/MachineWisdomAI/saga-a2ui/pull/113)<br>[#110](https://github.com/MachineWisdomAI/saga-a2ui/issues/110) | [review 5574577422](https://github.com/MachineWisdomAI/saga-a2ui/pull/113#pullrequestreview-5574577422)<br>[CI 39284756076](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39284756076)<br>reviewed head `70c94b6be1574ed84a95a7fbc244bd524ee1977f` | Core resolves each setting from the action, owning instance and SDK defaults. No named-host behavior, remote cancellation, installation, publication or deployment shown. |
| CORE2: Play on mapping A (#15) | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | [`8eb46792205fd0866067cd3aeaf29d8b47ed8257`](https://github.com/MachineWisdomAI/saga-a2ui/commit/8eb46792205fd0866067cd3aeaf29d8b47ed8257) | [#133](https://github.com/MachineWisdomAI/saga-a2ui/pull/133)<br>[#15](https://github.com/MachineWisdomAI/saga-a2ui/issues/15) | — | Review, checks and host acceptance are in the [connector Status](../features/reusable_mcp_connector.blueprint.md#status). |
| ACT7: current-codebase integration audit (#83) | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md)<br>[`564bcb2a13dd162515a80e7f491d2870990958ab`](https://github.com/MachineWisdomAI/saga-a2ui/blob/564bcb2a13dd162515a80e7f491d2870990958ab/blueprints/modules/action_binding.blueprint.md) | [`a704da4d2b76204a8b15dd0cb89ecfacc5ad101a`](https://github.com/MachineWisdomAI/saga-a2ui/commit/a704da4d2b76204a8b15dd0cb89ecfacc5ad101a)<br>[README at the accepted ACT7 revision](https://github.com/MachineWisdomAI/saga-a2ui/blob/a704da4d2b76204a8b15dd0cb89ecfacc5ad101a/README.md#the-action-contract-across-the-current-codebase-act7-partial) | [#145](https://github.com/MachineWisdomAI/saga-a2ui/pull/145)<br>[#83](https://github.com/MachineWisdomAI/saga-a2ui/issues/83) | [review 5577722067](https://github.com/MachineWisdomAI/saga-a2ui/pull/145#pullrequestreview-5577722067)<br>[CI 39323397751](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39323397751)<br>reviewed head `db16be2d897a2c30b47cffa22881af2fe6c34001` | Accepted for the current Lit codebase. Audited landings: ACT6 `591cb21e3e897f9cce9d1d06cab925e20953234b`; defaults `c45992d61426b9707f199b57fa567e4222d29306`; Play `8eb46792205fd0866067cd3aeaf29d8b47ed8257`; VIEW2 `39d528bbf9bb31b32bb8fe0d4763ea65a22d960e` and `c5f4ce8032b65ab53bfdf52d28b2a5ba9bbefc85` with acceptance recorded at `e11aae0aa9559dc87f7b4d7edaf54fcfb3294294`; CORE3 `aa1abfb951aa8c811c634acd8ba471f413022bf6` with acceptance at `aab6964bdea899bd32e8694db8ac4f6bbbb376c8`. Audit found no parallel action runtime, compatibility shim or activation-time handler lookup, and removed one unused constant. Still unqualified: actual-host acceptance beyond the cited CORE2 and STATE2 receipts, full React parity (E15), PACK1, any Lynx adapter. |
| REACT1: installed React notes integration (SDK #28) | Not recorded. The source says only "the approved action/lifetime contract". | [`89a0518adabcf4f1041abc45af5ae8ead7bd90f9`](https://github.com/MachineWisdomAI/saga-a2ui/commit/89a0518adabcf4f1041abc45af5ae8ead7bd90f9) | [#165](https://github.com/MachineWisdomAI/saga-a2ui/pull/165)<br>[#28](https://github.com/MachineWisdomAI/saga-a2ui/issues/28)<br>[#33](https://github.com/MachineWisdomAI/saga-a2ui/issues/33) | [review 5583259516](https://github.com/MachineWisdomAI/saga-a2ui/pull/165#pullrequestreview-5583259516)<br>[CI 39400434473](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39400434473)<br>reviewed head `326f356ead70613915be7b7bd3d8ad55545b9785`<br>SHA256 `8f9c27c385c0452c4046ae4fb96dc34d6127e7503ef71b03681ed0424fc37811`, `709def92c5f2f2323ba0ceae17ba39bab10598b066b92a96d981563a81f594a9` | Notes integration only; the subscriptions/description/Play recipe is SDK #33. ChatGPT first iframe load failed and one visible Try again rendered the empty view. Claude read sign-in-required where ChatGPT showed prerequisite-error: no verified SDK defect, upstream normalization unproven. Prior Alexa existing-frame failure remains an affected limitation. Not Lit-free (web_core brings Lit transitively). |
| React protected-player integration | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md)<br>[`564bcb2a13dd162515a80e7f491d2870990958ab`](https://github.com/MachineWisdomAI/saga-a2ui/blob/564bcb2a13dd162515a80e7f491d2870990958ab/blueprints/modules/action_binding.blueprint.md) | [`4d40761d14c563cb3b48648266594b1d70d8e918`](https://github.com/MachineWisdomAI/saga-a2ui/commit/4d40761d14c563cb3b48648266594b1d70d8e918) | [#172](https://github.com/MachineWisdomAI/saga-a2ui/pull/172) | — | Reuses the shared controller, bound actions and player owner; adds no runtime and does not use the optional React card. Loopback media, host-container retries and absent forwarded-cancellation evidence remain explicit. |

Design cells read "Not recorded" where no design revision is named for the entry; the approved revisions under Design are not paired with it.

**Source inspection, not implementation.** The design review read SDK main [`c3eecaad89fcefc540ee7816a8b41731cb65e9d0`](https://github.com/MachineWisdomAI/saga-a2ui/tree/c3eecaad89fcefc540ee7816a8b41731cb65e9d0) (the design-time snapshot under [Current implementation baseline](#current-implementation-baseline)); reading is not running, and no test was run for that inspection. The declarations in the [evidence companion](./action_binding.evidence.md) compile and each intended negative case is rejected, which shows only that the examples are well typed. ACT1 through ACT3 evidence ran in local Chromium, not in an actual host.

**Related records.** The bounded STATE2 ([#13](https://github.com/MachineWisdomAI/saga-a2ui/issues/13)) source and named-host acceptance followed the server/controller delivery in [PR #115](https://github.com/MachineWisdomAI/saga-a2ui/pull/115) and the safe-recovery repair in [PR #124](https://github.com/MachineWisdomAI/saga-a2ui/pull/124); see the [lifetime Status](../features/request_view_lifetimes.blueprint.md#status). The optional Lit card integration (CARD1 [#19](https://github.com/MachineWisdomAI/saga-a2ui/issues/19)) and packaging (PACK1 [#21](https://github.com/MachineWisdomAI/saga-a2ui/issues/21)) were unimplemented when the ACT7 audit ran and are recorded in the [content safety](../features/content_safety_levels.blueprint.md#status) and [connector](../features/reusable_mcp_connector.blueprint.md#status) Status sections.

**Acceptance still open.** Full renderer parity, a production Lynx adapter, actual-host acceptance beyond the cited receipts (gesture, forwarded cancellation, rollback), registry-installed application behavior beyond the separately recorded [public-install recipe](../../docs/public-install.md), and the open decisions below. The historical slices above do not by themselves establish current registry availability.

Pre-cleanup narrative, including verification counts and chronology: [action_binding Status at the cleanup baseline](https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md).
## Purpose and boundaries

### Purpose

An application builds one typed action and attaches it to a rendered control. For example, two Archive buttons share one definition but each captures its own note identifier and has independent pending state. Core runs prerequisites, the handler, required success work and cleanup; the renderer supplies the exact instance that was pressed.

### What stays outside the module

The application owns domain values, authorization, backend effects, presentation and acquired resources. MCP owns delivery and connection lifetime. Renderers own mounting, event delivery and retirement. A client prerequisite never authorizes a protected server operation. No handler-name lookup, global action bus or automatic retry is introduced.

### Component terminology

A **definition** describes the action. A **rendered instance** is one control created by a renderer, including one occurrence of a repeated layout component. A **binding** attaches a definition to one event on that instance. An **invocation** is one admitted activation. The **subject** is the application item the instance currently shows; a reused row can change subject without being recreated.

### Lifetimes and owners

| Owner | Responsibility |
| --- | --- |
| Application | Reusable definitions, semantic subjects, effect reporting and token-scoped resource ownership |
| Renderer adapter | Instance handles, event slots, live data readers and binding disposal at retirement |
| Shared runtime | Invocation state, deadlines, callback eligibility, outcomes and release of held tokens |
| Server and MCP delivery | Independent request lifetimes, authentication, authorization and transport completion |

A definition holds no pending state. Unsubscribing discovery does not dispose bindings. Ending an invocation does not prove that a sent request stopped. A transferred resource can outlive the invocation that acquired it.

### Vocabulary inherited from #69

The earlier lifetime design's *attempt* maps to a server-action invocation and its continuation; its *client-held resource* maps to an acquired resource. These terms do not map execution location to A2UI's `event` and `functionCall` wire forms. The [approved lifetime design](../features/request_view_lifetimes.blueprint.md) owns the request/view contract.

### Evidence status

[Status](#status) distinguishes approved design revisions, reviewed heads, landed code and acceptance limits. The [design-time evidence table][design-evidence] records source inspection and declaration checks at `c3eecaad89fcefc540ee7816a8b41731cb65e9d0`; it is not a description of today's missing implementation. The [evidence companion](action_binding.evidence.md) retains illustrative declarations and renderer investigations, including retired Lynx work.

## Interfaces and behavior

The current API is exported from `packages/core/src/actions/index.ts` and the Lit and React `/actions` entries. The [development reference](../../docs/development-reference.md#actions) describes its shipped behavior. The detailed [approved contract][full-contract] remains the source for edge cases omitted from this overview; the defaults amendment supersedes mandatory-limit declarations in the historical companion. No design requirement or acceptance state changes in this editorial revision.

### Authoring

Build with `Action.local<Event>(label)` or `Action.server<Event>(label, transport)`, then optional `input`, `atActivation` and ordered `before` prerequisites, followed by required `run`. Optional hooks, per-action limits, busy policy and telemetry follow. Each builder value is immutable; branching an alias creates independent definitions. Duplicate registrations are rejected, except `before`, which deliberately repeats in order. Labels are diagnostic and never select behavior.

`input` fixes the parameter type; prerequisites add provided values; `run` fixes the result type. Hook contexts expose only values available at their stage. `input`, `atActivation` and resource adoption must be synchronous, enforced by types and runtime thenable checks. Limits are optional for local and server actions, including hooks and resources.

### Direct attachment

Setup finds handles with `watchById` or `getById` and calls `handle.bindAction(event, definition, { subject? })`. Activation calls the callable installed on that exact instance; it performs no ID lookup. The layout names the control and its child, with no action or handler name.

#### Identity and disposal defaults

Only one binding may own an instance/event slot. A second bind throws and leaves the first intact. `getById` throws for zero or several matches; `watchById` reaches present and later instances. Disposal is idempotent and detaches only its own installation. A live handle can be rebound; a retired handle cannot. Recreated instances start unbound and idle.

#### Binding state, subject and ending

Bindings expose `idle`, `running`, `settling` or `disposed`, a snapshot subscription and `dispose()`. Independent bindings share no pending state. A subject reader uses live instance data, compared with `Object.is` at checkpoints. A mismatch cancels undecided work but keeps the binding installed; after an outcome is decided it only retires presentation. Without a subject reader, semantic row replacement is undetected.

### Execution semantics

#### Order of events for one activation

Admission checks the installation and revalidates active work before applying `ignore` or `replace`. The accepted invocation runs synchronous input and activation work, sequential prerequisites, the handler and required `onSuccess`. It then decides one outcome, runs `onFailure` or `onCanceled` if applicable, releases held tokens newest first and finalizes through `onFinally`. `ignore` drops a second activation while running or settling. `replace` cancels undecided work and starts the new invocation beside the old cleanup; a decided outcome stays unchanged. Only the invocation that still owns the binding state may return it to idle. Entirely synchronous actions return to idle in the event's call stack.

#### Outcome decision and obsolescence

The first failure, deadline, cancellation or completed success hook fixes the outcome. Later events never rewrite it. Replaced, disposed or changed-subject invocations cannot start presentation hooks. If `onFailure` already runs when it becomes obsolete, its signal aborts and its `current()` becomes false; failure remains failure. Releases and finalization still run. Late values are dropped; late scope-owned resources are released.

#### Running prerequisites

A prerequisite returns `proceed(values)`, `proceed()` or `refuse(reason)`, synchronously or asynchronously. Refusal, throw, invalid return or duplicate provided keys stops the handler. Prerequisite effects are separate from handler effects: “no handler request sent” does not mean nothing happened. Required audit before the handler belongs here; required work after the handler belongs in `onSuccess`.

#### Event-turn work

`input` copies event data and `atActivation` performs synchronous API-specific work such as preparing audio. Both run in the adapter event's call stack. This promises no universal browser gesture permission. The historical `eventTurn` declaration and Lynx environment tagging are not exported by the current core API; the retired Lynx design has no implemented bind-time environment check.

#### Handler and server calls

Local handlers receive parameters, activation data, provided values, a signal, `current()` and a resource scope. Server handlers also receive `call`. Core supplies its signal and remaining work budget; the application supplies transport. Tool-level `isError` remains a reply the handler interprets. Transport rejection does not establish whether a server effect occurred, and aborting the wait proves neither forwarded cancellation nor rollback.

#### Bounds: the work deadline and the hook budget

| Setting | Default | Covers |
| --- | --- | --- |
| `deadlineMs` | 30,000 ms | Prerequisites and handler after the synchronous activation prefix |
| `hookMs` | 5,000 ms | Each awaited hook, release and cleanup step separately |

Each field resolves independently from action override, owning SDK instance, then default. Omission inherits; supplied non-finite, non-positive or non-number values are rejected before activation, even when shadowed. Configuration is copied. Progress never renews a deadline. There is no whole-invocation maximum: cleanup steps have separate budgets. Timers stop waiting, cannot preempt synchronous JavaScript and cannot recall effects already started.

#### Hooks and cleanup

`onSuccess` is required work: its error or timeout decides failure with the handler's result. `onFailure` and `onCanceled` respond to the decided outcome; their failures become cleanup diagnostics. Releases follow, then `onFinally` receives the outcome and accumulated diagnostics. Failure of `onFinally` reaches only the observer by step name. Work that must run after obsolescence belongs in a release or finalization.

#### Freshness: three questions that look alike

`scope.active` asks whether the outcome is undecided. `signal` asks whether work was told to stop. A callback's own `current()` asks whether it may still present: that callback must remain eligible, the binding and instance live, the invocation unreplaced and the subject unchanged. Eligibility ends permanently when the callback finishes or the runtime stops waiting. After an `await`, check immediately before a synchronous presentation write; the runtime cannot suppress arbitrary side effects.

#### The runtime and adapter seam

Adapters supply current liveness, exact installation identity, detachment and optional `watchScope` notifications. Core owns eligibility, checkpoints and timers. Checks occur before prerequisites, on handler settlement, before presentation hooks, at busy admission and on `current()`. An unobserved A→B→A subject change cannot be detected; applications needing that distinction include a revision in the subject.

#### Resource ownership and handoff

`scope.own` accepts an already-held token; `scope.acquire` owns an awaited acquisition. Both release late arrivals if the invocation ended. Every release must affect only its token, be idempotent and leave a newer acquisition untouched. `Held.transfer(adopt)` hands ownership to a longer-lived owner synchronously; an ended invocation returns false, and a throw or thenable leaves ownership with the scope.

The playback application implements a lease owner in `apps/lit-host/src/playback/player-owner.ts`. Play transfers a started lease; Pause, Resume and view teardown use that owner. Whole-player shutdown belongs to the owner, never generic invocation cleanup. The [historical worked example][resource-example] preserves the detailed success, cancellation and failed-hook paths; actual-player evidence remains bounded by Status.

#### Telemetry

Observers receive labels, opaque binding/invocation IDs, phase, elapsed time, status, failure kind and cleanup-step names. They receive no parameters, results, errors or component text. Observers and state listeners cannot alter the outcome through a throw or rejected promise. Durable audit is application work, not telemetry.

### Renderer proposals

Lit and React attachment are implemented on one runtime. The Lynx proposal remains historical: only a Web qualification fixture exists, and the delivery chain was retired on 2026-10-19. The [companion's renderer declarations](action_binding.evidence.md#e-printed-renderer-proposals-moved-from-the-blueprint) preserve design investigations without claiming current production support.

#### The trace every renderer completes

Layout creates an attachable control; the adapter opens an instance; setup binds its handle; the control's event calls that installation with live instance data; the runtime executes the definition. Protocol ID, rendered position, semantic item and physical element remain distinct.

#### What each renderer must supply

An adapter must provide typed instance events, a live data reader, liveness checks, installation-safe dispatch and owned disposal. Upstream catalog registration stays at the renderer boundary. Unrelated upstream protocol actions retain their behavior, and an activation must never run both the direct binding and the upstream path.

#### Instance data and the host (Lit and React)

`InstanceEvent.read(path)` is valid during delivery; the handle's `read(path)` reads live scope data and returns `undefined` after retirement. `createInstanceHost` owns setup registrations and closes them terminally. Setup failure leaves no partial bindings; a failing discovery callback loses only its own bindings and reports to `onSetupError`.

#### Same-position replacement and work in flight

Lit and React can reuse an instance for another item at the same data path. `input` copies the original item's identifier; the subject reader protects later presentation. Data-model notifications request a checkpoint, but coalesced changes may conceal an A→B→A round trip. Busy policy still applies while canceled work settles.

#### Lit (`@a2ui/lit` and `@a2ui/web_core` 0.13.0)

The opt-in `ActionButton` has no protocol `action`. Its element owns the event and opens an instance for the component model/data path. The app element owns one instance host per presented surface; deletion, disconnect and failed setup retire it. Host lookup follows DOM ownership through shadow roots, so a second unmanaged surface mount stays unbound. [ACT1 evidence](#status) records the qualification.

#### React (`@a2ui/react`, source at commit `45633b97636daf89bafb43fa7db23e3cd916461d`)

The heading identifies the design-time source investigation. Shipped qualification uses the pinned 0.13.0 renderer. A layout effect opens one instance for a committed host/node pair; cleanup, node retirement and host close retire it idempotently. Discarded renders publish nothing. `InstanceHostProvider` owns the host; `useActionSetup` owns stable setup. ACT2 records React qualification, not full renderer parity.

#### Lynx (`@lynx-js/genui` 0.7.0)

No production Lynx package exists or is planned. The retained proposal uses background tap admission, logical-instance handles and an observed-key epoch. Native removal before asynchronous cleanup, thread partition, environment tagging and GenUI's separate A2UI interpreter remain unresolved. [The companion](action_binding.evidence.md#d-lynx-freshness-and-admission-mechanism) preserves those mechanisms and their source-only limitations.

#### Renderer comparison

Lit owns instances through element/model lifetimes; React uses committed effect lifetimes. Both use instance-host discovery and one core runtime. Lynx has a separate proposed admission mechanism and a retained Web fixture, with no native or production acceptance.

## Representative flow: archiving a note

Two notes render Archive controls with the same layout ID. Setup binds one `archiveNote` definition to each handle and supplies that handle's note ID as its subject. On a press, `input` copies the selected ID; session, confirmation and audit prerequisites run in order; the handler calls `archive_note`.

A refusal before the handler means no archive request was sent. A transport timeout means the effect is unknown. A valid archive reply followed by failed required view work means the archive completed and client work failed. The application reports those cases separately and never invites blind replay. If the row changes while awaiting, the old invocation cannot present on the new note. The server authorizes the archive independently.

![Action construction, instance binding, execution and cleanup](../../diagrams/action-binding.svg)

The [action guide](../../docs/actions.md) provides a current executable walkthrough; the [historical complete example][archive-example] preserves the approved design's application helpers and type relationships.

## Failure and recovery

### What each outcome says about the server effect

| Observation | Effect claim |
| --- | --- |
| Input or prerequisite failure | Handler not started; prerequisite effects may exist |
| Handler error, timeout or cancellation before a usable reply | Unknown unless the application's own contract proves more |
| Handler returned, then success-hook failure or completing-stage cancellation | Keep the known result; client work failed or was abandoned |
| Success | Handler and required success work completed |

### Error categories and safe presentation

Categories supplement stage and failure kind; they do not rewrite outcomes. Known typed evidence may distinguish authentication, permission, timeout, cancellation, unavailable or validation failures. Unknown errors stay unknown. The original cause is inspectable but never displayed automatically. The application owns safe wording; client timeout categories assign no HTTP status.

### Recovery

The runtime retries nothing. Recovery after a completed or uncertain effect requires application knowledge of idempotency. A deliberate new activation is a new operation; local prerequisites and aborts prove no authorization or rollback.

### Failure paths owned by the adapters

Adapters retire bindings when their instance, surface or host ends. Late cleanup cannot detach a newer installation. `runToolResultView` owns connection shutdown and calls view teardown once, including explicit disposal and `pagehide`; on a host teardown request it answers before closing. The application's teardown releases its bindings and resources, not the connection.

## Verification outcomes

The [detailed verification matrix][verification-matrix] preserves the approved triggers and expected outcomes. It is a contract, not proof every row ran. Status identifies accepted slices and their evidence; the [development reference](../../docs/development-reference.md#qualification-evidence) records test scope and limits.

### Amendment verification outcomes

The defaults amendment requires independent precedence, copied settings, early rejection of invalid values, finite omitted limits, progress that never extends work, separate cleanup budgets and honest known/unknown effect reporting. PR #113 implements that amendment; its design and code SHAs remain in Status.

### Shared runtime outcomes

Checks must cover independent bindings, ordered prerequisites, both busy policies, immutable outcomes, subject changes, callback eligibility, late settlement, resource transfer and cleanup. They must distinguish no handler request from an unknown server effect and count prerequisite requests separately.

### Renderer conditions

Real-renderer checks cover repeated IDs, exact instance dispatch, replacement, setup failure, remount, disposal, Strict Mode and abandoned React renders. ACT1 and ACT2 contain local qualification; the historical Lynx conditions do not establish native behavior. API-specific browser activation and actual-host behavior require their own observations.

### Preserved behavior

Migration retains server authorization, grant validation, safe content rejection, tag-conflict handling, image-consent ownership, request bounds and token-scoped stale cleanup. The [historical safeguard table][safeguards] names their sources and distinguishes read assertions from candidate test titles.

### Actual-host acceptance

Local tests do not prove host cancellation forwarding, view reuse, teardown ordering, gesture/audio behavior, resource-policy enforcement or remote rollback. Only the bounded named-host receipts in Status support such claims; absent observations remain absent.

## Open decisions

### Settled

The work deadline covers prerequisites and handler; per-step hook budgets remain separate. Play uses one server-action invocation and an application lease owner. Label loss is final per view. Lit and React adapters and the pinned React version are implemented. Request and streaming policy belong to the lifetime/connector records.

### Still open

The design records no separate decision about exposing `onFinally` exception objects beyond step-only telemetry. Lynx environment tagging, native-retirement timing, interpreter choice and package placement have no scheduled owner after retirement. Related Blueprint status is owned by each Blueprint, not inferred here.

### Mechanisms and evidence still missing

The [detailed evidence-gap table][evidence-gaps] distinguishes source inspection, local checks and named-host observations. Remaining claims include full React parity, native Lynx behavior, real-player interleavings beyond recorded lease tests, host forwarding and remote rollback. No new run is claimed by this cleanup.

## Related contracts and implementations

### Current implementation baseline

At `2405c5d28f02a5b8d5fb70ed7a929e676cf78d43`, core owns the action runtime, Lit and React provide attachment, and both stacks compose rendering with MCP delivery. Play and the notes example consume those contracts. `apps/lynx-fixture` is retained qualification code; `packages/lynx` does not exist. Current package installation guidance is in [public install](../../docs/public-install.md), separate from these historical acceptance records.

#### Safeguards already built

The [design-time safeguards][safeguards] remain migration obligations. Their original code names and observations are historical; current bridge behavior is owned by `runToolResultView`, and server bounds by the request lifetime.

#### Candidate gaps

The [lifetime Blueprint](../features/request_view_lifetimes.blueprint.md#candidate-gaps) owns the original source-inspection candidates and their later disposition. A candidate is not a reproduced defect or proof of exposure.

### Corrections by owner

Core owns invocation semantics; adapters own binding retirement; application controllers own sign-in labels, selection and player leases; listener and connector own server requests. The [historical correction map][correction-map] retains each obligation. Play's delivered mapping places key creation through audio start inside the action work interval; it adds no whole-invocation timer.

### Migration rules

Move a path only with its required behavior covered. Delete the replaced controller-local timers, generations, abort code and superseded tests in the same change. Keep required upstream registration at the renderer boundary and application authorization, grant validation and resource meaning in the application. Never add a parallel runtime or compatibility shim.

### Approved designs needing later reconciliation

[Authorized playback](../features/authorized_playback.blueprint.md) and [content safety](../features/content_safety_levels.blueprint.md) own their approval and implementation records. This module supplies action vocabulary without reviving the rejected account/session proposal or treating content consent as protected-action authorization.

### Relationship of the lifetime corrections to this contract

The runtime provides cancellation, currentness, deadlines and token cleanup. Controllers must still invoke those mechanisms and enforce their own identity and recovery rules. A generic runtime cannot repair application lifetime defects by construction.

### Implementation sequence

The delivered sequence and exact revisions are retained in Status: ACT1–ACT7, the defaults amendment, CORE2 and React integrations. Request/view, packaging and host-acceptance work remain recorded by their owning Blueprints. This editorial revision schedules no implementation.

### Related records and code

- [Request and view lifetimes](../features/request_view_lifetimes.blueprint.md), [MCP connector](../features/reusable_mcp_connector.blueprint.md), [Lit adapter](../features/reusable_lit_adapter.blueprint.md).
- [Current action reference](../../docs/development-reference.md#actions) and [action guide](../../docs/actions.md).
- [Historical declarations and renderer investigations](action_binding.evidence.md); approved revisions and diagram bundle in Status.
- Design-time provenance: CORE1 landed at [`6c268cc924886d4f7dfeb1668d83d0e17324f00b`](https://github.com/MachineWisdomAI/saga-a2ui/commit/6c268cc924886d4f7dfeb1668d83d0e17324f00b). The earlier inspection snapshot [`bcccb730489a0c5207899a755c5a8238b7f8c4f0`](https://github.com/MachineWisdomAI/saga-a2ui/tree/bcccb730489a0c5207899a755c5a8238b7f8c4f0) and `c3eecaad89fcefc540ee7816a8b41731cb65e9d0` had unchanged listener, controller, playback/media, MCP operation/view and content-consent code; this is a historical comparison, not a current test. The Lynx investigation read upstream lynx-stack [`bb2f9ba92c8fe936be39b882047ab94aae58809f`](https://github.com/lynx-family/lynx-stack/commit/bb2f9ba92c8fe936be39b882047ab94aae58809f), not a SAGA implementation revision.

[full-contract]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#interfaces-and-behavior
[design-evidence]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#evidence-status
[resource-example]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#resource-ownership-and-handoff
[archive-example]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#authoring
[verification-matrix]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#verification-outcomes
[safeguards]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#safeguards-already-built
[evidence-gaps]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#open-decisions
[correction-map]: https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/modules/action_binding.blueprint.md#corrections-by-owner
