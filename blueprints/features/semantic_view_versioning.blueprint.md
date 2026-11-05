---
feature_name: semantic_view_versioning
status: approved
module_blueprints: []
dependencies: [reusable_mcp_connector, view_composition]
date_added: 2026-10-31
---

# Semantic view versioning

A view's `ui://` address names its compatibility line, not its bytes. The application states the major version of the contract between its tools and its view. Every rebuild within that major keeps the same address; a new major gets a new one. A build stamp the application writes into the document stays in the document and leaves the address alone.

This is the 1.0 identity contract. Version 1 is the first line.

## Status

- Design: approved on 5 November 2026 at [`c9c44aaa01f3547f1bc3fbcd30273235d61d6f35`](https://github.com/MachineWisdomAI/saga-a2ui/blob/c9c44aaa01f3547f1bc3fbcd30273235d61d6f35/blueprints/features/semantic_view_versioning.blueprint.md) by the delivery coordinator under authority delegated by the owner for the 1.0 release. It narrows the 31 October draft (`04a8cc632a551c373953bba23f4120b7b267ff0c`) to the 1.0 identity change. Later edits to this file record status and the implementation choices noted under "Where it lands".
- Implementation: implemented in [PR #357](https://github.com/MachineWisdomAI/saga-a2ui/pull/357); the landed commit is recorded after merge.
- Predecessor: [retained view resources](retained_view_resources.blueprint.md), rejected at its proposed revision `a0b581285ffa917f32ef5998159d2921adcdc077`. No part of it was implemented or approved.

## Why the address must stop following the bytes

Before 1.0, `operationViewFromHtml` (`packages/mcp/src/server/operation-view.ts`) set the view's URI to `viewUriForHtml(html, filename)` (`view-identity.ts`): the filename with the first 32 hex digits of the document's SHA-256 inserted, such as `ui://views/answer.<digest>.html`. Any change to the document was a new address. An application that writes its release into the document therefore changed the address on every deploy, even when nothing about the contract changed.

That breaks new Claude conversations after a deploy. In the [Ansari deployment trials](https://github.com/iaser-ai/ansari/issues/335#issuecomment-6523633269), Claude web called the tool 31 to 95 seconds after a deploy using a tool descriptor it had obtained before the deploy. It read the card address that descriptor named, the server no longer served it and answered `-32602`, and Claude showed "Unable to reach". New conversations after that window rendered.

The server was not asking Claude to keep that copy. On the 2026-07-28 protocol the server returned `ttlMs: 0` and `cacheScope: "private"` on `server/discover`, `tools/list` and `resources/read`; these are the defaults of `@modelcontextprotocol/server` 2.3.1, not settings SAGA or the application chose. The [MCP caching specification](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) says such a result should be considered immediately stale. The [published measurements](https://github.com/anthropics/claude-ai-mcp/issues/1206#issuecomment-6655982132) are on the public host issue.

A [host engineer's reply](https://github.com/anthropics/claude-ai-mcp/issues/1206#issuecomment-6543141702) separates two caches: the tool-descriptor cache (`tools/list`, including `_meta.ui.resourceUri`) and the resource-document cache (`resources/read`). Every logged Claude failure was the descriptor cache naming an address the server had retired. No read of a current address failed, and Claude re-read the card in every trial.

So the fix is on the server side: a stale descriptor must name an address that is still served. Every one of those deploys was compatible. With one address per major, the stale descriptor would have named the current address, and the read would have returned the current document.

OpenAI's [UI resource guidance](https://developers.openai.com/plugins/build/chatgpt-ui#embed-the-component-in-the-server-response) uses the same shape: a versioned URI, changed for breaking changes together with the tools that reference it.

![OpenAI documentation showing a versioned UI URI and guidance to change it for breaking changes](../../docs/evidence/semantic-view-versioning/openai-resource-versioning.png)

Documentation capture supplied on 31 October 2026. It shows the published guidance; it is not a host conformance test.

## Contract

The application owns one integer: the major version of the view's contract. The contract is what the view reads from a result and what its actions send and expect back. The major is independent of the SAGA package version, the application's release and the document's digest. The SDK validates it and formats the address; the application never writes a `ui://` string itself.

| Change | Major | Address for `answer.html` | Obligation |
| --- | --- | --- | --- |
| First release on 1.0 | `1` | `ui://views/answer.v1.html` | Define what the view reads and what its actions do. |
| Compatible fix, addition, restyle, new build stamp | `1` | `ui://views/answer.v1.html` | A cached v1 document must still handle current results and actions, and the current document must handle any result a v1 tool can still return. |
| Incompatible change | `2` | `ui://views/answer.v2.html` | Every tool that names the view moves to the new address in the same deploy, because the address comes from the one view value they share. |

The address keeps today's form, with `v<major>` where the digest was. The filename rules are unchanged: a relative `.html` path with no empty, `.` or `..` segment, each segment percent-encoded. A directory in the filename stays in the address (`cards/answer.html` at major 1 is `ui://views/cards/answer.v1.html`).

A major bump is the application's assertion, backed by its own compatibility tests. The SDK does not compare schemas. A change to how the view interprets a result, what an action means, or which host capabilities or content-security origins the view needs can be breaking even when the JSON shape is unchanged. A SAGA upgrade or a new build stamp alone is not a break.

The address no longer promises particular bytes. During a rolling deploy, replicas may serve two compatible builds under one address, and a host may keep showing a document it cached earlier under it. Both are within the contract, because every build on a major is compatible with the others.

### Build stamps

A stamp the application writes into the HTML, such as its release identifier, stays in the served document. It identifies the build that rendered, and it has no effect on the address. Applications that stamp their documents today keep doing so.

## Public API

`operationViewFromHtml` gains a required `major`:

```ts
import { operationViewFromHtml } from '@saga-a2ui/react-mcp-stack/server';

const view = operationViewFromHtml({
  html: stampedHtml, // final bytes, release stamp included
  filename: 'answer.html',
  major: 1,
  title: 'Answer',
});
// view.uri === 'ui://views/answer.v1.html'
```

The same function is exported from `@saga-a2ui/mcp/server` and from both stacks' `/server` entries (`@saga-a2ui/lit-mcp-stack/server`, `@saga-a2ui/react-mcp-stack/server`), so an application keeps importing from its one stack.

- `major` is required. Omitting it is a type error and, from untyped JavaScript, a `TypeError` at construction. 1.0 has one way to derive a view's identity, so no application keeps the per-deploy address by default.
- `major` must be a safe integer of at least 1. Zero, a negative number, a fraction, `NaN` and a string throw `TypeError` naming the option.
- A new export, `viewUriForMajor(filename, major)`, returns the address for an application that builds its `OperationView` by hand. It applies the same validation and needs neither `node:crypto` nor the filesystem.
- `viewUriForHtml` stays exported and unchanged as a content digest. `operationViewFromHtml` no longer calls it.
- `OperationView` keeps its shape. Registration (`register` in `packages/mcp/src/server/operation.ts`) already puts `view.uri` on the tool descriptor's `_meta.ui.resourceUri`, on every result, and on the resource it registers; it needs no change.
- Two different documents on one server need two filenames. Registering a second view at an address already registered on the same server fails at startup instead of serving one of them.

## Where it lands

| File | Change |
| --- | --- |
| `packages/mcp/src/server/view-identity.ts` | Add `viewUriForMajor`. Share the filename check with `viewUriForHtml`. |
| `packages/mcp/src/server/operation-view.ts` | Take `major`; derive `uri` from `viewUriForMajor(filename, major)`. |
| `packages/mcp/src/server/operation.ts` | No change: the MCP server already throws when a second resource is registered at an address. A test pins that refusal. |
| `packages/mcp/src/server/index.ts`, `packages/lit-mcp-stack/src/server/index.ts`, `packages/react-mcp-stack/src/server/index.ts` | Export `viewUriForMajor`; update each `exports.test.ts`. |
| `apps/lit-host/src/mcp/content-resource.ts` | Pass major 1, and put a digest of the embedded content policy in the filename (`ui://views/view.<policy digest>.v1.html`), so a Strict and a Standard policy never share an address. |
| `scripts/publish/publish.ts`, `scripts/candidate-rehearsal.ts` | These confirm a deployment serves the build. They accept the file's major-line address (or its digest address) and compare the bytes served there with the build. The release input is unchanged: the bytes, not a declared major, identify the build. |
| `templates/`, `examples/`, `scripts/fixtures/`, `docs/getting-started.md`, `docs/react-consumers.md`, `docs/tic-tac-toe/`, `docs/development-reference.md`, `scripts/publish/README.md` | Pass `major: 1`; replace the fingerprint explanation with the compatibility rule and its obligation. Committed release snapshots under `docs/releases/` are not edited. |

The release notes for 1.0 state the migration: pass `major: 1`, keep any build stamp, and bump the major only for an incompatible change.

## Tests

Through the public `@saga-a2ui/mcp/server` entry, with the MCP client reading what a host reads:

1. **Compatible rebuild keeps the address.** Two documents that differ only in their build stamp, both at major 1, give the same `view.uri`. After registering each in turn, `tools/list` names that address in `_meta.ui.resourceUri`, and a result carries it.
2. **A major bump changes the address.** The same document at major 1 and major 2 gives `ui://views/answer.v1.html` and `ui://views/answer.v2.html`. `viewUriForMajor` agrees with `operationViewFromHtml`, including for a filename with a directory.
3. **The stamp is in the document.** `resources/read` of the registered address returns the exact stamped HTML.
4. **Invalid input is refused.** A missing, zero, negative, fractional or non-number `major` throws `TypeError`; the existing invalid-filename cases still throw.
5. **Duplicate address.** A second view at the same filename and major on one server fails at registration.
6. **Deployment check.** Publish and candidate rehearsal accept a server whose major-line address serves the build's bytes, and refuse one that serves other bytes there.
7. **Both stacks.** Each stack's `/server` export test lists `viewUriForMajor`, and the existing packed-consumer qualification passes with consumers supplying `major: 1`.

The fingerprint tests in `apps/lit-host/src/mcp/content-resource.test.ts` and `server.test.ts` change from "the URI is the document's digest" to "the URI is the major-line address, and the read returns the policy-embedded document".

## Not in this design

- A view that is already mounted when its major changes is not replaced or told to stop by this design. Nothing in the 1.0 identity change depends on it.
- Retained documents for earlier addresses, manifests, historical resource dispatchers, and CDN or storage provisioning remain rejected.

No implementation, merge, release or deployment is authorized by this draft.
