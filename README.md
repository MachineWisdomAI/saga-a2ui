# SAGA A2UI

Safe Agentic Generative Applications — by [Machine Wisdom](https://machine-wisdom.ai).

TypeScript middleware for connecting existing services to assistant experiences, with renderer choice, explicit data-sharing rules, and server authorization hooks.

## Status

Repository setup is underway. A minimal private Lit application (`apps/lit-host`) builds and renders locally. Three private, unreleased SDK packages (`packages/core`, `packages/lit` and `packages/mcp`) exist and no host compatibility is available yet, and the app has not been verified in ChatGPT or Claude. This repository starts private and is intended to become public after a separate publication decision.

The first implementation will exercise a small Lit application in ChatGPT and Claude. React and Lynx remain Stage A targets; Alexa+ enters the initial host investigation.

## Planned packages

| Package | Responsibility |
| --- | --- |
| `@saga-a2ui/core` | Renderer-independent value objects and processing interfaces, with protocol-specific implementations in separate modules |
| `@saga-a2ui/mcp` | MCP app integration, data and action boundaries, and protocol error mapping |
| `@saga-a2ui/components` | Optional renderer-neutral component contracts and shared component behavior |
| `@saga-a2ui/lit` | Lit renderer integration |
| `@saga-a2ui/react` | React renderer integration |
| `@saga-a2ui/lynx` | Lynx renderer integration |

Developers retain their normal renderer tools and write the code that calls their APIs. A2A is a later integration; no placeholder package is published.

## Content safety

**Standard** permits validated HTTPS links through the host and images from explicitly allowed HTTPS hosts. **Strict** keeps every link inert, shows blocked fragments as accessible placeholders the reader can reveal as text, and loads a permitted image only after the reader chooses Show images. Both preserve ordinary Markdown formatting and retain server authorization and data-sharing checks. Application code controls the policy.

The planned FaithfulCard component displays supplied Markdown without rewriting or silent truncation. Ansari-specific branding and presentation rules remain in Ansari.

## Development

This is an npm workspace skeleton; the root is private and is never published. Build and test commands for the local Lit application are under Local development below. See [contributing](CONTRIBUTING.md) and [package layout](packages/README.md).

## License

The SDK uses [Apache-2.0](LICENSE). Preserve applicable third-party licenses and notices when adding dependencies or extracted code.

## Local development

Requires Node 22.12.0 or newer (pinned in `.nvmrc`; `nvm use`) and npm. No global tools are needed.

    npm ci                              # install from the committed lockfile
    npm start                           # Vite dev server at http://127.0.0.1:5173
    npm run build                       # build the Lit app into apps/lit-host/dist
    npm run typecheck                   # tsc --noEmit
    npm run test:headless               # protocol decoding/processing in plain Node (no DOM, no browser)
    npx playwright install chromium    # explicit browser install; verify does not download one
    npm run test:browser                # serves the built page and checks the visible title
    npm run verify                      # guards, typecheck, build, tests, LFS, and version enrollment

`test:browser` expects `npm run build` to have run first; it loads the built page in Chromium and asserts that the heading "SAGA A2UI" is visible. CI (`.github/workflows/ci.yml`) installs Chromium, then runs `npm run verify`. Verify includes typecheck, build, the headless tests and the browser check, so CI does not run that suite a second time.

### Repository verification

`npm run verify` is the one local and CI route. It runs the static guard, headless and browser discovery checks, typecheck, build, headless tests, browser tests, Git LFS pointer check, and version-enrollment check, in that order. It stops at the first failing command and uses that command's exit code. Git LFS must already be installed; the pointer check calls `git lfs`.

Browser installation is an explicit prerequisite. Install the Playwright browser this repository already depends on before verify. Verify does not download a browser and does not substitute a different one:

    npx playwright install chromium

CI runs `npx playwright install --with-deps chromium` before `npm run verify`.

Each invocation writes a disposable receipt to `.wise-agents/verify-receipts/` (ignored) and copies it to `latest.json` in that directory. The receipt records the working directory, the verify process arguments, the Node and npm versions that actually ran, the git commit and tracked dirty state at each command boundary, and each command's name, arguments, timestamps, and exit code. It does not record environment variables or command output, so do not put secrets in command arguments. A run is labeled `pristine-head` only when the commit and tracked dirty state are clean at the start and unchanged through every command that ran. A dirty tracked file or a commit created during verification is recorded as `not-pristine-head`. That label is not itself a failure. Detection is at command boundaries, not a continuous watch. `--exec` replaces the repository suite and marks the receipt `exec`; `npm run verify` does not pass it.

The static guard is not a general truthiness analysis and does not prove a policy is correct. It reports `||` whose left operand, after removing parentheses and zero-argument `.trim()` calls, is a string or untagged template that contains fixed non-whitespace text. It reports the file and line and exits nonzero. It does not flag identifiers, interpolation-only templates, whitespace-only fixed text, `||` nested inside an interpolation, concatenation, `&&`, `??`, non-zero-argument `.trim()`, or other methods. It parses authored `.ts`, `.tsx`, `.mts`, and `.cts` files with the TypeScript compiler and skips `.d.ts`, dependencies, and generated output (`node_modules`, `dist`, `coverage`, `test-results`, `playwright-report`). It does not typecheck.

Test discovery asks Vitest for its file list (`vitest list --filesOnly` against `vitest.config.ts`) and compares that with authored `*.test.ts` files. Playwright `*.spec.ts` files are compared separately with `playwright test --list`. An authored file omitted by its runner fails the check. The file walk does not exclude fixture or `e2e` tests. Discovery does not run the tests, measure coverage, or prove an architectural boundary.

Passing verify does not guarantee coverage, host compatibility, or architecture.

The only application is `apps/lit-host` (private, not published). It deliberately declares no `version`, so it introduces no owned version to enroll; add one only through the repository's version-policy bootstrap when that tooling exists. The workspace root stays private; `packages/core`, `packages/lit` and `packages/mcp` are the SDK packages so far (private, unreleased, no version).

### Fixture rendering (A2UI v0.9)

`apps/lit-host` renders a developer-authored A2UI v0.9 surface from synthetic public data. Tested, exactly pinned versions: `@a2ui/lit` 0.13.0, `@a2ui/web_core` 0.13.0 (both Apache-2.0), `zod` 3.25.76 (required by both; each installs its own nested copy, see "MCP Apps 2 recipe" below), `lit` 3.3.3, Node 22.12.0+. The optional peer `@a2ui/markdown-it` is deliberately not installed.

Modules in `apps/lit-host/src` (application-local; MCP delivery moved to `@saga-a2ui/mcp` later, see "Reusable MCP connector (CORE1)"):

- `@saga-a2ui/core` (`packages/core`) owns the A2UI v0.9 message cases, `MessageDecoder` and `createMessageSession` that used to live here, plus the Zod 3 alias catalogs author schemas with. See "Core and Lit packages (VIEW1)".
- `saga-panel/contract.ts`, `saga-panel/fixture.ts`: renderer-neutral `SagaPanel` contract and synthetic fixture data.
- `lit/integration.ts`: Lit panel element, catalog, and the explicit `registerLitElements()` setup (nothing registers at import time).
- `lit/saga-app.ts`: the application's `saga-app` element, built on `createA2uiAppElement` from `@saga-a2ui/lit`. The package owns the session, subscriptions, rejection fallback (failures as inert text) and disposal; the application adds the heading, its content policy and the `window.sagaSend` hook.
- `main.ts`: composition root; constructs and connects the above.

Call path: `window.sagaSend(unknown)` -> `saga-app` -> `session.ingest` -> decoder -> visitor -> upstream processor -> surface model -> Lit.

Invalid messages, unknown catalogs/components or wrongly typed properties produce a visible "Could not render this content" alert and clear the surface (see "Core and Lit packages (VIEW1)"). Values render only as Lit text bindings, so supplied markup stays inert text. The description is the one value read as Markdown, under a trusted content policy; see "Standard descriptions (POL1)" below.

`npm run test:headless` (vitest, Node) covers decoding and processing through the public `@saga-a2ui/core` interface only (`packages/core/src/protocols/a2ui/v0_9/protocol.test.ts`). Browser tests cover rendering, binding, inert markup, recovery and mount/unmount.

`e2e/*.spec.ts` drive the real processor through the typed `window.sagaSend` entry point and assert rendered output. Recipe (same commands as above): `npm ci && npm run typecheck && npm run build && npx playwright install chromium && npm run test:browser`.

### MCP tool result in the view (MCP1)

`apps/lit-host` also hosts an ordinary MCP server and renders one of its tool results through the same A2UI session. Public synthetic data only; no authentication, playback, SDK packages or actual-host (ChatGPT/Claude) acceptance.

Pinned additions (exact; the MCP packages are the MCPV2 recipe below): `@modelcontextprotocol/ext-apps` 2.0.3 (MIT; its optional `react` peers are not installed) with `client`, `core` and `server` 2.3.1 and `node` 2.1.1 (Apache-2.0), dev-only `vite-plugin-singlefile` 2.3.3, `tsx` 4.23.15, `@types/node` 22.20.5. No MCP-UI, CopilotKit, AG-UI or Ora packages are used; the only overlap is shared standards (MCP, MCP Apps, A2UI).

    npm run build         # app, the single-file view (dist/view/view.html) and the test-only host fixture
    npm run serve:mcp     # MCP server at http://127.0.0.1:3001/mcp (PORT overrides); needs the build first

Modules in `apps/lit-host/src`:

- `mcp/episode.ts`: public contract shared with the view (input shape, bounded `PublicEpisode`); imports only `zod`.
- `mcp/server.ts`: `createEpisodeServer` declares one explicitly public, read-only operation `get_episode` (runtime-validated `episodeId`) and the `ui://saga-a2ui/episode-view.html` resource through `registerPublicOperation` from `@saga-a2ui/mcp/server`. Only `episodeId`, `title` and `description` are projected from a record. The resource is the built HTML served verbatim, so request data never enters cached HTML; its CSP metadata allows no network or external resources.
- `mcp/listener.ts`: application-owned loopback Streamable HTTP hosting (`POST /mcp`, stateless, JSON responses, Host-header DNS-rebinding protection, no auth because the tool is public).
- `mcp/view.ts`, `view-main.ts`, `view.html`: the view connects the MCP Apps `App` bridge, then turns each tool result into an A2UI data-model update and hands it to the existing session. Decoding stays in `protocols/a2ui`; rendering stays in `lit/`. `vite.view.config.ts` builds it to one HTML file with no server imports.
- `e2e/host-fixture`, `e2e/mcp-view.spec.ts`: a test-only local host with a real `AppBridge` and a `sandbox="allow-scripts"` iframe. The spec makes real `tools/call` and `resources/read` requests over HTTP, delivers the result, and checks the wire result, rendered title, CSP and resource linkage. `e2e/view-bundle.spec.ts` checks the built artifacts for server code and credentials. The fixture is not evidence of compatibility with any actual host.

### MCP result lifecycle in the view (MCP2)

`connectEpisodeView` (`apps/lit-host/src/mcp/view.ts`) applies each result to the A2UI session over the bridge connection that `connectToolResultView` from `@saga-a2ui/mcp/view` owns, and nothing else: A2UI decoding stays in `protocols/a2ui`, and the session and surface lifetime stay with `saga-app`. It uses only the upstream `App` API from `@modelcontextprotocol/ext-apps`; there is no extra host handshake and no second fetch of the answer (the host delivers the result it already has).

- Initialization: the `toolresult` listener (`addEventListener`) and `onteardown` are registered before `app.connect`, so a result the host sends right after the handshake is rendered exactly once.
- Replacement: each valid public result is applied as a data-model update and replaces the one shown.
- Failure: an error result, a result that is not a public episode (including undeclared fields) or an ingest failure removes the panel surface and shows a plain-text fallback in `[data-testid="view-problem"]`. The next valid result recreates the surface and clears the fallback.
- Teardown: the resolved `EpisodeViewConnection.dispose()` removes the listener and closes the `App`; it also runs if `connect` fails. A host `ui/resource-teardown` request releases the listener and answers the host, which then ends the connection. Results arriving afterwards are ignored. Connecting the same `App` again starts with exactly one listener, so delivery is not duplicated.

Tests: `src/mcp/view.test.ts` (`npm run test:headless`) joins a real `App` and `AppBridge` over an in-memory transport with a real A2UI session. `e2e/mcp-view.spec.ts` (`npm run test:browser`) controls delivery order through the test-only host fixture's real `AppBridge` against the built view: a result sent during initialization, replacement, each failure kind with recovery, delivery after teardown, and remount. Account or selection isolation is a separate, later concern.

### Subscriptions for the verified request identity (BROWSE1)

A second, protected MCP endpoint, `POST /subscriptions/mcp`, returns the signed-in user's own subscriptions from a synthetic account fixture. Synthetic data only; no real Patreon access, no actual-host (ChatGPT/Claude) acceptance. No new dependencies. (This section describes the slice as built; its MCP delivery now runs through `@saga-a2ui/mcp`, see "Reusable MCP connector (CORE1)".)

- `mcp/request-auth.ts`: application-owned authentication. A bearer credential is checked by an `OAuthTokenVerifier` (the MCP server package's own interface; an unknown credential is an `OAuthError` with `OAuthErrorCode.InvalidToken`) before any server is built or backend called. Missing credential: `401` with `WWW-Authenticate: Bearer realm=...`; malformed, unknown or expired: `401 invalid_token`; verified but not a user (service-only, no account or scope): `403 insufficient_scope`. The accepted credential is copied into a frozen, request-owned snapshot of the validated claims before it is attached to `req.auth`: the transport reads that context only after the body arrives, so a verifier that reuses or mutates its own `AuthInfo` cannot change which account an earlier request was authenticated as. The snapshot reaches the tool only as the SDK's per-request `ctx.http.authInfo`, read inside each invocation; an `accountId` argument is dropped. An optional `status` filter is the only declared argument, and it cannot name an account. There is no shared current-user state.
- `mcp/dev-auth.ts`: **development-only** verifier with fixed public tokens (`DEV_TOKENS`). It throws when `NODE_ENV=production`, is imported only by `mcp/serve.ts` (the loopback demo) and tests, and is kept out of the browser bundles (checked by `e2e/view-bundle.spec.ts`). A remote host must pass its own configured `verifier` to `startEpisodeListener({ subscriptions })`; the listener has no default.
- `mcp/subscriptions.ts`, `mcp/subscriptions-server.ts`: strict, bounded zod projection. Each field is copied from the backend record explicitly (no spreading) and the result is validated before serialization; a record that breaks the contract yields a generic tool error. Canary private fields never reach the wire.
- View session: the result carries an opaque label (`vs_` + 22 characters, an HMAC of the sign-in id under a per-process key). `mcp/subscriptions-view.ts` pins the opening host delivery; a different label, an unknown shape, or an error clears the private view. A `toolinput` notification does not authenticate the next `toolresult` — those notifications are not correlated. When the host proxies server tool calls, a new input starts `App.callServerTool`, and only that response may establish or recover the pin. That read carries the declared `status` filter from the input's business arguments, so a filtered read stays filtered: an undeclared field such as `accountId` is dropped, and a status the tool does not support clears the view instead of widening the read. A finished read does not recycle its identity, so an older in-flight response cannot satisfy a later read or restore private rendering after a later refusal. An unsolicited notification cannot open private rendering, but an error, a changed label, or an unknown shape still clears the view while a correlated read is in flight and retires reads that started before that loss. Only a correlated read started after the loss may recover. A refusal of the proxied call (the listener's HTTP 401/403, before any tool handler) keeps the view cleared. The label controls freshness only; the server authorizes every call.
- `subscriptions.html`, `src/subscriptions-main.ts`: the view, built to `dist/subscriptions-view/subscriptions.html`. States: subscriptions, empty, sign-in required, retry, problem. Values are written with `textContent`.
- `connectToolResultView` (bridge lifetime) is the `@saga-a2ui/mcp/view` export that the episode, subscriptions, answer and playback views share.

Try it locally (`npm run build` first): `curl -s -X POST http://127.0.0.1:3001/subscriptions/mcp -H 'authorization: Bearer dev-only-token-alice' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_subscriptions","arguments":{}}}'`.

### Recovering from a failed subscription read (BROWSE2)

Install and run the same way as the rest of the app: `nvm use`, `npm ci`, `npm run build`, then `npm run serve:mcp`. The protected path is `POST /subscriptions/mcp`. Sign in with a bearer token the configured verifier accepts. The loopback demo accepts only the development tokens printed in `mcp/dev-auth.ts`; it refuses to start that verifier when `NODE_ENV=production`. A remote host passes its own `OAuthTokenVerifier` to `startEpisodeListener({ subscriptions })`. There is no separate diagnostic command.

Read the HTTP status before the JSON-RPC body. They are different failures, and none of them forwards a backend status or a raw `Error.message`.

| What you see | Class | Meaning |
| --- | --- | --- |
| `401` or `403`, `WWW-Authenticate: Bearer ...`, body `{ "error": "..." }` and no `jsonrpc` | Authorization | The credential is missing, invalid, expired, or not a user. The tool did not run. Sign in again. `insufficient_scope` means the credential is not a user sign-in. |
| `413`, `406` or `415`, body `{ "error": "..." }` and no `jsonrpc` | Transport | The body is over the browse limit, or `Content-Type` / `Accept` is missing. The tool did not run. Fix the request. A chunked body with no `Content-Length` is the same 413, sent before the connection is closed. |
| `400` or `200` with `jsonrpc`, `id` and `error`, and no `result` | Protocol | Malformed JSON (`id` is `null` when none can be read), a malformed call, unknown tool, or an argument over the input limit. A JSON-RPC batch is classified the same way before any element runs: a one-element batch keeps that element's error and id; a rejected longer batch is one invalid request and does not run the other elements. The tool name is not copied into the error. The `id` matches the request when one was present. The tool did not run. |
| `200` with `result.isError` and a fixed sentence | Tool failure | The known tool ran, or rejected its own business input, and returned a safe sentence. A backend read that does not finish within five seconds, or whose request is cancelled, is this failure (`Subscriptions are unavailable.`); a later resolution is not sent. An empty `subscriptions` array is not this: it is a successful read. |

The view then shows one of three subscriber states, and never the backend text:

- **Empty** (`data-state="empty"`): the read succeeded and there are no rows. Try again refreshes that same read.
- **Retry** (`data-state="retry"`): the read could not be completed. Private rows and the selection are cleared. Try again calls `list_subscriptions` with no arguments; it does not resend the failed input.
- **Cleared** (`data-state="problem"`): the result was not a subscriptions result, the projected output was invalid, or the business input was rejected. Private values are cleared. Try again is still only the safe read.

A selection stays only when the next successful read still contains that subscription id. A host refusal of the proxied call (HTTP 401/403, before the tool handler) keeps the sign-in-required state; a delayed copy of an earlier result cannot restore it.

Tests: `src/mcp/subscriptions.test.ts` (wire classes, limits, batch classification, chunked 413, a bounded backend read that does not emit late, and the failure fixture), `src/mcp/subscriptions-view.test.ts` (empty, retry, cleared, selection, the declared status filter through a real `App`/`AppBridge`, and a bounded read that does not emit late), `e2e/subscriptions-view.spec.ts` (the same wire results in the sandboxed view).

Tests: `src/mcp/subscriptions.test.ts` (real listener and bearer credentials over HTTP: concurrent users, forged account argument, canaries, bad backend data, every credential failure and its status/challenge, and a paused request whose verifier reuses one mutable `AuthInfo`), `src/mcp/subscriptions-view.test.ts` (session pinning, clearing, recovery only through the correlated `callServerTool` response, an older in-flight read that cannot reuse a later read's identity after a refusal, and session loss that clears while a read is pending), `e2e/subscriptions-view.spec.ts` (built view in the sandboxed host fixture: authorized, changed sign-in, a proxied tools/call whose listener 401 clears the view, a delayed prior result, and recovery from that call's response).

### Play an episode only after a fresh entitlement check (PLAY1)

A third protected MCP endpoint, `POST /playback/mcp`, lets the signed-in synthetic subscriber press Play in an embedded Lit view and hear a protected episode. Synthetic accounts and a generated tone only; no real Patreon access, no actual-host (ChatGPT/Claude) acceptance. One new runtime dependency: `jose` 6.2.12 (MIT) for JWT proofs and RFC 7638 key thumbprints; no MCP-UI, CopilotKit, AG-UI or Ora package is used.

    npm run build && npm run serve:mcp   # also prints the playback URL; dev tokens only (see mcp/dev-auth.ts)

Mechanisms chosen for the Blueprint's open decisions (the evidence is the tests named below, run through the real listener and the built view):

- **Recipient binding (decision 1): proof of possession.** The view creates a non-extractable ECDSA P-256 key and sends only its public half in the Play call's `_meta` (`saga-a2ui/recipient-key`); the arguments stay `{ episodeId }`. The media service binds the issued capability to the verified account, the episode and that key's thumbprint. A media request must carry the capability **and** a fresh ES256 proof signed by that key naming the exact URL, method and capability; each proof is single-use. A copied capability, another user, another episode, a missing, stale, replayed or mis-targeted proof and an expired capability each get a bodiless `403` and no protected read (`playback/media.test.ts`, `e2e/playback-view.spec.ts`). A bearer URL alone is never enough.
- **App-only declaration and private result channel (decision 3).** `play_episode` declares `_meta.ui.visibility: ['app']`; the only model-visible tool is `get_playable_episode`, which mounts the view and checks no access. A successful Play puts the capability **only** in `result._meta['saga-a2ui/playback']` (MCP Apps documents `_meta` as not intended for model context); `content` is a fixed sentence and there is no `structuredContent`. Both projections are strict, bounded zod schemas parsed before serialization. The static view resource is identical for every caller.
- **User gesture (decision 4).** The press calls `player.prepare()` synchronously (creating and resuming the `AudioContext` inside the activation), then authorizes asynchronously. If the browser still holds audio back, the view shows `gesture-needed` and a second explicit press plays; it never autoplays. Audio is fetched with `fetch` and decoded with Web Audio, so the view needs only `connect-src` for the media origin and no media element, URL or `media-src`.
- **Playing means audible.** The view reports `playing` only after the audio clock advances; `denied`, `sign-in-required`, `expired`, `unsupported`, `unavailable`, `media-failed` and `gesture-needed` are distinct states, and pending work is retired by a generation number so a late success cannot restore cleared media.
- **Pause, Resume and a short episode tell the truth.** `pause()` and `resume()` return promises, so the view shows `paused` or `playing` only once the audio did that. A Resume the browser withholds (`NotAllowedError`, or a clock that does not advance) shows `resume-blocked`, keeps the position, and the next explicit press retries it without a new authorization. A Pause or Resume the player cannot perform is `media-failed`. Audio that ends before the start is confirmed shows `ended`: the end is remembered for the request that was waiting, and the late `started` result cannot replace it, while a retired request still cannot restore anything.

Wire mapping, verified against `@modelcontextprotocol/server` 2.3.1 and `ext-apps` 2.0.3 (see the MCPV2 recipe below):

| Condition | Result |
| --- | --- |
| Missing, invalid, expired credential | HTTP `401` + `WWW-Authenticate`, before any tool |
| Service-only credential | HTTP `403 insufficient_scope` |
| Malformed call, unknown tool, oversized argument | JSON-RPC error from the request gate (`protected-request.ts`), tool not run |
| Known tool, invalid input (incl. a forged `accountId`) | `isError` result with a fixed sentence; the rejected key and value are not echoed |
| Denial, unknown episode | `isError`, "Playback denied: this account does not have access to this episode." (identical for both) |
| No usable recipient key (host dropped `_meta`) | `isError`, "Playback is not supported here."; zero entitlement checks, zero media reads |
| Backend failure, projection that breaks its contract | `isError` with a different fixed sentence; no capability, no backend text, nothing in logs |

Limits worth knowing:

- The MCP server package maps **any** handler failure to an `isError` result (and copies the thrown message into it, which is why handlers catch everything and return fixed sentences); it has no JSON-RPC internal-error path for a registered tool. The ticket's "sanitized internal error" is therefore an `isError` result with a fixed sentence and no success data. A distinct JSON-RPC `-32603` would need a change upstream or a custom dispatcher, which this slice does not add.
- Play's input is a strict object, so a forged `accountId` is rejected instead of dropped. MCP Apps 2 accepts that schema in `registerAppTool`, which also writes the legacy flat `ui/resourceUri` key, so Play and its opener use the helper like every other app tool.
- **Feasibility gap kept open:** recipient binding needs the host to forward `_meta` on the view's proxied `tools/call` and to let a sandboxed iframe `fetch` the media origin with custom headers. The local host fixture shows the mechanism works when it does and that Play fails closed when it does not (`unsupported`, no protected fetch). Neither ChatGPT web nor Claude web has been tried; their result decides whether each can carry the binding. Nothing here weakens the binding for a host that cannot.
- The media origin answers any origin (`Access-Control-Allow-Origin: *`, no credentials) because a sandboxed iframe sends `Origin: null`. That is safe only because no cookie or ambient header authorizes media; the capability and proof decide every request.
- Expiry, revocation, ranges, redirects, origins and caches are decided together in PLAY2 below. [Request and view lifetimes](blueprints/features/request_view_lifetimes.blueprint.md) proposes STATE1/STATE2 scope for selection races, teardown, cancellation and bounded request completion, replacing the [rejected account/session proposal](blueprints/features/account_session_isolation.blueprint.md). Design and breakdown approval remain pending; existing authentication and isolation safeguards and prerequisite edges remain.
- Audio device output is not asserted by headless Chromium beyond the audio clock advancing; "audible playback" in a real host is a Captain acceptance run.

Tests: `src/playback/playback.test.ts` (wire contract through the real listener: declaration, entitled/denied/unsupported/forged/replay, every credential failure, projections, fault mapping with log capture, CORS/CSP), `src/playback/media.test.ts` (recipient binding, replay, expiry, preflight), `src/playback/playback-view.test.ts` (the controller through a real `App`/`AppBridge` whose host forwards to the real listener), `e2e/playback-view.spec.ts` (built view in the sandboxed fixture with real Web Audio: playing, keyboard, denial, sign-in recovery, unsupported, replay after revocation, expiry, recipient binding, pending, live region, 320px reflow with 200% text), and `e2e/view-bundle.spec.ts` (no server code, credential or media element in the built view).

### Protected media expiry and delivery constraints (PLAY2)

The same example media service and foreground player, no new dependency and no general media proxy. The rules below are decided together and each one is pinned by a test named after the behavior. They build on PLAY1's recipient binding (capability plus a fresh single-use proof from the bound key); none of them weakens it.

Every acquisition, whole body or byte range, runs the same checks in this order and stops at the first failure with a bodiless `403` and no read of protected storage: capability known and unexpired on the **service's** clock, episode scope, proof from the bound recipient key (single-use, so a range needs its own proof), then **current entitlement**. Only then is storage read and the `Range` header interpreted.

| Rule | Decision |
| --- | --- |
| Lifetime | 60 seconds from issue (`capabilityTtlSeconds` overrides). Usable while `now < expiresAt`; the view is told that same `expiresAt`. Using a capability does not extend it. A new Play issues a new capability. |
| Revocation lookup | The application's own `checkEntitlement`, asked again on every acquisition for the account and episode the capability was issued for. A denial refuses the request **and drops the capability**, so access granted again later is reached only through a new Play, never by reviving an old copy. |
| Lookup or storage fault | Not a refusal and never a grant: a bodiless `503` (`unavailable`) with no dependency text on the wire or in logs, distinct from the `403` that means expired, revoked or misused. A fault does not revoke the capability. |
| In-flight response | A response that already passed every check is not tracked or cancelled and finishes. Every acquisition that **starts** after the revocation or expiry, including a range request issued while the first is still running, gets no bytes. |
| Bytes already delivered | Cannot be retracted. Stopping and clearing the player reduces continued use of held media; it does not erase what the browser or the host already buffered or downloaded. This is the explicit buffered-byte limit. |
| Ranges | One `bytes=` range (`a-b`, `a-`, `-n`) is answered `206` with `Content-Range` and `Content-Length`; `Accept-Ranges: bytes` is sent on whole answers. A `bytes=` range the service cannot serve as one slice (past the end, reversed, `-0`, `-`, several ranges, non-numeric) is `416` with `Content-Range: bytes */<length>` and no body, sent **only to a caller who passed every check**, so the length is not a probe. A range in another unit is ignored and the whole body is sent (RFC 9110). |
| Cache | Every answer that can carry bytes or a status (`200`, `206`, `403`, `416`, `503`) is `Cache-Control: private, no-store` with `Vary: Origin, Range, x-saga-capability, x-saga-proof`, so neither a shared cache nor the browser keeps it and a cache that ignores `no-store` still cannot answer one user with another's bytes. The player also fetches with `cache: 'no-store'`. |
| Origins | The only origin the view may reach is the one the resource declares in `connect-src` (the listener's own). A grant naming any other origin is blocked by that policy in the built view: nothing, not even a preflight, reaches the other destination, and the player reports a media failure. |
| Redirects | The media service never redirects. The player fetches with `redirect: 'error'`, so a redirect is a failed acquisition and the capability and proof headers never follow it to a destination the application did not declare. |

Recovery in the view: expiry or revocation between grant and fetch shows `expired`; any other failure of the media request (network, `5xx`, a redirect, undecodable bytes, a blocked origin) shows `media-failed`. Both stop the player, clear the source and offer one explicit press. That press is a brand-new Play (fresh authentication, a fresh entitlement check, then a fresh capability) and ends in playing or the safe denial. Nothing refreshes a capability from saved view state, nothing retries on its own, and no public MP3 or chat URL is ever substituted. The status line is the polite live region and the control keeps keyboard focus through `expired`.

Limits worth knowing:

- The built player fetches the whole body with one request and never sends `Range`. Range behavior is exercised at the service's HTTP edge (real listener, real proofs), not through the player.
- The view controller does not compare a media URL's origin itself; the resource's declared `connect-src` is what rejects an undeclared destination. A host that ignores the resource's CSP would not reject one, which is part of the host feasibility check, not something this service can enforce.
- The redirect rule is exercised in the headless controller test against a real redirecting origin, not in the browser spec.
- The synthetic entitlement lookup and storage are in-memory seams. A real application owns revocation latency; this service guarantees only that it asks on every acquisition.
- `Access-Control-Allow-Origin: *` remains (see PLAY1): a sandboxed iframe sends `Origin: null`. Nothing ambient authorizes media, so this discloses nothing to a page without the capability and a proof from the bound key.
- Neither real host has been tried. Whether ChatGPT web or Claude web forward `_meta`, allow the `connect-src` origin and keep the player's focus and announcements is Captain acceptance work, as is the dependency on STATE1/STATE2 and both content-policy levels.

Tests: `src/playback/media.test.ts` (revocation of an issued capability, sticky revocation, fault versus revocation, in-flight characterization, lifetime boundaries, every range case, `416`, `503`, cache and `Vary` headers, log capture), `src/playback/playback-view.test.ts` (redirect not followed, expiry versus media failure, retry as a new Play, no automatic loop, only the declared origin fetched), and `e2e/playback-view.spec.ts` (the same behavior in the built view: revoked mid-Play with keyboard focus kept and announced recovery, media-service outage, no self-retry, an undeclared origin receiving nothing, headers sent only to the declared origin, no media request after a denied Play, no capability in model-visible fields or the static resource).

### Standard descriptions (POL1)

Episode descriptions are read as Markdown under one trusted, immutable content policy chosen by the application. This section is Standard (POL1); Strict and the reader's Show images control follow in [POL2](#strict-descriptions-and-show-images-pol2). One new runtime dependency: `markdown-it` 15.0.2 (MIT; notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). No MCP-UI, CopilotKit, AG-UI or Ora package is used. A2UI's optional `@a2ui/markdown-it` peer stays uninstalled; SAGA uses `markdown-it` directly so it controls the token set.

    npm run build && npm run serve:mcp   # the default policy; PORT=… overrides the port

Decisions made here (the Blueprint left them open):

- **Parser and dialect.** `markdown-it`'s `commonmark` preset with linkify, typographer, tables and strikethrough off. Supported: paragraphs, headings, block quotes, bullet and ordered lists, fenced and indented code, rules, emphasis, strong, inline code, soft and hard breaks, links and images. Everything else, including raw HTML (`<b>x</b>`), stays as the characters written. The parser recognises raw HTML only so POL2 can tell it from prose: its tags, comments and blocks become `raw-html` and `raw-html-block` nodes that carry their characters and are rendered as text, never as elements.
- **Input bound.** 2000 UTF-16 code units (`MAX_DESCRIPTION_LENGTH`). Longer input is an explicit "too long" alert, never truncated. The MCP tool contract (`mcp/episode.ts`) is stricter, at 500; the renderer bound covers other data sources too.
- **Nesting bound.** `markdown-it` silently stops reading once open block containers reach its ceiling, which would drop the rest of the text. The ceiling is fixed explicitly (`MAX_NESTING_LEVEL`, 20; a block quote counts one level, a list item two) and a description that reaches it is refused with an explicit "nested too deeply" alert, never partly rendered. Inline nesting (brackets, emphasis) does not drop text and is not limited.
- **Restricted tokens.** `content/markdown.ts` turns the parser's tokens into a closed, deeply frozen set of nodes in source order (`ParsedDescription.source` keeps the original string). `lit/description.ts` renders each node with a fixed template and text bindings; no `unsafeHTML`, `innerHTML` or parser-generated HTML exists.
- **Policy.** `content/policy.ts` (`createContentPolicy`) validates `{ level?, imageHosts?, blockedPresentation? }` (see POL2) and returns a frozen policy or an explicit failure; it accepts only canonical lowercase DNS hostnames (labels of letters, digits and interior hyphens, which also covers canonical dotted IPv4) and rejects wildcards, schemes, ports, paths, credentials, uppercase or non-canonical hosts, any character that is a delimiter in a Content-Security-Policy (such as `;`, `,`, `'`, spaces) and bracketed IPv6 literals, more than 32 hosts and unknown settings, and never falls back to something looser. `imageHosts` defaults to empty. Link decisions allow only absolute HTTPS without credentials. Image decisions additionally need an exact `https://host` origin match (so suffix tricks, unlisted subdomains, other ports and credentials fail) and demonstrated enforcement.
- **Links.** A link is a button whose accessible name includes the parsed hostname (shown as `(docs.example.com)`; internationalized names appear in ASCII). Activation calls only `HostLinks.open`, backed by the pinned upstream `App.openLink` (`ui/open-link`) when the host advertised `openLinks` (`mcp/host-links.ts`). Denial, failure or a missing capability shows a polite status with the destination as text. There is no `window.open`, anchor or navigation fallback. A result that arrives after the description changed is ignored.
- **Resource restrictions.** MCP Apps `resourceDomains` is one broad permission (scripts, styles, fonts, media and images). The server therefore inserts a second `<meta http-equiv="Content-Security-Policy">` derived from the same policy into the served document (`content/embedded-policy.ts`, `mcp/content-resource.ts`): `default-src 'none'`, `script-src`/`style-src` `'unsafe-inline'` only (the single-file view), `img-src` the exact origins, and `font-src`, `media-src`, `connect-src`, `frame-src`, `object-src` `'none'`. A document must satisfy the host's policy and this one, so a listed origin gains nothing but images. Redirects are checked against the same `img-src`, so a redirect to an unlisted origin is not followed.
- **Enforcement gate.** The view rebuilds the policy from the JSON embedded in its own resource (an invalid one stops the view before anything is mounted) and treats images as enforced only when the document carries exactly the restrictions that policy derives (`establishImageEnforcement`). Without them every image stays inert, even from a listed host. This is evidence about the resource document, not about a host's own enforcement; the host fixture shows the effect with a host policy as broad as the spec describes.
- **Identity.** The default policy keeps `ui://saga-a2ui/episode-view.html`. Any other policy is served as `ui://saga-a2ui/episode-view-<12 hex of SHA-256 of its configuration>.html` (the configuration is the level, the image hosts and, for Strict, the blocked presentation), with the image origins as the only `resourceDomains`, so a cached resource cannot supply another policy's variant. A Strict policy therefore never shares a URI with a Standard policy that declares the same origins, although both declare identical host metadata. `createEpisodeServer` and `startEpisodeListener` take the policy explicitly (the listener defaults to Standard with no image host); the view receives its own policy and `HostLinks` through its `saga-app`, never through module state.
- **Authored Play is separate.** The playback resource and its capability, origin and entitlement rules are unchanged; a content image host is never added to them, and choosing one does not change Play's authorization (`playback/content-policy-separation.test.ts`).

Limits worth knowing:

- Neither real host (ChatGPT web, Claude web) has been tried. Whether each keeps the document's second policy when it mounts the resource, forwards `ui/open-link` and applies `resourceDomains` as described is Captain acceptance work. A host that rewrote the document's policy away would make the view treat every image as inert, because the derived restrictions are missing (covered by the stripped-policy browser test).
- Image-only enforcement is demonstrated in the local host fixture's sandboxed iframe in Chromium only. The `securitypolicyviolation` directives and the absence of requests at the network boundary are the evidence.

Tests: `src/content/policy.test.ts` (configuration failures, link and image decisions, derived restrictions, immutability, enforcement), `src/content/markdown.test.ts` (order, preservation, inert HTML and unsupported syntax, the bound), `src/mcp/content-resource.test.ts` and `src/mcp/server.test.ts` (identity, declared origins, embedded configuration), `src/mcp/host-links.test.ts` (a real `App`/`AppBridge`: opened, denied, failed, no capability), and `e2e/description.spec.ts` (the built view in the sandboxed fixture with real `ui/open-link`: order and formatting, hostile input, hostname disclosure, keyboard activation, denial and missing capability without navigation, inert links, stale results, empty and exact-host allowlists, suffix/subdomain/credential/port/non-HTTPS images, redirect, the missing-restriction fallback, a no-restriction control proving scripts, styles, fonts and media would otherwise load, and invalid embedded configuration).

### Strict descriptions and Show images (POL2)

Strict is chosen by the application, like Standard: `createContentPolicy({ level: 'strict', imageHosts?, blockedPresentation? })`, where `blockedPresentation` is `placeholder` (the default) or `inert-text` and is rejected for Standard. The same policy value drives the resource restrictions and the view's decisions. No new dependency.

    const created = createContentPolicy({ level: 'strict', imageHosts: ['images.example.com'] });
    if (!created.ok) throw new Error(created.failure.message); // never mount on a guessed policy
    await startEpisodeListener({ viewHtml, catalog, contentPolicy: created.policy, port });

Behavior (`content/policy.ts`, `content/image-consent.ts`, `lit/description.ts`, `lit/blocked-fragment.ts`):

- **Blocked fragments.** Under Strict every link, image reference and piece of raw HTML is a blocked fragment. By default each appears as readable placeholder text in its original position (`[Link blocked]` after the link's label, `[Image blocked: alt]`, `[Markup blocked]`); surrounding prose, order and formatting are unchanged. With `inert-text` the source is shown from the start. In either case a keyboard-operable **Reveal source / Hide source** button switches between the two. It changes visibility only: nothing revealed can execute, navigate or fetch. Revealed source is reconstructed from the parsed fragment (`[label](destination)`, `![alt](source)`, the HTML's own characters), not copied byte for byte; `ParsedDescription.source` still holds the supplied string. A description with nothing to block gets no button.
- **Links stay inert.** `decideLink` refuses every destination under Strict, valid HTTPS included, and image consent does not change that.
- **Show images.** Before consent, including after source reveal, no image request is made (`decideImage` answers `consent-required` for an image that otherwise qualifies). **Show images** is enabled only when `offerImages` finds an image that would qualify now: an exactly listed HTTPS host and demonstrated enforcement, the same test as Standard. It cannot widen the allowlist or relax the document's restrictions, which Strict declares before mounting exactly as Standard does. When no image qualifies the button is disabled and a polite message says images cannot be shown; a description with no image has no button. Under Strict the images load eagerly once consented, rather than lazily, so consent and request are one observable step. **Hide images** removes them and revokes consent; it cannot undo a request already sent.
- **Consent is separate, revocable view state.** `createImageConsentScope()` creates one scope per view (`contentViewFromDocument`); a grant is live until revoked and is never restored, so a later Show images is a new grant. The description element revokes its grant on Hide images, when its description changes, when its view's scope is revoked, and on disconnection, and ignores image load results from before. The view revokes the scope before it applies any delivered tool result (a new result is a new selection even when its description is identical, which also means a repeated identical result needs fresh consent; the view is still live, so the reader can consent again, `mcp/view.ts`, `revokeImageConsent`). When the host asks it to tear down, and when its connection is disposed, the view retires the scope instead (`retireImageConsent`, `ImageConsentScope.retire()`): that is terminal, every later `grant()` is already dead, and the Show images control is disabled with a "view ended" notice. Show/Hide images controls are also bound to the description revision they were rendered for, so a control kept from a replaced description (or from before a disconnect) does nothing when invoked. A new view replacing an old one, or a second view, starts with no consent and cannot inherit it. This slice adds no retention TTL, account switching or focus/resume revalidation, and no observed identity or session signal exists in the public episode view; the scope's `revokeAll` is where such a signal would call once a lifetime design is approved.
- **Identity.** See POL1: the Strict configuration is part of the resource URI and is embedded in the document, so Standard and Strict resources are never confused. `npm run candidate:identity -- --level strict [--blocked-presentation inert-text] --image-host HOST` reports the Strict resource's URI, bytes and SHA-256.
- **Authored Play is unchanged in both modes.** The player resource, capability, origin and entitlement rules are untouched; `playback/content-policy-separation.test.ts` runs its cases under Standard and Strict.

Limits worth knowing:

- Neither real host (ChatGPT web, Claude web) has been tried; the local fixture is not evidence of host enforcement. Final signoff and the integrated authenticated runs stay open acceptance work, as does integration with the separately held lifetime design (STATE1/STATE2).
- Only raw HTML is treated as "unsupported markup". Other syntax this dialect does not support (strikethrough, tables) is ordinary text and stays visible under Strict.
- HTML blocks follow CommonMark: a line that starts an HTML block keeps the rest of that block as raw source, so Markdown inside it is no longer interpreted (Standard shows it as text too).

Tests: `src/content/policy-strict.test.ts` (configuration, link and image decisions, Show images offers), `src/content/image-consent.test.ts` (grant, revoke, view-wide revoke, isolation between views), `src/content/markdown.test.ts` (raw HTML nodes, fragment inventory), `src/mcp/content-resource.test.ts` (Strict identity and embedded configuration), `src/mcp/view.test.ts` (revocation before each result, on teardown and dispose), `src/playback/content-policy-separation.test.ts` (Play under both levels), `scripts/candidate-identity.test.ts`, and `e2e/description-strict.spec.ts` against the built resource in the sandboxed fixture (placeholders, keyboard reveal and hide, hostile input before and after reveal and consent, zero requests before consent, only the permitted image after, disabled states, redirects, Hide images, late results, description change, new selection, teardown, view replacement, failure results, two concurrent views and interleaved Standard and Strict views, resource identity and restrictions). Helpers shared with `e2e/description.spec.ts` live in `e2e/description-harness.ts`.

### Reusable MCP connector (CORE1)

`packages/mcp` (`@saga-a2ui/mcp`) takes over MCP delivery from the application. It is a **private, unreleased workspace package** with no version (nothing is published, and the version policy has nothing to enroll). The Lit application consumes it through its package name and its three separate subpath exports. This is a preparation slice: the interfaces may change until CORE3, and owned callers migrate together.

| Export | Holds | Imports |
| --- | --- | --- |
| `@saga-a2ui/mcp/server` | `registerPublicOperation`, `registerProtectedOperation`, `OperationConfigurationError` and the declaration types | MCP server and MCP Apps server helpers, Zod; no renderer, no view code |
| `@saga-a2ui/mcp/view` | `connectToolResultView` (bridge lifetime: listeners installed before connect, delivery once, teardown, disposal) | types only; no server module, no Node built-in, no renderer |
| `@saga-a2ui/mcp/policy` | `ViewCsp`, `CLOSED_VIEW_CSP`, `DEFAULT_OPERATION_BOUND_MS` | nothing |

`packages/mcp/src/exports.test.ts` imports each subpath by name and bundles its module graph (dependencies included) to show a server consumer pulls in no renderer and a view consumer pulls in no server module; `e2e/view-bundle.spec.ts` repeats the check on the built views.

**What the application keeps.** The listener (`mcp/listener.ts`: hosting, Host-header protection, body bounds), authentication (`mcp/request-auth.ts`), request classification (`mcp/protected-request.ts`), domain authorization (which subscriptions belong to the verified account), backend calls and the renderer. The connector never reads a credential: for a protected operation the application supplies `identity(authInfo)`, which turns the transport's per-request verified context into its own immutable value.

**What the connector does** for each declared operation, in this order:

1. *Registers* the tool and its `ui://` view resource on the application's `McpServer`. Protected registration without an identity resolver, sign-in failure text, projection, view or output contract throws `OperationConfigurationError` naming the missing requirement, before anything is served. A non-finite bound is refused the same way.
2. *Validates input* with the declared Zod contract before the handler runs. Undeclared fields (for example an `accountId`) are dropped; the handler never sees them and a protected operation takes its identity only from the verified context.
3. *Resolves identity* (protected only). No acceptable identity gives the declared sign-in text and the handler does not run. A public operation resolves nothing and hands its handler no identity.
4. *Waits for the handler* only for its bound (`boundMs`, default 5 s) and the request's cancellation signal. A result that loses that race is ignored; a handler that throws or rejects gives the declared `unavailable` text with no message.
5. *Projects explicitly*: `project(record)` builds the model-facing text and the structured data field by field; the connector validates the data against the strict output contract before serialization. A violation gives the declared `invalidOutput` text, not the validator's message.

The handler returns `record`, `absent` (declared text) or `refused` (a fixed safe text for well-formed but unaccepted business input). Projections are the model-visible `content` text and the validated `structuredContent`. **No recipient mapping is adopted**: that depends on the Captain's MAP1 measurement in ChatGPT web and Claude web, so Play's app-only visibility and `_meta` payload stay in `playback/` until CORE2.

Browse (`mcp/subscriptions-server.ts`) is the protected consumer: the existing `list_subscriptions` behavior, including the declared `status` filter, the opaque view-session label, concurrent principals, forged-account rejection, and the empty/denied/failed outcomes, passes its unchanged `subscriptions.test.ts` and `e2e/subscriptions-view.spec.ts`. The episode tool (`mcp/server.ts`) is the first public consumer.

#### Public answer operation

`POST /answer/mcp` (`startEpisodeListener({ answer })`, off unless configured) is a synthetic, explicitly public question-and-answer tool, `answer_question`, with its own built view (`dist/answer-view/answer.html`). No credential is read, none is fabricated, and a presented `Authorization` header is not treated as an identity. `responseMode` is `json` (one body when the answer is ready) or `event-stream` (progress notifications, then the answer, as server-sent events).

- *Binding.* The result repeats the question exactly as asked (`{ question, answer }`, strict, bounded to 500 and 2000 characters). The view shows that pair. If the host also announced the question (`toolinput`), a result is shown only when its question is identical (no trimming or case folding); a result for another question, such as a late copy of an earlier answer, is ignored and the view keeps waiting.
- *Early, repeated, late.* A result before any input is shown with its own question; an input for the question already answered keeps the answer; the same answer again is not shown again; a different answer to the same question replaces it. After host teardown or dispose nothing is delivered. An error, a malformed or undeclared-field result, or an unreadable input clears the answer and shows a problem; only the server's three known safe texts are shown verbatim.
- *One handler call, progress, delay.* The handler runs once per call. `request.reportProgress` sends `notifications/progress` only to a caller that supplied a progress token and only while the operation is live; it is a quiet no-op after the operation finished, was cancelled or timed out. In `json` mode progress is not delivered but the delayed answer completes the one request.
- *Bounds and cancellation (unchanged semantics).* The wait is bounded (`answerBoundMs`, 5 s) and a dropped HTTP request aborts the handler's signal; a late answer has nowhere to go. This is the existing per-operation wait, **not** the whole-request deadline contract, which CORE3 owns. The application cleans up work it cannot interrupt.
- *No logging of questions.* Neither the connector nor the listener logs the question or answer.

Run it: `npm run build && npm run serve:mcp` (the demo answers two fixed questions with a short delay and progress, streaming). Tests: `packages/mcp/src/server/operation.test.ts` (the connector over real Streamable HTTP and a real MCP client: projection, refusal, absent, failure, bound, disconnect, progress in both modes, concurrent principals, forged account, registration failures), `packages/mcp/src/view/view.test.ts` (bridge lifetime), `packages/mcp/src/exports.test.ts`, `src/mcp/answer.test.ts` (the real listener in both modes), `src/mcp/answer-view.test.ts` (delivery rules over a real `App`/`AppBridge`), and `e2e/answer-view.spec.ts` (real listener, real client, the built view in the sandboxed host fixture).

Limits worth knowing: the local `AppBridge` fixture is not an actual host; ChatGPT web and Claude web were not run (MAP1 is the Captain's probe). STATE1/STATE2 are held, so no retained-state TTL, live-account switching or focus/resume revalidation exists, and no behavior from the proposed request/view lifetime design (#69) is implemented or claimed (the later ACT1 slice implements only the subset of the action-binding design (#73) described under "Direct action attachment (ACT1)"). Packages are installed through the npm workspace link, not from a registry; exact public source and npm installation remain a release gate (PACK1/PACK2).

### Core and Lit packages (VIEW1)

`packages/core` (`@saga-a2ui/core`) and `packages/lit` (`@saga-a2ui/lit`) take renderer-independent A2UI processing and Lit binding out of the application. Both are **private, unreleased workspace packages** with no version, like `@saga-a2ui/mcp`; nothing is published and the version policy has nothing to enroll. This is a preparation slice: the interfaces may change until the combined CORE3/VIEW2 qualification, and owned callers migrate together. The application keeps its catalogs, components, content policy and its existing Play operation.

| Export | Holds | Imports |
| --- | --- | --- |
| `@saga-a2ui/core/protocols/a2ui/v0_9` | `a2uiV0_9Decoder` (the `MessageDecoder` strategy), validated message cases with `A2uiMessageVisitor`, `createMessageSession` and the ingest result types | upstream `@a2ui/web_core` and Zod 3; no DOM, MCP or renderer (its `tsconfig` loads neither the DOM nor Node typings) |
| `@saga-a2ui/core/protocols/a2ui/zod3` | `z`, the Zod 3 copy upstream A2UI builds on, for authoring catalog component schemas | `zod3` |
| `@saga-a2ui/lit` | `createA2uiAppElement` (mounts one surface from a session and owns its lifecycle) and `defineElements` (explicit custom-element setup) | `lit`, upstream `@a2ui/lit`, the core types; no MCP, no Markdown parser, no optional components |
| `@saga-a2ui/core/actions`, `@saga-a2ui/lit/actions` | Added by ACT1: see "Direct action attachment (ACT1)" | as listed there |

**What the application keeps.** Its catalog (`saga-panel/` and `lit/integration.ts` for browse, descriptions and Play; `answer-card/` and `lit/answer-card.ts` for answers), the component implementations, the trusted content policy, host links, the Play operation, and the composition roots (`main.ts`, `view-main.ts`, `answer-main.ts`) that choose the decoder and session explicitly. Raw wire parsing exists only in core: renderer code receives validated messages.

**Rejection.** `ingest(input)` never throws for bad input. When the current input is rejected (unsupported version, malformed envelope, or an upstream refusal of a component or update), the element clears the surface and shows a safe fallback (`role="alert"`, inert text). Messages of a rejected batch that were applied before the refusal stay applied in the session: there is no atomic rollback. The next input the session accepts removes the fallback and shows the surface again. An application that wants a fresh surface sends `deleteSurface` and creates it again, as the episode view does.

**Registration.** `defineElements` defines tags that are free, leaves a tag bound to the very same constructor alone (so repeating setup, or two catalogs sharing a component, is harmless), and fails with `ElementConflictError` for a different constructor on an existing tag. The first definition is kept, and a failing call defines nothing. Nothing registers at import time.

**Lifecycle.** Connecting creates a session, subscribes to the surface and applies the initial input. Disconnecting unsubscribes and disposes the session; a late `ingest` on a retired element is refused, and a reconnected element starts fresh.

**Answer view.** `answer-main.ts` now renders the public answer through these packages with its own `AnswerCard` catalog: the view still decides which question and answer to show (`mcp/answer-view.ts`, unchanged), and each state is delivered as one `updateDataModel` that replaces the whole card, so a previous question, answer or problem cannot remain beside a new state. The answer view bundle contains neither the panel catalog nor the Markdown policy.

Tests: `packages/core/src/protocols/a2ui/v0_9/protocol.test.ts` (decoding, message cases, field preservation, partial updates, rejections, session lifetime, no DOM), `packages/core/src/exports.test.ts` (supported names; the bundled graph holds no renderer, MCP or DOM runtime), `packages/lit/src/element-registration.test.ts` (the tag rule), `e2e/fixture.spec.ts` and `e2e/lifecycle.spec.ts` (rendering, rejection clears and recovers, partial application, mount and unmount), `e2e/catalog-isolation.spec.ts` (the panel and answer catalogs in one page and one registry: independent data, rejections and disposal; conflicting tag fails and keeps the first), `e2e/answer-view.spec.ts` (early, repeated and late delivery, binding, markup, teardown through the built view), `e2e/own-catalog-consumer/packed-consumer.test.ts` (an application with its own catalog built from the packed core and Lit tarballs, without optional components, FaithfulCard, a Markdown parser or server code), and `e2e/view-bundle.spec.ts` (built artifacts).

Limits worth knowing. The packages are unversioned, which `npm pack` refuses, so the packed-consumer test packs a copy that carries a throwaway version; it proves the package contents and declared dependencies, not a registry install. Exact public source and npm installation, the combined protected/lifetime qualification (CORE3, VIEW2), STATE1/STATE2 and actual-host runs remain separate gates. Play still runs through the application's own operation; the reusable action contract (CORE2) is not used, and at this slice nothing from the proposed designs #69 or #73 was implemented or claimed (ACT1 later added a subset of #73; see "Direct action attachment (ACT1)"). The early Lynx Web investigation that gates freezing the renderer-neutral interfaces has not been performed here, so these interfaces remain candidates.

### Direct action attachment (ACT1)

ACT1 is the first slice of the [action binding](blueprints/modules/action_binding.blueprint.md) design (design revision `c6506adccdeb71ac65fb10c793208d127eea7914`, approved 2026-10-17). It builds a synchronous local action fluently and attaches it directly to the exact rendered Lit control that fires it. It is **provisional**: ACT2 (React) and ACT3 (Lynx) challenge its shared seam before ACT4 builds on it, and it establishes neither full portability nor migration readiness. Both packages stay private, unreleased and unversioned.

| Export | Holds | Imports |
| --- | --- | --- |
| `@saga-a2ui/core/actions` | `Action.local(label)`, `componentKind`, `createInstanceHost` and their types | nothing outside core: no Lit, no DOM, no MCP, no third-party module |
| `@saga-a2ui/lit/actions` | `ActionButton` (the kind token for setup code), `actionButtonEntry` and `ActionButtonElement` (the opt-in control), `createLitActions` | `lit`, upstream `@a2ui/lit`, core; imported by nothing in the main `@saga-a2ui/lit` entry |

Application code follows three steps; the rest is the SDK's:

```ts
// 1. Layout names the control by ID and type. It carries no action and no handler name.
{ id: 'save', component: 'ActionButton', child: 'save-label' }

// 2. Build the action once. Immutable; one definition serves any number of controls.
const save = Action.local<ActionButtonActivation>('save')
  .input((event) => ({ noteId: String(event.read('id')) })) // optional; copies what the handler needs
  .run(({ params }) => saveNote(params.noteId))             // synchronous
  .build();

// 3. Opt in once: list the entry in the catalog, define the element, and give the app element its setup.
createA2uiAppElement({
  /* createSession, initialInput, surfaceId */
  actions: createLitActions({
    attach: (view) => view.watchById('save', ActionButton, (handle) => handle.bindAction('activate', save)),
    onSetupError: reportSetupProblem,
  }),
});
```

- **Discovery and routing.** IDs select handles during setup only: `getById` for exactly one instance (it throws for none or several, naming the ID) and `watchById` for every present and later instance, such as each row of a template. An activation never looks anything up: the control's own click calls the callable installed in that instance's own slot. A slot belongs to one instance and is keyed by the event names its kind declares; there is no registry, no handler-name table and no action bus.
- **Binding rules.** One instance and event admit one live binding, so a second `bindAction` throws. `dispose()` is idempotent and detaches only its own installation; the same live handle can then bind again. Binding an event the instance does not offer, or through a handle whose instance was retired or whose setup ended, throws. A recreated component is a new instance that starts unbound and idle; handles for the old one are stale.
- **Execution.** A press runs `input` then the handler once, in the click's own call stack. Binding state passes `running` and `settling` and is `idle` again before the click handler returns, with a listener call for each change. A press that arrives while the same binding is still running (the handler caused it) is dropped, the default `ignore` policy. A handler or `input` that throws, or returns a promise the types did not show, ends the invocation, returns the binding to `idle`, and then rethrows to the event caller: this slice has no failure hook, and a failure must not disappear. `event.read(path)` reads the pressing instance's own data scope and answers only during delivery.
- **Ownership (Lit).** `createLitActions` makes the app element give each presented surface its own host. It starts before the surface first renders, so every `watchById` is registered before any control opens an instance, and it ends, disposing every binding and discovery subscription, when the surface is deleted or replaced, when setup fails, and when the element disconnects (before the session is disposed). A reconnected element presents a new surface and so gets a new host and a fresh `attach`. Unsubscribing a `watchById` stops later handles only; it disposes no binding. A setup that throws leaves nothing bound and the element shows its safe fallback; a discovery callback that throws loses only the bindings it made and reports to `onSetupError`.
- **Which mount owns a control.** `ActionButtonElement` finds its host from its place in the DOM, not from the surface object: the walk crosses shadow roots outward and accepts only an app element whose own `<a2ui-surface>` is the nearest surface above the control. A second `<a2ui-surface>` for the same model, outside any app element or inside an app element's own shadow tree, leaves its controls unbound. A control in light DOM or slotted content outside the app element's shadow tree finds no host and is unsupported.
- **Strict opt-in control.** `ActionButton` has a strict schema with `child` and optional `checks` and no `action`, so a layout that adds an upstream action, a `functionCall` or a handler name is rejected when it is ingested, before any property is resolved or any function runs. The element is the only click site (do not add a click listener to a rendered button as a shortcut). A control with no attached action does nothing, and a failing `checks` rule disables it as it does the upstream Button. Upstream `Button`s and their `event`/`functionCall` actions are untouched and deliver exactly once.
- **Lit seam.** The element uses upstream's overridable `createController()` and `isConnected`, the model registry and the data path, never `element.node`, which stays unset on the default `a2ui-surface` path. The existing rejection/recovery (`ingest` clears the surface and shows a fallback; the next accepted input recovers it, without atomic rollback) and `ElementConflictError` behavior are unchanged; a control that returns after a recovery is bound again by the same host without running `attach` a second time.
- **Own-catalog consumers.** The main `@saga-a2ui/lit` entry defines only the `A2uiActions` seam type and imports nothing from the action module, so an application that does not opt in bundles none of it. `packed-consumer.test.ts` builds both kinds of consumer from the packed tarballs.

Implemented in ACT1: immutable `Action.local(...).input(...).run(...).build()` with synchronous input and handler, binding state and subscription, direct attachment through `bindAction(event, definition)`, `getById`/`watchById`, ownership of setup, and the Lit control. **Not implemented**, and deliberately not declared (no placeholder methods, no ignored options): `atActivation`, `before`/prerequisites, `limits`, the four hooks, `whenBusy('replace')`, `observe`, the `subject` option, asynchronous handlers, the invocation scope with resource ownership and transfer, `Action.server`, the React and Lynx adapters, and migration of Play or any controller. They belong to ACT2 (React qualification), ACT3 (Lynx qualification), ACT4 (asynchronous local actions), ACT5 (resource scopes) and ACT6 (server actions and the joined contract); CORE2, CORE3 and VIEW2 are separate. Controller safeguards in the Play and subscriptions views are untouched.

Tests: `packages/core/src/actions/actions.test.ts` (through the public interface with a renderer-free fake adapter, plus the type-level cases checked by `npm run typecheck`), `packages/core/src/exports.test.ts` (supported names; the bundled graph has no renderer, MCP or DOM runtime and no dependency at all), `apps/lit-host/e2e/action-binding.spec.ts` against the built consumer `dist/action-consumer` (a catalog of upstream Column, Row, List, Text and Button plus `ActionButton`, two app elements, repeated IDs and data paths, later rows, replacement, stale events, two mounts, a second surface mount, setup failure, surface deletion, disconnect and reconnect, rejection and recovery), and `packed-consumer.test.ts` (both consumers from the packed packages). The browser run is local Chromium through Playwright; it is not evidence for any actual host, React or Lynx.

### MCP Apps 2 recipe (MCPV2)

The browse and Play paths run on one peer-complete MCP Apps 2 recipe. It replaces the earlier `@modelcontextprotocol/sdk` 1.32.1 / `ext-apps` 1.7.5 / Zod 3 set; nothing of the old set remains installed or imported, and there is no compatibility layer. This is **local qualification** of the candidate that actual-host mapping (MAP1) will measure. It is not host evidence: the local `AppBridge` fixture does not stand in for ChatGPT web or Claude web, and the open recipient-mapping question in the [connector Blueprint](blueprints/features/reusable_mcp_connector.blueprint.md) stays open.

| Package | Exact version | License |
| --- | --- | --- |
| `@modelcontextprotocol/ext-apps` | 2.0.3 | MIT |
| `@modelcontextprotocol/client`, `core`, `server` | 2.3.1 | Apache-2.0 |
| `@modelcontextprotocol/node` | 2.1.1 | Apache-2.0 |
| `zod` (MCP seam, hoisted to the workspace root) | 4.6.7 | MIT |
| `@a2ui/lit`, `@a2ui/web_core` (unchanged) | 0.13.0 | Apache-2.0 |
| `zod` (each A2UI package's own nested copy) | 3.25.76 | MIT |

Install with `npm ci` on Node 22.12.0 or newer (the MCP packages need Node 20+, so the workspace engine is unchanged). `ext-apps` declares `zod ^4.2`, `core`/`client`/`server` as peers and `node` requires `server ^2.3.0`; all are direct dependencies of `apps/lit-host`, so `npm ls --all` reports no missing or invalid peer.

**Two Zod versions, one boundary.** Zod 4 belongs to the MCP seam: tool, projection and request-metadata schemas (`mcp/episode.ts`, `mcp/subscriptions.ts`, `playback/playback.ts`, `mcp/request-auth.ts`) and the content policy configuration (`content/policy.ts`) import `zod`. Zod 3 belongs to upstream A2UI, whose `ComponentApi` and message schemas are Zod 3. Anything this application authors *for A2UI* (`saga-panel/contract.ts`, the decoder's types, the protocol test) imports `z` from `protocols/a2ui/zod3.ts`, which re-exports the exact-version `zod3` alias. `zod/v3` inside the Zod 4 package is not a substitute: its declarations differ from upstream's and the compiler's comparison runs out of memory. The root `package.json` declares `zod` 4.6.7 so that npm hoists it where `ext-apps` and the MCP packages share one copy and leaves each A2UI package its own Zod 3. `zod-to-json-schema`, which A2UI uses, is locked under `@a2ui/web_core` for the same reason (hoisted, its peer would resolve to Zod 4); `npm run candidate:identity` and its test fail if that placement drifts. A change to the A2UI pin is a separate decision. No Ansari package or version was touched.

**What moved together** (one change, no old path kept):

- Transport: `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node` replaces the monolithic SDK's transport. The listener still owns hosting, the Host-header rebinding check, the body bound and the request-classification gate (`protected-request.ts`) before any server is built.
- Verified request context: the application's `authenticate` is unchanged in behaviour, but its seam is now the server package's `OAuthTokenVerifier`/`OAuthError`, and the frozen snapshot reaches a tool as `ctx.http.authInfo`. The request signal and `_meta` are `ctx.mcpReq.signal` and `ctx.mcpReq._meta`.
- Runtime schemas: input and output are Zod 4 objects passed whole (no raw shapes). `PlayRequestSchema` is a `strictObject` with one fixed sentence for every issue; the recipient key's `d` member stays "absent or rejected" (`z.undefined().optional()`, because Zod 4 no longer treats an `undefined`-typed key as optional).
- Browser integration: views use the `App` and `PostMessageTransport` from `ext-apps` 2, whose runtime is built on `@modelcontextprotocol/client`; the view modules import types from that package. The test host fixture uses the matching `AppBridge`.
- Removed: the `@modelcontextprotocol/sdk` dependency, the raw-shape request exports (`EpisodeRequestShape`, `SubscriptionsRequestShape`) and the hand-written legacy `ui/resourceUri` key on Play (`registerAppTool` now accepts the strict schema and writes it).

Behaviour kept from the merged Play code: freshness and recipient binding, the 60-second capability, revocation on every acquisition, ranges, cache headers, the declared-origin-only `connect-src`, no redirects, and the fixed unsupported-recipient failure with zero entitlement checks and zero media reads. The unchanged specs (`playback.test.ts`, `media.test.ts`, `playback-view.test.ts`, `e2e/playback-view.spec.ts`) pass against the new recipe without edits to their expectations.

**Built views now carry the MCP client library.** `ext-apps` 2 imports `Protocol` from `@modelcontextprotocol/client`, so the single-file views grew and now contain the client's OAuth error classes. The bundle guard (`e2e/view-bundle.spec.ts`) therefore matches the credential header as a quoted name (`"authorization"`) instead of the bare word, and also forbids the HTTP client and server transports by name. The views set no header, use no HTTP client and read no credential. Inlined MIT and Apache-2.0 code keeps its license; carry the upstream notices with any view you distribute outside this private repository (see [public install](docs/public-install.md)).

**Candidate identities for MAP1.** After `npm run build`, `npm run candidate:identity` prints the source commit, the lockfile hash, every recipe package's resolved version and tarball integrity, the three served `ui://` resources with their built file and SHA-256, the Node version and the last verify receipt's per-command results (`--out FILE` writes it instead; keep the file in ignored `.wise-agents/`). The episode view is not served verbatim: the content policy embeds its restrictions in the document and gives each policy configuration its own URI. The report therefore builds that resource through the same `contentResource` the server registers and gives the served URI, byte count and SHA-256, with the raw build identified separately under `rawBuild`. Pass the candidate's configured policy as `--image-host HOST` (repeatable), `--level strict` and `--blocked-presentation placeholder|inert-text`; without them the report describes the default policy, and an invalid value is an error rather than a fallback. `scripts/candidate-identity.test.ts` compares the report with the resource a server returns for the default and for a configured policy. The same lockfile and sources produced identical resource hashes in this tree and in a fresh `npm ci` copy. Quote the output with the PR head in the acceptance record; do not commit a pasted copy, because the commit hash cannot name itself.

**Run it.** `npm ci`, `npx playwright install chromium`, `npm run verify`. The browser specs exercise the real listener and the built views: the public result (`mcp-view.spec.ts`), allowed, denied, changed-sign-in and refused browse (`subscriptions-view.spec.ts`), the app-only Play (declared `visibility: ['app']`, capability only in result `_meta`), and the unsupported-recipient failure for a host that drops request metadata (`playback-view.spec.ts`).
