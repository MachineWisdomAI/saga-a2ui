---
feature_name: authorized_playback
status: draft
module_blueprints: []
dependencies: []
date_added: 2026-10-15
---

# Authorized playback

Draft awaiting human design review.

## Problem and current behavior

A subscriber should be able to press Play on an entitled episode and hear it inside the assistant. The server must decide whether the signed-in user can acquire that episode now. A visible Play button, an earlier subscription result, and possession of an episode ID do not grant access.

E04 adds this capability to the synthetic subscription example. User A has access to the selected episode; user B does not. The proposed example exercises real authorization and protected media delivery with fictional accounts and content. It does not integrate with Patreon or establish production identity, mobile, autoplay, voice-mode, or background playback support.

At inspected SDK revision `53ed8328f4f5c06dd1772e48b098fdcf3d4bae79`, the application has a public episode-description endpoint and a separate authenticated subscriptions endpoint. The [listener](../../apps/lit-host/src/mcp/listener.ts) authenticates each protected request, snapshots its verified context, and passes that context through the upstream MCP transport. [Request authentication](../../apps/lit-host/src/mcp/request-auth.ts) requires an unexpired credential with the subscriptions scope and account/sign-in claims. That browse scope is not a playback permission.

The [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts) explicitly constructs and validates a bounded result, including an opaque sign-in label. It returns that result in `structuredContent`; this is not an established view-only channel for a media capability. The [subscriptions view](../../apps/lit-host/src/mcp/subscriptions-view.ts) correlates its own reads, clears on invalid or changed-session results, and retires late reads. These are useful starting points, but there is no Play operation, entitlement service, protected-media endpoint, or player in this revision. Neither authenticated browsing nor local rendering establishes protected playback in either required host.

No related feature or module Blueprint exists yet. The empty frontmatter lists reflect that absence, not freedom from prerequisites. This feature describes the affected responsibilities without inventing a package or claiming an implemented playback contract.

## Proposed behavior

Consider user A selecting the synthetic episode `ep-1` and pressing its authored Play control. The episode ID identifies content; the **verified principal** identifies the caller, as established by the application's authentication system. An **entitlement** is the application's current decision that this principal may access that episode. A **media capability** is a short-lived authorization to acquire only the scoped media under the service's recipient and delivery rules.

1. The Lit view enters a pending state and requests the declared app-only Play operation with only `{ episodeId: "ep-1" }`. The control remains keyboard reachable while repeat activation is suppressed. The view has at most one active playback request and one foreground player.
2. The application verifies the request's identity independently of those arguments. The Play path validates its minimal business input and checks user A's current entitlement. Replaying an earlier action repeats these checks. A supplied account ID, session label, or subscription status cannot select a principal or confer permission.
3. Before protected media acquisition, the delivery path establishes that the host supports the required app action and recipient separation. If it cannot, the operation returns a safe unsupported result. It must not move private output into a model-visible field to make the feature work.
4. After authorization, the synthetic media service issues a short-lived capability limited to this episode and recipient. The application constructs explicit model and view projections and validates them before serialization. Only the view projection may carry the capability; the model may receive safe outcome text. The exact capability format and recipient-binding mechanism remain open decisions below.
5. The view accepts only a valid result for its current session, selection, and request. The player then acquires media under the service's checks and declared host resource policy. A successful tool response means access was granted; the view shows **playing** only when playback actually starts. The supported outcome is audible, user-initiated foreground playback.
6. If access expires or loading fails, the view stops and clears the source and offers a deliberate retry where recovery is possible. Retry starts a fresh Play request with fresh identity and entitlement checks. It never refreshes a capability from saved view state.

![Playback and failure flow: an explicit Play request passes identity, entitlement and host-routing checks before capability delivery; every fresh media acquisition is checked, and failures clear the player.](../../diagrams/authorized-playback-flow.png)

[Editable Mermaid](../../diagrams/authorized-playback-flow.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-flow.excalidraw) · [SVG](../../diagrams/authorized-playback-flow.svg)

## Responsibilities and interfaces

SAGA supplies reusable delivery, validation, and lifecycle behavior around an application's operations. The application retains the HTTP listener, identity provider, backend calls, entitlement policy, and authoritative effects. A2UI describes presentation and carries declared actions; it is not an authorization system. Renderer selection must not select a user or policy.

