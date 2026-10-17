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

An example podcast subscription app provides public episode descriptions and lets signed-in listeners browse their subscriptions. This design adds playback inside an assistant: a listener presses Play and hears an episode their account can access. The example uses fictional accounts and content. User A can listen to the selected episode; user B cannot.

The existing sign-in check establishes whose subscriptions to show, but permission to browse does not establish current permission to play an episode. Playback needs a fresh server decision on every Play request. A visible button, a previous subscription result or possession of an episode ID cannot grant access.

The proposed playback flow applies server authorization and protected media delivery to its fictional accounts and content. Playback is user initiated and stays in the foreground. Patreon integration, production identity, mobile, autoplay, voice-mode and background playback are outside this feature's scope.

## Proposed behavior

User A selects an episode with ID `ep-1` and presses Play in the app's embedded interface, built with Lit. The assistant host runs this view and mediates its requests to the application. The view shows that the request is pending and sends only `{ episodeId: "ep-1" }` to the declared app-only Play operation. Here, **app-only** means the operation is exposed to the embedded view and excluded from the model’s available tools. The server still authenticates and authorizes every request. The control remains keyboard reachable while repeated activation is suppressed, and the view allows at most one active playback request and one foreground player.

The application validates the episode ID and authenticates the request independently of its arguments. This establishes a **verified principal**: the identity of the caller, confirmed by the application's authentication system. The Play operation then checks that principal's current **entitlement**, meaning permission to access the selected episode. An account ID, sign-in label or subscription status supplied in the action cannot select the caller or grant permission. Replaying an earlier Play request repeats both authentication and the entitlement check.

Before protected media acquisition, the delivery path checks that the host supports the app action and can deliver private playback data to the view separately from the model's response. If the host lacks either capability, Play returns a safe unsupported result without fetching protected media. Private playback data cannot be placed in a model-visible field as a fallback.

Once A is authorized, the synthetic media service issues a **media capability**: short-lived authorization to fetch the selected episode for the permitted recipient. The capability's format and the mechanism that prevents another user from using it remain open decisions. The application prepares separate results for the view and the model. These are **result projections**, each containing only the fields intended for its recipient, and both are validated before serialization. Only the view's projection may contain the media capability; the model may receive safe outcome text.

The view validates the returned payload and accepts it only if it matches the current sign-in, selected episode and playback request. A response belonging to an earlier sign-in, selection or request cannot restore media after the view has cleared it. The player then fetches media under the service's authorization checks and the host's declared resource policy. A successful Play response means that access was granted; the view shows **playing** only after audio actually starts. The intended outcome is audible foreground playback initiated by the user.

If B requests the same episode, the entitlement check refuses access before issuing a capability or fetching protected media. The view stops and clears any prior media and explains that this account does not have access. Missing or expired sign-in instead leads to sign-in recovery.

If A's access expires or media loading fails, the view stops and clears the source, then offers a deliberate retry where recovery is possible. Retry starts a new Play request with fresh identity and entitlement checks; it never refreshes a capability from saved view state.

![Playback and failure flow: an explicit Play request passes identity, entitlement and host-routing checks before capability delivery; every fresh media acquisition is checked, and failures clear the player.](../../diagrams/authorized-playback-flow.png)

[Editable Mermaid](../../diagrams/authorized-playback-flow.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-flow.excalidraw) · [SVG](../../diagrams/authorized-playback-flow.svg)

## Responsibilities and interfaces

The application owns the decisions that permit playback: who is making the request, whether that person may hear the episode, and whether a later request may receive more audio. It retains its HTTP listener, identity provider, backend calls, subscription rules and any resulting changes to backend state. SAGA supplies middleware around the application's operations for input validation, host delivery, failure mapping and view lifecycle. A2UI describes presentation and carries declared actions; choosing a renderer cannot choose a user or change authorization policy.

