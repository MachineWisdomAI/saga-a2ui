---
feature_name: reusable_mcp_connector
status: draft
module_blueprints: []
dependencies: [authorized_playback, request_view_lifetimes, content_safety_levels]
date_added: 2026-10-15
---

# Reusable MCP connector

Draft awaiting human design review.

## Problem and current behavior

An application should be able to replace its MCP delivery code without replacing its HTTP server, authorization rules or renderer. SAGA's synthetic application currently implements these responsibilities together under `apps/lit-host`: public episode delivery, authenticated subscription browsing, protected playback and the embedded view's connection lifecycle. No reusable SAGA packages exist at the inspected revision, `31759fabb596f7d59921eb3f85095bc2a3aba73b`.

The existing code already provides useful seams. `connectToolResultView` installs result handlers before connecting and retires delivery on teardown. Subscription browsing reads verified identity per request, builds an explicit bounded result and retires a timed-out backend read. Playback rechecks entitlement and keeps its media capability in a separate result projection. A **projection** is the set of fields deliberately prepared for one recipient. These mechanisms are extraction candidates. They do not show how every real host carries the resulting fields.

This feature extracts those responsibilities into `@saga-a2ui/mcp`, preserving the complete browse and Play behavior and its failure handling. It also supports explicitly public operations, such as an answer tool, without inventing a user identity. Application hosting, backend calls, authentication, domain permission and media issuance remain application-owned.

## Proposed behavior

For an authenticated subscription read, the application listener verifies the request and supplies an immutable identity. The connector validates the operation's declared input, invokes the application handler and validates the explicitly constructed output before serialization. The application still decides which subscriptions belong to that caller. The host receives the permitted result and the linked immutable HTML resource; the connected view passes delivered data to the application's rendering implementation.

For Play, the view invokes a named typed operation with an episode ID. The application checks current identity and entitlement on every invocation and owns any media capability it issues. The connector carries separately validated model and view projections through a supported MCP Apps mapping. An unsupported recipient path fails before protected acquisition. No private field is moved into model-visible output as a fallback.

A public operation declares that access mode explicitly, supplies its input and output contracts, and uses the same validation and failure disciplines. Public access does not make questions, credentials or diagnostic data suitable for logs. Neither mode accepts caller-supplied account fields as authority.

![The application owns identity and business decisions; the MCP connector validates and delivers model and view projections, while the application composes the view with its renderer.](../../diagrams/reusable-mcp-connector.svg)

[Editable Mermaid](../../diagrams/reusable-mcp-connector.mmd) · [Editable Excalidraw](../../diagrams/reusable-mcp-connector.excalidraw) · [PNG](../../diagrams/reusable-mcp-connector.png)

## Responsibilities and interfaces

The proposed package, `@saga-a2ui/mcp`, has distinct `/server`, `/view` and `/policy` subpath exports, each grouping one concern. A2UI wire-version protocols stay in `@saga-a2ui/core`; this package does not own them. Server exports attach to an application-owned MCP server and accept declared operations, runtime schemas and application callbacks. View exports own supported bridge initialization, result delivery and teardown. Policy exports express MCP delivery decisions and required capabilities without importing a renderer or the application's subscription policy. Subpath names are settled; exact exported identifiers remain a design choice. The [package layout](../../packages/README.md) records the flat package naming.

| Owner | Inputs and outputs | Required boundary |
| --- | --- | --- |
| Application listener | Request transport and credentials; verified request identity | HTTP setup and authentication remain outside the connector. No mutable shared current-user state. |
| Application operation | Validated arguments and request identity; domain result | Backend calls, entitlement and effects remain here. A public operation receives no fabricated principal. |
| MCP server integration | Declared operation, schemas and explicit projections; validated wire result | Protected registration without required identity/projection configuration fails. Upstream registration is not a SAGA action registry. |
| MCP view integration | Host notifications and connection lifetime; typed delivery callbacks | Install handlers before connection, deliver once, retire callbacks and release listeners on disposal. No A2UI interpretation. |
| Application renderer | Delivered result and application-owned catalog; visible state | Rendering, content presentation and player ownership remain in the application until their adapter migration. |

