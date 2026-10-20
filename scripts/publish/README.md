# Publication tooling (`saga publish`, CLI3)

Optional developer tooling in the single `saga` CLI ([`scripts/saga.ts`](../saga.ts)). It checks a
built application, its already deployed HTTPS MCP endpoint and a release input, and prepares the
ChatGPT plugin package with a findings record. It deploys, uploads and submits nothing, and a
prepared package is never reported as live. Design:
[host publication Blueprint](../../blueprints/features/host_publication.blueprint.md). Only the
ChatGPT target exists; the Claude dossier is a later slice.

```sh
npx tsx scripts/saga.ts publish check   --target chatgpt --release path/to/saga-publication.json
npx tsx scripts/saga.ts publish prepare --target chatgpt --release path/to/saga-publication.json --out ./publication
```

Options: `--against DIR` compares with an earlier output and fails when its evidence is stale;
`--invoke-fixture` calls the tools the release input declares under `fixture.calls`;
`--bearer-env NAME` reads a bearer credential from that environment variable for a read-only look
at a protected endpoint. A verdict other than `ready` exits 1.

## The release input

`saga-publication.json` (format `saga-publication/1`, see [`release-input.ts`](release-input.ts)) is
the smallest input that carries what the host needs and nothing it does not: the application
`publisher` (who the listing belongs to; the operator running the tool and the SDK's npm publisher
are never substituted for it) with credited `contributors` kept apart, the listing text and links,
PNG or SVG `assets`, the `build` directory and its view files, the `endpoint`, and optional
`review`, `publication` and `fixture` sections. Paths are relative to the file. It holds no
credential; reviewer credentials, authentication and publisher verification stay in the host's
portal. A working example is [`fixture/notes-app`](fixture/notes-app).

## What is produced

`prepare --out DIR` writes, after everything is checked:

- `chatgpt-plugin.zip`: root `plugin.json` and `mcp.json` (Agent Plugins 1.0.0), `assets/`, and
  OpenAI's `extensions["com.openai"]` listing, review and publication fields. Entries are stored
  uncompressed in sorted order with one fixed timestamp, so unchanged inputs reproduce the same
  bytes and digest.
- `findings.json`: the verdict (`ready`, `incomplete`, `blocked`), every finding, the source
  revision, the digests of the release input, each built view, each tool definition and each served
  resource, the package digest and every file's digest, the deployment identity, the validator
  identity and documentation date, and the pending handoff. It has no timestamp, so unchanged
  inputs reproduce it too.

Any failed check leaves only `findings.json`: no package that could be mistaken for a complete one.
The output is a new directory, or a directory this tool generated earlier, replaced only after the
new output is fully written beside it. An interrupt (SIGINT or SIGTERM) leaves nothing new and the
earlier output unchanged. Ownership is the directory, not the path: the earlier output is verified
by device and inode (the rule `saga init` uses for the directory it creates), and every rename and
removal acts only on a directory that is still that one. If another process puts its own directory
at the output path while the new output is being written, nothing there is changed or removed and
the run fails saying so. Node has no directory-relative calls, so the check narrows the window to
the instant between two adjacent calls; it does not close it.

Everything the command prints passes through a redactor first: secret-looking spans and the
credential given with `--bearer-env` are replaced by a marker. What an endpoint or a proxy says
about a failure is never printed or recorded; only a fixed diagnostic kind is (authentication
challenge, timeout, HTTP status, network error, unusable answer).
The same holds for a failure nobody anticipated: every error the command raises is caught and
reported through that redactor (exit code 1), never rethrown to a caller that prints it raw.

## What is checked

`pass` is only the result of a check that ran and held. A check that could not run or conclude
(an unreachable or protected endpoint, an unavailable validator, an undeclared deployment identity)
is `unknown`, and any `unknown` makes the verdict `incomplete`; any `fail` makes it `blocked`.

- The build: every view exists inside the build directory, is a regular file, and has a
  content-addressed `ui://sha256/…` identity.
- The endpoint: a public HTTPS URL (no local, internal or IP-literal host). Discovery performs
  `initialize`, `tools/list`, `resources/list` and `resources/read` and never `tools/call`. Each tool
  has a description and explicit `readOnlyHint`, `destructiveHint` and `openWorldHint`. The
  endpoint serves every built view byte for byte as `text/html;profile=mcp-app` with a declared
  content security policy, every tool's view belongs to this build, and a served `ui://sha256/…`
  name matches its bytes. A deployment that serves a different build is the stale case.
