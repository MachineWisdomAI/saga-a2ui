---
feature_name: reusable_lit_adapter
status: draft
module_blueprints: []
dependencies: [reusable_mcp_connector]
date_added: 2026-10-15
---

# Reusable Lit adapter

## Status

- Design: this terminology/lifetime revision remains draft in [PR #69](https://github.com/MachineWisdomAI/saga-a2ui/pull/69). The earlier approved contract and its sequencing amendment below remain current; this revision grants no implementation authority.
- Approved baseline: approved on 2026-10-16 at [`6785ae1d8205a45e668f478ea303fbdd7e474663`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6785ae1d8205a45e668f478ea303fbdd7e474663/blueprints/features/reusable_lit_adapter.blueprint.md).
- Implementation: partial. Blueprint `6785ae1d8205a45e668f478ea303fbdd7e474663`, with the approved sequencing amendment below, is implemented for the VIEW1 preparation slice at [`MachineWisdomAI/saga-a2ui@c3eecaad89fcefc540ee7816a8b41731cb65e9d0`](https://github.com/MachineWisdomAI/saga-a2ui/commit/c3eecaad89fcefc540ee7816a8b41731cb65e9d0): private, unreleased `@saga-a2ui/core` and `@saga-a2ui/lit` with the synthetic application as consumer, plus passive answer rendering. [PR #76 and its independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/76#pullrequestreview-5558428247) record verification at `c54a246d3a3bd4389cdd245bfdd0911168f12c56`, including 544 headless tests, 117 browser tests and the packed own-catalog consumer. Missing: CORE2 action contract re-run, complete CORE3/VIEW2, and PACK1/PACK2. This slice does not complete the design or implement the proposed #69 lifetime changes.
- The bounded Lynx Web investigation is complete, as recorded in the [PR #76 review](https://github.com/MachineWisdomAI/saga-a2ui/pull/76#pullrequestreview-5558428247): the default upstream module Worker path failed cross-origin in both actual web hosts. This satisfies the investigation gate; it does not establish Lynx renderer acceptance, rule out other packaging paths, or qualify this integrated candidate in those hosts.
- The approved 2026-10-17 sequencing amendment in [VIEW1 #17](https://github.com/MachineWisdomAI/saga-a2ui/issues/17) permits passive-renderer preparation after CORE1, retaining existing lifecycle safeguards. VIEW2 still requires STATE2; full qualification remains required.
- Proposed terminology/lifetime revision: [this Blueprint at `d62c2232ecd8e100d90fe9dbffa072f6cd3dd4a7`](https://github.com/MachineWisdomAI/saga-a2ui/blob/d62c2232ecd8e100d90fe9dbffa072f6cd3dd4a7/blueprints/features/reusable_lit_adapter.blueprint.md) in [PR #69](https://github.com/MachineWisdomAI/saga-a2ui/pull/69), draft.
- Acceptance: full SDK qualification, required actual-host evidence and publication or destination acceptance remain separate gates.

## Problem and current behavior

A Lit application should be able to use SAGA's validated A2UI processing and view lifecycle while retaining its own components. At the original inspected revision, `31759fabb596f7d59921eb3f85095bc2a3aba73b`, the synthetic app kept a decoder, message visitor and mutable processor session under `apps/lit-host/src/protocols/a2ui/v0_9`, while `src/lit` supplied its concrete elements. No reusable core or Lit package existed then. VIEW1 has since moved the protocol code to `packages/core/src/protocols/a2ui/v0_9` and the surface lifecycle to `packages/lit/src/a2ui/app-element.ts`; the application composes those packages with the public MCP bridge and retains its catalogs and domain behavior. The partial implementation and remaining scope are recorded above.

The protocol implementation delegates supported schema and state validation to upstream A2UI. It accepts unchecked input, returns validated message cases, and visits each case to update a processor session. The view subscribes to surface creation/deletion and disposes its session on disconnect. These responsibilities now belong to core and Lit respectively. The demo heading, global `window.sagaSend` test hook, episode schema and synthetic catalog remain application details.

This feature introduces `@saga-a2ui/core` and `@saga-a2ui/lit` with a working own-catalog consumer. It preserves the example's complete read, content and protected server action workflow (see the [action vocabulary](../README.md#action-vocabulary)), followed by the proposed [request and view lifetime verification](request_view_lifetimes.blueprint.md#verification-outcomes). Ansari supplies a second application-owned catalog; neither consumer is required to adopt SAGA's optional FaithfulCard.

## Proposed behavior

The application constructs an A2UI session with its catalog and an explicitly selected decoder. A result arrives through the public MCP view interface, and the application passes the corresponding presentation input to the adapter. Core validates the supported A2UI envelope and message cases. The upstream processor applies component support, references and partial updates. Lit binds the resulting surface to the application's components.

When a title or answer changes, data-model updates change the visible text without replacing the application's architecture. Invalid current input clears the affected presentation and shows a safe fallback; it cannot leave an older success looking current. Valid replacement can recover. On disconnect, the adapter retires delivery, unsubscribes and disposes the owned session. Reconnection creates a fresh instance rather than restoring retired private state.

![The application supplies its catalog and composition. Core validates and processes A2UI; Lit renders the surface; MCP owns delivery, and explicit disposal retires all owned resources.](../../diagrams/reusable-lit-adapter.svg)

[Editable Mermaid](../../diagrams/reusable-lit-adapter.mmd) · [Editable Excalidraw](../../diagrams/reusable-lit-adapter.excalidraw) · [PNG](../../diagrams/reusable-lit-adapter.png)

## Responsibilities and interfaces

Core owns renderer-independent contracts and processing. A2UI knowledge stays under a named protocol/version module. Its decoder treats input as `unknown`, uses upstream schemas, preserves supported fields and returns typed cases or an explicit failure. Its visitor handles every supported case; renderer code does not inspect raw wire tags again. Mutable session state remains separate from immutable validated values.

Lit owns mounting, binding integration, events, accessibility and disposal. Its interface accepts the application's catalog and explicit integrations rather than discovering them through a registry. The application chooses its renderer, host and trusted content policy independently. Upstream custom-element/catalog registration stays at the Lit integration seam; importing SAGA does not configure an application globally.

Within one `CustomElementRegistry`, catalog registration may reuse an existing definition only when both tag and constructor match. A tag already bound to a different constructor must fail explicitly, preserving the first definition; the adapter must not silently use the existing component. Distinct implementations need distinct tag names.

| Owner | Required behavior |
| --- | --- |
| `@saga-a2ui/core` | Validate supported A2UI input and apply typed message cases; import no MCP, renderer or DOM runtime. |
| `@saga-a2ui/lit` | Connect validated surface state to Lit, expose clear mount/update/dispose ownership, and release subscriptions exactly once. |
| `@saga-a2ui/mcp` | Deliver host results and lifecycle events through its public view contract; perform no protocol interpretation or renderer selection. |
| Consumer application | Supply catalog, content rules, host-theme/resource hooks, server and client action handlers and composition; retain domain authorization and protected-resource decisions. |

The own-catalog import must not require `@saga-a2ui/components`, FaithfulCard or a Markdown parser. A consumer such as Ansari may use its own Markdown parser and branded component; that does not make those dependencies requirements of core or Lit.

The session must distinguish schema validity, component support, reference integrity and state-dependent update validity. A successful decode does not authorize a server action. Preserve valid partial updates, supported action data, state and attribution; unsupported essential behavior requires an explicit failure. The current session can apply earlier messages before a later processor rejection. The public adapter must define and test how that rejection clears or replaces the affected display rather than claiming an atomic state rollback it does not implement.

The early Lynx Web dependency/sandbox investigation is a prerequisite to VIEW1 interface finalization, not to the MCP connector's extraction. It identifies whether requirements such as workers, WASM or resource origins would expose a Lit-only assumption in the neutral contracts. A concrete supported path or documented infeasibility/access gap completes that bounded investigation. It does not require implementing Lynx, and it does not establish Lynx host support.

## Failure and recovery

| Trigger | Visible result and cleanup |
| --- | --- |
| Unsupported version, malformed envelope or rejected component/update | The affected current view clears and shows a safe SAGA fallback: supplied markup stays inert and no invalid server action is dispatched. Application-owned components remain responsible for safely rendering their own content. |
| A valid result replaces an earlier answer or item | Only the current result is visible; old bindings and resources do not persist as another active view. |
| A result arrives during connection | It is handled once after the owning view is ready; initialization does not repeat the business request. |
| Results arrive out of order after selection/account changes | The current request/session generation wins; retired data and client continuations (such as media playback) cannot be restored. |
| Authentication is lost or a new sign-in is observed | Private content clears immediately when observable; client-held resource and request cleanup follows the lifetime contract. An invisible host account change is not claimed to be immediately detectable. |
| A callback fails, processing exceeds a configured bound, or the view disconnects | Safe failure or teardown retires work and releases owned listeners/sessions. Application-owned cleanup remains explicit. The [connector's failure contract](reusable_mcp_connector.blueprint.md#failure-and-recovery) covers the bounded request. |
| Standard and Strict instances share one page | Trusted policy and callbacks remain instance-owned; changing one instance cannot permit another instance's links or images. |

Host navigation uses only a supported advertised capability. When unavailable, supplied links remain readable and inert. Image requests obey trusted exact-host configuration and the host's Content Security Policy (CSP). Content cannot change the policy; an authored protected server action retains separate server authorization and resource rules under both content levels.

## Verification outcomes

| Condition | Observable result |
| --- | --- |
| Core is exercised without a DOM or renderer | Valid envelopes, message cases, field preservation and partial updates work; malformed, unsupported and state-invalid input returns explicit failure. |
| The synthetic app uses installed public core/Lit exports | The read, content and protected server action retain their authorization, policy, disclosure and visible behavior with the application's catalog. |
| Two independent catalogs and policy instances are mounted | Neither catalog, data, callbacks nor policy configuration changes the other instance. |
| Two catalogs register the same tag in one `CustomElementRegistry` | Different constructors fail explicitly without changing the first definition; repeating the exact same tag and constructor is harmless. |
| Early/repeated results, reversed selections, account changes and cancellation occur | Each accepted result renders once; no duplicate operations or listeners, and no restoration of stale private data or a retired client continuation. |
| A mounted view is disposed and then reconnected | Old subscriptions and sessions are released; late results are ignored; the new instance starts fresh. |
| The built resource loads under declared CSP | Bindings, actual host-navigation callbacks, allowed/blocked image requests, keyboard interaction and narrow layouts behave as required. |
| Server and browser entry points are independently imported | Core has no renderer/MCP/DOM dependency; the browser artifact contains no server module or credentials. |
| An own-catalog consumer installs packed artifacts | It uses public exports without optional FaithfulCard/components/parser dependencies, workspace aliases or copied SDK code. |

Run the full VIEW2 lifecycle matrix and the complete connector CORE3 checks before claiming the joined SDK ready for packaging/release. Browser evidence proves the built adapter behavior; independent actual-host runs remain required for host claims and must run promptly on integrated candidates. A pending maintainer acceptance decision does not require idle implementation, but no missing observation is converted into a pass.

## Implementation sequence

After the shared dependency recipe and the CORE1 view contract (the first of the three [MCP connector](reusable_mcp_connector.blueprint.md#implementation-sequence) extraction steps) are established, [VIEW1](https://github.com/MachineWisdomAI/saga-a2ui/issues/17) extracts core and Lit together using the synthetic app's catalog. Complete the bounded Lynx Web investigation before freezing the renderer-neutral interfaces. There is no dependency on finished React or Lynx implementation.

Sequencing amendment (approved 2026-10-17). The operator approved starting the preparation slices that do not need the proposed request/view lifetime or action-binding designs ([#69](https://github.com/MachineWisdomAI/saga-a2ui/pull/69), [#73](https://github.com/MachineWisdomAI/saga-a2ui/pull/73)): "don't wait on #69 or #73 for work that doesn't need them." The approval covers this bounded change of start order only. It does not approve either proposed design or its implementation, and no compatibility with them is added or claimed.

VIEW1 can therefore proceed before CORE2 and CORE3. It establishes core/Lit consumption of the public MCP view contract and passive answer rendering, and it retains the application's existing Play operation and its current request, view, authentication, selection-correlation, cancellation and disposal behavior. Preparation acceptance additionally renders the public answer through installed core, Lit and MCP exports with an independent, synthetic, application-owned answer catalog: exact question and answer binding, early, repeated and late delivery, an invalid current result falling back safely, isolation from the other catalog, and disposal. Preparation candidates are unreleased and may change; owned consumers migrate together.

Later slices keep their prerequisites. CORE2 explicitly waits for STATE2; when it lands, the working consumer must use the reusable action contract and rerun the affected integrated behavior, and the lifetime guarantees it adds are claimed only then. STATE1 and STATE2 stay design and breakdown held. CORE3 keeps its entire failure, deadline, callback, projection and transport matrix. This changes start order, not VIEW1's complete browse/description/Play and two-catalog obligations or CORE3's failure coverage.

[VIEW2](https://github.com/MachineWisdomAI/saga-a2ui/issues/18) then moves the full account, selection, cancellation and teardown fixtures onto the public adapter; STATE2 remains an explicit prerequisite. It integrates the completed policy and session source behavior and documents application cleanup and theme/component/resource hooks that the consumer actually uses. Combined protected and lifetime qualification belongs to VIEW2 and CORE3. It is not a prerequisite for handing a pinned preparation candidate to the Ansari migration.

The complete [PACK1](https://github.com/MachineWisdomAI/saga-a2ui/issues/21) and [PACK2](https://github.com/MachineWisdomAI/saga-a2ui/issues/22) obligations remain: own-catalog and optional FaithfulCard consumers, full protected behavior, external installation, matched resources and upgrade/rollback evidence. Full SDK qualification joins the completed CORE3 (the connector's complete failure and lifecycle contract) and VIEW2 outcomes with the optional components, and PACK1 and PACK2 (packaging and release) readiness follows; advancing VIEW1 does not remove that join, and neither do exact public source and npm installation, the required actual-host evidence or destination maintainer authority. The path to the destination merge then continues through public npm installation of the exact versions. The Ansari design does not make external directory approval or shared publishing tooling new prerequisites for that merge; its required host runs and the public SDK/npm prerequisite remain. [Ansari migration](ansari_adoption.blueprint.md) can develop against pinned candidates while its merge and publication prerequisites remain explicit.

## Open decisions

1. **Which core/Lit peer recipe preserves both catalogs?** SAGA currently pins A2UI 0.13.0 and Ansari 0.9.1; both use `/v0_9`. Compare the real catalogs and corpus before choosing versions. Package-version differences alone do not establish wire incompatibility.
2. **How does the public lifecycle report processing failure and release resources?** Preserve the existing observable contract while resolving partial-application failures, callback exceptions and ownership of caller-held subscriptions. Demonstrate recovery and disposal through public imports.
3. **What does the Lynx Web investigation require from neutral interfaces?** Use its concrete dependency/sandbox findings to avoid renderer-specific assumptions. Do not add speculative extension mechanisms or delay this design for Lynx parity implementation.

## References

- [Coding standards](../../CODING_STANDARDS.md), [package direction](../../packages/README.md), and [reusable MCP connector](reusable_mcp_connector.blueprint.md).
- [A2UI decoder](https://github.com/MachineWisdomAI/saga-a2ui/blob/31759fabb596f7d59921eb3f85095bc2a3aba73b/apps/lit-host/src/protocols/a2ui/v0_9/decoder.ts), [validated messages](https://github.com/MachineWisdomAI/saga-a2ui/blob/31759fabb596f7d59921eb3f85095bc2a3aba73b/apps/lit-host/src/protocols/a2ui/v0_9/message.ts), [processor session](https://github.com/MachineWisdomAI/saga-a2ui/blob/31759fabb596f7d59921eb3f85095bc2a3aba73b/apps/lit-host/src/protocols/a2ui/v0_9/session.ts), [Lit lifecycle](https://github.com/MachineWisdomAI/saga-a2ui/blob/31759fabb596f7d59921eb3f85095bc2a3aba73b/apps/lit-host/src/lit/saga-app.ts), and [catalog integration](https://github.com/MachineWisdomAI/saga-a2ui/blob/31759fabb596f7d59921eb3f85095bc2a3aba73b/apps/lit-host/src/lit/integration.ts), inspected at `31759fabb596f7d59921eb3f85095bc2a3aba73b` (linked at that revision; VIEW1 moved the decoder, messages and session to [`packages/core`](../../packages/core/src/protocols/a2ui/v0_9/) and the Lit lifecycle to [`packages/lit`](../../packages/lit/src/a2ui/app-element.ts)).
- [Authorized playback](authorized_playback.blueprint.md), [request and view lifetimes](request_view_lifetimes.blueprint.md), [content safety](content_safety_levels.blueprint.md), and [Ansari adoption](ansari_adoption.blueprint.md).
