---
feature_name: authorized_playback
status: approved
module_blueprints: [action_binding]
dependencies: []
date_added: 2026-10-15
---

# Authorized playback

## Status

**Approved; source implements the synthetic protected-player flow and its scoped lifetime/action integration.** The baseline approval is `feb037e51e411ee4da9a71b9e1f6e4d51e1737f9`; the content and lifetime amendments have separate identities. The [lifecycle records](authorized_playback.lifecycle.md#status) preserve each design-to-code record and reviewed slice, including the React protected control.

This Blueprint describes application source at `cdad54747dfbba756464676ac3b1b8c90148a566`. The protected application and synthetic media service are repository examples, not npm packages. Published SDK dependencies at `0.7.7-rc.1` supply action and delivery primitives; publication does not establish acceptance of this application.

Bounded ChatGPT/Claude observations establish private grant delivery, refusal without a grant and fresh recovery for their recorded artifacts. They do not establish audible host playback, invisible account-switch detection, host-forwarded cancellation, remote rollback or production deployment. Full audible foreground playback remains an acceptance target, not a completed claim. Lit includes the optional public description card; the React protected-player control does not establish the combined React card recipe.

## Problem and current behavior

An example podcast subscription app provides public episode descriptions and lets signed-in listeners browse their subscriptions. The intended experience is playback inside an assistant: a listener presses Play and hears an episode their account can access. The implemented source exercises authorization and a foreground Web Audio player; audible playback in an actual assistant host remains unaccepted. The example uses fictional accounts and content. User A can listen to the selected episode; user B cannot.

The existing sign-in check establishes whose subscriptions to show, but permission to browse does not establish current permission to play an episode. Playback needs a fresh server decision on every Play request. A visible button, a previous subscription result or possession of an episode ID cannot grant access.

The implemented playback flow applies server authorization and protected media delivery to its fictional accounts and content. Playback is user initiated and stays in the foreground. Patreon integration, production identity, mobile, autoplay, voice-mode and background playback are outside this feature's scope.

## Proposed behavior

User A selects an episode with ID `ep-1` and presses Play in the app's embedded interface, built with Lit or the separate React control over the same controller. The assistant host runs this view and mediates its requests to the application. The view shows that the request is pending and sends only `{ episodeId: "ep-1" }` to the declared app-only Play operation. Here, **app-only** means the operation is exposed to the embedded view and excluded from the model’s available tools. The server still authenticates and authorizes every request. The control remains keyboard reachable while repeated activation is suppressed, and the view allows at most one active playback request and one foreground player.

The application validates the episode ID and authenticates the request independently of its arguments. This establishes a **verified principal**: the identity of the caller, confirmed by the application's authentication system. The Play operation then checks that principal's current **entitlement**, meaning permission to access the selected episode. An account ID, sign-in label or subscription status supplied in the action cannot select the caller or grant permission. Replaying an earlier Play request repeats both authentication and the entitlement check.

Before the host call, the controller checks advertised server-tool capability and creates a recipient key. The server rejects absent or malformed recipient metadata before entitlement lookup. These checks support the selected app-only/private-metadata mapping; they do not prove that an arbitrary host preserves confidentiality or can fetch the media. Those host behaviors need observation. Private playback data cannot be placed in a model-visible field as a fallback.

Once A is authorized, the synthetic media service issues a **media capability**: short-lived authorization to fetch the selected episode for the permitted recipient. The implementation issues an opaque 32-byte random capability, stores only its SHA-256 hash, and binds it to the account, episode and RFC 7638 thumbprint of the view's ES256 public key. Its default lifetime is 60 seconds. Each acquisition also needs a fresh signed proof; possession of the capability alone grants nothing. The application prepares separate results for the view and the model. These are **result projections**, each containing only the fields intended for its recipient, and both are validated before serialization. Only the view's projection may contain the media capability; the model may receive safe outcome text.

The view validates the returned payload and accepts it only if it matches the current sign-in, selected episode and playback request. A response belonging to an earlier sign-in, selection or request cannot restore media after the view has cleared it. The player then fetches media under the service's authorization checks and the host's declared resource policy. A successful Play response means that access was granted; the view shows **playing** only after audio actually starts. The browser qualification observes the audio clock advancing; that is not audible-output evidence. Audible foreground playback remains the intended host outcome.

If B requests the same episode, the entitlement check refuses access before issuing a capability or fetching protected media. The view stops and clears any prior media and explains that this account does not have access. Missing or expired sign-in is refused by the listener's authentication gate. A rejected host call does not tell the view that authentication was the cause, so the current controller reports an unconfirmed outcome rather than inventing a sign-in diagnosis.

If the next acquisition is refused after expiry or revocation, or media loading fails, the view clears that attempt and offers a deliberate retry where recovery is possible. Expiry alone does not stop already-loaded audio; the service checks fresh acquisition, not decoded bytes already held by the player. Retry starts a new Play request with fresh identity and entitlement checks; it never refreshes a capability from saved view state.

**Conceptual flow:** the optional range branch describes direct media-service clients; the built player fetches the whole body. Expiry and revocation affect the next acquisition, not already-buffered audio. Unknown Play outcomes require reopening the episode rather than the retry branch.

![Playback and failure flow: an explicit Play request passes identity, entitlement and host-routing checks before capability delivery; every fresh media acquisition is checked, and failures clear the player.](../../diagrams/authorized-playback-flow.png)

[Editable Mermaid](../../diagrams/authorized-playback-flow.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-flow.excalidraw) · [SVG](../../diagrams/authorized-playback-flow.svg)

## Responsibilities and interfaces

The application owns the decisions that permit playback: who is making the request, whether that person may hear the episode, and whether a later request may receive more audio. It retains its HTTP listener, identity provider, backend calls, subscription rules and any resulting changes to backend state. The SDK supplies bounded request, action and view-lifecycle primitives. The application's custom Play registration owns its input schemas, fixed failure mapping and private result construction on the upstream MCP Apps API. A2UI describes presentation and carries declared actions; choosing a renderer cannot choose a user or change authorization policy.

**Historical ownership diagram:** “recipient proof TBD” is resolved by the ES256 proof described above. The separate projections are constructed by the application's custom Play registration, not a generic private-projection API in SAGA. React uses the same application controller and authorization path.

![Historical Lit ownership diagram; recipient proof is now ES256, and the application owns private projection construction. The embedded view requests Play through the host. The application authenticates the request and checks entitlement before issuing a media capability. SAGA delivers separate view and model results, and the media service checks the player's later requests for audio.](../../diagrams/authorized-playback-ownership.png)

[Editable Mermaid](../../diagrams/authorized-playback-ownership.mmd) · [Editable Excalidraw](../../diagrams/authorized-playback-ownership.excalidraw) · [SVG](../../diagrams/authorized-playback-ownership.svg)

Application authentication checks a request credential's issuer, audience, expiry and revocation, then maps it to an account. It produces an immutable verified principal for that request. Missing, invalid, expired or service-only identity is rejected before protected work. The Play operation receives the principal separately from its validated episode ID and applies the application's current subscription rules before authorizing acquisition. This request-scoped identity prevents concurrent operations from relying on a shared, mutable “current user.” Development fixture authentication remains local; each actual host needs its supported authenticated path.

Issuing a capability and accepting it for media are separate authorization decisions. The synthetic media service checks current entitlement, expiry and the capability's recipient and episode scope on every fresh acquisition, including a later request for a byte range. The same service issues and revokes capabilities. It controls which media origins, redirects and byte ranges it permits and how responses may be cached.

Those acquisition checks require a way to bind a media request to its authorized recipient and make a current revocation decision. A bearer URL protected only by a short lifetime does not establish either cross-user rejection or immediate revocation of new acquisition. The current proof is an ES256 JWT naming the method, exact URL and capability hash, with a fresh `iat` and single-use `jti`. The service verifies the bound key, checks current entitlement on every acquisition and deletes the capability on an entitlement denial. A lookup or storage fault returns unavailable without revoking the capability; the next attempt still needs a new proof. Host support for forwarding the recipient metadata and fetching with custom headers remains an evidence requirement. Refusing the next request is separate from cancelling an in-flight response or dealing with audio already delivered to the browser.

For both result projections, the application constructs explicitly allowed fields, rejects unknown or oversized fields, and validates the result before serialization. The selected Model Context Protocol (MCP) delivery path carries each projection to its intended recipient. The labels `forModel` and `forView` describe those audiences; they do not name existing SAGA APIs.

Capabilities, raw credentials and private backend fields must stay out of all model-visible output, including `content`, `structuredContent`, resource bodies and A2UI payloads, as well as errors and ordinary logs. The static HTML resource contains no user credentials or per-user capability. Filtering a response after it reaches the browser cannot undo disclosure to the model. The host must preserve the selected recipient mapping and permit the declared media and resource behavior. Data reserved for the view is still visible to the host provider.

The application controller shared by the Lit and React controls owns the player and its accessible pending, playing, paused, ended and recovery states. Its input validation and request tracking keep a stale result from replacing the current session or selection. It also invalidates old work, stops playback and disposes of player resources. These lifecycle decisions cannot grant entitlement. Rendering stays in the selected control, while host communication stays at the MCP boundary.

This feature applies the shared [action model](../modules/action_binding.blueprint.md#lifetimes-and-owners) to one application; it is not the source of that model. Play is the action whose handler issues a protected request, which the server authenticates and authorizes every time, and no client-side check substitutes for that. Its client work produces a player, an acquired resource that can outlive the Play invocation. Pause and Resume are local actions on that player and cannot grant, extend or change authorization. The module is an approved design whose Status records its implementation. The current Play is one `Action.server` invocation: its synchronous prefix prepares audio and takes a lease; prerequisites create the recipient key; work requests authorization, signs/fetches media and starts audio. A confirmed start synchronously transfers the lease to the application player owner before the handler returns. Required success hooks have their own bounds; a later success-hook failure does not revoke the transferred player. The owner ends only the lease passed to it, so a late completion cannot stop newer audio.

An episode description may include links and image references supplied as content. A separate content policy governs what those references can activate or fetch; the application's authored Play control invokes a declared operation with its own media policy and server authorization. The approved [content safety design](content_safety_levels.blueprint.md) defines Standard and Strict. Strict keeps links inert, makes blocked-fragment visibility configurable and requires deliberate Show images consent before loading otherwise-permitted images. Play retains its own authorization and media policy under either level. Neither level can expand host permissions, and supplied content cannot change either policy.

The playback prototype stays in the working application and should use its pinned upstream MCP/MCP Apps interfaces. Operation names, input/output schemas and routing remain choices within these requirements. The [coding standards](../../CODING_STANDARDS.md) call for explicit typed composition, runtime validation at input boundaries and one owner for each rule; this design introduces no SAGA-wide registry or string-keyed action bus. Reusable core, renderer and MCP packages have since been extracted; the original sequencing and later amendments are retained in the lifecycle record. Their source/package qualification does not fill missing host observations. Synthetic accounts, content and subscription policy remain in the example.

## Failure and recovery

Recovery depends on which check failed. Missing or expired identity is rejected at the HTTP authentication boundary; the view can offer a sign-in diagnosis only when the host actually conveys one. An entitlement denial instead explains, “Playback denied: this account does not have access to this episode.” Signing in again does not grant a subscription.

| Trigger | Result and recovery |
| --- | --- |
| Missing, malformed, expired or service-only identity | The application rejects the request before protected work and preserves the applicable HTTP authentication status and challenge. The host owns any sign-in challenge flow. The view does not infer an authentication failure from a generic rejected call. |
| Forged account fields or invalid episode input | Arguments cannot choose the caller's identity. The application rejects invalid business input before acquiring media. |
| A capability is used by another recipient or for another episode | The media service refuses the acquisition and returns no protected bytes. |
| Current entitlement is denied at Play authorization | The fixed Play refusal yields no capability and maps to the view's `denied` state. A later explicit request succeeds only if the server then permits it. |
| Required recipient routing or media support is absent | Missing server-tool capability, a recipient-key failure or absent Web Audio fails before protected acquisition. The controller cannot preflight every host media restriction: a later CSP/network failure is `media-failed`. No private URL is placed in chat as a fallback. |
| Acquisition returns `403`, or media fails to load | Any `403` refusal maps to `expired`, including expiry/revocation, invalid capability/proof/key/episode scope or proof replay; the uniform response identifies no particular reason. Other media failures map to `media-failed`. Both clear that attempt and recover only through fresh authorization, without a retry loop or reused capability. Expiry alone does not stop already-loaded audio. |
| A result is invalid, oversized, late or for a different request, selection or sign-in | A malformed current opener stops audio and shows unavailable, while it can retain the selected episode label. A malformed Play grant yields an unconfirmed outcome with no immediate retry. Stale invocation success cannot mount media; a changed sign-in label terminally retires the controller. |
| The account or selection changes, authentication is lost, or the view is disposed | The view invalidates pending results, cancels where possible, stops playback, removes the source and releases player resources and listeners. New content requires a current authenticated result. |
| A deadline expires or work is cancelled | On timeout, the operation stops waiting within its configured deadline and the view shows a safe error. Cancellation returns the appropriate safe outcome, and late results are suppressed. Cancellation of underlying work is best effort; application code owns its cleanup. |

Failures use different protocol responses according to where they occur. A malformed MCP call or an unknown tool produces a JSON-RPC error. For a known Play operation, invalid arguments, entitlement denial, expected backend failures and missing required host capabilities produce a safe tool failure with `isError: true`. In the current application handler, a projection schema failure returns fixed invalid-result tool text, and dependency/contract faults return fixed unavailable tool text; neither carries success data or raw diagnostics. The MCP endpoint does not copy backend HTTP errors blindly.

Wire-level tests check these mappings against the selected upstream output-schema and error behavior. Once the response has completed, a browser player failure changes the view's state rather than replacing the server response.

When the view observes that authentication was lost, the sign-in changed or the selection changed, it invalidates pending results as described above, and the server still checks every request. If a host exposes no observable account-change signal, the view cannot clear immediately after an invisible switch. Verification records this limit for each actual host. The [rejected account/session proposal](account_session_isolation.blueprint.md) had proposed retained-state limits and focus or resume revalidation; those are not requirements of this feature. STATE1/STATE2 and later installed/host qualification now have their own scoped records in [request and view lifetimes](request_view_lifetimes.blueprint.md#status). Label loss is terminal: the old controller ignores later openers and all controls. Recovery requires a fresh controller with a current authenticated opener; a host reload is useful only if it actually supplies that new view and result. No universal reload-recovery guarantee follows from the UI's suggestion.

Stopping and clearing the player reduces continued use of held media, but cannot revoke bytes already buffered or downloaded. Expiry and revocation prevent fresh acquisition at the service; they cannot retract delivered bytes or erase a host provider's copy. Likewise, abandoning the client's wait for a Play request does not show that the host forwarded cancellation or that the server stopped, and it cannot undo a capability already issued.

## Verification outcomes

The retained qualification requirements exercise the real listener, a controlled synthetic media service and the built player views together. Completed source/browser/host evidence is recorded separately; the table does not assert that all host acceptance targets passed. The checks follow an action through authorization and delivery, then observe the player and the service's handling of later media requests.

| Test condition | Observable result |
| --- | --- |
| Entitled user A presses Play for `ep-1` | One accepted action passes through the listener, Play operation and validated view projection to acquire protected audio. The capability is scoped to the episode and recipient. The player reports playing only after playback begins. |
| User B requests A's episode, or credentials are missing, forged, expired or service-only | Authentication or current-entitlement checks refuse the request before protected work. There is no capability disclosure and no protected backend or media fetch. |
| A modified action adds an account ID or repeats an earlier valid request | Runtime input validation rejects invalid arguments. Arguments cannot impersonate another account, and every valid replay rechecks current permission. |
| User B reuses A's capability, or a capability is used for another episode | The media service returns no protected bytes. |
| Entitlement is revoked or a capability expires before a later acquisition, including a range request | The media service refuses new bytes, including use of an already-issued capability. Explicit retry repeats authorization and either obtains fresh access or shows denial. |
| Backend output or errors contain a capability or a recognizable private test value | Neither appears in serialized model-visible responses, resource bodies or errors, or in ordinary logs. The view receives only its permitted, validated fields. |
| A host lacks required recipient separation, app-only actions or media support | Unsupported preflight or recipient metadata fails closed without disclosure. Restrictions only discovered during media fetching are reported as media failure; the source does not detect every missing host feature in advance. |
| A redirect targets an undeclared origin, a shared cache is used, or valid and invalid range requests arrive | Service responses, headers and browser network activity show rejection of disallowed destinations and no cross-user cache disclosure. Supported ranges enforce the same authorization and expiry checks as other acquisitions. |
| Double activation, selection change, account change or disposal occurs while work is pending | The built view has at most one active playback request and one player. Old audio stops, its source clears, and late success cannot restore it. |
| Identity verification, authorization, the handler or projection work stalls | The operation stops waiting within its configured deadline and returns a safe error for the view to show. Cancellation notification and cleanup occur; late results and duplicate operations are suppressed. Tests exercise the complete asynchronous pipeline and the supported JSON response and Server-Sent Events (SSE) lifecycle established by the state work. |
| Standard and Strict render the same supplied content | Exercise the [content safety design’s](content_safety_levels.blueprint.md) presentation, destination restrictions and Strict image-consent behavior. Source reveal grants no network permission and Strict links stay inert. Authorized authored Play remains available under its separate authorization, media policy and host resource restrictions. |
| A keyboard user encounters denial, timeout or expired playback at narrow width or increased zoom | Playback and recovery controls remain reachable, status is announced, focus is sensible, and old media is not retained. Tests use the built view and the host's media controls. |

For complete audible-playback acceptance, ChatGPT web and Claude web each require an independent run of the authenticated synthetic workflow with the actual built resource. Each run covers invocation and rendering, separation of model and view results, allowed and denied Play actions, media expiry, account and selection changes while work is pending, both content-policy levels, and audible foreground playback. Missing, expired or service-only identity and forged arguments produce no protected disclosure or fetch. Each host's run establishes its own acceptance result.

The host record identifies the date, source revision, built resource and hash, relevant package and upstream versions, host, browser and device, and authentication setup. It gives expected and observed results separately, with credentials, capability URLs and personal account details redacted. Unchanged browsing-setup evidence can be reused; changed source and resource identities are recorded. Playback is confirmed by observing audible foreground audio in the authenticated workflow in that host. A required path that fails or cannot be exercised blocks that host's acceptance.

## Implementation sequence

The original PLAY1/PLAY2 and later state/content sequencing remain in the [lifecycle companion](authorized_playback.lifecycle.md#implementation-sequence), with the approved preparation exception. Source implementations and bounded later observations retain their own identities. No new host campaign, publication or deployment is authorized by this document.

## Open decisions

The implementation resolves the original mechanism questions as follows; the [original decisions](authorized_playback.lifecycle.md#original-open-decisions) remain historical context.

1. **Recipient binding:** ES256 proof of possession binds the media request to the view's key and capability. A copied capability without the private key cannot pass the service checks. This is synthetic application code, not a general media proxy or proof of production identity.
2. **Expiry and revocation:** the default capability lifetime is 60 seconds; each fresh acquisition checks entitlement again, including a range request. Denial deletes the grant. Dependency faults do not. The service never redirects and sends private/no-store cache headers; it cannot retract delivered bytes or cancel an already-authorized response solely because entitlement later changed.
3. **Recipient mapping:** `play_episode` is app-only and writes the validated grant into private result `_meta`; model text is fixed and safe. Generic `registerProtectedOperation` projection exposes model-visible text/structured data and must not be used as a private grant channel. Bounded actual-host receipts support only their exact observed mappings.
4. **Audio activation:** the synchronous Play prefix calls `player.prepare()` before asynchronous authorization. The browser may still withhold playback; a blocked start offers a fresh explicit Play, while blocked Resume retries the already-loaded audio. Audible host playback remains unaccepted.

The Play work deadline and transferred player lease have implemented owners, as described above. Pending host acceptance and application-specific production choices remain separate from those source decisions.

## References

- [Blueprint conventions](../README.md), [feature format](README.md) and the [action binding](../modules/action_binding.blueprint.md) module.
- [Coding standards](../../CODING_STANDARDS.md), [package ownership](../../packages/README.md), and [contributor review](../../CONTRIBUTING.md#review).
- [Application listener](../../apps/lit-host/src/mcp/listener.ts), [request authentication](../../apps/lit-host/src/mcp/request-auth.ts), [subscriptions server](../../apps/lit-host/src/mcp/subscriptions-server.ts), [subscriptions view](../../apps/lit-host/src/mcp/subscriptions-view.ts), and [bridge lifecycle](../../packages/mcp/src/view/run-tool-result-view.ts). The original investigation was at `53ed8328f4f5c06dd1772e48b098fdcf3d4bae79`; these links now name current owners.
- [PLAY1: fresh entitlement and foreground playback](https://github.com/MachineWisdomAI/saga-a2ui/issues/10) and [PLAY2: protected-media delivery constraints](https://github.com/MachineWisdomAI/saga-a2ui/issues/11).
- [MCP tool errors](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#error-handling) and [MCP Apps upstream documentation](https://apps.extensions.modelcontextprotocol.io/api/). These define the protocol mechanisms used at the application and host boundaries.