- The deployment identity: `endpoint.expectedServer` (name and version) is compared with what the
  endpoint reports in `initialize`. Equal is `established`, different is a failure, and anything
  else stays `unknown` and explicit in the report and record.
- The package, read back from the ZIP bytes: the official Agent Plugins 1.0.0 `plugin.json` and
  `mcp.json` schemas (below), exactly one `streamable-http` server at the declared endpoint with no
  headers, OpenAI's listing limits and URL rules, the logo and composer icon (square PNG or SVG, at
  least 48 px, at most 5 MiB), no app references, hooks or reviewer credentials, and no secret.
  The logo and icons are read as images, not just recognised by a header: a PNG must have every
  chunk complete with a correct checksum, one `IHDR` first, `IEND` last with nothing after it, and
  image data that inflates to exactly the rows the header promises; an SVG must be accepted by an
  established XML parser (jsdom's, from the repository's development dependencies; this tool keeps no
  grammar of its own, so undefined entities, unbound prefixes, repeated attributes and truncated
  documents are refused) and have an `svg` root element in the SVG namespace, with no entity
  declarations. If that parser cannot be loaded, the assets finding is `unknown`, not a pass.
  The secret scan looks for credential patterns and for the literal discovery credential; findings
  name the kind, never the value.
- Reading is bounded (20 pages of each list, 50 views), and a bound that is reached makes the
  discovery, tool and view findings `unknown` and the record's `endpoint.complete` false: what was
  not read is not certified. A definite failure among what was read still blocks.
- Fixture invocation (`--invoke-fixture`): only the declared calls, and only to a tool that
  advertises `readOnlyHint: true`; others are refused without a call. Only a digest of each result
  is kept, and it is labelled fixture evidence, separate from real-host observations.

## Recorded decisions

- **Format.** The portable Agent Plugins 1.0.0 package, as OpenAI's packaging guide recommends for
  new packages, not the Codex compatibility layout.
- **Validator.** The official schemas in [`schemas/agent-plugins-1.0.0`](schemas/agent-plugins-1.0.0)
  (Apache-2.0, pinned by digest, a differing copy is "unavailable") run through the MCP SDK's public
  Ajv validator (`@modelcontextprotocol/client/validators/ajv`), so no new dependency is added.
  OpenAI's rules are checked against its documentation as of 2026-10-20 (`DOCUMENTATION_DATE`):
  [packaging](https://developers.openai.com/plugins/build/plugins),
  [submission](https://developers.openai.com/plugins/deploy/submission),
  [server review](https://developers.openai.com/plugins/deploy/app-review) and
  [guidelines](https://developers.openai.com/plugins/plugin-guidelines).
- **Authentication is not in `mcp.json`.** OpenAI's guide shows an `extensions["com.openai"].auth`
  object inside a server entry, but the official 1.0.0 `mcp.json` schema has closed server variants
  and "defines no OAuth configuration". The package follows the schema; the publisher configures
  authentication in the portal's connection form. If OpenAI or the schema changes this, update
  `assemblePackage` and the pinned digests together.
- **Declared and installed versions are different facts.** `application.sagaPackages.declared` is
  what the application's `package.json` asks for; `installed` is the version found in the
  `node_modules` that serves it (`null` when none). A placeholder or a range that was declared says
  nothing about what was built. The record of a complete built application, the qualified
  `lit-node` starter installed from packed candidate tarballs, is exercised by
  [`publish.test.ts`](publish.test.ts).
- **Evidence goes stale with the contract the deployment serves.** `--against` compares the release
  input, each built view, each tool definition, each served resource and its metadata (where a
  view's content security policy and so the origins it may reach are declared), the server
  instructions, the deployment identity, the declared and installed packages, the validator and
  documentation date, how much of the endpoint could be read, and the package content, and names
  each change.
- **Deployment identity** is supplied by the release input and compared with the endpoint's own
  report; there is no mechanism that asks the host.

## Not covered here

Portal automation and submission, upload retries, Claude, a real ChatGPT web run, and the
owner-only steps listed under "Pending handoff" in every report (publisher verification and
authority, domain verification, reviewer credentials, the review walkthrough). Local validators and
fixture runs do not replace actual-host observation.
