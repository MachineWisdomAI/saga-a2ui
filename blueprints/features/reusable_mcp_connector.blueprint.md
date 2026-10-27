---
feature_name: reusable_mcp_connector
status: approved
module_blueprints: [action_binding]
dependencies: [authorized_playback, request_view_lifetimes, content_safety_levels]
date_added: 2026-10-15
---

# Reusable MCP connector

An application can expose an MCP tool without handing its account model, backend or HTTP server to the SDK. The application authenticates the request and decides what the caller may do. SAGA validates the declared operation, bounds its work, and delivers the fields the application chose to expose. On the other side of the host, SAGA starts and ends the embedded view while the application decides what the result means.

For example, a subscription tool receives a filter, not an account ID. The application obtains the account from verified request context, reads that account's subscriptions, and deliberately copies the public fields into the result. A second concurrent caller gets a different immutable identity. Neither call changes a shared “current user.”

## Status

The connector is published as `@saga-a2ui/mcp@0.7.7-rc.1`, with separate `server`, `view` and `policy` entries. All seven SDK packages have `0.7.7-rc.1` under npm's `next` tag. The [release receipt](https://github.com/MachineWisdomAI/saga-a2ui/releases/tag/v0.7.7-rc.1) identifies the release; the implementation and acceptance records below concern their named scopes, not universal host support.

