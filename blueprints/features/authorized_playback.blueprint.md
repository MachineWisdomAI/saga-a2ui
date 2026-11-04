---
feature_name: authorized_playback
status: approved
module_blueprints: [action_binding]
dependencies: []
date_added: 2026-10-15
---

# Authorized playback

A visible Play button does not establish permission to hear an episode. The application must authenticate the request and check current entitlement, then protect the separate request that fetches the audio. SAGA supplies the action and request lifetimes around those application decisions; the view cannot grant itself access.

The synthetic example uses fictional accounts and content. User A may hear `ep-1`; user B may not. Its Lit and React controls drive the same controller, server and media service. The example demonstrates foreground, user-initiated playback; it is not a production identity system or a claim of mobile, background, voice-mode or audible playback support in every host.

## Status

The human-approved [playback design at `feb037e51e411ee4da9a71b9e1f6e4d51e1737f9`](https://github.com/MachineWisdomAI/saga-a2ui/blob/feb037e51e411ee4da9a71b9e1f6e4d51e1737f9/blueprints/features/authorized_playback.blueprint.md) and [content-policy clarification at `6785ae1d8205a45e668f478ea303fbdd7e474663`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6785ae1d8205a45e668f478ea303fbdd7e474663/blueprints/features/authorized_playback.blueprint.md) remain approved. The [lifetime amendment at `7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/authorized_playback.blueprint.md) replaced only request/view lifetime scope. It did not revive the rejected account/session machinery.

| Implemented scope | Landed revision | Evidence and limit |
| --- | --- | --- |
| Original PLAY1/PLAY2 authorization and media service | `31759fabb596f7d59921eb3f85095bc2a3aba73b`, through [PR #56](https://github.com/MachineWisdomAI/saga-a2ui/pull/56) and [PR #58](https://github.com/MachineWisdomAI/saga-a2ui/pull/58) | [Final PLAY2 review](https://github.com/MachineWisdomAI/saga-a2ui/pull/58#pullrequestreview-5540944730) records source/local verification; the original slices did not establish the later lifecycle integration |
| One Play invocation, metadata and player leases | `8eb46792205fd0866067cd3aeaf29d8b47ed8257` ([PR #133](https://github.com/MachineWisdomAI/saga-a2ui/pull/133)) | [Review](https://github.com/MachineWisdomAI/saga-a2ui/pull/133#pullrequestreview-5576383648) of `98f836811f95833c02f68aa163fb66ad94c8c8d5`; [bounded Claude/ChatGPT receipt](https://github.com/MachineWisdomAI/saga-a2ui/issues/15#issuecomment-6275325996) |
| React control using the shared application | `4d40761d14c563cb3b48648266594b1d70d8e918` ([PR #172](https://github.com/MachineWisdomAI/saga-a2ui/pull/172)) | [Action Status](../modules/action_binding.blueprint.md#status) distinguishes source review `58199872cb25c3b8378fb679b6f33198e6f8d7b6` from integration review `2bab6b8884af2ab42e4a40f5e782709079de1db2`; protected player only, with no React description card |

The [request/view Status](request_view_lifetimes.blueprint.md#status) records the intervening server-budget, retirement and safe-recovery deliveries. The [preserved playback Status](https://github.com/MachineWisdomAI/saga-a2ui/blob/cdad54747dfbba756464676ac3b1b8c90148a566/blueprints/features/authorized_playback.blueprint.md#status) retains all earlier design-to-code entries and approval conditions.

Actual Claude and ChatGPT observations cover private grants, refusal without a grant and fresh-view recovery; ChatGPT also covers a pending-view reload followed by a new acquisition. Loopback media then failed, so those observations do not establish audible audio. Some host containers needed a rendering retry. Combined-description, physical-device, invisible account-switch and forwarded-cancellation acceptance remain separate. The [React host record](https://github.com/MachineWisdomAI/saga-a2ui/blob/24194b60cb63dcd7762b6b198cea6a3a75dea803/docs/2026-10-21_react_play_acceptance_v1.md) preserves the exact resource identities and observed limits. The SDK's `0.7.7-rc.1` publication does not deploy this example or close those host gaps.

## Why playback needs its own authorization

Browsing establishes which subscriptions to show for one verified request. It does not establish current permission to play a selected episode later. A subscription can expire between those operations, and an episode ID can be copied into another request. The server therefore checks identity and entitlement on every Play, and the media service checks the grant and current entitlement on every fresh acquisition.

Those two decisions protect different boundaries. Play issues permission for a particular recipient key; acquisition proves that the requester holds that key and is still entitled to receive bytes. Stopping an old view prevents its local work from continuing, but cannot substitute for either server decision.

## Playback flow

User A selects an episode with ID `ep-1` and presses Play in the embedded Lit or React control. The assistant host runs this view and mediates its requests to the application. The view shows that the request is pending and sends only `{ episodeId: "ep-1" }` to the declared app-only Play operation. Here, **app-only** means the operation is exposed to the embedded view and excluded from the model’s available tools. The server still authenticates and authorizes every request. The control remains keyboard reachable while repeated activation is suppressed, and the view allows at most one active playback request and one foreground player.

The application validates the episode ID and authenticates the request independently of its arguments. This establishes a **verified principal**: the identity of the caller, confirmed by the application's authentication system. The Play operation then checks that principal's current **entitlement**, meaning permission to access the selected episode. An account ID, sign-in label or subscription status supplied in the action cannot select the caller or grant permission. Replaying an earlier Play request repeats both authentication and the entitlement check.

Before protected media acquisition, the delivery path checks that the host supports the app action and can deliver private playback data to the view separately from the model's response. If the host lacks either capability, Play returns a safe unsupported result without fetching protected media. Private playback data cannot be placed in a model-visible field as a fallback.

Once A is authorized, the synthetic media service issues a **media capability**: short-lived authorization to fetch the selected episode for the permitted recipient. The implemented capability is an opaque random value, stored by hash in the media service and bound to the episode, account and thumbprint of the view's public key. Possession of the capability alone is insufficient: each acquisition also needs a fresh proof signed by that key. The application prepares separate results for the view and the model. These are **result projections**, each containing only the fields intended for its recipient, and both are validated before serialization. Only the view's projection may contain the media capability; the model may receive safe outcome text.

The view validates the returned payload and accepts it only if it matches the pinned sign-in label, selected episode and playback invocation. A response belonging to an earlier sign-in, selection or request cannot restore media after the view has cleared it. The player then fetches media under the service's authorization checks and the host's declared resource policy. A successful Play response means that access was granted; the view shows **playing** only after the player confirms its audio clock is advancing. Audio that ends before startup confirmation is shown as ended. The intended outcome is audible foreground playback initiated by the user.

If B requests the same episode, the entitlement check refuses access before issuing a capability or fetching protected media. The view stops and clears any prior media and explains that this account does not have access. Missing or expired sign-in instead leads to sign-in recovery.

If a fresh acquisition is refused or media loading fails, the view stops and clears the source, then offers a deliberate retry where recovery is possible. The media service does not monitor an already-delivered buffer for later entitlement changes. Retry starts a new Play request with fresh identity and entitlement checks; it never refreshes a capability from saved view state.

![Play authorizes a recipient, then the separate media acquisition proves possession and checks current entitlement; unknown outcomes do not invite retry.](../../diagrams/authorized-playback-flow.png)

[Editable Mermaid](../../diagrams/authorized-playback-flow.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-flow.excalidraw) · [SVG](../../diagrams/authorized-playback-flow.svg)

## Responsibilities and interfaces

The application owns the decisions that permit playback: who is making the request, whether that person may hear the episode, and whether a later request may receive more audio. It retains its HTTP listener, identity provider, backend calls, subscription rules and any resulting changes to backend state. SAGA supplies the action runtime, bounded server/request helpers and view lifecycle. This specialized playback server owns its strict schemas, upstream app-only registration, safe failures and private result projection. A2UI describes presentation and carries declared actions; choosing a renderer cannot choose a user or change authorization policy.

![The application owns identity, entitlement and recipient-bound media; SAGA owns action/request lifetimes and view delivery.](../../diagrams/authorized-playback-ownership.png)

[Editable Mermaid](../../diagrams/authorized-playback-ownership.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-ownership.excalidraw) · [SVG](../../diagrams/authorized-playback-ownership.svg)

Application authentication checks a request credential's issuer, audience, expiry and revocation, then maps it to an account. It produces an immutable verified principal for that request. Missing, invalid, expired or service-only identity is rejected before protected work. The Play operation receives the principal separately from its validated episode ID and applies the application's current subscription rules before authorizing acquisition. This request-scoped identity prevents concurrent operations from relying on a shared, mutable “current user.” Development fixture authentication remains local; each actual host needs its supported authenticated path.

Issuing a capability and accepting it for media are separate authorization decisions. The synthetic media service checks current entitlement, expiry and the capability's recipient and episode scope on every fresh acquisition, including a later request for a byte range. The same service issues and revokes capabilities. It controls which media origins, redirects and byte ranges it permits and how responses may be cached.

The view generates an ES256 key and sends its public JWK in request metadata, separately from the episode argument. For a media GET it signs a fresh proof naming the method, exact target URL, capability hash and unique proof identifier. The service verifies the signature and recipient-key thumbprint, proof age and unused identifier before consulting current entitlement. A copied capability without the private key cannot satisfy those checks. This is the selected synthetic-service mechanism, not a new SDK authentication system.

The service's default capability lifetime is 60 seconds. Proofs have a 60-second maximum age and 5-second clock tolerance; replay identifiers are remembered for their acceptance interval. A current denial deletes the grant, while a dependency fault or a denial arriving after request retirement does not. Each later acquisition repeats entitlement checking. Refusing the next request is separate from canceling an in-flight response or retracting bytes already buffered.

For both result projections, the application constructs explicitly allowed fields, rejects unknown or oversized fields, and validates the result before serialization. The selected Model Context Protocol (MCP) Apps path carries safe text in `content` and the application's private playback payload under its result `_meta` key. `forModel` and `forView` are local projection variables in the application server, not a general SAGA private-result API.

Capabilities, raw credentials and private backend fields must stay out of all model-visible output, including `content`, `structuredContent`, resource bodies and A2UI payloads, as well as errors and ordinary logs. The static HTML resource contains no user credentials or per-user capability. Filtering a response after it reaches the browser cannot undo disclosure to the model. The host must preserve the selected recipient mapping and permit the declared media and resource behavior. Data reserved for the view is still visible to the host provider.

The application controller and player owner own the player and its accessible pending, playing, paused, ended and recovery states. Its input validation and request tracking keep a stale result from replacing the current session or selection. It also invalidates old work, stops playback and disposes of player resources. These lifecycle decisions cannot grant entitlement. The Lit and React views present the same controller state, while host communication stays at the MCP boundary.

This feature applies the shared [action model](../modules/action_binding.blueprint.md#lifetimes-and-owners) to one application; it is not the source of that model. Play is the action whose handler issues a protected request, which the server authenticates and authorizes every time, and no client-side check substitutes for that. Its client work produces a player, an acquired resource that can outlive the Play invocation. Pause and Resume are local actions on that player and cannot grant, extend or change authorization. The implemented mapping uses one server-action invocation from recipient-key creation through player start. Gesture preparation happens synchronously in `atActivation`; prerequisites and handler share the work deadline; success and cleanup have their separate hook budgets. The application player owner holds acquisition-scoped leases, so late release of an older lease cannot stop the current player. A successful transfer allows the player to outlive Play. [Request and view lifetimes](request_view_lifetimes.blueprint.md#playback-through-one-action-invocation) explains the full stage mapping.

An episode description may include links and image references supplied as content. A separate content policy governs what those references can activate or fetch; the application's authored Play control invokes a declared operation with its own media policy and server authorization. The [content safety design](content_safety_levels.blueprint.md) defines Standard and Strict. Strict keeps links inert, makes blocked-fragment visibility configurable and requires deliberate Show images consent before loading otherwise-permitted images. Play retains its own authorization and media policy under either level. Neither level can expand host permissions, and supplied content cannot change either policy.

The application retains this protected-media implementation because account rules, capability issuance and media storage are domain responsibilities. It uses the pinned MCP/MCP Apps APIs alongside SDK lifetimes rather than exporting a universal media service. Synthetic identities, records and content stay in the application; adopting a stack does not install that fixture policy.

### Acquiring protected bytes

The [media service](../../apps/lit-host/src/playback/media-service.ts) performs its checks in order and refuses without revealing which check failed: known unexpired capability, matching episode, valid proof of the bound key, matching method/URL/capability, fresh unused proof ID, and current entitlement. Only then does it read storage and interpret the Range header. An authorized single byte range receives 206; an unsatisfiable range receives 416 without protected bytes. A dependency failure receives 503 rather than pretending entitlement was denied.

The browser fetch omits ambient credentials, disables caching and refuses redirects. The listener constructs the proof's expected URL from its configured origin rather than an incoming Host header, and responses use private/no-store caching. The media route permits cross-origin reading because the capability plus proof authorizes acquisition; it is not an origin allowlist. The host's declared connect policy is a separate browser restriction. A production adopter must preserve that distinction when choosing its own delivery service.

## Failure and recovery

Recovery depends on which check failed. Missing or expired identity leads to the supported sign-in flow. An entitlement denial instead explains, “Playback denied: this account does not have access to this episode.” Signing in again does not grant a subscription.

| Trigger | Result and recovery |
| --- | --- |
| Missing, malformed, expired or service-only identity | The application rejects the request before protected work and preserves the applicable HTTP authentication status and challenge. The view clears protected state and media and offers supported sign-in. |
| Forged account fields or invalid episode input | Arguments cannot choose the caller's identity. The application rejects invalid business input before acquiring media. |
| A capability is used by another recipient or for another episode | The media service refuses the acquisition and returns no protected bytes. |
| Current entitlement is denied or revoked | A denied Play request yields no capability; a denied acquisition yields no new bytes. The view clears the player and shows the denial. A later explicit request succeeds only if the server then permits it. |
| Required recipient routing or media support is absent | The view shows that playback is unsupported. No protected fetch occurs, and no private URL is placed in chat as a fallback. |
| A fresh acquisition finds an expired capability, or media fails to load | The view stops playback and clears the source. A recoverable failure offers an explicit retry through fresh authorization; it does not start a retry loop or reuse stale authorization. |
| A result is invalid, oversized, late or for a different request, selection or sign-in | The view clears invalid current state and rejects stale success before mounting media. Retired work cannot restore an older episode or account. |
| The view observes a changed sign-in label or selection, loses authentication, or is disposed | The view invalidates pending results, cancels where possible, stops playback, removes the source and releases player resources and listeners. New content requires a current authenticated result. |
| A deadline expires or work is cancelled | The action stops waiting within its work deadline and suppresses late success. A request with no known result remains unconfirmed without an in-card retry invitation; a failure before sending or after a valid grant has its own permitted recovery. Cancellation of underlying work is best effort; application code owns its cleanup. |

Failures use different protocol responses according to where they occur. A malformed MCP call or an unknown tool produces a JSON-RPC error. For a known Play operation, invalid arguments, entitlement denial, expected backend failures and missing required host capabilities produce a safe tool failure with `isError: true`. The playback handler also converts invalid projection data and unexpected dependency faults into its fixed safe tool-failure text without success data. The MCP endpoint does not copy backend HTTP errors blindly.

Wire-level tests check these mappings against the selected upstream output-schema and error behavior. Once the response has completed, a browser player failure changes the view's state rather than replacing the server response.

When an opener or grant carries a different sign-in label, the playback view retires permanently: it clears selection and player, disposes bindings and ignores later openers. A fresh view may recover with its own authenticated opener. It cannot detect an invisible account change the host never reports. Same-label openers also carry no request ID, so an old delayed opener can replace a selection; the server still independently authorizes the selected episode. The [request/view contract](request_view_lifetimes.blueprint.md#read-recovery-and-sign-in-labels) states both limits. The [rejected account/session proposal](account_session_isolation.blueprint.md) does not impose retention timers or focus/resume revalidation here.

Stopping and clearing the player reduces continued use of held media, but cannot revoke bytes already buffered or downloaded. Expiry and revocation prevent fresh acquisition at the service; they cannot retract delivered bytes or erase a host provider's copy. Likewise, abandoning the client's wait for a Play request does not show that the host forwarded cancellation or that the server stopped, and it cannot undo a capability already issued.

## Verification outcomes

The maintained local integration tests exercise the real listener, a controlled synthetic media service and the built Lit/React player views. The table states the contract those tests and retained reviews qualify; it is not a report of a new run. The checks follow an action through authorization and delivery, then observe the player and the service's handling of later media requests.

| Test condition | Observable result |
| --- | --- |
| Entitled user A presses Play for `ep-1` | One accepted action passes through the listener, Play operation and validated view projection to acquire protected audio. The capability is scoped to the episode and recipient. The player reports playing only after playback begins. |
| User B requests A's episode, or credentials are missing, forged, expired or service-only | Authentication or current-entitlement checks refuse the request before protected work. There is no capability disclosure and no protected backend or media fetch. |
| A modified action adds an account ID or repeats an earlier valid request | Runtime input validation rejects invalid arguments. Arguments cannot impersonate another account, and every valid replay rechecks current permission. |
| User B reuses A's capability, or a capability is used for another episode | The media service returns no protected bytes. |
| Entitlement is revoked or a capability expires before a later acquisition, including a range request | The media service refuses new bytes, including use of an already-issued capability. Explicit retry repeats authorization and either obtains fresh access or shows denial. |
| Backend output or errors contain a capability or a recognizable private test value | Neither appears in serialized model-visible responses, resource bodies or errors, or in ordinary logs. The view receives only its permitted, validated fields. |
| A host lacks required recipient separation, app-only actions or media support | The Play path returns an unsupported result without promoting private fields into a model-visible channel or starting a protected fetch. |
| A redirect targets an undeclared origin, a shared cache is used, or valid and invalid range requests arrive | Service responses, headers and browser network activity show rejection of disallowed destinations and no cross-user cache disclosure. Supported ranges enforce the same authorization and expiry checks as other acquisitions. |
| Double activation, selection change, observed label loss or disposal occurs while work is pending | The built view has at most one active playback request and one player. Old audio stops, its source clears, and late success cannot restore it. |
| Identity verification, authorization, the handler or projection work stalls | The request stops waiting within its configured deadline. It uses the safe error mapping while the transport permits a response, or closes after commitment. Local cancellation and cleanup run; late results and later owned stages are suppressed. Tests exercise the complete asynchronous pipeline and the supported JSON response and Server-Sent Events (SSE) lifecycle established by the state work. |
| Standard and Strict render the same supplied content | Exercise the [content safety design’s](content_safety_levels.blueprint.md) presentation, destination restrictions and Strict image-consent behavior. Source reveal grants no network permission and Strict links stay inert. Authorized authored Play remains available under its separate authorization, media policy and host resource restrictions. |
| A keyboard user encounters denial, timeout or expired playback at narrow width or increased zoom | Playback and recovery controls remain reachable, status is announced, focus is sensible, and old media is not retained. Tests use the built view and the host's media controls. |

ChatGPT web and Claude web each require an independent run of the authenticated synthetic workflow with the actual built resource. Each run covers invocation and rendering, separation of model and view results, allowed and denied Play actions, media expiry, observable label and selection changes while work is pending, both content-policy levels, and audible foreground playback. The retained observations in Status cover only their named subset; audible and combined-card acceptance remain open. Missing, expired or service-only identity and forged arguments produce no protected disclosure or fetch. Each host's run establishes its own acceptance result.

The host record identifies the date, source revision, built resource and hash, relevant package and upstream versions, host, browser and device, and authentication setup. It gives expected and observed results separately, with credentials, capability URLs and personal account details redacted. Unchanged browsing-setup evidence can be reused; changed source and resource identities are recorded. Playback is confirmed by observing audible foreground audio in the authenticated workflow in that host. A required path that fails or cannot be exercised blocks that host's acceptance.

## Implementation sequence

PLAY1/PLAY2 established app-only authorization, recipient-bound media, expiry and acquisition-time revocation. STATE1/STATE2 then supplied teardown, final label loss, finite waits and stage-appropriate recovery. CORE2 migrated Play into one action work interval with per-call metadata and acquisition-scoped leases. React subsequently added a second view over the same controller and server; it did not add another authorization path.

The original sequencing amendment permitted connector and passive-renderer preparation before the remaining lifetime work. That changed start order, not the complete feature's host or release gates. The [preserved design history](https://github.com/MachineWisdomAI/saga-a2ui/blob/cdad54747dfbba756464676ac3b1b8c90148a566/blueprints/features/authorized_playback.blueprint.md#implementation-sequence) retains the original stages and their conditions.

## Open decisions

Recipient proof, capability expiry, request metadata, the one-invocation mapping and player leases are implemented choices in the synthetic application. They are no longer pending mechanism selections. Their implementation does not decide how a production application should operate identity, storage or revocation.

The remaining acceptance question is whether a claimed host supports the complete authenticated foreground-audio workflow, including its resource restrictions and user-gesture behavior. Private-grant delivery alone cannot answer it. A host that cannot enforce the required recipient or media path stays unsupported for protected playback; exposing a public media URL is not a fallback.

A broader private-result API, another media service or new same-label correlation would need its own design. Until then the application keeps its explicit private projection and proof mechanism, and the documented host/cleanup limits remain part of the supported scope.

## References

- [Blueprint conventions](../README.md), [feature format](README.md) and the [action binding](../modules/action_binding.blueprint.md) module.
- [Coding standards](../../CODING_STANDARDS.md), [package ownership](../../packages/README.md), and [contributor review](../../CONTRIBUTING.md#review).
- [Application listener](../../apps/lit-host/src/mcp/listener.ts), [request authentication](../../apps/lit-host/src/mcp/request-auth.ts), [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts), [subscriptions view](../../apps/lit-host/src/mcp/subscriptions-view.ts), and [bridge lifecycle](../../apps/lit-host/src/mcp/view.ts). Current behavior was checked at SDK source `cdad54747dfbba756464676ac3b1b8c90148a566`; the earlier design inspection at `53ed8328f4f5c06dd1772e48b098fdcf3d4bae79` remains in history.
- [PLAY1: fresh entitlement and foreground playback](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) and [PLAY2: protected-media delivery constraints](https://github.com/MachineWisdomAI/saga-a2ui/issues/11).
- [MCP tool errors](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling) and [MCP Apps upstream documentation](https://apps.extensions.modelcontextprotocol.io/api/). These define the protocol mechanisms used at the application and host boundaries.
