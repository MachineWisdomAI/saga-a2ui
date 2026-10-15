# SAGA A2UI

Safe Agentic Generative Applications — by [Machine Wisdom](https://machine-wisdom.ai).

TypeScript middleware for connecting existing services to assistant experiences, with renderer choice, explicit data-sharing rules, and server authorization hooks.

## Status

Repository setup is underway. A minimal private Lit application (`apps/lit-host`) builds and renders locally. No SDK packages or host compatibility are available yet, and the app has not been verified in ChatGPT or Claude. This repository starts private and is intended to become public after a separate publication decision.

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

**Standard** permits validated HTTPS links through the host and images from explicitly allowed HTTPS hosts. **Strict** displays link and image references as inert text. Both preserve ordinary Markdown formatting and retain server authorization and data-sharing checks. Application code controls the policy.

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
    npx playwright install chromium    # one-time browser download for the check below
    npm run test:browser                # serves the built page and checks the visible title

`test:browser` expects `npm run build` to have run first; it loads the built page in Chromium and asserts that the heading "SAGA A2UI" is visible. CI (`.github/workflows/ci.yml`) runs typecheck, build, the headless tests and the browser check on every pull request.

The only application is `apps/lit-host` (private, not published). It deliberately declares no `version`, so it introduces no owned version to enroll; add one only through the repository's version-policy bootstrap when that tooling exists. The workspace root stays private and no SDK packages exist yet.

### Fixture rendering (A2UI v0.9)

`apps/lit-host` renders a developer-authored A2UI v0.9 surface from synthetic public data. Tested, exactly pinned versions: `@a2ui/lit` 0.13.0, `@a2ui/web_core` 0.13.0 (both Apache-2.0), `zod` 3.25.76 (required by both), `lit` 3.3.3, Node 22.12.0+. The optional peer `@a2ui/markdown-it` is deliberately not installed.

Modules in `apps/lit-host/src` (all application-local; no SDK packages):

- `protocols/a2ui/v0_9/message.ts`: validated message value and `A2uiMessageVisitor` (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`). No catch-all, so a new case breaks incomplete visitors at typecheck.
- `protocols/a2ui/v0_9/decoder.ts`: `MessageDecoder` strategy and the v0.9 implementation. Accepts `unknown`: one message, an array, or `{ messages: [...] }`. Validates with upstream `@a2ui/web_core` schemas and returns deep-frozen copies or a typed `DecodeFailure` (`unsupported-version` | `malformed`). It is the only place wire tags are read.
- `protocols/a2ui/v0_9/session.ts`: `createMessageSession` owns one upstream `MessageProcessor` configured with `STRICT_VALIDATION`. Upstream decides component support, omitted types on partial updates, unknown surfaces/components and state. `ingest(input)` returns `{ ok: true }` or `{ ok: false, failure }`; `dispose()` ends the processor's lifetime.
- `saga-panel/contract.ts`, `saga-panel/fixture.ts`: renderer-neutral `SagaPanel` contract and synthetic fixture data.
- `lit/integration.ts`: Lit panel element, catalog, and the explicit `registerLitElements()` setup (nothing registers at import time).
- `lit/saga-app.ts`: the view. It presents results (failures as inert text) and owns its session, subscriptions and `window.sagaSend` hook: connect creates and publishes them, disconnect unsubscribes, disposes and removes the hook, reconnect starts clean.
- `main.ts`: composition root; constructs and connects the above.

Call path: `window.sagaSend(unknown)` -> `saga-app` -> `session.ingest` -> decoder -> visitor -> upstream processor -> surface model -> Lit.

Invalid messages, unknown catalogs/components or wrongly typed properties produce a visible "Could not render this content" alert. Values render only as Lit text bindings, so supplied markup stays inert text. No Markdown is applied to the description.

`npm run test:headless` (vitest, Node) covers decoding and processing through `decoder`/`session` only. Browser tests cover rendering, binding, inert markup, recovery and mount/unmount.

`e2e/*.spec.ts` drive the real processor through the typed `window.sagaSend` entry point and assert rendered output. Recipe (same commands as above): `npm ci && npm run typecheck && npm run build && npx playwright install chromium && npm run test:browser`.

### MCP tool result in the view (MCP1)

`apps/lit-host` also hosts an ordinary MCP server and renders one of its tool results through the same A2UI session. Public synthetic data only; no authentication, playback, SDK packages or actual-host (ChatGPT/Claude) acceptance.

Pinned additions (exact): `@modelcontextprotocol/sdk` 1.32.1 (MIT), `@modelcontextprotocol/ext-apps` 1.7.5 (MIT; its optional `react` peers are not installed), dev-only `vite-plugin-singlefile` 2.3.3, `tsx` 4.23.15, `@types/node` 22.20.5. They share the existing `zod` 3.25.76. No MCP-UI, CopilotKit, AG-UI or Ora packages are used; the only overlap is shared standards (MCP, MCP Apps, A2UI).

    npm run build         # app, the single-file view (dist/view/view.html) and the test-only host fixture
    npm run serve:mcp     # MCP server at http://127.0.0.1:3001/mcp (PORT overrides); needs the build first

Modules in `apps/lit-host/src`:

- `mcp/episode.ts`: public contract shared with the view (input shape, bounded `PublicEpisode`); imports only `zod`.
- `mcp/server.ts`: `createEpisodeServer` registers one read-only tool `get_episode` (runtime-validated `episodeId`) and the `ui://saga-a2ui/episode-view.html` resource via `registerAppTool`/`registerAppResource`. Only `episodeId`, `title` and `description` are projected from a record. The resource is the built HTML served verbatim, so request data never enters cached HTML; its CSP metadata allows no network or external resources.
- `mcp/listener.ts`: application-owned loopback Streamable HTTP hosting (`POST /mcp`, stateless, JSON responses, Host-header DNS-rebinding protection, no auth because the tool is public).
- `mcp/view.ts`, `view-main.ts`, `view.html`: the view connects the MCP Apps `App` bridge, then turns each tool result into an A2UI data-model update and hands it to the existing session. Decoding stays in `protocols/a2ui`; rendering stays in `lit/`. `vite.view.config.ts` builds it to one HTML file with no server imports.
- `e2e/host-fixture`, `e2e/mcp-view.spec.ts`: a test-only local host with a real `AppBridge` and a `sandbox="allow-scripts"` iframe. The spec makes real `tools/call` and `resources/read` requests over HTTP, delivers the result, and checks the wire result, rendered title, CSP and resource linkage. `e2e/view-bundle.spec.ts` checks the built artifacts for server code and credentials. The fixture is not evidence of compatibility with any actual host.

### MCP result lifecycle in the view (MCP2)

`connectEpisodeView` (`apps/lit-host/src/mcp/view.ts`) owns the bridge connection's lifetime and nothing else: A2UI decoding stays in `protocols/a2ui`, and the session and surface lifetime stay with `saga-app`. It uses only the upstream `App` API from `@modelcontextprotocol/ext-apps`; there is no extra host handshake and no second fetch of the answer (the host delivers the result it already has).

- Initialization: the `toolresult` listener (`addEventListener`) and `onteardown` are registered before `app.connect`, so a result the host sends right after the handshake is rendered exactly once.
- Replacement: each valid public result is applied as a data-model update and replaces the one shown.
- Failure: an error result, a result that is not a public episode (including undeclared fields) or an ingest failure removes the panel surface and shows a plain-text fallback in `[data-testid="view-problem"]`. The next valid result recreates the surface and clears the fallback.
- Teardown: the resolved `EpisodeViewConnection.dispose()` removes the listener and closes the `App`; it also runs if `connect` fails. A host `ui/resource-teardown` request releases the listener and answers the host, which then ends the connection. Results arriving afterwards are ignored. Connecting the same `App` again starts with exactly one listener, so delivery is not duplicated.

Tests: `src/mcp/view.test.ts` (`npm run test:headless`) joins a real `App` and `AppBridge` over an in-memory transport with a real A2UI session. `e2e/mcp-view.spec.ts` (`npm run test:browser`) controls delivery order through the test-only host fixture's real `AppBridge` against the built view: a result sent during initialization, replacement, each failure kind with recovery, delivery after teardown, and remount. Account or selection isolation is a separate, later concern.

### Subscriptions for the verified request identity (BROWSE1)

A second, protected MCP endpoint, `POST /subscriptions/mcp`, returns the signed-in user's own subscriptions from a synthetic account fixture. Synthetic data only; no real Patreon access, no SDK packages, no actual-host (ChatGPT/Claude) acceptance. No new dependencies.

- `mcp/request-auth.ts`: application-owned authentication. A bearer credential is checked by an `OAuthTokenVerifier` (the MCP SDK's own interface) before any server is built or backend called. Missing credential: `401` with `WWW-Authenticate: Bearer realm=...`; malformed, unknown or expired: `401 invalid_token`; verified but not a user (service-only, no account or scope): `403 insufficient_scope`. The accepted credential is copied into a frozen, request-owned snapshot of the validated claims before it is attached to `req.auth`: the transport reads that context only after the body arrives, so a verifier that reuses or mutates its own `AuthInfo` cannot change which account an earlier request was authenticated as. The snapshot reaches the tool only as the SDK's per-request `extra.authInfo`, read inside each invocation; the tool takes no arguments, so an `accountId` argument is dropped. There is no shared current-user state.
- `mcp/dev-auth.ts`: **development-only** verifier with fixed public tokens (`DEV_TOKENS`). It throws when `NODE_ENV=production`, is imported only by `mcp/serve.ts` (the loopback demo) and tests, and is kept out of the browser bundles (checked by `e2e/view-bundle.spec.ts`). A remote host must pass its own configured `verifier` to `startEpisodeListener({ subscriptions })`; the listener has no default.
- `mcp/subscriptions.ts`, `mcp/subscriptions-server.ts`: strict, bounded zod projection. Each field is copied from the backend record explicitly (no spreading) and the result is validated before serialization; a record that breaks the contract yields a generic tool error. Canary private fields never reach the wire.
- View session: the result carries an opaque label (`vs_` + 22 characters, an HMAC of the sign-in id under a per-process key). `mcp/subscriptions-view.ts` pins the opening host delivery; a different label, an unknown shape, or an error clears the private view. A `toolinput` notification does not authenticate the next `toolresult` — those notifications are not correlated. When the host proxies server tool calls, a new input starts `App.callServerTool`, and only that response may establish or recover the pin. A finished read does not recycle its identity, so an older in-flight response cannot satisfy a later read or restore private rendering after a later refusal. While the view is invalid, or while a correlated read is in flight, an unsolicited notification is ignored, so a delayed copy of an earlier result cannot revive the private view. A refusal of the proxied call (the listener's HTTP 401/403, before any tool handler) keeps the view cleared. The label controls freshness only; the server authorizes every call.
- `subscriptions.html`, `src/subscriptions-main.ts`: the view, built to `dist/subscriptions-view/subscriptions.html`. States: subscriptions, sign-in required, problem. Values are written with `textContent`.
- `mcp/view.ts` now exposes `connectToolResultView` (bridge lifetime), which the episode view and the subscriptions view share.

Try it locally (`npm run build` first): `curl -s -X POST http://127.0.0.1:3001/subscriptions/mcp -H 'authorization: Bearer dev-only-token-alice' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_subscriptions","arguments":{}}}'`.

Tests: `src/mcp/subscriptions.test.ts` (real listener and bearer credentials over HTTP: concurrent users, forged account argument, canaries, bad backend data, every credential failure and its status/challenge, and a paused request whose verifier reuses one mutable `AuthInfo`), `src/mcp/subscriptions-view.test.ts` (session pinning, clearing, recovery only through the correlated `callServerTool` response, and an older in-flight read that cannot reuse a later read's identity after a refusal), `e2e/subscriptions-view.spec.ts` (built view in the sandboxed host fixture: authorized, changed sign-in, a proxied tools/call whose listener 401 clears the view, a delayed prior result, and recovery from that call's response).
