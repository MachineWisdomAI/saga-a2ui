---
feature_name: authorized_playback
status: approved
module_blueprints: [action_binding]
dependencies: []
date_added: 2026-10-15
---

# Authorized playback

## Status

Design approved; implementation partial. Protected playback (PLAY1/PLAY2) and the React protected player are implemented. Request and view lifetime work is recorded in the [lifetime Status](request_view_lifetimes.blueprint.md#status).

**Design**

| Design revision | Decision |
| --- | --- |
| [`feb037e51e411ee4da9a71b9e1f6e4d51e1737f9`](https://github.com/MachineWisdomAI/saga-a2ui/blob/feb037e51e411ee4da9a71b9e1f6e4d51e1737f9/blueprints/features/authorized_playback.blueprint.md) | Approved 2026-10-15. |
| [`6785ae1d8205a45e668f478ea303fbdd7e474663`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6785ae1d8205a45e668f478ea303fbdd7e474663/blueprints/features/authorized_playback.blueprint.md) | Content Safety clarification of this Blueprint, approved 2026-10-16. |
| [`7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/authorized_playback.blueprint.md) | Request/view-lifetime amendment of this Blueprint, approved by the human owner on 2026-10-17 in [PR #69](https://github.com/MachineWisdomAI/saga-a2ui/pull/69). It replaces only the lifetime scope; earlier design-to-code records stay valid. The lifetime Blueprint at this revision is [request_view_lifetimes](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/request_view_lifetimes.blueprint.md). |
| [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) | Action binding module design, approved independently; merged as `8b5daf04478593271831d08a9e11c7c2bff0f566` in [PR #73](https://github.com/MachineWisdomAI/saga-a2ui/pull/73). The general action vocabulary follows it. |
| [`d62c2232ecd8e100d90fe9dbffa072f6cd3dd4a7`](https://github.com/MachineWisdomAI/saga-a2ui/blob/d62c2232ecd8e100d90fe9dbffa072f6cd3dd4a7/blueprints/features/request_view_lifetimes.blueprint.md) | Earlier lifetime proposal; historical draft, never approved. |

**Implementation**

| Scope | Design implemented | Landed code | PR / issue | Review and checks | Limits and what it does not show |
| --- | --- | --- | --- | --- | --- |
| PLAY1 and PLAY2 (protected playback source) | [`feb037e51e411ee4da9a71b9e1f6e4d51e1737f9`](https://github.com/MachineWisdomAI/saga-a2ui/blob/feb037e51e411ee4da9a71b9e1f6e4d51e1737f9/blueprints/features/authorized_playback.blueprint.md) | [`31759fabb596f7d59921eb3f85095bc2a3aba73b`](https://github.com/MachineWisdomAI/saga-a2ui/commit/31759fabb596f7d59921eb3f85095bc2a3aba73b) | [#56](https://github.com/MachineWisdomAI/saga-a2ui/pull/56)<br>[#58](https://github.com/MachineWisdomAI/saga-a2ui/pull/58) | [review 5540944730](https://github.com/MachineWisdomAI/saga-a2ui/pull/58#pullrequestreview-5540944730) | Final PLAY2 review records covered source behavior and local verification. Integrated request/view lifetimes and authenticated ChatGPT/Claude playback were outside these slices. |
| Lifetime amendment, STATE1: teardown retirement and late-player cleanup | [`7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/request_view_lifetimes.blueprint.md)<br>(related amendment of this Blueprint: [`7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/authorized_playback.blueprint.md)) | [`b84276d6efa90379436cf92ee9f3311327be8ebd`](https://github.com/MachineWisdomAI/saga-a2ui/commit/b84276d6efa90379436cf92ee9f3311327be8ebd) | [#84](https://github.com/MachineWisdomAI/saga-a2ui/pull/84) | Review and checks are in the [lifetime Status](request_view_lifetimes.blueprint.md#status) ([exact-head review 5561164021](https://github.com/MachineWisdomAI/saga-a2ui/pull/84#pullrequestreview-5561164021), [required CI 39090874952](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39090874952)). | Slice limit at STATE1: bounded completion, lease ownership and required host acceptance were listed as remaining. Later lifetime records own their outcome; see the [lifetime Status](request_view_lifetimes.blueprint.md#status). |
| Label loss final per view instance (decision 2026-10-19, issue 105) | [`7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/request_view_lifetimes.blueprint.md) | [`dc968ab54a9f3793bb3841c1c3242b4e1ffe3182`](https://github.com/MachineWisdomAI/saga-a2ui/commit/dc968ab54a9f3793bb3841c1c3242b4e1ffe3182) | [#106](https://github.com/MachineWisdomAI/saga-a2ui/pull/106)<br>[#105](https://github.com/MachineWisdomAI/saga-a2ui/issues/105) | — | Recorded in the [lifetime Status](request_view_lifetimes.blueprint.md#status), which owns the review and checks for this scope. |
| React protected player (grant, refusal, fresh recovery) | [`a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`](https://github.com/MachineWisdomAI/saga-a2ui/blob/a60acdaf002b8fcca57bcdbd88e30e9c96acfda8/blueprints/modules/action_binding.blueprint.md) (action design)<br>[`564bcb2a13dd162515a80e7f491d2870990958ab`](https://github.com/MachineWisdomAI/saga-a2ui/blob/564bcb2a13dd162515a80e7f491d2870990958ab/blueprints/modules/action_binding.blueprint.md) (bounded-default amendment)<br>[`7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/request_view_lifetimes.blueprint.md) (request/view design)<br>[`c674060310406b20cf5a985bc23040379bd48812`](https://github.com/MachineWisdomAI/saga-a2ui/blob/c674060310406b20cf5a985bc23040379bd48812/blueprints/features/request_view_lifetimes.blueprint.md) (server-budget amendment) | [`4d40761d14c563cb3b48648266594b1d70d8e918`](https://github.com/MachineWisdomAI/saga-a2ui/commit/4d40761d14c563cb3b48648266594b1d70d8e918) | [#172](https://github.com/MachineWisdomAI/saga-a2ui/pull/172) | — | The acceptance record [docs/2026-10-21_react_play_acceptance_v1.md](https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/docs/2026-10-21_react_play_acceptance_v1.md) names the four design revisions as implemented for this scoped integration; the first two belong to [action_binding](../modules/action_binding.blueprint.md) and the last two to [request_view_lifetimes](request_view_lifetimes.blueprint.md). Claude and ChatGPT observed private grant, refusal without grant and fresh recovery; ChatGPT also observed pending-view reload followed by a new acquisition. Loopback media failure is not audio acceptance. Optional description card and combined React recipe are not covered. |

**Acceptance limits.** This document does not establish authenticated ChatGPT/Claude playback beyond the scoped React observations in the table, audible audio, or the combined description-card recipe. Historical STATE1 limit: when [PR #84](https://github.com/MachineWisdomAI/saga-a2ui/pull/84) landed, bounded completion, lease ownership and required host acceptance were listed as remaining. Later outcomes are in the [lifetime Status](request_view_lifetimes.blueprint.md#status). The 2026-10-17 sequencing amendment lets public-answer connector and passive-renderer work start before the remaining lifetime work ([CORE1 #14](https://github.com/MachineWisdomAI/saga-a2ui/issues/14)); it replaces only the extraction start-order sentence in [Implementation sequence](#implementation-sequence) and does not waive playback, release or host acceptance.

**Rejected.** Account and session machinery stays rejected ([account_session_isolation](account_session_isolation.blueprint.md)).

Pre-cleanup narrative, including verification counts and chronology: [authorized_playback Status at the cleanup baseline](https://github.com/MachineWisdomAI/saga-a2ui/blob/2405c5d28f02a5b8d5fb70ed7a929e676cf78d43/blueprints/features/authorized_playback.blueprint.md).
## Problem and current behavior

An example podcast app lets signed-in listeners browse their subscriptions. This design adds playback inside an assistant: a listener presses Play and hears an episode their account can access. The example uses fictional accounts and content. User A can listen to the selected episode; user B cannot.

Permission to browse is not permission to play. Every Play request needs a fresh server decision. A visible button, an earlier subscription result or possession of an episode ID cannot grant access. Playback is user initiated and stays in the foreground. Patreon integration, production identity, mobile, autoplay, voice mode and background playback are out of scope.

## Proposed behavior

User A selects episode `ep-1` and presses Play in the app's embedded Lit view, which the assistant host runs and whose requests it mediates. The view shows a pending state and sends only `{ episodeId: "ep-1" }` to the declared **app-only** Play operation: exposed to the embedded view and excluded from the model's tools. The control stays keyboard reachable while repeated activation is suppressed. The view allows at most one active playback request and one foreground player.

The application validates the episode ID and authenticates the request independently of its arguments. That yields a **verified principal**, the caller's identity as confirmed by the application's authentication. Play then checks the principal's current **entitlement**, permission to access that episode. An account ID, sign-in label or subscription status in the action cannot select the caller or grant permission, and a replayed request repeats both checks.

Before acquiring protected media, the delivery path checks that the host supports the app action and can deliver private playback data to the view separately from the model's response. If either is missing, Play returns a safe unsupported result and fetches nothing. Private data is never placed in a model-visible field as a fallback.

For an authorized user the synthetic media service issues a **media capability**: short-lived authorization to fetch the selected episode for the permitted recipient. The reference application binds it to the account, episode and view key (see [Open decisions](#open-decisions)). The application builds separate **result projections** for view and model, each holding only fields meant for its recipient and validated before serialization. Only the view's projection may carry the capability; the model may receive safe outcome text.

The view accepts a payload only if it matches the current sign-in, selection and request, so a response from an earlier one cannot restore media after the view cleared it. The player fetches media under the service's checks and the host's declared resource policy. A successful Play response means access was granted. The view shows **playing** only once audio actually starts.

User B requesting the same episode is refused at the entitlement check, before any capability or media fetch; the view clears prior media and explains the denial. The server rejects missing or expired credentials before protected work; a rejected host call does not tell the view which authentication check failed. The view reports an unconfirmed outcome and requires a fresh opener. If A's access expires or media fails, the view stops, clears the source and offers a deliberate retry, which is a new Play request with fresh checks. It never refreshes a capability from saved view state.

![Playback and failure flow: an explicit Play request passes identity, entitlement and host-routing checks before capability delivery; every fresh media acquisition is checked, and failures clear the player.](../../diagrams/authorized-playback-flow.png)

[Editable Mermaid](../../diagrams/authorized-playback-flow.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-flow.excalidraw) · [SVG](../../diagrams/authorized-playback-flow.svg)

## Responsibilities and interfaces

The application decides who is asking, whether they may hear the episode and whether a later request may receive more audio. It keeps its HTTP listener, identity provider, backend calls and subscription rules. saga a2ui supplies middleware for input validation, host delivery, failure mapping and view lifecycle. A2UI describes presentation and carries declared actions; choosing a renderer cannot choose a user or change authorization policy.

![The embedded Lit view requests Play through the host. The application authenticates the request and checks entitlement before issuing a media capability. saga a2ui delivers separate view and model results, and the media service checks the player's later requests for audio.](../../diagrams/authorized-playback-ownership.png)

[Editable Mermaid](../../diagrams/authorized-playback-ownership.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-ownership.excalidraw) · [SVG](../../diagrams/authorized-playback-ownership.svg)

**Identity.** Authentication checks a credential's issuer, audience, expiry and revocation, maps it to an account and produces an immutable verified principal for that request. Missing, invalid, expired or service-only identity is rejected before protected work. Play receives the principal separately from the validated episode ID, so concurrent operations never share a mutable "current user". Fixture authentication is local; each real host needs its supported authenticated path.

**Capability and media service.** Issuing a capability and accepting it are separate decisions. The same synthetic media service issues and revokes capabilities and, on every fresh acquisition including each byte-range request, checks current entitlement, expiry and the capability's recipient and episode scope. It also controls media origins, redirects, ranges and caching. A bearer URL protected only by a short lifetime establishes neither cross-user rejection nor immediate revocation, so the reference application also checks a signed proof of the view key and current entitlement. Each host must support that path. Refusing the next request is distinct from cancelling an in-flight response or recalling delivered audio.

**Projections.** The application constructs explicitly allowed fields for each projection, rejects unknown or oversized fields and validates before serialization. The selected MCP delivery path carries each to its recipient. `forModel` and `forView` name audiences, not existing saga a2ui APIs. Capabilities, raw credentials and private backend fields must stay out of all model-visible output (`content`, `structuredContent`, resource bodies, A2UI payloads, errors, ordinary logs). The static HTML resource holds no credential or per-user capability. Filtering after a response reaches the browser cannot undo disclosure to the model. View-only data is still visible to the host provider.

**View.** The view owns the player and its accessible pending, playing, paused, ended and recovery states. Request tracking keeps a stale result from replacing the current session or selection; it also invalidates old work, stops playback and disposes player resources. None of that grants entitlement. Lit and the scoped React player share the application controller; host communication stays at the MCP boundary.

**Action model.** This feature applies the shared [action model](../modules/action_binding.blueprint.md#lifetimes-and-owners) to one application and is not its source. Play's handler issues a protected request that the server authenticates and authorizes every time; no client check substitutes. Its client work produces a player, an acquired resource that can outlive the Play invocation. Pause and Resume are local actions on that player and cannot grant, extend or change authorization. Play uses one invocation with a work deadline through player start and token-scoped leases; the module's [decisions](../modules/action_binding.blueprint.md#open-decisions) record this mapping.

**Content policy.** Episode descriptions may contain links and image references. A separate [content safety design](content_safety_levels.blueprint.md) defines Standard and Strict: Strict keeps links inert, makes blocked-fragment visibility configurable and requires deliberate Show images consent. Play keeps its own authorization and media policy under either level. Neither level expands host permissions, and supplied content cannot change either policy.

**Prototype.** It stays in the working application and uses its pinned upstream MCP and MCP Apps interfaces. Operation names, schemas and routing are choices within these requirements. The [coding standards](../../CODING_STANDARDS.md) apply: explicit typed composition, runtime validation at input boundaries, one owner per rule. There is no saga a2ui-wide registry or string-keyed action bus. Public-answer connector and passive-renderer extraction may proceed under the sequencing amendment in [Status](#status); this does not waive playback acceptance. Synthetic accounts, content and subscription policy stay in the example.

## Failure and recovery

Recovery depends on evidence the view actually receives. The server rejects missing or expired identity before protected work. A host-call rejection is an unknown outcome in the view, not a sign-in diagnosis, and offers no blind retry. An entitlement denial explains "Playback denied: this account does not have access to this episode"; signing in again does not grant a subscription.

| Trigger | Result and recovery |
| --- | --- |
| Missing, malformed, expired or service-only identity | Rejected before protected work with the applicable HTTP authentication response. If the host rejects the call, the view clears media and reports an unconfirmed outcome; it does not infer sign-in failure or invite retry. |
| Forged account fields or invalid episode input | Arguments cannot choose the caller. Invalid business input is rejected before media acquisition. |
| Capability used by another recipient or for another episode | The media service refuses and returns no bytes. |
| Entitlement denied or revoked | A denied Play yields no capability; a denied acquisition yields no new bytes. The view clears the player and shows the denial. A later explicit request succeeds only if the server then permits it. |
| Recipient routing or media support absent | The view shows playback unsupported. No protected fetch occurs and no private URL goes to chat. |
| Capability expires or media fails to load | The view stops and clears the source. A recoverable failure offers an explicit retry through fresh authorization; no retry loop, no stale authorization. |
| Result invalid, oversized, late or for another request, selection or sign-in | The view clears invalid state and rejects stale success before mounting media. |
| Account or selection changes, authentication is lost, or the view is disposed | Pending results are invalidated, work cancelled where possible, playback stopped, source removed, resources and listeners released. New content needs a current authenticated result. |
| Deadline expires or work is cancelled | The operation stops waiting within its deadline and the view shows a safe error; cancellation returns a safe outcome and late results are suppressed. Cancelling underlying work is best effort; application code owns its cleanup. |

Protocol responses depend on where the failure occurs. A malformed MCP call or unknown tool is a JSON-RPC error. For a known Play operation, invalid arguments, entitlement denial, expected backend failures and missing host capabilities are safe tool failures with `isError: true`. Invalid output or projection data and unexpected contract faults become safe `isError` tool failures with no success payload or private diagnostics. The endpoint does not copy backend HTTP errors. Wire-level tests check these mappings against the pinned upstream schema and error behavior. After the response completes, a player failure changes view state rather than the server response.

If a host exposes no observable account-change signal, the view cannot clear immediately after an invisible switch; the server still checks every request, and verification records this limit per host. The [rejected account/session proposal](account_session_isolation.blueprint.md) proposed retained-state limits and focus or resume revalidation; those are not requirements here. The [request and view lifetimes](request_view_lifetimes.blueprint.md#status) design owns remaining teardown policy, STATE2 prerequisites and host gates.

Stopping the player reduces continued use but cannot revoke bytes already buffered or downloaded. Expiry and revocation prevent fresh acquisition; they cannot retract delivered bytes or erase a host provider's copy. Abandoning the client's wait does not show the host forwarded cancellation or the server stopped, and cannot undo an issued capability.

## Verification outcomes

Local integration tests exercise the real listener, a controlled synthetic media service and the built Lit view together.

| Test condition | Observable result |
| --- | --- |
| Entitled user A presses Play for `ep-1` | One accepted action passes through listener, Play operation and validated view projection. The capability is scoped to episode and recipient. The player reports playing only after playback begins. |
| User B requests A's episode, or credentials are missing, forged, expired or service-only | Refused before protected work: no capability disclosure, no protected backend or media fetch. |
| Modified action adds an account ID, or repeats an earlier valid request | Validation rejects invalid arguments; every valid replay rechecks permission. |
| B reuses A's capability, or a capability is used for another episode | No protected bytes. |
| Entitlement revoked or capability expired before a later acquisition, including a range request | New bytes refused, including with an already-issued capability. Explicit retry repeats authorization and obtains access or shows denial. |
| Backend output or errors contain a capability or recognizable private test value | Absent from model-visible responses, resource bodies, errors and ordinary logs. The view receives only permitted, validated fields. |
| Host lacks recipient separation, app-only actions or media support | Unsupported result; no private field in a model-visible channel; no protected fetch. |
| Redirect to an undeclared origin, shared cache, valid and invalid ranges | Disallowed destinations rejected, no cross-user cache disclosure, ranges enforce the same checks. |
| Double activation, selection or account change, or disposal while pending | At most one request and one player; old audio stops and clears; late success cannot restore it. |
| Identity, authorization, handler or projection work stalls | Stops waiting within the deadline with a safe error; cancellation notice and cleanup occur; late and duplicate results suppressed. Tests cover the whole asynchronous pipeline and the JSON and SSE response lifecycle. |
| Standard and Strict render the same supplied content | Follow the [content safety design](content_safety_levels.blueprint.md). Source reveal grants no network permission, Strict links stay inert, and authored Play stays available under its own authorization and media policy. |
| Keyboard user meets denial, timeout or expiry at narrow width or high zoom | Controls reachable, status announced, sensible focus, old media not retained, using the built view and the host's media controls. |

ChatGPT web and Claude web each need an independent run of the authenticated synthetic workflow with the real built resource: invocation and rendering, model/view separation, allowed and denied Play, expiry, account and selection changes while pending, both content-policy levels and audible foreground playback. Missing, expired or service-only identity and forged arguments produce no protected disclosure or fetch. Each host's run establishes its own acceptance.

Each host record states date, source revision, built resource and hash, package and upstream versions, host, browser and device, and authentication setup; expected and observed results separately; credentials, capability URLs and personal details redacted. Unchanged browsing-setup evidence can be reused. Playback is confirmed only by audible foreground audio in that host. A required path that fails or cannot be exercised blocks that host's acceptance.

## Implementation sequence

[PLAY1](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) extends the authenticated example (built on [verified browsing](https://github.com/MachineWisdomAI/saga-a2ui/issues/8)) with one episode, an app-only Play operation, separate model and view results and one foreground player; recipient binding and routing must work first. [PLAY2](https://github.com/MachineWisdomAI/saga-a2ui/issues/11) adds expiry, revocation of fresh acquisition, rejection of recipient and episode misuse, reauthorized recovery, and the example service's handling of origins, redirects, ranges and caches; it is not a general media proxy.

The complete flow integrates [STATE1](https://github.com/MachineWisdomAI/saga-a2ui/issues/12) and [STATE2](https://github.com/MachineWisdomAI/saga-a2ui/issues/13) for [request and view lifetimes](request_view_lifetimes.blueprint.md), and [POL1](https://github.com/MachineWisdomAI/saga-a2ui/issues/5) and [POL2](https://github.com/MachineWisdomAI/saga-a2ui/issues/7) for Standard and Strict content. Acceptance in ChatGPT web and Claude web needs that work plus each host's browsing gate. The Captain performs those runs. The sequencing amendment in [Status](#status) permits public-answer connector and passive-renderer work before remaining lifetime acceptance; playback and host gates remain. The tickets keep implementation detail and dependency order.

## Open decisions

**Settled in the reference application** (see [How authorized playback works](../../docs/authorized-playback.md) and the PLAY1 and PLAY2 sections of the development reference):

1. **Recipient binding.** The capability is bound to the account, the episode and the RFC 7638 thumbprint of the view's public key. Each request, including each byte range, carries a new proof signed with the view's non-extractable private key.
2. **Expiry and revocation.** A capability lasts 60 seconds from issue on the service's clock. The media service asks entitlement again on every acquisition; a denial refuses the request and drops the capability. Fresh bytes are refused after expiry or revocation, and bytes already buffered cannot be retracted.
3. **Wire mapping.** `play_episode` declares `visibility: ['app']`. The view sends its public key in the call's `_meta` under `saga-a2ui/recipient-key`; the result's `content` holds only a fixed sentence and the capability goes under `_meta['saga-a2ui/playback']`. Host acceptance for this mapping is recorded for CORE2 in the [connector Status](reusable_mcp_connector.blueprint.md#status); a mapping the reusable interface can promise beyond Play is that Blueprint's open decision.
4. **Starting playback after asynchronous authorization.** The press calls `player.prepare()` synchronously inside the user's click, before any network work. The view shows Playing only after the audio clock advances.
5. **Play's mapping onto the action module** (invocations, two bounds) and per-attempt leases: Play is one invocation under a single work deadline with token-scoped leases (mapping A, CORE2). See the [action binding decisions](../modules/action_binding.blueprint.md#open-decisions).

**Still open.** Audible foreground playback has not been shown in ChatGPT web or Claude web; the recorded host runs used loopback media (see Acceptance limits in [Status](#status)). Whether a given host preserves the user activation through asynchronous authorization or needs a second explicit Play gesture is therefore not established. If a required host cannot carry an enforceable recipient binding or the separate model and view results, that is a feasibility gap, and autoplay or a public URL cannot replace user-initiated, authorized playback.

## References

- [Blueprint conventions](../README.md), [feature format](README.md), [action binding](../modules/action_binding.blueprint.md).
- [Coding standards](../../CODING_STANDARDS.md), [package ownership](../../packages/README.md), [contributor review](../../CONTRIBUTING.md#review).
- [Listener](../../apps/lit-host/src/mcp/listener.ts), [request authentication](../../apps/lit-host/src/mcp/request-auth.ts), [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts), [subscriptions view](../../apps/lit-host/src/mcp/subscriptions-view.ts), [bridge lifecycle](../../apps/lit-host/src/mcp/view.ts), inspected at SDK revision `53ed8328f4f5c06dd1772e48b098fdcf3d4bae79`.
- [PLAY1](https://github.com/MachineWisdomAI/saga-a2ui/issues/10), [PLAY2](https://github.com/MachineWisdomAI/saga-a2ui/issues/11).
- [MCP tool errors](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling), [MCP Apps documentation](https://apps.extensions.modelcontextprotocol.io/api/).