The human-approved baseline is [`19fb26c84116b15a56fec31bfa358898fe96d791`](https://github.com/MachineWisdomAI/saga-a2ui/blob/19fb26c84116b15a56fec31bfa358898fe96d791/blueprints/features/reusable_mcp_connector.blueprint.md), with the [content-policy clarification at `6785ae1d8205a45e668f478ea303fbdd7e474663`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6785ae1d8205a45e668f478ea303fbdd7e474663/blueprints/features/reusable_mcp_connector.blueprint.md). The sequencing amendment recorded at `6c268cc924886d4f7dfeb1668d83d0e17324f00b` allowed preparation before the lifetime work; it did not waive the later acceptance gates.

| Implemented scope | Design and landed revision | Review and acceptance |
| --- | --- | --- |
| Browse and explicitly public operations | Baseline and sequencing amendment implemented at `6c268cc924886d4f7dfeb1668d83d0e17324f00b` ([PR #75](https://github.com/MachineWisdomAI/saga-a2ui/pull/75)) | [Source/preparation review](https://github.com/MachineWisdomAI/saga-a2ui/pull/75#pullrequestreview-5558284379); this early slice did not establish private recipient mapping |
| Protected Play migration | Lifetime design `7836c80345cec2aeb474d2eb026a1b9455819ef2`, action design `a60acdaf002b8fcca57bcdbd88e30e9c96acfda8` and its defaults implemented for this scope at `8eb46792205fd0866067cd3aeaf29d8b47ed8257` ([PR #133](https://github.com/MachineWisdomAI/saga-a2ui/pull/133)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/133#pullrequestreview-5576383648) of `98f836811f95833c02f68aa163fb66ad94c8c8d5`; [bounded Claude/ChatGPT receipt](https://github.com/MachineWisdomAI/saga-a2ui/issues/15#issuecomment-6275325996) |
| Complete consumer request/failure qualification | Lifetime design plus server-budget amendment `c674060310406b20cf5a985bc23040379bd48812` implemented at `aa1abfb951aa8c811c634acd8ba471f413022bf6` ([PR #140](https://github.com/MachineWisdomAI/saga-a2ui/pull/140)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/140#pullrequestreview-5577263195) of `8c0eb0777611d9df98a7490d5ccb320811c52bbc`; real-listener, installed-export and built-view cases with the stateless cancellation limits below |
| View lifecycle and stack composition | Approved view-composition design `49e39bdb434f5848ded9c042e425c5cefe735b31` integrated at `18153793795d4ecfc12d2785d96422d2e397a3b2` ([PR #234](https://github.com/MachineWisdomAI/saga-a2ui/pull/234)); result amendment `7a78e7eae99285174a11c62d43c1f0035658ec96` implemented at `3a37b200e44ba36fa785202d1b63498a4ac70be1` ([PR #240](https://github.com/MachineWisdomAI/saga-a2ui/pull/240)) | [Result-adapter review](https://github.com/MachineWisdomAI/saga-a2ui/pull/240#pullrequestreview-5618100272); [view composition Status](view_composition.blueprint.md#status) owns the constituent revisions and acceptance limits |
| Cleanup during startup | `d0f04f1ee213075c7c611eb9c1b348f6f0dcc0f7` ([PR #245](https://github.com/MachineWisdomAI/saga-a2ui/pull/245)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/245#pullrequestreview-5620594181); teardown and connection cleanup complete even when callbacks throw |

The [preserved Status record](https://github.com/MachineWisdomAI/saga-a2ui/blob/cdad54747dfbba756464676ac3b1b8c90148a566/blueprints/features/reusable_mcp_connector.blueprint.md#status) retains all exact revision roles, PACK1/PACK2 installation and rollback evidence, and scoped acceptance. Earlier “private, unreleased” statements describe those historical preparation slices. They do not describe the current registry release. This revision adds no runtime or host acceptance.

## One authenticated read, end to end

The maintained [subscription server](../../apps/lit-host/src/mcp/subscriptions-server.ts) shows the division of work. Its listener first verifies the incoming credential and freezes the request identity. `registerProtectedOperation` then interprets the tool arguments against `SubscriptionsRequestSchema` and obtains the application's identity through `identityFromAuthInfo`. A tool argument cannot substitute for that identity.

The handler receives three things separately: parsed arguments, the verified identity and an `OperationRequest`. It asks `request.within('storage', ...)` to run the backend read inside the handler's remaining budget. The backend uses `identity.accountId`; the optional status filter narrows the returned subscriptions. A missing record becomes the declared absent outcome, and an unacceptable business filter becomes a safe refusal.

The projection constructs two fields: model-facing text and structured data. It copies the display name and each subscription's ID, creator, tier and status explicitly. It also adds an opaque view-session label derived from the verified sign-in. That label helps the view detect a change; it cannot authorize another read. The connector validates the projection against the output schema before returning it.

The host obtains the operation's immutable HTML resource and delivers the result to its view. The view lifetime installs its handlers before connecting, holds early input/results while startup finishes, then supplies host context, input and result in that order. The application's result reader decides whether the result is usable, and its renderer presents it. Closing the view retires local delivery and releases the application's view resources; it does not retract a server read that already ran.

An explicitly public operation uses `registerPublicOperation` and has no identity parameter. It retains the same declared schemas, bounded handler, projection and safe-failure discipline. “Public” describes who may call the operation; it does not make questions, diagnostics or credentials suitable for logs.

![Application identity and business rules surround the connector's validated delivery boundary.](../../diagrams/reusable-mcp-connector.svg)

[Editable Mermaid](../../diagrams/reusable-mcp-connector.mmd) · [Editable Excalidraw](../../diagrams/reusable-mcp-connector.excalidraw) · [PNG](../../diagrams/reusable-mcp-connector.png)

The diagram separates the application handler from delivery and rendering. A recipient-specific projection additionally needs evidence that the selected host carries it to the intended recipient. The ordinary operation helper described above produces model text and `structuredContent`; the protected player below owns its distinct private result mapping.

## Responsibilities and interfaces

| Owner | Responsibility | What stays outside |
| --- | --- | --- |
| Application listener | HTTP setup, credentials, verified request context, transport creation and response completion | The SDK does not choose an identity provider or application host |
| Application operation | Backend work, domain authorization, record selection and deliberate projection | A valid schema or a client prerequisite cannot grant permission |
| MCP server entry | Operation declaration, input/output validation, bounded callback execution, safe failures and view-resource registration | It does not import a renderer or own the application's records |
| MCP view entry | Host handshake, early delivery, readiness, host context and teardown | It does not interpret A2UI or decide what an answer means |
| Renderer and stack | Render the application's surface and connect it to delivery | They do not select a user or authorize a backend effect |
| Core action runtime | One bound invocation's prerequisites, handler, outcome, budgets and invocation-owned resources | A server request and a transferred application resource have their own lifetimes |

The package's [`server` exports](../../packages/mcp/src/server/index.ts) include `registerProtectedOperation`, `registerPublicOperation`, `createServerBudgets`, request-lifetime helpers and `operationViewFromHtml`. An application supplies an MCP server it created; there is no separate SAGA registry. The [`view` exports](../../packages/mcp/src/view/index.ts) include `runToolResultView`, `deliveredResultFromToolResult`, `hostLinksFromApp`, `startOwnSizing` and `readingProfile`. The [`policy` entry](../../packages/mcp/src/policy/index.ts) contains delivery policy and bounded-timer support.

A complete A2UI application normally consumes one renderer's MCP stack. The stack composes these lower-level pieces and owns view startup. An independently installed server can use `@saga-a2ui/mcp/server` without a renderer peer; a stack's `/server` entry is a convenience for an application already using that stack. [Package ownership](../../packages/README.md) and [public installation](../../docs/public-install.md) describe those choices.

Three policies meet here. **Delivery policy** controls recipients and required host capabilities. **Domain authorization** decides which records or effects a verified caller may access. **Content policy** governs effects of displayed content, such as opening a link or loading an image. A permitted link does not authorize Play, and a successful Play authorization does not relax the card's content policy. The [content safety design](content_safety_levels.blueprint.md) owns Standard and Strict behavior.

### Request time and cancellation

The listener starts one `RequestLifetime` at admission, before authentication or body waits, and passes it through its per-request server factory. The SDK's default operation limit is 3,000 ms and its request limit is 10,000 ms, with independent instance/route overrides. An operation's `boundMs` can override its own aggregate handler budget; it cannot extend the enclosing request. [Request and view lifetimes](request_view_lifetimes.blueprint.md#configurable-server-budgets) explains nesting, finite delivery and streaming.

`OperationRequest.signal` tells application work when its operation ends. `within(stage, work, options?)` runs authorization, storage or another dependency under the remaining aggregate budget and passes a signal to that work. `reportProgress(update)` delivers only while the operation is current. Progress, another callback or an internal retry cannot restart the deadline.

Racing the callback bounds the wait even when the callback ignores its signal. It cannot stop arbitrary JavaScript or undo an effect already made. The code that would start a later protected effect must still check the scope. Identity resolution is synchronous; a promise or a throwing accessor fails closed before the protected handler starts. Projection promises and malformed outcomes do not become success payloads.

The qualified listener is stateless: it creates a server and transport for each POST. Same-request disconnect and cancellation are tested boundaries. A separately posted `notifications/cancelled` receives 202 but cannot reach a different stateless request; there is no process-wide request registry. GET/DELETE resumption is refused with 405. These are meaningful support limits, not resumable-session guarantees.

### The embedded view lifetime

`runToolResultView` owns readiness and ending. It installs handlers before the handshake, starts optional `readyWhen` work alongside it, and keeps only the latest input and result that arrive before readiness. Once both startup tasks succeed, it supplies host context, then held input, then the held result. A later result is delivered normally. A result by itself does not authenticate another notification or reveal its correlation.

On disposal, host teardown, `pagehide` or startup failure, the runner stops delivery, aborts readiness, drops held values and invokes application teardown once. It removes listeners and closes the connection even if teardown throws. For a host teardown request it answers the host before closing. An application releases its external resources in `onTeardown`; it does not sequence the bridge's close itself.

`deliveredResultFromToolResult` maps the transport result into core's neutral `DeliveredResult`; it does not classify its business meaning. The application definition's `result` reader owns that decision. This preserves one place to decide whether an answer, error or empty result is suitable for the surface. The former `connectToolResultView` and `classifyResult` option are no longer current APIs.

## Protected playback and recipient separation

The [playback server](../../apps/lit-host/src/playback/playback-server.ts) is a specialized application integration. It uses the SDK's request lifetime and the upstream MCP Apps registration API while retaining its capability issuance and private projection. It is not a generic `registerProtectedOperation` private-result feature.

The view's Play action sends an episode ID in arguments and its recipient public key in request `_meta`. The app-only operation checks verified identity, validates that key and checks entitlement before issuing a capability bound to the key. Its safe model text goes in `content`; its validated capability-bearing result goes under the application's result `_meta` key. The view later proves possession of the corresponding private key to acquire media. The [authorized playback Blueprint](authorized_playback.blueprint.md) owns these checks and their limits.

This mapping has bounded Claude web and ChatGPT web observations on the migrated path. Both produced private grants and kept the capability and media URL out of the observed model-visible result. The earlier MCP Apps 1.7.5 runs failed to display the control and established no mapping; they remain historical evidence, not the current verdict. The later successful request observations do not establish successful audio, universal host behavior or remote cancellation. The host provider can still see data delivered through its infrastructure.

The pinned MCP seam uses MCP Apps 2.0.3, split client/core/server 2.3.1, Node integration 2.1.1 and Zod 4.6.7. A2UI's upstream 0.13 schema boundary retains its own Zod 3 dependency. The original version-only migration produced type errors across transport, context and schemas; the current source performs that migration rather than hiding both versions behind a compatibility layer.

## Failure and recovery

| Trigger | Observable result and owner |
| --- | --- |
| Incomplete operation declaration | Registration rejects the configuration before serving; the diagnostic names the missing requirement without credentials |
| Missing or unacceptable verified identity | The listener preserves its authentication status/challenge; the protected helper does not enter the handler without acceptable identity |
| Malformed protocol call or unknown operation | The upstream protocol error path runs without entering the application handler |
| Known operation with invalid business input, refusal, absent record or expected backend failure | A declared safe tool failure is returned; a backend HTTP status does not automatically become the MCP endpoint's status |
| Callback throws, stalls, returns malformed data or breaks the projection contract | Work ends within its budget; no rejected success fields or private diagnostics enter the result |
| Disconnect, cancellation or late completion | The terminal owner stops waiting, drops late output and starts no later owned stage; application work cleans up effects it cannot interrupt |
| Required private recipient path is unavailable | The application refuses before protected acquisition and never moves the capability into model-visible output as a fallback |
| View startup or application callback fails | Startup rejects with a typed failure and cleanup completes; after readiness, callback errors go to the configured error handler without silently becoming valid content |

HTTP authentication/challenge, JSON-RPC error and tool-level `isError` are separate observations. A safe failure must preserve that distinction without weakening the successful-output schema. On the client, a lost reply leaves an operation's effect unknown; reconnecting a view does not make repeating a write safe.

## Verification outcomes

The maintained [operation tests](../../packages/mcp/src/server/operation.test.ts), [request-lifecycle tests](../../packages/mcp/src/server/request-lifecycle.test.ts) and [view-lifetime tests](../../packages/mcp/src/view/run-tool-result-view.test.ts) exercise these contracts. The historical reviews in Status identify what was independently run at each delivery.

The important cases follow the owning boundaries: two concurrent principals must stay separate; forged account arguments must not select another identity; an explicitly public operation must run without fabricated identity; stalled identity, handler or projection work must not hold the request indefinitely; late progress and success must be dropped; and closing one view must not keep its callbacks active. Strict output schemas and diagnostic canaries check disclosure separately from request completion. Server imports and browser bundles must retain their dependency direction.

CORE3's retained qualification includes real JSON/SSE delivery, progress and delayed completion, response writes after closure, installed server exports and built views. A local listener test does not prove a production proxy's slow-reader behavior. A packed install does not prove registry installation. A host request receipt does not prove audio or unseen account transitions. The [host compatibility guide](../../docs/host-compatibility.md) keeps current reader-facing host claims within those limits.

## Implementation sequence

CORE1 extracted browse/public-answer delivery. STATE1/STATE2 established retirement and bounded requests; CORE2 then migrated Play to one action work interval and acquisition-scoped leases. CORE3 qualified the complete consumer request/failure path. PACK1/PACK2 joined installed consumers and rehearsed coherent replacement/rollback. View composition later made the stacks own view startup and moved neutral result interpretation to one application reader. These are completed source stages with their own acceptance records, not a queue to dispatch again.

Application adoption, new host qualification and publication are separate actions. The [Ansari adoption design](ansari_adoption.blueprint.md) retains its destination and exact-package requirements; this connector Blueprint does not grant destination merge or deployment authority.

## Open decisions

The current exported callback and lifetime interfaces are implemented; the old CORE3 interface questions are no longer open. A broader private-result abstraction would still need to preserve the application-owned Play contract and demonstrate its recipient mapping in every claimed host. Support beyond the tested stateless transport, including resumable sessions or cross-request cancellation, would be a separate design.

Applications choose their identity provider, authorization rules, safe error wording and tighter budgets. They also decide how to reconcile a write whose reply was lost. Those responsibilities are not missing connector defaults.
