# How authorized playback works

PLAY1 ([#56](https://github.com/MachineWisdomAI/saga-a2ui/pull/56)) lets a signed-in synthetic subscriber press Play in the embedded Lit player and hear a protected episode. PLAY2 ([#58](https://github.com/MachineWisdomAI/saga-a2ui/pull/58)) adds expiry, revocation and delivery rules for the media itself. The server checks the account's entitlement on every Play and again on every media request, and only the player view that asked can fetch the audio. The design is the [authorized playback Blueprint](../blueprints/features/authorized_playback.blueprint.md). Run commands, the wire mapping, the delivery rules and the full list of limits are in the README sections [Play an episode only after a fresh entitlement check (PLAY1)](../README.md#play-an-episode-only-after-a-fresh-entitlement-check-play1) and [Protected media expiry and delivery constraints (PLAY2)](../README.md#protected-media-expiry-and-delivery-constraints-play2).

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

![Player view states: an opener result leads to ready; Play moves to pending; pending leads to playing once the audio clock advances, to ended if the audio ended before the start was confirmed, to a retryable failure, or to unsupported or session-changed. Within loaded audio, playing, paused and resume-blocked move between each other, and any of them moves to ended when the audio ends. Ended and the retryable failures start a new Play.](../diagrams/authorized-playback-view-states.png)

[Editable Mermaid](../diagrams/authorized-playback-view-states.mmd) · [SVG](../diagrams/authorized-playback-view-states.svg)

The view shows what the audio actually did. Pause shows `paused` only once the audio context has suspended, and Resume shows `playing` only once the audio clock advances again. A Resume that the browser withholds shows `resume-blocked` and keeps the position; the next press retries it without a new authorization. A Pause or Resume that the player cannot perform shows `media-failed`. A `403` from the media service, meaning expiry or revocation between the grant and the fetch, shows `expired`. Any other media failure (network, `5xx`, a redirect, undecodable bytes, a blocked origin) shows `media-failed`. If a short episode ends before the player confirms that it started, the view keeps that end and shows `ended` instead of the late "started" result.

Each Play gets a generation number. A new press after a failure, a changed selection or sign-in, a denial, or disposal advances the generation, aborts the byte fetch and stops the player, so a late response to an earlier request cannot restore audio. Presses are ignored while a request is pending or audio is loaded. Every retry is a new Play with a fresh entitlement check; the view never reuses a capability. A new opener result resets the view to `ready`, or to `session-changed` if it belongs to a different sign-in.

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
      4. read the body, up to policy.limits.maxRequestBytes
      5. classifyProtectedBody(body, policy): JSON-RPC shape, allowed tools, argument bounds
      6. endpoint.createServer() runs the tool with the verified identity
```

The media path answers a CORS preflight with `204` and rejects any method other than `GET` or `OPTIONS` with `405`.

## Where the code lives

| File | Role |
| --- | --- |
| [`playback/playback.ts`](../apps/lit-host/src/playback/playback.ts) | Contract shared by server and view: tool names, `_meta` keys, strict schemas, fixed sentences |
| [`playback/playback-server.ts`](../apps/lit-host/src/playback/playback-server.ts) | `play_episode` and `get_playable_episode` |
| [`playback/media-service.ts`](../apps/lit-host/src/playback/media-service.ts) | Issues capabilities and decides every media request, including the entitlement check |
| [`playback/media-range.ts`](../apps/lit-host/src/playback/media-range.ts) | Reads a `Range` header after authorization; grants nothing |
| [`playback/recipient-proof.ts`](../apps/lit-host/src/playback/recipient-proof.ts) | The view's key pair and per-request proof |
| [`playback/playback-view.ts`](../apps/lit-host/src/playback/playback-view.ts) | View controller: request generations and states |
| [`playback/web-audio-player.ts`](../apps/lit-host/src/playback/web-audio-player.ts) | Web Audio player: prepare, start, pause, resume |
| [`lit/play-control.ts`](../apps/lit-host/src/lit/play-control.ts) | Play button and status line |
| [`mcp/protected-request.ts`](../apps/lit-host/src/mcp/protected-request.ts), [`mcp/request-auth.ts`](../apps/lit-host/src/mcp/request-auth.ts) | Body classification and bearer authentication for the shared gate |

## Limits

- Not yet tried on ChatGPT or Claude. Recipient binding needs the host to forward `_meta` on the view's proxied `tools/call` and to let the sandboxed iframe `fetch` the media origin with custom headers. The local host fixture shows that Play fails closed (`unsupported`, no protected fetch) when it does not.
- The view controller does not check a media URL's origin itself. The resource's declared `connect-src` is what blocks an undeclared destination, so a host that ignores the resource's CSP would not block one.
- The built player fetches the whole body and never sends `Range`. Range handling is tested at the service's HTTP edge through the real listener, not through the player.
- No shared cache is simulated. Cache safety rests on the `private, no-store` and `Vary` headers.
- The synthetic entitlement lookup and storage are in memory. A real application owns how quickly a revocation takes effect; this service guarantees only that it asks on every request.
- Headless Chromium shows that the audio clock advances, not that the sound is audible.