![Ownership and data flow: the host mediates the view's request and recipient delivery; application authentication and entitlement govern the operation and media service; only approved safe output reaches the model.](../../diagrams/authorized-playback-ownership.png)

[Editable Mermaid](../../diagrams/authorized-playback-ownership.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-ownership.excalidraw) · [SVG](../../diagrams/authorized-playback-ownership.svg)

| Responsibility | Input and result | Authority and placement |
| --- | --- | --- |
| Application authentication | Request credential → immutable verified principal, or rejection | Owns issuer/audience, expiry, revocation and account mapping. Development fixture authentication remains explicitly local; actual hosts need their supported authenticated path. |
| Application Play operation | Validated episode ID plus separately verified principal → entitlement decision and authorized acquisition | Owns current subscription rules and backend access. Rejects missing, invalid, expired or service-only identity before protected work. No shared mutable current user. |
| Synthetic media service | Scoped capability plus the chosen recipient proof → permitted bytes or refusal | Owns issuance, expiry, recipient/episode checks, revocation, origins, redirects, range handling and cache behavior. Synthetic accounts and media remain example code. |
| SAGA MCP delivery behavior | Declared operation and explicit projections → validated recipient-specific response | Owns protocol delivery and failure mapping. App-only exposure is host-mediated visibility, not proof of authorization. Initial implementation stays in the working app; later extraction follows observed contracts. |
| View lifecycle and Lit player | Validated current playback result → one player and accessible state | Owns pending/playing/paused/ended and recovery presentation, invalidation, stopping and disposal. It cannot grant entitlement. Framework rendering stays in Lit; host delivery stays at the MCP boundary. |
| Host | App action, resource and response → embedded view, permitted media path and model context | Must preserve the selected recipient mapping and permit the declared resource behavior. View-only data is still visible to the host provider. |

`forModel` and `forView` name the intended projection audiences. They are design vocabulary, not existing exported SAGA APIs. Construct new allowed fields rather than spreading backend objects, reject unknown or oversized projected fields, and validate the view payload again on arrival. Capabilities, raw credentials and private backend fields must stay out of model-visible `content`, `structuredContent`, resource bodies, A2UI payloads directed to the model, errors and ordinary logs. A static HTML resource contains no user credentials or per-user capability. Filtering after arrival in the browser is too late to prevent disclosure.

The initial Play path should use the pinned upstream MCP/MCP Apps interfaces already used by the application. Exact operation naming, input/output schemas and routing remain implementation choices to resolve within these requirements, rather than illustrative TypeScript signatures promoted into a contract. Follow the [coding standards](../../CODING_STANDARDS.md): explicit typed composition, runtime validation at input boundaries, and a single owner for each rule. Do not introduce a SAGA-wide registry or string-keyed action bus. Create reusable packages only with working consumers after the integrated prototype has the required evidence.

The capability has two checks to survive: permission to issue it, and permission to use it for bytes. Every fresh media acquisition, including a later range request, must enforce current entitlement, expiry and recipient/episode scope. A time-limited bearer URL alone does not demonstrate cross-user rejection or immediate revocation of new acquisition. The service therefore needs an enforceable recipient binding and a current revocation decision; those mechanisms must be selected and exercised in the host-compatible path. Cancellation of an in-flight response and the amount of data already handed to the browser are distinct from refusing a subsequent request.

Content policy is a separate prerequisite. Standard permits only validated HTTPS content links through supported host callbacks and content images from a trusted exact-host allowlist, empty by default. Strict keeps those links and image references readable but inert. The authored Play control retains its own declared media policy and server authorization under both levels. Neither level can expand host permissions, and response content cannot change either policy.

## Failure and recovery

A denied entitlement produces a safe explanation such as “Playback denied: this account does not have access to this episode.” It does not suggest that signing in again grants a subscription. Missing or expired identity instead offers the supported sign-in recovery. Both outcomes stop and clear prior media, and neither starts a protected fetch.

| Trigger | Observable result and recovery |
| --- | --- |
| Missing, malformed, expired or service-only identity | Reject before protected work; preserve applicable HTTP authentication status and challenge. Clear protected state and media; recover through supported sign-in. |
| Forged account fields, invalid episode input or wrong-recipient capability use | Arguments never choose identity. Reject invalid business input before acquisition; media service rejects a capability used by another recipient or for another episode, returning no protected bytes. |
| Current entitlement denied or revoked | No capability on denied Play and no new bytes on denied acquisition. Clear the player and show denial; a later explicit request succeeds only if the server now allows it. |
| Required recipient routing or media support absent | Safe unsupported state, no protected fetch or private-URL fallback in chat. A different host is not acceptance of this one. |
| Capability expires or media load fails | Stop and clear source; offer explicit reauthorized retry for a recoverable failure. Do not loop retries, reuse stale authorization or promise automatic continuation. |
| Invalid, oversized, late or mismatched result | Clear invalid current state and reject stale success before mounting media. Retired work cannot restore an older episode or account. |
| Account/selection change, authentication loss or disposal | Invalidate pending results, cancel where possible, stop playback, remove the source, and release player resources and listeners. New content requires a current authenticated result. |
| Deadline or cancellation | Return the appropriate bounded safe outcome and suppress late emission. Cancellation is best effort; application code owns cleanup of underlying work. |

Protocol errors, business failures and browser failures remain distinguishable. Malformed MCP calls and unknown tools use JSON-RPC errors. Invalid arguments to a known Play operation, entitlement denial, expected backend failures and unsupported required capabilities use safe tool failures (`isError: true`). Invalid output/projection and unexpected server contract faults require sanitized internal errors, without success data. Backend HTTP errors must not be copied blindly to the MCP endpoint. A player failure after a response has completed is a view state, not a replacement server response. The selected upstream output-schema and error paths need wire verification; the browse server's broad tool-failure handling does not establish these Play semantics.

Account/session isolation work supplies the complete generation, expiry and focus/resume rules. When a host exposes no observable account-change signal, immediate clearing on an invisible switch cannot be promised. Revalidation before restoring private content on focus/resume and bounded retained state limit that exposure; the actual host's limit must be recorded. Server checks still apply to every request.

Stopping and clearing the player reduces continued use of held media. It cannot revoke bytes already buffered or downloaded. Expiry and revocation claims apply to fresh acquisition at the service; they are not a promise to retract delivered bytes or erase a host provider's copy.

## Verification outcomes

The following are required outcomes, not results obtained by writing this Blueprint. Use the real listener, controlled synthetic service and built Lit view for local integration. Separate those results from actual-host acceptance.

| Condition or input | Required observable result | Boundary exercised |
| --- | --- | --- |
| Entitled A presses Play for `ep-1` | One accepted action yields a scoped capability and protected audio; player enters playing only after playback begins | Listener → operation → projection → media service → built view |
| B requests A's episode; credentials are missing, forged, expired or service-only | Safe refusal, no capability disclosure and zero protected backend/media fetches | Authentication and current entitlement before protected work |
| Modified action adds an account ID or repeats an earlier valid request | No impersonation; invalid input is refused and every valid replay rechecks current permission | Runtime input validation and request-scoped authority |
| Capability is reused by B or for a different episode | Service returns no protected bytes | Recipient and episode enforcement at media acquisition |
| Entitlement is revoked or capability expires before a subsequent acquisition/range | New bytes are refused; explicit retry repeats authorization and either obtains fresh access or shows denial | Media service and recovery, including already-issued capabilities |
| Backend output/errors contain canary private fields or a capability | No canary or capability in model-visible paths or ordinary logs; view sees only its permitted validated projection | Pre-serialization projection, wire mapping, resource and error paths |
| Host lacks required recipient separation or app-only/media support | Unsupported state without private-field promotion or protected fetch | Negotiated host capability and fail-closed delivery |
| Redirect targets an undeclared origin; shared cache is used; valid/invalid range requests arrive | Reject disallowed destinations; no cross-user cache disclosure; supported ranges obey identical authorization and expiry checks | Actual service responses, headers and browser network behavior |
| Double activation, selection change, account change or disposal occurs with work pending | At most one player/request per view; old audio stops, source clears and late success cannot restore it | Player lifecycle plus account/session-isolation integration |
| Identity, authorization, handler or projection stalls | Finite safe outcome, cancellation notification and cleanup, no late result or duplicate operation | Complete asynchronous pipeline; supported JSON/SSE lifecycle as established by state work |
| Standard and Strict render the same supplied content | Standard obeys exact-host/callback policy; Strict has zero content-image fetches or link activation; authorized authored Play remains available where supported | Trusted per-instance policy, resource/CSP rules and browser effects |
| Keyboard activation, denial, timeout and expired playback at narrow width/zoom | Reachable recovery controls, announced status and sensible focus; no old media retained | Built view and host media-control accessibility |

Two independent actual-host gates remain required: **ChatGPT web** and **Claude web**. Each must exercise the authenticated synthetic workflow with the actual built resource: invocation, rendering, recipient separation, allowed and denied actions, media expiration, pending account/selection changes, both content levels, and audible foreground playback. Missing/expired/service-only identity and forged arguments must produce no protected disclosure or fetch. Reuse unchanged browsing setup evidence, but record the changed source and resource identities.

Each host receipt needs the date, source revision, resource identity/hash, relevant package/upstream versions, host/browser/device, authentication setup, and separate expected/observed results. Redact credentials, capability URLs and personal account details. Local CI, a diagram, a public MP3, tool discovery, a prior application's receipt or a model's assertion that audio played cannot replace these observations. If a required path fails or is unavailable, the gate remains open with the blocker, owner and next bounded action. No E04 actual-host pass is claimed here.

## Implementation sequence

First, [PLAY1](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) extends the authenticated application with one episode, an app-only Play operation, explicit recipient projection and one foreground player. It builds on [verified browsing](https://github.com/MachineWisdomAI/saga-a2ui/issues/8) and the existing prerequisite acceptance gate. Resolve recipient binding and routing before claiming protected playback; keep synthetic policy in the example.

Next, [PLAY2](https://github.com/MachineWisdomAI/saga-a2ui/issues/11) establishes expiry, revocation of fresh acquisition, recipient/episode misuse rejection, origin/redirect/range/cache behavior and reauthorized recovery using that same service and view. It does not create a general media proxy product.

Then integrate [STATE1](https://github.com/MachineWisdomAI/saga-a2ui/issues/12) and [STATE2](https://github.com/MachineWisdomAI/saga-a2ui/issues/13) for account/selection races and bounded work, and [POL1](https://github.com/MachineWisdomAI/saga-a2ui/issues/5) and [POL2](https://github.com/MachineWisdomAI/saga-a2ui/issues/7) for Standard/Strict behavior. These retain their own responsibilities and dependency order. The host gates require the completed media, state and content-policy leaves plus the corresponding host's browsing gate; PLAY1 does not acquire those later prerequisites merely because the complete flow is described here.

Finally, the Captain verifies the complete prototype independently in ChatGPT web and Claude web. Required host failures remain blockers. Reusable SDK extraction follows the integrated evidence rather than preceding it. Existing tickets remain the implementation instructions; this draft does not change them, their edges, or dispatch authority.

## Open decisions

1. **How does the media service bind acquisition to the recipient?** Compare a recipient-authenticated media request with a capability bound to a separate verifiable session or proof. Establish what the actual embedded player can send. A bearer URL whose only protection is secrecy and a short lifetime does not resolve the cross-user case. If a required host cannot carry an enforceable binding, report that feasibility gap rather than weaken the requirement.
2. **What exactly expires or is revoked, and when?** Select the capability lifetime, current-entitlement/revocation lookup, treatment of an in-flight response, supported range behavior and explicit reacquisition rule. Specify cache headers, allowed origins and redirect handling together. Demonstrate refusal of fresh bytes after expiry/revocation while stating the buffered-byte limit.
3. **Which wire mapping preserves the two recipients?** Select the pinned MCP Apps app-only declaration and result channel, validate separate model/view payloads and safe errors, and test both real hosts. The current browse `structuredContent` result is not an answer to this question. No generic projection API is promised before that slice works.
4. **How does foreground playback resume after asynchronous authorization?** Establish whether the chosen host/browser preserves user activation or needs a second explicit play gesture, and how supported media failures are distinguished from expiry. Keep pending and recovery controls accessible; do not replace the required interaction with autoplay or a public URL.

The mechanism choices above need resolution during design review/refinement. Missing implementation and actual-host receipts are separate evidence gaps. The existing tickets cover the accepted E04 outcomes; they do not yet select the capability or delivery mechanism. Their coverage and links can be reconciled after explicit human design approval without recreating the backlog.

## References

- [Blueprint conventions](../README.md) and [feature format](README.md).
- [Coding standards](../../CODING_STANDARDS.md), [planned package ownership](../../packages/README.md), and [contributor review](../../CONTRIBUTING.md#review).
- [Application request authentication](../../apps/lit-host/src/mcp/request-auth.ts), [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts), [subscriptions view](../../apps/lit-host/src/mcp/subscriptions-view.ts), and [bridge lifecycle](../../apps/lit-host/src/mcp/view.ts), inspected at the revision above.
- [PLAY1: fresh entitlement and foreground playback](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) and [PLAY2: protected-media delivery constraints](https://github.com/MachineWisdomAI/saga-a2ui/issues/11).
- [MCP tool errors](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling) and [MCP Apps upstream documentation](https://apps.extensions.modelcontextprotocol.io/api/). These define protocol mechanisms; the application and host checks above remain necessary.
