# Publishing versioned documentation

The SDK owns the Mintlify site. Root `docs.json` selects committed pages under
`docs/releases/`. `.mintignore` excludes other repository content from publication.
The first version is the stable default; prereleases have an explicit label.
Root metadata keeps this qualification site out of external search engines.

Released pages are independent snapshots, not imports from current guides. Their
page metadata and source links identify the exact package version and SDK revision.
To add a release, verify npm availability, pin the source revision, and add a new
version directory and native Mintlify navigation entry through a reviewed PR.
Do not regenerate older directories from main. Corrections to a released page
require an explicit, reviewed change to that page. Git preserves previous content.
The current qualification pages cover React installation and server exports;
they are not a complete migration of the SDK manuals.

Run `npx mint validate` and `npx mint broken-links` from the repository root.
Use `npx mint dev --no-open` for a local preview. Connect Mintlify to this
repository's main branch and root configuration after the configuration PR lands.
Git integration deploys merged changes; local validation does not establish that
a deployment or its MCP search index is ready.

For a preservation check, record the stable page's contents, change only a newer
page on a preview branch, and compare the stable page after that preview deploys.
Use each page's full version and topic in MCP searches and verify the returned
page URL and content. A tool response that merely repeats the version is insufficient.

`scripts/docs-probe.ts` makes both checks repeatable against any deployment. It reads
the release navigation from `docs.json` and writes nothing to the site:

```bash
# Real MCP client: initialize, list tools, search once per release.
npx tsx scripts/docs-probe.ts mcp https://SITE/mcp
# Hash every released page before and after the newer page changes.
npx tsx scripts/docs-probe.ts snapshot https://SITE > before.json
npx tsx scripts/docs-probe.ts snapshot https://SITE > after.json
npx tsx scripts/docs-probe.ts compare before.json after.json
```

`mcp` passes only when each release's own server-entry-points page is the first release
page searched for that release's question and the page the endpoint's read-only
filesystem tool returns for it states that release's export facts (`FACTS` in the probe,
checked against the committed pages by the tests) without the other release's. A correct
page address with another release's content fails. Other releases that also appear in
search results are listed, not failed. It exits 1 on a wrong, unreadable or
unidentifiable release, which holds dependent publication.
`compare` lists changed and unchanged pages and exits 1 when a page could not be read.
A pull request receives a Mintlify preview on its own host, named in the Mintlify check
and PR comment; pass that host to `snapshot` and `mcp`. Provider host names are removed
before hashing, so a preview snapshot compares directly with a production snapshot.
The tests in `scripts/docs-probe.test.ts` use local stand-ins, so they show how the probe
judges a response, not what the hosted site returns.

Rollback a site change by reverting its commit through a PR. Restore the previous
navigation entry and page content together. Remove a qualification project in the
Mintlify dashboard only after confirming its identity; no DNS is needed for a
provider-hosted preview. Domain activation is a separate deployment operation.
