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

Rollback a site change by reverting its commit through a PR. Restore the previous
navigation entry and page content together. Remove a qualification project in the
Mintlify dashboard only after confirming its identity; no DNS is needed for a
provider-hosted preview. Domain activation is a separate deployment operation.
