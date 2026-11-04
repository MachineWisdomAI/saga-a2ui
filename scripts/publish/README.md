# Publication tooling (`saga publish`, CLI3, CLI4 and CLI5)

Optional developer tooling in the single `saga` CLI ([`scripts/saga.ts`](../saga.ts)). It checks a
built application, its already deployed HTTPS MCP endpoint and a release input, and prepares one
host's materials with a findings record: the ChatGPT plugin package (CLI3) or the Claude connector
dossier (CLI4). Both targets read the same release input, the same endpoint and the same evidence
record. It deploys, uploads and submits nothing, and a prepared package is never reported as live.
`saga publish handoff` (CLI5) then keeps the resumable record of the manual submission that follows.
Design: [host publication Blueprint](../../blueprints/features/host_publication.blueprint.md).

```sh
npx tsx scripts/saga.ts publish check   --target chatgpt --release path/to/saga-publication.json
npx tsx scripts/saga.ts publish prepare --target chatgpt --release path/to/saga-publication.json --out ./publication
npx tsx scripts/saga.ts publish check   --target claude  --release path/to/saga-publication.json
npx tsx scripts/saga.ts publish prepare --target claude  --release path/to/saga-publication.json --out ./publication
```

Options: `--against DIR` compares with an earlier output and fails when its evidence is stale;
`--invoke-fixture FILE` calls the tools your own `saga-fixture-calls/1` file authorizes (see
below; the release input chooses no call);
`--bearer-env NAME` reads a bearer credential from that environment variable for a read-only look
at a protected endpoint. A verdict other than `ready` exits 1.

## The release input

`saga-publication.json` (format `saga-publication/1`, see [`release-input.ts`](release-input.ts)) is
the smallest input that carries what the host needs and nothing it does not: the application
`publisher` (who the listing belongs to; the operator running the tool and the SDK's npm publisher
are never substituted for it) with credited `contributors` kept apart, the listing text and links,
PNG or SVG `assets`, the `build` directory and its view files, the `endpoint`, and optional
`review` and `publication` sections. Paths are relative to the file. It holds no
credential; reviewer credentials, authentication and publisher verification stay in the host's
portal. A working example is [`fixture/notes-app`](fixture/notes-app).

`listing` and `assets` (with `review` and `publication`) belong to the ChatGPT target, and a `claude`
section belongs to the Claude target. The ChatGPT target requires `listing`. Branding is optional:
each of `assets.logo`, `assets.composerIcon`, `assets.logoDark` and `assets.composerIconDark` that
you omit uses the bundled SAGA A2UI dragon, in the light or dark artwork that suits the field (the
composer icons are the transparent head crop of the mark; the logos are the full mark on a solid tile; see
[`assets/brand/plugin`](../../assets/brand/plugin/README.md)). A dark default follows its light
field: `logoDark` and `composerIconDark` default to the dragon only when `logo` or `composerIcon`
also uses the dragon, so your own light branding is never paired with SAGA's dark artwork. Supply
your own paths to use your application's branding; an application that supplies a light file and
no dark file gets no dark variant. Supplied files are preserved, and an invalid supplied file
remains an error. These defaults
affect newly prepared ChatGPT packages; they do not update an installed App or establish how a host
renders an existing connection. Claude submissions still use their own supplied connector icon.
The bundled artwork uses Git LFS. If your checkout skipped LFS downloads, run
`git lfs pull --include='assets/brand/plugin/*.png'` before preparing a default-branded package.
`claude` is the one section whose missing fields are findings instead of a parse error
(below), so a maintainer sees every missing piece at once.

## What is produced (ChatGPT)

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

  The source revision is read from the application directory's `.git` files (`HEAD`, the branch it
  names, `packed-refs`, a linked worktree's pointer); Git is never run there, because a repository
  can name programs in its own configuration and the release input chooses the directory. For the
  same reason none of those files is read through a symbolic link, so a link cannot make another
  local file become `source.revision`, and `source.dirty` is always `null`: whether tracked files
  differ from the commit is not established. `source.revision` is `null` when no readable
  repository is found.

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

## The Claude connector dossier (CLI4)