Three kinds of policy meet at this boundary, and they have different owners. *Delivery policy* is the connector's: which recipient receives which projection and which host capabilities a protected operation requires. *Domain authorization* is the application's: who may see which subscription and whether this caller may play this episode. *Content policy* decides what supplied text may do when rendered, such as whether a link navigates or an image loads. The [content safety design](content_safety_levels.blueprint.md) defines its Standard and Strict levels and currently keeps the policy module inside the application.

Actual host evidence must establish the recipient mapping before CORE1 (which extracts the browse connector and the server/view/policy split) adopts it in the reusable projection contract. The merged Play prototype declares app-only visibility, reads a recipient public key from request metadata, returns safe model text in `content`, and puts the playback payload under its own result `_meta` key. That is the implemented candidate mapping, not a portable contract established by the source alone. The [authorized playback design's third open decision](authorized_playback.blueprint.md#open-decisions) remains applicable.

PLAY1 and PLAY2 are the tickets that built the merged Play path: [PLAY1](authorized_playback.blueprint.md#implementation-sequence) added the app-only Play operation with separate model and view results and one foreground player, and PLAY2 added expiry, revocation and misuse rejection. A bounded baseline run of that path has been made in **ChatGPT web and Claude web** on the merged source with MCP Apps 1.7.5. In both hosts, synthetic authentication succeeded and the opening operation was invoked. ChatGPT then showed a blank opening frame; Claude returned a textual result without an interactive card. Each host got one reload retry. Neither showed a Play control, so no entitlement or media call was made. The runs are inconclusive. They establish no recipient mapping, which remains unmeasured and unqualified, and they identify no cause for the missing view.

Two dependency sets are in play. SAGA currently uses MCP Apps 1.7.5, the monolithic MCP SDK 1.32.1 and Zod 3.25.76. Ansari uses MCP Apps 2.0.3, split MCP server/client 2.3.1 and Node integration 2.1.1, and Zod 4.2-compatible schemas. The extraction target is MCP Apps **2.0.3**, split client/core/server **2.3.1**, Node integration **2.1.1**, and Zod **4.2+** at the MCP seam. That target is selected, not yet qualified. A peer-complete disposable installation against unchanged merged source produced 32 TypeScript diagnostics, so the move needs a focused transport/context/schema migration and is not a version-only update. Qualify the complete lockfile and engine recipe before CORE1 adopts a projection mapping on that target. The 1.7.5 host run above is baseline evidence only. A2UI 0.13 stays on its upstream Zod 3 schema boundary. Do not downgrade Ansari or introduce a dual-version abstraction.

With that target qualified, the mapping must be measured again in both web hosts before CORE1 adopts it. In each web host, that run needs to establish whether the model is excluded from Play, whether the view can invoke it with the required metadata, whether the intended view result arrives, and whether recognizable private test values remain absent from model-visible responses and resources. It also exercises rejection when the mapping is unavailable, and records exact source, resource hash, package recipe and observable limits. Another client, a local AppBridge fixture or source inspection cannot replace either web-host run. Missing access or another inconclusive result leaves the mapping decision unresolved; unrelated preparation can continue, but CORE1 must not rely on an assumed mapping.

## Failure and recovery

The connector exposes safe outcomes without making callers reconstruct callback order or transport state. It enforces finite input, result, item, string and retained-state bounds at the owning interfaces before copying or serializing unbounded values. One finite request deadline covers identity, authorization, handler and projection work without restarting at each stage. Cancellation stops waiting and retires late output; the application remains responsible for cleanup of work that cannot be interrupted. The [Ansari adoption design](ansari_adoption.blueprint.md) separately requires the supported integration to preserve progress and delayed JSON/SSE completion within that one bounded request. The connector or callback interface that lets handlers observe cancellation and the deadline, and that carries progress and delayed completion inside it, is not yet defined; CORE3 establishes it.

| Trigger | Observable result and recovery |
| --- | --- |
| Protected registration lacks identity, projection or capability requirements | Registration fails before serving the operation; the configuration error identifies the missing requirement without printing credentials. |
| Identity is missing, invalid, expired or service-only | The established authentication status/challenge remains intact; no protected handler or acquisition runs. |
| A malformed protocol call or unknown operation arrives | The supported JSON-RPC failure is returned; no application handler runs. |
| A known operation receives invalid business input, denial or an expected backend failure | A safe tool failure is returned according to the selected upstream contract. Backend 401, 429 or 503 does not automatically become the MCP endpoint status. |
| A callback throws, stalls or produces malformed/oversized projected data | The request terminates within its bound with no success payload or private diagnostics. The view clears invalid current state and offers only the permitted recovery. |
| Cancellation, disconnect, late output or disposal occurs | No duplicate operation, late response, headers-after-stream-start or restoration of retired data occurs. Cleanup responsibilities remain explicit. |
| The host cannot preserve required recipients | Protected behavior fails before acquisition. No capability appears in model text, structured output, resource HTML, A2UI payloads, errors or ordinary logs. |

Failure mapping must be verified at the wire boundary: HTTP status and challenge, JSON-RPC result/error, and `isError` are separate observations. The current prototype's safe tool failures do not by themselves settle every generic connector contract fault. Successful-output schemas remain strict; error handling must not weaken them.

## Verification outcomes

| Condition | Observable result |
| --- | --- |
| Allowed, denied, empty and failed subscription reads use public package exports | The real listener and built view retain their prior authorization, request correlation and displayed results, including declared filters. |
| Two principals invoke operations concurrently, or an input adds a forged account | Each handler receives only its request's verified identity; supplied fields cannot select another account. |
| A public answer-style operation is declared | It runs without user authentication while retaining explicit validation, projections and safe failures. |
| Allowed and denied Play actions use the connector | Every valid Play reauthorizes; denial causes no protected acquisition; the permitted view receives only its projection. |
| Identity, authorization, handler and projection callbacks each stall or fail | The configured bounds hold at every stage; late emissions are retired and diagnostic canaries do not escape. |
| JSON and supported SSE delivery carry notifications, cancellation and disconnect/resume | There are no duplicate operations or invalid second responses, and disposed views ignore late delivery. |
| An instruction-like field or private canary is included in backend data | It neither changes action arguments nor appears outside its explicitly allowed recipient, including logs and resource metadata. |
| Server and view exports are imported independently | Server use does not import a renderer; browser artifacts contain no Node/server module or credential. |

CORE3 retains its full callback, contract, disclosure and transport verification. Extraction does not reduce it to the cases used by the first consumer. The complete protected workflow still requires its content-policy and session-lifetime implementation and actual host runs. Run those host checks as soon as the integrated candidate exists; pending maintainer signoff may remain open while compatible downstream coding proceeds. Missing host evidence or a contradicted interface remains a technical issue, not a signed-off success.

## Implementation sequence

Besides PLAY1 and PLAY2, two further groups of existing tickets feed this extraction: [STATE1](https://github.com/MachineWisdomAI/saga-a2ui/issues/12) and [STATE2](https://github.com/MachineWisdomAI/saga-a2ui/issues/13) have proposed scope for view retirement, selection races and bounded request completion (see [request and view lifetimes](request_view_lifetimes.blueprint.md)). Their identities and dependency edges remain; the replacement design and breakdown await human approval. Existing authentication and isolation safeguards remain. [POL1](https://github.com/MachineWisdomAI/saga-a2ui/issues/5) and [POL2](https://github.com/MachineWisdomAI/saga-a2ui/issues/7) cover Standard and Strict content behavior.

Two lines of work run in parallel. The first settles the dependency recipe: migrate and qualify the selected v2 target, then repeat the affected mapping path on it before CORE1 adopts the projection mapping. The 1.7.5 baseline run in both web hosts has already happened. The second prepares extraction characterization tests and completes the application policy/session behavior the working consumer needs. Use the merged Play implementation and its tests as the extraction starting point. Preserve its required behavior while migrating callers and removing superseded code.

The CORE tickets then extract the connector in three steps. [CORE1](https://github.com/MachineWisdomAI/saga-a2ui/issues/14) extracts the browse connector and server/view/policy separation with explicit public-operation support. It retains the application-local A2UI and Lit implementations. [CORE2](https://github.com/MachineWisdomAI/saga-a2ui/issues/15) then moves the proven Play operation through the same declared contract. [CORE3](https://github.com/MachineWisdomAI/saga-a2ui/issues/16) establishes the complete bounded failure and lifecycle contract through installed public exports.

CORE1 through CORE3 are unreleased implementation slices, not stable releases. Their interfaces may evolve as failure and lifecycle behavior is completed. Migrate owned consumers and tests together instead of retaining compatibility shims, legacy overloads or aliases for earlier slices, following the [coding standards](../../CODING_STANDARDS.md).

After CORE1 establishes the view interface, the [Lit adapter](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/reusable_lit_adapter.blueprint.md) can progress alongside CORE2 and CORE3 through its own VIEW1 and VIEW2 tickets. Its Play consumer can initially use the proven application operation; combined acceptance must use the completed connector and preserve the full workflow. The early Lynx Web dependency/sandbox investigation informs VIEW1, rather than blocking MCP extraction. The inspection may report a concrete infeasibility, but it must not be omitted.

This overlap changes when work starts, not what must finish. Full SDK qualification joins CORE3 (the complete failure and lifecycle contract), VIEW2 (the adapter's full lifecycle) and the optional components, and [PACK1](https://github.com/MachineWisdomAI/saga-a2ui/issues/21) and [PACK2](https://github.com/MachineWisdomAI/saga-a2ui/issues/22) release readiness comes after that join. The [Ansari adoption](ansari_adoption.blueprint.md) design adds a later requirement: the exact package versions must be publicly installable from npm before the destination merge.

Blueprint approval and implementation-breakdown approval remain required before dispatch. Full host runs remain scheduled work; only final maintainer acceptance may wait while technically ready implementation advances. Publication remains a separate authorized action after the complete required package and release checks.

## Open decisions

1. **Which exact peer/engine recipe qualifies the selected v2 target?** The 2.0.3 direction is selected; the server, schema, transport and browser migration must pass reproducible local and actual-host checks before CORE1 adopts a projection mapping on that recipe.
2. **Which host mapping can the projection interface promise?** The 1.7.5 baseline runs were inconclusive, so no mapping is established. Measure the merged Play candidate again in ChatGPT web and Claude web on the qualified v2 target before CORE1 adopts the projection mapping. A failed path requires an SDK/application repair or an explicit supported-host limitation, not a claim of success.
3. **Which concrete limits, failure codes and callback interfaces become public contract?** Reuse existing bounds where they fit, establish the complete callback lifecycle through CORE3, and document application cleanup. The unresolved part is the supported connector/callback interface for observing the deadline and cancellation and for carrying progress and delayed completion inside the one bounded request contract. The values must support the tested browse, Play and public-answer consumers without silently truncating their content.

## References

- [Application setup](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/application_setup.blueprint.md), which describes how new and existing applications wire their authentication and server integration to this connector's verified-identity hook.
- [Package ownership](../../packages/README.md), [coding standards](../../CODING_STANDARDS.md), and [version policy](../../docs/version-policy.md).
- [Application listener](../../apps/lit-host/src/mcp/listener.ts), [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts), [request classification](../../apps/lit-host/src/mcp/protected-request.ts), [bridge lifecycle](../../apps/lit-host/src/mcp/view.ts), and [playback server](../../apps/lit-host/src/playback/playback-server.ts), inspected at `31759fabb596f7d59921eb3f85095bc2a3aba73b`.
- [Authorized playback](authorized_playback.blueprint.md), [request and view lifetimes](request_view_lifetimes.blueprint.md), [content safety](content_safety_levels.blueprint.md), [reusable Lit adapter](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/reusable_lit_adapter.blueprint.md), and [Ansari adoption](ansari_adoption.blueprint.md).
