# How authorized playback works

This guide follows [SAGA A2UI v0.1.0](https://github.com/MachineWisdomAI/saga-a2ui/tree/v0.1.0) (`dda384de`, 2026-10-18). The Lit demo lets a signed-in synthetic subscriber press Play to authorize and fetch a generated audio episode. The server checks entitlement on every Play and again on every media request. A capability is usable only with a proof from the requesting view's private key.

The design is the [authorized playback Blueprint](../blueprints/features/authorized_playback.blueprint.md). For setup and the complete delivery rules, see [PLAY1](../README.md#play-an-episode-only-after-a-fresh-entitlement-check-play1) and [PLAY2](../README.md#protected-media-expiry-and-delivery-constraints-play2).

## Where playback fits in v0.1.0

Here, v0.1.0 identifies the repository snapshot. Its workspace packages remain private and unversioned; this guide is not a registry installation recipe.

The demo now consumes extracted SDK packages. The main A2UI view uses `@saga-a2ui/core` for decoding and `@saga-a2ui/lit` for rendering. Playback is a separate, authored Lit view: its controller and Web Audio player still belong to the application, while `@saga-a2ui/mcp/view` owns the bridge connection's lifetime.

```text
apps/lit-host/src/playback-main.ts           # composition root of the player iframe
├── lit/play-control.ts                     # Play / Pause / Resume and status
├── playback/playback-view.ts               # authorization, fetch and player lifecycle
│   └── @saga-a2ui/mcp/view                  # connectToolResultView: results and teardown
│       └── MCP Apps App + PostMessageTransport → host bridge
└── playback/web-audio-player.ts             # browser audio context and playback

apps/lit-host/src/mcp/listener.ts            # HTTP server outside the iframe
├── /playback/mcp → playback/playback-server.ts
└── /playback/media/{id} → playback/media-service.ts
```

The reusable action runtime also exists in v0.1.0: direct bindings, asynchronous local actions, resource scopes and server actions. **Play has not migrated to it.** This button still calls the playback controller directly; the `Action` / `TypedAction.server` examples in the README are separate consumers. Request bounds, session-label recovery and player resource ownership still need their application-specific decisions before that migration.

The MCP integration uses `ext-apps` 2.0.3 and the split MCP SDK 2 packages (`client`, `core`, `server` 2.3.1; `node` 2.1.1). The listener uses `NodeStreamableHTTPServerTransport`; a handler reads verified identity from `ctx.http.authInfo` and request metadata from `ctx.mcpReq._meta`. Browser views use `App` and `PostMessageTransport`. These replace the old monolithic SDK imports without changing the capability/proof protocol below.

## One Play press

![Sequence of one Play press: the view prepares audio and creates a key pair, the host forwards play_episode to the protected endpoint, the handler checks entitlement and gets a capability bound to the view's key, the view fetches the bytes with the capability and a signed proof, the media service checks the capability, the proof and current entitlement again, and the view shows Playing once the audio clock advances.](../diagrams/authorized-playback-play-sequence.png)

[Editable Mermaid](../diagrams/authorized-playback-play-sequence.mmd) · [SVG](../diagrams/authorized-playback-play-sequence.svg)

The press calls `player.prepare()` synchronously, so the browser unlocks audio inside the user's click before any network work starts. The view then creates an ECDSA P-256 (ES256) key pair. The private key is non-extractable and stays in the view. Only the public key travels, in the Play call's `_meta` under `saga-a2ui/recipient-key`; the arguments stay `{ episodeId }`.

The host forwards the call to `POST /playback/mcp` with the signed-in user's bearer token. Before any tool runs, the endpoint checks the body size, the token and its `playback:play` scope, then the JSON-RPC shape, the tool name and the argument bounds.

`play_episode` takes the account from the verified token, never from the arguments, and its strict input schema rejects a forged `accountId`. If the public key is missing or malformed, it returns "Playback is not supported here." before looking anything up. Otherwise it checks the account's entitlement to the episode at that moment and asks the media service for a capability bound to the account, the episode and the public key's RFC 7638 thumbprint. The result has two projections. `content` holds only the fixed sentence "Playback authorized." The capability, media URL and expiry go only in `_meta['saga-a2ui/playback']`, which MCP Apps documents as not intended for model context.

The model cannot call `play_episode`: it declares `visibility: ['app']`, so the host offers it only to the view. The model-visible tool is `get_playable_episode`. It mounts the player and requires sign-in, but it checks no entitlement and issues no capability.

The view accepts a Play result only if it names the selected episode, the sign-in the view pinned when it opened, and the media path for that episode. It then fetches the bytes with the capability and a newly signed proof, without following redirects. The media service checks that request on its own, including whether the account is still entitled. The view decodes the bytes with Web Audio and shows Playing only after the audio clock advances.

## What the media service checks

![Media request checks in order: both headers present; capability issued, unexpired and for this episode; proof is a fresh ES256 JWT naming GET, this URL and this capability; proof key matches the key the capability was issued to; proof ID never used; account still entitled. Any failed check returns the same 403, and a revoked entitlement also drops the capability. A failed entitlement lookup or storage read returns 503 and keeps the capability. After every check passes, the Range header decides between 200 for the whole body, 206 for one byte range, and 416 for any other bytes range.](../diagrams/authorized-playback-media-checks.png)

[Editable Mermaid](../diagrams/authorized-playback-media-checks.mmd) · [Editable Excalidraw](../diagrams/authorized-playback-media-checks.excalidraw) · [SVG](../diagrams/authorized-playback-media-checks.svg)

`GET /playback/media/{episodeId}` does not identify the person. Cookies and bearer tokens play no part. The capability, the proof and the account's current entitlement decide every request. The proof is a JWT signed with the view's private key. It names the method, the exact URL and the SHA-256 hash of the capability, and carries its own `iat` and single-use `jti`, so every request, including each byte range, needs a new proof. A capability lasts 60 seconds from issue on the service's clock, and the service stores only its hash.

After the proof checks, the service asks the application's `checkEntitlement` again, for the account and episode the capability was issued for. If the answer is no, the service refuses the request and drops the capability, so access granted again later needs a new Play. If the lookup itself fails, or the storage read fails, the answer is `503` with the body `{"error":"unavailable"}`. That is neither a grant nor a refusal, and the capability stays usable.

Every refusal is the same `403` with the body `{"error":"forbidden"}`, so a caller cannot tell which check failed, and storage is not read. Only a caller who passed every check gets the `Range` header interpreted: one `bytes=` range is `206`, any other `bytes=` range is `416` with the total length and no body, and no range or another unit gets the whole body with `200`. Every answer that can carry bytes or a status is `Cache-Control: private, no-store` with `Vary: Origin, Range, x-saga-capability, x-saga-proof`, so a cache cannot answer one user with another's bytes.

Revocation and expiry decide the next request only. A response that already passed every check finishes, and bytes the browser already received cannot be retracted.

The media path answers any origin (`Access-Control-Allow-Origin: *`) because the sandboxed iframe sends `Origin: null`. That is safe only because nothing ambient authorizes a media request. The service never redirects, and the player fetches with `redirect: 'error'`, so the capability and proof headers never follow a redirect to another destination.

## Player view states

![Player view states: host teardown or disposal retires the controller from any active state; an opener result leads to ready; Play moves to pending; pending leads to playing once the audio clock advances, to ended if the audio ended before the start was confirmed, to a retryable failure, or to unsupported or session-changed. Within loaded audio, playing, paused and resume-blocked move between each other, and any of them moves to ended when the audio ends. Ended and the retryable failures start a new Play.](../diagrams/authorized-playback-view-states.png)

[Editable Mermaid](../diagrams/authorized-playback-view-states.mmd) · [SVG](../diagrams/authorized-playback-view-states.svg)

The view shows what the audio actually did. Pause shows `paused` only once the audio context has suspended, and Resume shows `playing` only once the audio clock advances again. A Resume that the browser withholds shows `resume-blocked` and keeps the position; the next press retries it without a new authorization. A Pause or Resume that the player cannot perform shows `media-failed`. A `403` from the media service, meaning expiry or revocation between the grant and the fetch, shows `expired`. Any other media failure (network, `5xx`, a redirect, undecodable bytes, a blocked origin) shows `media-failed`. If a short episode ends before the player confirms that it started, the view keeps that end and shows `ended` instead of the late "started" result.

Play is one action invocation, bound to the rendered control and owned by the shared action runtime. A changed selection changes the invocation's subject, so an undecided Play is canceled at its next checkpoint (its signal aborts), and the player owner stops the audio at once. Any opener, including a malformed one that leaves the same item selected, also retires an undecided Play, and the media request is sent only after a final checkpoint that reads the work deadline. If the control that started a Play is retired or replaced while it is pending, the view shows `ready` (nothing sent), plain `unavailable` (grant known) or the unknown-outcome `unavailable` (request sent); a later press on the replacement is a new Play. A late response from an earlier invocation cannot restore audio. Presses are ignored while authorization is pending (the binding is busy) or audio is loaded (application state). Every authorization retry is a new Play with a fresh entitlement check; the view never reuses a capability. Resume of already-loaded audio is different: it uses the existing decoded bytes. While the controller is active, a new opener result resets it to `ready` when it carries the pinned sign-in label. An opener or a Play grant under a different label ends the controller for good: it clears the selection, stops the player, shows `session-changed` with no control and asks the user to open a new view or reload. Later openers, including one under the old label or an unreadable one, are ignored, and Play, Pause and Resume do nothing. A new view or a reload pins its own label.

One work interval (the action's work deadline, 30,000 ms by default and overridable through the action host's `limits`) covers the whole press: it starts after the synchronous prefix, spans creating the recipient key, the host call, proof signing, the media request and body, decoding and starting, and ends with any outcome, but not with a successful start. When it expires the invocation fails with a timeout (the signal aborts, the owner stops the audio, a late result is dropped, including one that arrives after the deadline but before its timer) and the view shows `unavailable`. If the Play request may already have reached the server (a rejected, timed-out or aborted host call, a generic tool error, or a success whose private grant is missing, malformed or for another episode) the outcome is unknown, so the view says playback could not be confirmed, offers no Try again and asks the user to open the episode again; the view-state diagram above predates this wording. Only the server's fixed denied and unsupported refusals and a valid matching grant make the result known; a generic error does not, because the server issues the capability before it finishes the response. An expiry before anything was sent, or after a valid matching grant, keeps Try again. The view never claims that a rejected host call was a sign-in problem, because the host does not say.

Host teardown is terminal for this controller. It aborts the media fetch, releases the player and prevents Play, Pause, Resume, end events and outstanding asynchronous work from presenting anything or starting another request. The diagram's **retired** node describes this internal lifetime; it is not a displayed player status. Teardown stops bridge delivery, but the later `dispose()` still closes the connection exactly once. The page also calls `dispose()` on `pagehide` if no teardown arrived.

Cleanup belongs to the Play that started the work. The player owner hands out one lease per Play and ends exactly the lease it is given. If an old `player.start()` settles after retirement, it releases the player only if no lease holds it now; an old completion must never stop newer audio. These teardown and cleanup rules are implemented in v0.1.0. The label-loss rule above follows the 2026-10-19 decision (final loss, recovery by a new view or reload). A delayed opener under the same label cannot be detected, and none of this proves teardown, view reuse or cancellation behavior in an actual assistant host.

## The shared request gate

Both protected MCP endpoints run the same checks in the same order, in `serveProtected` in [`listener.ts`](../apps/lit-host/src/mcp/listener.ts). Each endpoint supplies only a `ProtectedRequestPolicy` (its tool names and size bounds), an `AuthRequirement` (its challenge realm and scope) and a server factory.

```text
handle(request)
├── /playback/media/{id}  → serveMedia → mediaService.acquire   (capability and proof only)
├── /subscriptions/mcp    → serveProtected(subscriptions endpoint)
└── /playback/mcp         → serveProtected(playback endpoint)
      1. declared Content-Length within policy.limits.maxRequestBytes
      2. authenticate(verifier, requirement): bearer token, realm, scope
      3. Content-Type and Accept headers
      4. read the body, up to policy.limits.maxRequestBytes (a bounded stage)
      5. classifyProtectedBody(body, policy): JSON-RPC shape, allowed tools, argument bounds
      6. endpoint.createServer(lifetime) runs the tool with the verified identity
      (every step above is a stage of the request's one lifetime, started at admission)
```

The media path answers a CORS preflight with `204` and rejects any method other than `GET` or `OPTIONS` with `405`.

## Where the code lives

| File | Role |
| --- | --- |
| [`playback-main.ts`](../apps/lit-host/src/playback-main.ts) | Composes the bridge, controller, controls and Web Audio player; disposes on page exit |
| [`@saga-a2ui/mcp/view`](../packages/mcp/src/view/index.ts) | Registers listeners before connecting, forwards teardown, stops delivery and closes once on disposal |
| [`playback/playback.ts`](../apps/lit-host/src/playback/playback.ts) | Contract shared by server and view: tool names, `_meta` keys, strict schemas, fixed sentences |
| [`playback/playback-server.ts`](../apps/lit-host/src/playback/playback-server.ts) | `play_episode` and `get_playable_episode` |
| [`playback/media-service.ts`](../apps/lit-host/src/playback/media-service.ts) | Issues capabilities and decides every media request, including the entitlement check |
| [`playback/media-range.ts`](../apps/lit-host/src/playback/media-range.ts) | Reads a `Range` header after authorization; grants nothing |
| [`playback/recipient-proof.ts`](../apps/lit-host/src/playback/recipient-proof.ts) | The view's key pair and per-request proof |
| [`playback/playback-view.ts`](../apps/lit-host/src/playback/playback-view.ts) | View controller: request generations, terminal teardown and acquisition-scoped cleanup |
| [`playback/web-audio-player.ts`](../apps/lit-host/src/playback/web-audio-player.ts) | Web Audio player: prepare, start, pause, resume |
| [`lit/play-control.ts`](../apps/lit-host/src/lit/play-control.ts) | Play button and status line |
| [`mcp/protected-request.ts`](../apps/lit-host/src/mcp/protected-request.ts), [`mcp/request-auth.ts`](../apps/lit-host/src/mcp/request-auth.ts) | Body classification and bearer authentication for the shared gate |

## Limits

- [Bounded host observations on 2026-10-18](https://github.com/MachineWisdomAI/saga-a2ui/issues/12#issuecomment-6250638974) exercised the v0.1.0 playback implementation in ChatGPT web and Claude web, both in Edge. ChatGPT rendered the card immediately; Claude needed a display retry and failed to render it after reload. In both, an explicit Play completed entitlement checking and delivered private playback metadata without a tool/protocol error. Audio did not play: the fixture's media URL remained loopback and no media read reached it. This is evidence of authorization and metadata delivery, not successful audio, host teardown or final host acceptance.
- Recipient binding needs the host to forward `_meta` on the view's proxied `tools/call`, and media delivery needs iframe `fetch` with custom headers to reach the declared origin. A local host fixture tests dropped request metadata: Play fails closed as `unsupported`, with no entitlement check or protected fetch.
- The view controller does not check a media URL's origin itself. The resource's declared `connect-src` is what blocks an undeclared destination, so a host that ignores the resource's CSP would not block one.
- The built player fetches the whole body and never sends `Range`. Range handling is tested at the service's HTTP edge through the real listener, not through the player.
- No shared cache is simulated. Cache safety rests on the `private, no-store` and `Vary` headers.
- The synthetic entitlement lookup and storage are in memory. A real application owns how quickly a revocation takes effect; this service guarantees only that it asks on every request.
- Headless Chromium shows that the audio clock advances, not that the sound is audible.
