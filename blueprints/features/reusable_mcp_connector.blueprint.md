---
feature_name: reusable_mcp_connector
status: approved
module_blueprints: [action_binding]
dependencies: [authorized_playback, request_view_lifetimes, content_safety_levels]
date_added: 2026-10-15
---

# Reusable MCP connector

## Status

**Approved; the scoped CORE1–CORE3, installed-consumer and view-composition deliveries are implemented.** The baseline design is [`19fb26c84116b15a56fec31bfa358898fe96d791`](https://github.com/MachineWisdomAI/saga-a2ui/blob/19fb26c84116b15a56fec31bfa358898fe96d791/blueprints/features/reusable_mcp_connector.blueprint.md); the [lifecycle records](reusable_mcp_connector.lifecycle.md#status) preserve its clarification, lifetime/server-budget and view-composition amendments with exact reviewed and landed revisions. This refresh changes no approved contract or final acceptance decision.

`@saga-a2ui/mcp` is published at `0.7.7-rc.1`. Its 14 shipped source files match source baseline `cdad54747dfbba756464676ac3b1b8c90148a566`, with registry tarball integrity verified. This is package/source identity, not another installation or host run. The original private extraction and candidate-replacement observations remain historical evidence.

The current view API is `runToolResultView`; `connectToolResultView` no longer exists. Application consumers normally use one renderer's stack; independently hosted servers use `@saga-a2ui/mcp/server` without a renderer peer. Retained ChatGPT/Claude observations establish only their bounded private-grant and lifetime cases, not universal recipient support, audible playback, forwarded cancellation, rollback or deployment.

## Problem and current behavior

An application should be able to replace MCP delivery without replacing its HTTP server, authorization rules or renderer. The original investigation at `31759fabb596f7d59921eb3f85095bc2a3aba73b` found these responsibilities together in the synthetic application. The package now separates server operation/lifetime helpers, browser delivery and MCP policy; application authentication, backend calls, domain authorization and capability issuance retain their owners.

A **projection** is the set of fields deliberately prepared for a recipient. The generic operation helpers currently expose a synchronous `project` callback returning `{ text, data }`: text becomes model-visible `content`, and validated data becomes `structuredContent`. That API does **not** provide a private view-only payload. The application's protected Play endpoint uses a separate app-only registration and private result metadata, described below. Keeping these paths distinct prevents an application from placing a capability in generic structured output and assuming it is hidden from the model.

A server action's handler sends a request through the host; the connector concerns that request. A local action runs in the view and may also be asynchronous. In the protected player, Play obtains a grant and starts a client-held resource; Pause and Resume act locally on its lease. The [action module](../modules/action_binding.blueprint.md) owns invocation execution, while the application owns these definitions and resources. Explicitly public operations can use the same validation discipline without inventing an identity.

## Proposed behavior

This section describes the approved behavior and its implemented boundaries, not new setup promises.

For an authenticated subscription read, the application listener verifies the request and supplies an immutable identity. The connector validates the operation's declared input, invokes the application handler and validates the explicitly constructed output before serialization. The application still decides which subscriptions belong to that caller. The host receives the permitted result and the linked immutable HTML resource; the connected view passes delivered data to the application's rendering implementation.

For example, the [subscription operation](../../apps/lit-host/src/mcp/subscriptions-server.ts) accepts `{ "status": "active" }`, never an account ID. Its handler reads the account named by verified identity, filters its subscriptions, and passes that record to `project`. For an illustrative account named Maya with one active subscription, model text is `Maya: 1 subscription(s)`. The structured result contains `displayName`, the selected subscriptions' `subscriptionId`, `creator`, `tier` and `status`, and an opaque `viewSession` label derived from the sign-in. It contains neither the account ID nor the raw sign-in ID. The application's result callback validates that result and presents the active row; an empty valid list presents “No subscriptions.”

A status such as `"unknown"` instead produces the safe refusal “That subscription request could not be read.” A missing backend account produces “Subscriptions are unavailable.” These are tool failures, not successful empty lists. The [subscription view controller](../../apps/lit-host/src/mcp/subscriptions-view.ts) owns clearing its rows and selection and showing the appropriate problem or retry state; connector delivery alone does not choose that presentation.

For a protected server action, the view invokes a named typed operation with the selected item's ID. The application checks current identity and authorization on every invocation and owns any capability it issues for the client continuation. The application-owned Play handler separately constructs and validates model and private-view projections through its app-only MCP Apps mapping; this is not a `Projection` option on generic operation registration. An unsupported recipient path fails before protected acquisition. No private field is moved into model-visible output as a fallback.

A public operation declares that access mode explicitly, supplies its input and output contracts, and uses the same validation and failure disciplines. Public access does not make questions, credentials or diagnostic data suitable for logs. Neither mode accepts caller-supplied account fields as authority.

**Conceptual delivery diagram.** The recipient-probe gate records the design requirement that preceded CORE2. Bounded ChatGPT/Claude observations now exist in the lifecycle record. The model/view split shown here includes the application-specific Play path; it is not a private-field API on `registerProtectedOperation`.

![Conceptual delivery ownership, including application-specific private Play mapping rather than a generic private-projection API. The application owns identity and business decisions; the MCP connector validates and delivers model and view projections, while the application composes the view with its renderer.](../../diagrams/reusable-mcp-connector.svg)

[Editable Mermaid](../../diagrams/reusable-mcp-connector.mmd) · [Editable Excalidraw](../../diagrams/reusable-mcp-connector.excalidraw) · [PNG](../../diagrams/reusable-mcp-connector.png)

## Responsibilities and interfaces

The published package, `@saga-a2ui/mcp`, has distinct `/server`, `/view` and `/policy` subpath exports, each grouping one concern. A2UI wire-version protocols stay in `@saga-a2ui/core`; this package does not own them. Server exports attach to an application-owned MCP server and accept declared operations, runtime schemas and application callbacks. View exports own supported bridge initialization, result delivery and teardown. Policy exports express MCP delivery decisions and required capabilities without importing a renderer or the application's subscription policy. The public identifiers are defined by the package exports; the main seams are listed below. The [package layout](../../packages/README.md) records the flat package naming.

| Owner | Inputs and outputs | Required boundary |
| --- | --- | --- |
| Application listener | Request transport and credentials; verified request identity | HTTP setup and authentication remain outside the connector. No mutable shared current-user state. |
| Application operation | Validated arguments and request identity; domain result | Backend calls, entitlement and effects remain here. A public operation receives no fabricated principal. |
| MCP server integration | Declared operation, schemas and explicit projections; validated wire result | Protected registration without required identity/projection configuration fails. Upstream registration is not a SAGA action registry. |
| MCP view integration | Host notifications and connection lifetime; typed delivery callbacks | Install handlers before connection, deliver once, retire callbacks and release listeners on disposal. No A2UI interpretation. |
| Application renderer | Delivered result and application-owned catalog; visible state | The renderer/stack owns its surface lifecycle; the application owns result meaning, catalog choices and player resources. |
| Action runtime | Invocation execution, outcomes and invocation-scope cleanup in the [action binding](../modules/action_binding.blueprint.md) module | Not part of the connector. The application owns action definitions and the application or adapter owns bindings; the application's resource owner retains acquired resources. The connector carries the request a server action's handler sends; it does not own prerequisites, hooks, busy policy or binding. |

Three kinds of policy meet at this boundary, and they have different owners. *Delivery policy* is the connector's: which recipient receives which projection and which host capabilities a protected operation requires. *Domain authorization* is the application's: who may see which records and whether this caller may perform the protected action on this item. *Content policy* decides what supplied text may do when rendered, such as whether a link navigates or an image loads. The [content safety design](content_safety_levels.blueprint.md) defines Standard and Strict. The [components package](../../packages/components/src/faithful-card/policy.ts) owns the reusable content-policy contract; applications supply trusted settings, and renderer/stack integration enforces the permitted effects.

The connector owns the transport and request contract: operation declaration, input and result validation, projection delivery, the request deadline, cancellation and late-output retirement, and the JSON and SSE lifecycle. It does not own application authentication or domain permission, and it does not own generic action binding. A client-side prerequisite in an action definition never substitutes for the server checks this connector delivers. Where an action definition aborts its wait, that shows only that the client stopped waiting; whether the host forwarded cancellation and whether the server stopped are separate facts that [CORE3](https://github.com/MachineWisdomAI/saga-a2ui/issues/16) and host observation have to establish.

### Current operation and view seams

| Seam | Current contract |
| --- | --- |
| `registerPublicOperation` / `registerProtectedOperation` | Register on an application-owned MCP server. Input/output schemas, fixed failure text, view and callbacks are explicit. Protected registration additionally requires a synchronous identity resolver. |
| `identity(authInfo)` | Converts transport-verified context to the application's identity or `undefined`; it does not authenticate a bearer token. Promise-returning or throwing resolvers fail closed. |
| `handle` / `project` | The handler may await and returns `record`, `absent` or a safe `refused` outcome. Projection is synchronous; output validation happens before serializing success. |
| `OperationRequest` | Supplies `signal`, nested `within(stage, work, { limitMs })`, and `reportProgress`. Progress is sent only when requested and while the operation remains live. |
| `createServerBudgets` / `OperationContext.lifetime` | Let an adapter admit one request before authentication/body work and pass the same lifetime into operation registration. Without a supplied context, the helper creates a call-local lifetime; it cannot retroactively bound earlier HTTP admission. |
| `operationViewFromHtml` / `viewUriForHtml` | Prepare the immutable operation view and its identity from built HTML; application resource configuration remains explicit. |
| `runToolResultView` | Installs handlers before connecting, holds the latest early input/result until readiness, then delivers them in order. Ending stops delivery, runs application teardown once and closes; host teardown is answered before close. |
| `deliveredResultFromToolResult` | Maps MCP content/error/structured data into core's neutral `DeliveredResult` without interpreting application meaning or carrying private `_meta`. The application reader decides what it means. |
| `hostLinksFromApp`, `startOwnSizing`, `readingProfile` | Browser delivery adapters for host links, viewport sizing and the host's reading profile; no renderer or business authorization is imported. |

Among SDK packages, MCP depends only on core. A2UI protocol interpretation, content rendering and generic action execution are not connector responsibilities. Server and browser imports stay separate.

### Protected Play mapping and evidence

The reference application's [playback server](../../apps/lit-host/src/playback/playback-server.ts) registers the Play tool with app-only visibility, reads a per-call recipient key from request metadata, emits safe model text, and puts the validated grant under its private result `_meta` key. Acquisition then checks the recipient-bound capability and proof independently. No private field moves into `content`, `structuredContent`, resource HTML or an error as a fallback.

The original MCP Apps 1.7.5 web-host runs never displayed an actionable card and established no mapping. Later CORE2 observations on the reviewed 2.0.3 recipe did establish private-grant delivery in ChatGPT web and Claude web, with episode-only arguments and recipient metadata. These exact source/resource records are retained in the [lifecycle companion](reusable_mcp_connector.lifecycle.md#status), including rendering retries, unknown-outcome recovery and the lack of successful loopback audio. Their scope cannot be generalized to a new host or renderer. A new recipient path requires its own observation; source inspection or a local bridge fixture is not that evidence.

The current MCP package pins MCP Apps 2.0.3, split client/core/server 2.3.1 and Zod 4.6.7; its Node qualification uses integration 2.1.1. The original dependency migration and inconclusive predecessor runs remain [historical](reusable_mcp_connector.lifecycle.md#historical-mapping-investigation), not continuing blockers or a reason to introduce parallel SDK versions.

## Failure and recovery

The connector exposes safe outcomes without making callers reconstruct callback order. Applications declare finite schema/content bounds at their owning interfaces; generic registration does not invent a universal limit for every string, item or retained application state. Strict output schemas and explicit projection are still necessary to keep private fields out.

The SDK defaults are 3,000 ms per operation and 10,000 ms per request. Trusted route settings resolve against instance settings and defaults; an operation's `boundMs` and nested `within` limit can narrow work but never extend the admitted request deadline. Authentication, body receipt, handler/projection and finite response delivery share that original request budget when the adapter carries the lifetime end to end. Finite delivery completes only at an undestroyed transport `finish`, not when application work returns or calls `end`. Streaming lifetime is adapter-specific. The reference application's [response-lifetime adapter](../../apps/lit-host/src/mcp/response-lifetime.ts), when configured with its optional streaming policy, replaces the setup deadline with a finite idle/backpressure policy once the stream is established. The maintained starters instead carry the request deadline through response delivery, including SSE: their default stream limit is 10,000 ms. An application adding long-lived streams must choose an explicit policy; keepalives do not extend either policy. See [starter transport and streaming](../../docs/getting-started.md#protocol-state-and-notifications).

Client action work/hook budgets are separate. Cancellation stops the owner's wait and retires late output; it cannot preempt synchronous JavaScript, retract buffered bytes or undo an external effect. Callbacks ignoring a signal remain responsible for their own effects. Progress never renews an enclosing operation or request budget. The [request/view lifetime design](request_view_lifetimes.blueprint.md#configurable-server-budgets) owns the full budget contract.

| Trigger | Observable result and recovery |
| --- | --- |
| Protected registration lacks its identity resolver, projection, schemas, view or required failure text | Registration fails before serving the operation; the configuration error identifies the missing requirement without printing credentials. |
| Identity is missing, invalid, expired or service-only | The established authentication status/challenge remains intact; no protected handler or acquisition runs. |
| A malformed protocol call or unknown operation arrives | The supported JSON-RPC failure is returned; no application handler runs. |
| A known operation receives invalid business input, denial or an expected backend failure | A safe tool failure is returned according to the selected upstream contract. Backend 401, 429 or 503 does not automatically become the MCP endpoint status. |
| A callback throws, stalls or produces malformed/oversized projected data | The connector retires the request within its bound and returns no success payload or private diagnostics. The application's result callback owns invalid-state clearing and recovery presentation (as the subscription controller does); a renderer stack owns surface delivery/lifecycle, not this business-state decision. |
| Cancellation, disconnect, late output or disposal occurs | No duplicate operation, late response, headers-after-stream-start or restoration of retired data occurs. Cleanup responsibilities remain explicit. |
| The host cannot preserve required recipients | Protected behavior fails before acquisition. No capability appears in model text, structured output, resource HTML, A2UI payloads, errors or ordinary logs. |

Failure mapping must be verified at the wire boundary: HTTP status and challenge, JSON-RPC result/error, and `isError` are separate observations. A safe tool failure is not proof of an HTTP authentication refusal, and a failed wait does not prove that a write had no effect. Successful-output schemas remain strict; error handling must not weaken them.

## Verification outcomes

The table retains the approved qualification requirements; the lifecycle records identify which exact runs support them. A requirement is not evidence that every adapter or host satisfies it.

| Condition | Observable result |
| --- | --- |
| Allowed, denied, empty and failed subscription reads use public package exports | The real listener and built view retain their prior authorization, request correlation and displayed results, including declared filters. |
| Two principals invoke operations concurrently, or an input adds a forged account | Each handler receives only its request's verified identity; supplied fields cannot select another account. |
| A public answer-style operation is declared | It runs without user authentication while retaining explicit validation, projections and safe failures. |
| Allowed and denied protected server actions use the connector | Every valid invocation reauthorizes; denial causes no protected acquisition; the permitted view receives only its projection. |
| Identity, authorization, handler and projection callbacks each stall or fail | The configured bounds hold at every stage; late emissions are retired and diagnostic canaries do not escape. |
| JSON and supported SSE delivery carry progress, cancellation and disconnect | No invalid second response or restoration of retired view state; stateless cross-POST cancellation and GET/DELETE resume remain unsupported as recorded below. |
| An instruction-like field or private canary is included in backend data | It neither changes server action arguments nor appears outside its explicitly allowed recipient, including logs and resource metadata. |
| Server and view exports are imported independently | Server use does not import a renderer; browser artifacts contain no Node/server module or credential. |

CORE3 retains its full callback, contract, disclosure and transport verification. Extraction does not reduce it to the cases used by the first consumer. The scoped completed runs and reused host observations are in the lifecycle records. A changed protected workflow still needs affected policy/lifetime checks and host evidence for any changed host-facing claim; unchanged observations remain bounded to their original artifacts. Missing host evidence or a contradicted interface remains a technical issue, not a signed-off success.

## Implementation sequence

The original CORE1 extraction, CORE2 protected-action migration, CORE3 complete request qualification, and subsequent installed-consumer/view-composition deliveries are recorded in the [lifecycle companion](reusable_mcp_connector.lifecycle.md#implementation-sequence). Preparation allowed some work to overlap; it did not waive final qualification or approve the then-proposed lifetime design. Later approvals and implementations retain their own exact revision records.

Future changes migrate owned consumers and tests together and follow the [version policy](../../docs/version-policy.md). Historical private candidates are not a continuing public-package hold. Package publication, destination adoption and host acceptance are separate from changing source or observing a local test.

## Open decisions and limits

The original v2 recipe, bounded callback interface and scoped ChatGPT/Claude mapping questions have recorded implementations and qualification. They are not unresolved prerequisites for using the shipped package. Broader portability and destination acceptance remain separate:

- Generic operation projection returns model-visible text and structured data. The observed private Play mapping is application-specific; no generic private-projection interface or host-independent confidentiality guarantee is implied.
- The stateless transport qualification distinguishes same-request disconnect/same-POST cancellation from separately posted cancellation. A separate notification may receive 202 without reaching another request; GET/DELETE resume is refused with 405. No cross-request cancellation registry or resumable-session guarantee is added.
- Observed host cancellation did not establish entitlement cancellation or rollback. Removed frames may be unobservable; deterministic ownership tests and visible fresh-view recovery prove different things.
- Local transport checks do not qualify production proxies, OAuth/DCR, remote audio, all renderers or new host versions. New claims need their own evidence.

## References

- [Application setup](application_setup.blueprint.md), which describes how new and existing applications wire their authentication and server integration to this connector's verified-identity hook.
- [Package ownership](../../packages/README.md), [coding standards](../../CODING_STANDARDS.md), and [version policy](../../docs/version-policy.md).
- [Application listener](../../apps/lit-host/src/mcp/listener.ts), [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts), [request classification](../../apps/lit-host/src/mcp/protected-request.ts), [view lifecycle](../../packages/mcp/src/view/run-tool-result-view.ts), and [playback server](../../apps/lit-host/src/playback/playback-server.ts). The [original investigation](https://github.com/MachineWisdomAI/saga-a2ui/tree/31759fabb596f7d59921eb3f85095bc2a3aba73b) predates extraction; these relative links point to current owners.
- [Authorized playback](authorized_playback.blueprint.md), [request and view lifetimes](request_view_lifetimes.blueprint.md), [action binding](../modules/action_binding.blueprint.md), [content safety](content_safety_levels.blueprint.md), [reusable Lit adapter](https://github.com/MachineWisdomAI/saga-a2ui/blob/b10a8882fa5b15ad9a7243f592e5c3dc086d5340/blueprints/features/reusable_lit_adapter.blueprint.md), and [Ansari adoption](ansari_adoption.blueprint.md).