Claude's directory takes a remote MCP server as a *connector*, submitted by its URL in the developer
portal (<https://claude.ai/directory/manage>, Submit new, then MCP connector). There is no connector
package to build, so `--target claude` prepares the materials for that submission, in the portal's
own order, bound to the same release evidence as the ChatGPT package. Rules were checked against
Anthropic's documentation as of 2026-10-20 (`DOCUMENTATION_DATE` in [`claude.ts`](claude.ts)):
[publishing](https://claude.com/docs/directory/publish),
[submission](https://claude.com/docs/connectors/building/submission),
[review criteria](https://claude.com/docs/connectors/building/review-criteria),
[authentication](https://claude.com/docs/connectors/building/authentication),
[`ui.domain`](https://claude.com/docs/connectors/building/mcp-apps/getting-started) and
[plugin submission](https://claude.com/docs/plugins/submit).

`prepare --target claude --out DIR` writes `claude-connector-dossier.zip` and `findings.json`
(same record, same rules for unknown and failed). The ZIP holds, stored uncompressed in sorted order
so unchanged inputs reproduce the same digest:

- `connector-dossier.json` (`saga-claude-connector-dossier/1`): the connection URL, the exact tools
  (name, title, read-only or write, definition digest), served resources (URI, digest, metadata
  digest), the listing, use cases, company, authentication, data handling, allowed link URIs, and
  the evidence the record holds (source revision, release input digest, built views, served contract
  digest, deployment identity, declared and installed `@saga-a2ui` packages). Its `distribution` section
  says `webDistribution: not-established`.
- `SUBMISSION.md`: the same, as the ten portal steps to follow.
- `assets/icon.*` and `screenshots/01.png` to `05.png`, with the prompt that produced each.
- `plugin/`: only when the release input supplies `claude.pluginBundle` (below).

The `claude.connector` section of the release input carries what the portal asks for: `name` (100
characters), `oneLiner` (200), `description` (2,000), one to five `categories`, `slug`,
`documentationURL`, `privacyPolicyURL`, `support`, `icon`, three to five `screenshots` (PNG, at least
1,000 pixels wide, each with its `prompt`), `useCases`, `authentication.mode`, `dataHandling`,
optional `allowedLinkUris`, and a `reviewContact`. The application publisher is the company; the
operator and the SDK's npm publisher are never substituted for it. Test-account credentials,
OAuth client secrets and the seven policy acknowledgments belong to the owner in the portal and are
never accepted here.

Checked, as findings that name the repair: the listing limits and links; the company (publisher
name, website and a contact); that use cases, authentication and data handling are complete and that
a declared `read` connector has only read-only tools; every tool has a title, a description, a name of
at most 64 characters and `readOnlyHint: true` or an explicit `destructiveHint`; the allowed link
URIs are HTTPS origins or custom schemes; the icon and screenshots are real images (the PNG and SVG
checks below); a served view that declares `_meta.ui.domain` declares exactly the value Claude computes
for the connector URL (optional, so no declaration is fine); no secret; and no local packaging. All
of it is read back from the ZIP bytes.

**Local packaging is not web distribution.** Claude Desktop extensions (`.mcpb`) are no longer
accepted by the directory, and installing in Claude Code is not the web directory. None is produced,
the dossier states it, and a `.mcpb`/`.dxt` file, a Desktop config or an MCPB `manifest.json` carried
into the ZIP is a failure (`package.distribution`).

**There is no offline validator for a connector submission.** The record says so
(`claude-connector-requirements`) instead of reporting a pass: the portal's Tools step and its
automated policy scan are the check of record, and running every tool through the MCP Inspector and as
a custom connector in Claude is the owner's to confirm. Reviewers also judge what a check cannot
(description accuracy and prompt-injection patterns, whether reads and writes are separate tools,
first-party API ownership); the report lists those as pending handoff.

### The optional plugin bundle

A bundle exists only when the application supplies its scope in `claude.pluginBundle`: the public
GitHub `repository` it will live in, the `skills` directories (each with a `SKILL.md`), a `readme` and
a `license` file. Nothing is invented: no sidebar, onboarding flow, command, agent or hook, and no
skill the application did not write. The bundle is `plugin/.claude-plugin/plugin.json`,
`plugin/.mcp.json` (one server: the connector's own endpoint, as the directory advises so people see
one set of tools), the README, the license and the skills, checked with Claude Code's own
`claude plugin validate`. Where Claude Code is not installed, or the validator cannot run, the bundle
finding is `unknown` and the verdict `incomplete`. The bundle is a separate submission from GitHub
(public before it goes live, with push access for the submitting account); the report lists that as
pending handoff.

## Resuming a handoff (`saga publish handoff`, CLI5)

`prepare` ends where the publisher's own work begins: submitting in the host's portal, the host's review
and, much later, a listing someone can install. `handoff` is the record of that work, kept in a directory
of your choosing, so it can stop at any point (a closed browser, a colleague taking over, a timeout whose
outcome nobody saw) and resume without a second upload and without a prepared package, a submission or an
approval being mistaken for a live listing. Apart from `begin`, which assesses the release again
(below), it reads and writes local files only. It calls no host, has no submission interface, hosting or credential of its own, and submits nothing: the
publisher submits by hand in the host's documented flow
([ChatGPT](https://developers.openai.com/plugins/deploy/submission),
[Claude](https://claude.com/docs/connectors/building/submission), portal
<https://claude.ai/directory/manage>).

From the SDK source checkout, use these command forms. Replace placeholders and choose one value where alternatives are shown.

```text
npx tsx scripts/saga.ts publish handoff begin               --handoff DIR --prepared ./publication --release path/to/saga-publication.json --authority-ref "owner agreement, ticket 12" [--invoke-fixture FILE] [--bearer-env NAME]
npx tsx scripts/saga.ts publish handoff status              --handoff DIR [--prepared ./publication-now]
npx tsx scripts/saga.ts publish handoff attempt             --handoff DIR --prepared ./publication-now
npx tsx scripts/saga.ts publish handoff confirm-submission  --handoff DIR --reference <the host's reference> [--observed-at TIME]
npx tsx scripts/saga.ts publish handoff void-attempt        --handoff DIR --inspected "<what you looked at in the host>" [--observed-at TIME]
npx tsx scripts/saga.ts publish handoff record-review       --handoff DIR --state in-review|changes-requested|approved|rejected [--reference REF] [--observed-at TIME]
npx tsx scripts/saga.ts publish handoff record-listing      --handoff DIR --prepared ./publication-now --state verified-live|not-listed --host "<named host>" --evidence REF [--observed-at TIME]
```

**Readiness is assessed again, never read from a file.** `findings.json` and the archive beside it are
plain files: whoever can write one can write the other to match, so a record that says `ready` and an
archive with the digest it names prove only that the two agree. `begin` therefore runs the checks of
`check` itself, with `--release` (and `--bearer-env` or `--invoke-fixture` where `prepare` needed them),
against the release input, the build and the endpoint as they are now. It reads the endpoint as `check` does
and calls no tool unless `--invoke-fixture` is given. It records a handoff only when that fresh assessment is
`ready` and the prepared output matches it by the rule `--against` uses (the release input, the views, the
tool definitions, the served resources, the deployment identity, the packages, the validators, the
fixture invocation and the package digest). What is pinned is the fresh assessment, not the prepared
record. A prepared output that was edited, or that the release has moved on from, is refused with what
differs.

The fixture invocation is part of that comparison: the calls declared, whether they ran, and the digest
of each result. A preparation made with `--invoke-fixture` begins only with the same fixture file and
the same results, so omitting the fixture, a changed result or a failing call is refused, and a fixture
given over a preparation made without one is refused as well. A preparation made without a fixture still
begins without one, and the handoff records that no fixture ran. A handoff begun before the fixture was
pinned holds no fixture section, and `status --prepared` has nothing of it to compare.

**What the record holds.** `begin` reads a `prepare` output that is intact (its package matches the
digest in its record) and whose verdict is `ready`, checks it against that fresh assessment, and pins the assessment: the host (target, directory name,
guide and portal), the application and its publisher, the exact release evidence (source revision, release
input and view digests, the tool definitions, served resources and contract digest, the deployment
identity, the declared and installed `@saga-a2ui` packages, the validators, the fixture invocation and the package digest) and the
references to the intended publisher's authority. Authority references are pointers (an agreement, a
ticket, an owner's confirmation) that this tool does not verify, and every free-text field is refused when
it looks like a credential. The handoff identity is derived from the host, the application, the publisher
and the package digest, so two hosts, or two releases, never share one.

**Four states, each from its own events.** The record is a directory of numbered event files
(`000001.json`, `000002.json`, ...), appended and never rewritten, each naming the digest of the one before it.
`status` derives the states from them:

| State | Values | Set by |
| --- | --- | --- |
| Preparation | `ready`, or `stale` once the release changed | `begin`, and `--prepared` |
| Submission | `not submitted`, `UNRESOLVED attempt`, `submitted` (with the host's reference) | `attempt`, `confirm-submission`, `void-attempt` |
| Review | `not started`, `in-review`, `changes-requested`, `approved`, `rejected` | `record-review` |
| Live listing | `not verified`, `verified-live`, `not-listed` (each on a named host, with evidence) | `record-listing` |

Each observation carries `observedAt`, the time the host showed it (ISO 8601 with an offset, never in the
future; the time of the command when omitted), and the event carries `recordedAt`, when the tool wrote it.
Later stages cannot predate earlier ones, and a review or listing observation cannot predate the newest
review or listing observation already recorded: a delayed observation never supersedes a newer one. An approval is not a listing: `record-listing` is accepted only
after an approval, with a named host and a reference to what was observed, and `status` keeps saying
`not verified` until then. `record-listing` checks that the release is still current before it answers anything, including that a
listing is already recorded as live: an earlier live observation stays in the record as made for the release
the record pins, and does not excuse changed or unusable evidence.

**An uncertain submission is inspected before any retry.** `attempt` records that you are about to submit,
before you do, and prints the host's guide, the pinned package and digest and the owner-only steps. If the
outcome is never recorded, the next `attempt` is refused and says what to inspect. The attempt is settled
only by `confirm-submission` (the host shows it; its reference is recorded) or `void-attempt` (the host
shows none for this release; what you inspected is recorded), and only then can another attempt be
made. Once a submission is recorded, `attempt` is refused, `confirm-submission` with the same reference changes
nothing and with another is refused as a second upload. Of two commands that read the same record, one
is refused: an event is created whole with a hard link, which fails when its number is taken, so none is
lost or doubled, and an interrupt before the link leaves no event (a leftover temporary file, named with a
leading dot, is ignored). An event is also written only into the directory that was read: the command holds that
directory by its identity, and a path replaced or renamed under it is refused with nothing recorded and
nothing changed or removed in the directory now at the path. Where the system names no open directory (macOS),
the command's temporary file is removed only while its name still shows the file it wrote; after a replacement
it can stay behind, in the directory that was moved, as an ignored dot-file. A record that was altered, has a missing event or holds other files is refused and
never repaired.

**Changed inputs invalidate readiness.** Run `prepare` again for the current state, into a new directory,
and pass it as `--prepared`. It is compared with the pinned release by the rule `--against` uses: the release input,
a built view, a tool definition, a served resource and its metadata, the server instructions, the
deployment identity, the packages, the validators, how much of the endpoint was read and the package
content. A preparation that is not `ready` is never current. This comparison reads the `--prepared` record, a file the maintainer controls: it notices honest change and is not
readiness evidence (`begin` assesses the release again for that). When stale, `status` lists what changed and
exits 1, and `attempt` and `record-listing` are refused for the old release; begin a new handoff for the new
one. What the host already holds for the old release stays as recorded, and a verified listing is reported
as observed for the earlier release. `attempt` and `record-listing` require `--prepared`, so readiness is
never assumed.

Not covered: submitting, verifying the publisher's authority or the host account, and observing an
installation. Those are the publisher's and the host's, and a `verified-live` record is the maintainer's
statement about a named host, not something this tool can check.

## What is checked

`pass` is only the result of a check that ran and held. A check that could not run or conclude
(an unreachable or protected endpoint, an unavailable validator, an undeclared deployment identity)
is `unknown`, and any `unknown` makes the verdict `incomplete`; any `fail` makes it `blocked`.
The build, endpoint, deployment identity, image, secret and stale-evidence rules below hold for both
targets; the package rules are the ChatGPT target's (the Claude target's are above). A target's own
tool rules differ: ChatGPT asks for three explicit hints, Claude for a title and a read-only or
destructive annotation.

- The build: every view exists inside the build directory, is a regular file, and has a
  content-addressed `ui://views/<filename>.<fingerprint>.html` identity.
  Each `build.views` entry is relative to `build.directory` and must be the same filename the
  application passes to `viewUriForHtml`: for example, `nested/answer.html` retains `nested/`
  in the resource URI. The build directory itself is not part of that name.
- The endpoint: a public HTTPS URL (no local, internal or IP-literal host). Discovery performs
  `initialize`, `tools/list`, `resources/list` and `resources/read` and never `tools/call`. Each tool
  has a description and explicit `readOnlyHint`, `destructiveHint` and `openWorldHint`. The
  endpoint serves every built view byte for byte as `text/html;profile=mcp-app` with a declared
  content security policy, every tool's view belongs to this build, and a served `ui://views/<filename>.<fingerprint>.html`
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
  The secret scan reads every file, whatever its name or extension, for common credential forms
  (private keys, cloud, source-host, registry and payment tokens, passwords in URLs, and
  `NAME=value` lines) and for the literal discovery credential. It also opens zip, gzip and tar
  archives inside the package, up to 3 levels deep, 1,000 files and 16 MiB in all (one allowance
  shared by every archive, checked before and after each is opened). A tar is read only when it
  is well formed (correct header checksums, two closing empty blocks, nothing after them); its
  members are named as an extractor would name them (ustar prefix, PAX `path`, GNU long name) and
  a link, device, sparse or other non-regular member makes the whole tar unreadable. It refuses
  by name the files that exist to hold credentials (`.env`, `.npmrc`, SSH and cloud credential
  folders, key stores; `.env.example` is allowed). An archive it cannot open (another format,
  damaged, encrypted or over those limits) fails the check instead of passing it. Findings name
  the file and the kind, never the value. This is a screen for common forms, not proof that no
  credential is present: a value that is encoded, split, encrypted or in an unrecognised format is
  not found, and the maintainer remains responsible for what the package carries. File names in a
  finding are shown with printable characters only.
- Reading is bounded (20 pages of each list, 50 views), and a bound that is reached makes the
  discovery, tool and view findings `unknown` and the record's `endpoint.complete` false: what was
  not read is not certified. A definite failure among what was read still blocks.
- Fixture invocation (`--invoke-fixture FILE`): only the calls in your own calls file (at most 50,
  with arguments of at most 16 KiB each), and only to a tool the file pins by `toolSha256` (the
  digest the record reports for that tool) whose definition the endpoint still advertises unchanged
  and with `readOnlyHint: true`. The digest is the authority; the hint can only narrow it. Anything
  else is refused without a call. Only a digest of each result is kept, and it is labelled fixture
  evidence, separate from real-host observations.

  The calls file is the maintainer's, not the application's: the release input and the endpoint it
  names are lower-trust than the person running the command, so neither chooses a tool, its
  arguments or the definition it is called against. Keep the file outside the application's tree
  and read each digest from a record you reviewed. The format is JSON, and the file is read like any
  other input, sized before it is read:

  ```json
  {
    "format": "saga-fixture-calls/1",
    "calls": [{ "tool": "get_status", "toolSha256": "<64 hex digits>", "arguments": {} }]
  }
  ```

## Network admission

Every request the publication tool and `scripts/docs-probe.ts` make goes through one module,
`scripts/maintainer-network.ts`; neither command constructs an MCP transport or calls `fetch` itself.
The module admits a request or refuses it with a fixed message that carries nothing the remote side
wrote:

- **Destination.** HTTPS only, no credentials in the URL, a public-looking host name and no IP
  literal. A refused endpoint is not contacted, and no bearer is sent to it.
- **Connected address.** The host name is resolved inside the connection, and an answer outside the
  public range refuses the connection, so the address that was checked is the address that is used.
- **Redirects.** Followed only for an uncredentialed `GET` or `HEAD`, at most three, and each hop is
  admitted again. A request that carries a bearer is never redirected.
- **Credential.** `--bearer-env` gives the bearer to this module, which attaches it to the first
  request to the endpoint's own origin and nowhere else.
- **Operations.** Discovery authorizes no tool call. A fixture call needs the exact name and digest
  the maintainer's own calls file pins; neither the release input nor what the endpoint advertises
  about a tool adds to that.
- **Size.** Each response is counted as it streams, against a per-response limit and one allowance
  shared by everything one assessment reads (discovery and the fixture run draw on the same
  allowance); lists an endpoint returns are cut at 200 items per page. A
  file the release input names is sized before it is read (`bounded-read.ts`): the input itself
  (1 MiB), each built view (8 MiB, 64 MiB together), an earlier output and an application asset.
  Every local file one command reads (the release input, the fixture calls file, views, application
  files and trees, an earlier record and archive) also draws on one allowance of 256 MiB, made at the
  command's entry and carried on the loaded release input, so categories that are each within their
  own limit cannot add up to more. The per-file and per-tree limits stay as the narrower bounds.
  The documentation probe requests at most four pages at once (`PAGE_CONCURRENCY`).

If a refusal needs repairing, change `RefusalKind`, the address list or `createAdmittedFetch` in
`maintainer-network.ts` (or the limits in `bounded-read.ts`); there is no second copy of a rule to
keep in step. Tests replace only the lowest layer (the connector), never the rules.

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

Portal automation and submission, upload retries (the handoff only records the maintainer's manual
submission), a real ChatGPT or Claude web run, and the owner-only steps listed under "Pending handoff" in every report
(publisher verification and authority, domain verification, reviewer accounts and credentials, the
review walkthrough, the Claude policy acknowledgments). Local validators and fixture runs do not
replace actual-host observation.