![The embedded Lit view requests Play through the host. The application authenticates the request and checks entitlement before issuing a media capability. SAGA delivers separate view and model results, and the media service checks the player's later requests for audio.](../../diagrams/authorized-playback-ownership.png)

[Editable Mermaid](../../diagrams/authorized-playback-ownership.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-ownership.excalidraw) · [SVG](../../diagrams/authorized-playback-ownership.svg)

Application authentication checks a request credential's issuer, audience, expiry and revocation, then maps it to an account. It produces an immutable verified principal for that request. Missing, invalid, expired or service-only identity is rejected before protected work. The Play operation receives the principal separately from its validated episode ID and applies the application's current subscription rules before authorizing acquisition. This request-scoped identity prevents concurrent operations from relying on a shared, mutable “current user.” Development fixture authentication remains local; each actual host needs its supported authenticated path.

Issuing a capability and accepting it for media are separate authorization decisions. The synthetic media service checks current entitlement, expiry and the capability's recipient and episode scope on every fresh acquisition, including a later request for a byte range. The same service issues and revokes capabilities. It controls which media origins, redirects and byte ranges it permits and how responses may be cached.

Those acquisition checks require a way to bind a media request to its authorized recipient and make a current revocation decision. A bearer URL protected only by a short lifetime does not establish either cross-user rejection or immediate revocation of new acquisition. The capability format, recipient binding and revocation lookup remain open choices to resolve in a path the host supports. Refusing the next request is separate from cancelling an in-flight response or dealing with audio already delivered to the browser.

For both result projections, the application constructs explicitly allowed fields, rejects unknown or oversized fields, and validates the result before serialization. The selected Model Context Protocol (MCP) delivery path carries each projection to its intended recipient. The labels `forModel` and `forView` describe those audiences; they do not name existing SAGA APIs.

Capabilities, raw credentials and private backend fields must stay out of all model-visible output, including `content`, `structuredContent`, resource bodies and A2UI payloads, as well as errors and ordinary logs. The static HTML resource contains no user credentials or per-user capability. Filtering a response after it reaches the browser cannot undo disclosure to the model. The host must preserve the selected recipient mapping and permit the declared media and resource behavior. Data reserved for the view is still visible to the host provider.

The Lit view owns the player and its accessible pending, playing, paused, ended and recovery states. Its input validation and request tracking keep a stale result from replacing the current session or selection. It also invalidates old work, stops playback and disposes of player resources. These lifecycle decisions cannot grant entitlement. Rendering stays in Lit, while host communication stays at the MCP boundary.

An episode description may include links and image references supplied as content. A separate content policy governs what those references can activate or fetch; the application's authored Play control invokes a declared operation with its own media policy and server authorization. The proposed [content safety design](content_safety_levels.blueprint.md) defines Standard and Strict. Strict keeps links inert, makes blocked-fragment visibility configurable and requires deliberate Show images consent before loading otherwise-permitted images. Play retains its own authorization and media policy under either level. Neither level can expand host permissions, and supplied content cannot change either policy.

The playback prototype stays in the working application and should use its pinned upstream MCP/MCP Apps interfaces. Operation names, input/output schemas and routing remain choices within these requirements. The [coding standards](../../CODING_STANDARDS.md) call for explicit typed composition, runtime validation at input boundaries and one owner for each rule; this design introduces no SAGA-wide registry or string-keyed action bus. Reusable packages are extracted only after the integrated prototype has the required evidence and working consumers. Synthetic accounts, content and subscription policy remain in the example.

## Failure and recovery

Recovery depends on which check failed. Missing or expired identity leads to the supported sign-in flow. An entitlement denial instead explains, “Playback denied: this account does not have access to this episode.” Signing in again does not grant a subscription.

| Trigger | Result and recovery |
| --- | --- |
| Missing, malformed, expired or service-only identity | The application rejects the request before protected work and preserves the applicable HTTP authentication status and challenge. The view clears protected state and media and offers supported sign-in. |
| Forged account fields or invalid episode input | Arguments cannot choose the caller's identity. The application rejects invalid business input before acquiring media. |
| A capability is used by another recipient or for another episode | The media service refuses the acquisition and returns no protected bytes. |
| Current entitlement is denied or revoked | A denied Play request yields no capability; a denied acquisition yields no new bytes. The view clears the player and shows the denial. A later explicit request succeeds only if the server then permits it. |
| Required recipient routing or media support is absent | The view shows that playback is unsupported. No protected fetch occurs, and no private URL is placed in chat as a fallback. |
| A capability expires or media fails to load | The view stops playback and clears the source. A recoverable failure offers an explicit retry through fresh authorization; it does not start a retry loop or reuse stale authorization. |
| A result is invalid, oversized, late or for a different request, selection or sign-in | The view clears invalid current state and rejects stale success before mounting media. Retired work cannot restore an older episode or account. |
| The account or selection changes, authentication is lost, or the view is disposed | The view invalidates pending results, cancels where possible, stops playback, removes the source and releases player resources and listeners. New content requires a current authenticated result. |
| A deadline expires or work is cancelled | On timeout, the operation stops waiting within its configured deadline and the view shows a safe error. Cancellation returns the appropriate safe outcome, and late results are suppressed. Cancellation of underlying work is best effort; application code owns its cleanup. |

Failures use different protocol responses according to where they occur. A malformed MCP call or an unknown tool produces a JSON-RPC error. For a known Play operation, invalid arguments, entitlement denial, expected backend failures and missing required host capabilities produce a safe tool failure with `isError: true`. Invalid output or projection data and unexpected server contract faults produce sanitized internal errors without success data. The MCP endpoint does not copy backend HTTP errors blindly.

Wire-level tests check these mappings against the selected upstream output-schema and error behavior. Once the response has completed, a browser player failure changes the view's state rather than replacing the server response.

Account/session-isolation work defines how request generations retire older results, how long private state may be retained, and when focus or resume triggers revalidation. If a host exposes no observable account-change signal, the view cannot clear immediately after an invisible switch. It revalidates before restoring private content on focus or resume and limits retained state. Verification records this limit for each actual host. The server still checks every request.

Status on 2026-10-16: the generic retention and focus/resume behavior above belongs to the [rejected account/session proposal](account_session_isolation.blueprint.md). STATE1/STATE2 await design reconciliation. Existing authentication, session invalidation, cancellation and cleanup obligations, and prerequisite edges, remain unchanged.

Stopping and clearing the player reduces continued use of held media, but cannot revoke bytes already buffered or downloaded. Expiry and revocation prevent fresh acquisition at the service; they cannot retract delivered bytes or erase a host provider's copy.

## Verification outcomes

Local integration tests will exercise the real listener, a controlled synthetic media service and the built Lit view together. The checks follow an action through authorization and delivery, then observe the player and the service's handling of later media requests.

| Test condition | Observable result |
| --- | --- |
| Entitled user A presses Play for `ep-1` | One accepted action passes through the listener, Play operation and validated view projection to acquire protected audio. The capability is scoped to the episode and recipient. The player reports playing only after playback begins. |
| User B requests A's episode, or credentials are missing, forged, expired or service-only | Authentication or current-entitlement checks refuse the request before protected work. There is no capability disclosure and no protected backend or media fetch. |
| A modified action adds an account ID or repeats an earlier valid request | Runtime input validation rejects invalid arguments. Arguments cannot impersonate another account, and every valid replay rechecks current permission. |
| User B reuses A's capability, or a capability is used for another episode | The media service returns no protected bytes. |
| Entitlement is revoked or a capability expires before a later acquisition, including a range request | The media service refuses new bytes, including use of an already-issued capability. Explicit retry repeats authorization and either obtains fresh access or shows denial. |
| Backend output or errors contain a capability or a recognizable private test value | Neither appears in serialized model-visible responses, resource bodies or errors, or in ordinary logs. The view receives only its permitted, validated fields. |
| A host lacks required recipient separation, app-only actions or media support | The operation returns an unsupported result without promoting private fields into a model-visible channel or starting a protected fetch. |
| A redirect targets an undeclared origin, a shared cache is used, or valid and invalid range requests arrive | Service responses, headers and browser network activity show rejection of disallowed destinations and no cross-user cache disclosure. Supported ranges enforce the same authorization and expiry checks as other acquisitions. |
| Double activation, selection change, account change or disposal occurs while work is pending | The built view has at most one active playback request and one player. Old audio stops, its source clears, and late success cannot restore it. |
| Identity verification, authorization, the handler or projection work stalls | The operation stops waiting within its configured deadline and returns a safe error for the view to show. Cancellation notification and cleanup occur; late results and duplicate operations are suppressed. Tests exercise the complete asynchronous pipeline and the supported JSON response and Server-Sent Events (SSE) lifecycle established by the state work. |
| Standard and Strict render the same supplied content | Exercise the [content safety design’s](content_safety_levels.blueprint.md) presentation, destination restrictions and Strict image-consent behavior. Source reveal grants no network permission and Strict links stay inert. Authorized authored Play remains available under its separate authorization, media policy and host resource restrictions. |
| A keyboard user encounters denial, timeout or expired playback at narrow width or increased zoom | Playback and recovery controls remain reachable, status is announced, focus is sensible, and old media is not retained. Tests use the built view and the host's media controls. |

ChatGPT web and Claude web each require an independent run of the authenticated synthetic workflow with the actual built resource. Each run covers invocation and rendering, separation of model and view results, allowed and denied Play actions, media expiry, account and selection changes while work is pending, both content-policy levels, and audible foreground playback. Missing, expired or service-only identity and forged arguments produce no protected disclosure or fetch. Each host's run establishes its own acceptance result.

The host record identifies the date, source revision, built resource and hash, relevant package and upstream versions, host, browser and device, and authentication setup. It gives expected and observed results separately, with credentials, capability URLs and personal account details redacted. Unchanged browsing-setup evidence can be reused; changed source and resource identities are recorded. Playback is confirmed by observing audible foreground audio in the authenticated workflow in that host. A required path that fails or cannot be exercised blocks that host's acceptance.

## Implementation sequence

[PLAY1](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) first extends the authenticated example with one episode, an app-only Play operation, separate model and view results, and one foreground player. It builds on [verified browsing](https://github.com/MachineWisdomAI/saga-a2ui/issues/8). Recipient binding and routing need to work before this slice can demonstrate protected playback. Synthetic subscription policy stays in the example.

[PLAY2](https://github.com/MachineWisdomAI/saga-a2ui/issues/11) then establishes expiry, revocation of fresh acquisition, rejection of recipient and episode misuse, and reauthorized recovery. It also establishes how the same example service handles origins, redirects, ranges and caches; its scope is that service, not a general media proxy.

The complete flow integrates [STATE1](https://github.com/MachineWisdomAI/saga-a2ui/issues/12) and [STATE2](https://github.com/MachineWisdomAI/saga-a2ui/issues/13) for the proposed [request and view lifetime](request_view_lifetimes.blueprint.md) scope: selection races, teardown and bounded request completion, plus [POL1](https://github.com/MachineWisdomAI/saga-a2ui/issues/5) and [POL2](https://github.com/MachineWisdomAI/saga-a2ui/issues/7) for Standard and Strict content behavior. These tasks retain their responsibilities and dependency order. Acceptance in ChatGPT web and Claude web requires the completed media, state and content-policy work, plus each host's own browsing gate.

The Captain performs the independent acceptance runs in ChatGPT web and Claude web. Reusable SDK extraction follows this integrated evidence. The existing tickets retain the implementation details and dependency order.

## Open decisions

1. **How does the media service bind acquisition to the recipient?** The alternatives include a media request authenticated as the recipient and a capability bound to a separately verifiable session or proof. The choice depends on what the actual embedded player can send. A bearer URL protected only by secrecy and a short lifetime does not reject reuse by another user. If a required host cannot carry an enforceable binding, that remains a feasibility gap.
2. **What expires or is revoked, and when?** The design needs a capability lifetime, a way to consult current entitlement and revocation state, and rules for in-flight responses, supported ranges and explicit reacquisition. Cache headers, allowed origins and redirect handling need to be selected together. The selected service behavior must refuse fresh bytes after expiry or revocation while retaining the stated limit for buffered bytes.
3. **Which wire mapping preserves separate model and view results?** The application needs an app-only declaration and result channel supported by its pinned MCP Apps interfaces, with separately validated payloads and safe errors. Both real hosts need to exercise that mapping. The current browsing result uses `structuredContent`; the Play path needs a channel that keeps the capability out of the model's response. A reusable projection API remains contingent on a working slice.
4. **How does foreground playback start after asynchronous authorization?** The host and browser might preserve the initial user activation or require a second explicit Play gesture. The chosen flow also needs to distinguish supported media failures from expiry and keep pending and recovery controls accessible. It must retain authorized, user-initiated playback; autoplay or a public URL cannot replace that interaction.

These mechanism choices need resolution during design review and refinement. The existing tickets cover this feature's outcomes but leave the capability and delivery mechanisms open. After explicit human design approval, their coverage and Blueprint links can be reconciled against the agreed design.

## References

- [Blueprint conventions](../README.md) and [feature format](README.md).
- [Coding standards](../../CODING_STANDARDS.md), [planned package ownership](../../packages/README.md), and [contributor review](../../CONTRIBUTING.md#review).
- [Application listener](../../apps/lit-host/src/mcp/listener.ts), [request authentication](../../apps/lit-host/src/mcp/request-auth.ts), [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts), [subscriptions view](../../apps/lit-host/src/mcp/subscriptions-view.ts), and [bridge lifecycle](../../apps/lit-host/src/mcp/view.ts), inspected at SDK revision `53ed8328f4f5c06dd1772e48b098fdcf3d4bae79`.
- [PLAY1: fresh entitlement and foreground playback](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) and [PLAY2: protected-media delivery constraints](https://github.com/MachineWisdomAI/saga-a2ui/issues/11).
- [MCP tool errors](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling) and [MCP Apps upstream documentation](https://apps.extensions.modelcontextprotocol.io/api/). These define the protocol mechanisms used at the application and host boundaries.
