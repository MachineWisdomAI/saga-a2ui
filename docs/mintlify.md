# Publishing versioned documentation

The SDK owns the Mintlify site. Root `docs.json` selects committed pages, `.mintignore` excludes
everything else, and Mintlify's Git integration publishes the default branch. No custom version
engine, search or MCP server exists: version navigation, search, Markdown and index files and the
documentation MCP endpoint are the platform's.

| Item | Value |
| --- | --- |
| Source | `MachineWisdomAI/saga-a2ui`, `main`, root `docs.json` |
| Mintlify project | `saga-a2ui`, served today at `https://saga-a2ui.mintlify.site` |
| Intended address | `docs.saga-a2ui.dev`. The project serves this hostname over HTTPS with canonical URLs on it. DNS and certificates belong to the domain owner, not to this repository. |
| Pull-request previews | A Mintlify check comments with a preview host. Previews depend on the project's plan, so confirm one appears before relying on this procedure. |

## What is published

```text
docs.json                              native navigation: versions, labels, the default
.mintignore                            publishes docs/connect and docs/releases only
docs/connect/assistants.mdx            shared page: MCP address, client steps, formats (not a snapshot)
docs/releases/VERSION/
  release.json                         input record: revision, packages, guides, exclusions, components
  installation.mdx                     authored
  server-entry-points.mdx              authored
  guides/*.mdx                         generated from the pinned revision
  components/*.mdx, catalog.json       generated from the pinned revision
scripts/docs-release.ts                generate, check, routes, verify-source
scripts/docs-probe.ts                  hosted-site checks (MCP, snapshots)
```

The first release in `docs.json` is the stable default. Prereleases carry an explicit `Prerelease`
label. Development `main` is never published as a release: a release directory is named for a version
that exists on npm, and `check` rejects any other name.

## Search-engine indexing

Production is indexable. `docs.json` sets `seo.indexing` to `navigable`, so search engines see the
pages in the navigation and nothing else, and it sets no site-wide `robots` meta tag. A `robots` tag
under `seo.metatags` is rendered on every page of every deployment, production included, so it
cannot protect previews and it blocks the production site; `check` fails on a site-wide value that
contains `noindex`, `nofollow` or `none`, and on any `seo.indexing` other than `navigable`. A
reviewed `seo.paths` entry may still withhold one folder.

Two further controls live outside this repository and are not configured by it:

- The Mintlify project switch **Don't index project** (dashboard, General) withholds the whole
  project, overrides `docs.json` and must stay off for production.
- Pull-request preview hosts are withheld by the provider. On a pull-request preview
  observed while this section was written, `robots.txt` was `User-agent: *` with `Disallow: /` and
  `Content-Signal: ai-train=no, search=no, ai-input=no`, while the production project's
  `robots.txt` allowed crawling apart from `/_next/` and `/cdn-cgi/`. That is the provider's
  behavior for preview hosts, not a setting here; the probe below shows it for any preview.

```bash
# Production: no blocking meta tag, header or robots rule, canonical on the custom domain, and a
# sitemap that lists pages.
npx tsx scripts/docs-probe.ts indexing https://docs.saga-a2ui.dev indexable
# A pull-request preview: at least one signal withholds it.
npx tsx scripts/docs-probe.ts indexing https://PREVIEW-HOST withheld
```

The report lists each signal (`robotsMeta`, `robotsHeader`, `robotsTxtDisallowsAll`, `blocks`),
the page's canonical and the sitemap's URL count, and exits 1 when the expectation fails. A
sitemap or search-engine submission, Search Console verification and the time a crawler takes to
index are separate operations and are not shown by this probe.

## Generated output and its one regeneration path

Pages under `guides/` and `components/` are generated output. Do not edit them by hand and do not keep
a second copy of a guide elsewhere (the marketing site links here; it has no manual of its own).
`release.json` is the input, and the generator is the only path from source to those pages:

```sh
npx tsx scripts/docs-release.ts generate VERSION
```

`generate` reads the guides, package manifests and entry points from the revision named in
`release.json` with `git show`, so it never reads the working tree. It converts each guide to MDX and
changes only what MDX rejects or what stops working outside the repository:

- `{`, `}` and `<` outside code are escaped, HTML comments are removed and autolinks become links;
- a relative link to a guide of the release becomes that page's route, and a link to any other file or
  directory becomes a link to it at the pinned revision; images are linked at the pinned revision;
- every fenced code block is copied exactly, including its info string;
- the title comes from the first heading, and a banner names the version, the channel, the source
  file, the revision and the Apache-2.0 license.

`generate` refuses to run once a release's pages are committed, because a published release is a
snapshot. `release.json` also lists every file of the revision's `docs` directory as published or
excluded, with a reason for each exclusion; a test fails if one is missing.

Two cases show why a guide is excluded from a stable release. A guide can describe packages that the
registry did not have at that version, such as the Lit packages before `0.7.7-rc.1`. A guide can also
state something the registry later contradicted, for example that no `0.7.x` package was published.
Verify package versions on npm before adding a release, and put the finding in `exclusions`.

## Add a release

1. Confirm the version exists on npm for the packages you will list, and choose the source revision.
   A manifest version in the repository can be ahead of the registry.
2. Create `docs/releases/VERSION/` with `release.json` (copy an existing one), and add the authored
   `installation.mdx` and `server-entry-points.mdx` for that version from its manifests.
3. Run `generate VERSION`. It adds the version to `docs.json` as a prerelease or stable entry that is
   not the default; it never changes the label or default of an existing entry.
4. Make a stable release the default, or relabel the previous stable one, as a deliberate one-line
   change to `docs.json` in the same reviewed pull request.
5. Run `npx tsx scripts/docs-release.ts check`, `npx mint validate` and `npx mint broken-links`.
   `check` needs only committed files. In a full clone, `verify-source` regenerates each release in
   memory and reports any page that differs from its revision.
6. Open a pull request. Merge it only after its Mintlify preview passes the checks below.

An older release is not regenerated when a newer one is added, and newer source never changes it. A
correction to a released page is an explicit, reviewed edit of that page; `verify-source` then reports
that page as drift, and the pull request should say why.

## Heading anchors

Mintlify's heading ids differ from GitHub's: it keeps `@`, `/`, `+` and a typographic apostrophe and
numbers a repeated heading from 2, where GitHub numbers from 1. A link written for GitHub, such as
`#alexa`, can miss on this site (the id is `alexa+`). The generator and `check` use the observed
rule, and `check` reports a link to a heading whose punctuation the rule has not been verified for.
The rule was compared with the ids that `mint dev` renders for every published page.

## Check a deployment

```bash
# Real MCP client: initialize, list tools, then once per release a search, a version-filtered
# search and a read of that release's server-entry-points page.
npx tsx scripts/docs-probe.ts mcp https://SITE/mcp
# Every page in docs.json is served as Markdown and its code blocks equal the committed ones.
npx tsx scripts/docs-probe.ts pages https://SITE
# Hash every page in docs.json before and after a change to a newer page.
npx tsx scripts/docs-probe.ts snapshot https://SITE > before.json
npx tsx scripts/docs-probe.ts snapshot https://SITE > after.json
npx tsx scripts/docs-probe.ts compare before.json after.json
# Every public route, and where each component is documented.
npx tsx scripts/docs-release.ts routes
```

`mcp` passes only when each release's own server-entry-points page is the first release page searched
and the page returned by the endpoint's read-only filesystem tool states that release's export facts
(`FACTS` in the probe, checked against the committed pages by the tests) without the other release's.
When the search tool has a `version` argument, the probe repeats the question with the release's exact
version name and fails if the filtered search returns another release's page or none. Without the
argument, search results can include pages of every release, listed by path but not failed. A snippet
is not a retrieved page, so the probe reads the page. `pages` fetches each page's hosted Markdown and
fails on a page that is not served or whose fenced code blocks differ from the committed ones; it
ignores the `theme` attribute the platform adds to a block's info string. `compare` lists changed and unchanged pages and
exits 1 when a page could not be read. The probe writes nothing to the site. Its tests in
`scripts/docs-probe.test.ts` use local stand-ins, so they show how the probe judges a response, not
what the hosted site returns.

What the hosted site does, as the probe found it:

- the search tool takes `version`, and the exact names in `docs.json` (`0.7.6`, `0.11.0-rc.1`) filter
  it; `v0.7.6` and `v0.7` returned no result;
- without the argument, both releases' pages are returned, with the requested release first for a
  question that names it;
- `/llms.txt`, `/sitemap.xml`, `/.well-known/mcp.json`, a page address with `.md` appended and each
  release's `components/catalog.json` are served. `llms.txt` lists the default release's pages only;
- `/llms-full.txt` is documented by Mintlify and was served by the production site before this
  content was added, but a pull-request preview returned 404 for it. Confirm it on the production site
  after merging before telling anyone to rely on it;
- the site's root redirects with `308` to the default release's installation page.

A pull request receives a Mintlify preview on its own host, named in the Mintlify check and PR
comment; pass that host to `snapshot` and `mcp`. Provider host names are removed before hashing, so a
preview snapshot compares directly with a production snapshot.

## Demonstrate an update and a rollback without touching released content

On a preview of a pull request, record a snapshot of the preview, append one sentence to a page of the
newer release only, and take a second snapshot after the preview deploys (usually within two minutes).
`compare` must list only that page as changed. Then revert the commit and take a third snapshot: every
hash returns to the first. Take a production snapshot beside each to confirm that production did not
move. This shows that a Git-sourced older page does not change when a newer page does, and that a
preview is isolated from production. It is not a Mintlify snapshot feature.

## Roll back

Revert the pull request that changed the site. The revert restores the navigation entry and the page
content together, and Mintlify redeploys the default branch. Check the result with `snapshot` and
`compare` against a snapshot taken before the change. To abandon a release that was never meant to
be published, revert the pull request that added it. Removing a project in the Mintlify dashboard is a
separate decision; confirm its identity first. Activating or removing the custom domain is a DNS
operation and is not part of a content rollback.

## Component catalog and the website

Each release lists its components in `docs/releases/VERSION/components/`. The generator reads each
entry point named in `release.json` from the package manifest and source at the pinned revision. It
stops if the manifest does not export the subpath, if the version does not match the listed npm
version, or if the entry point exports nothing, so the catalog cannot name an API the source does not
have. A package that has no registry release at that version is listed as not published. The
static demonstration on each component page is a copy of lines from a maintained source file, located
by its first and last line and copied at the pinned revision; it is not a live rendering.

`components/catalog.json` is the machine-readable form. The website reads it at a pinned commit of
this repository, uses each component's `route`, `summary` and `usage` for its own cards and links to
the page here. `npx tsx scripts/docs-release.ts routes` prints every page and, for each component, its
route in every release that documents it. A component missing from the default release has no stable
route: link to the prerelease page and show the Prerelease label with it.

## Agents

`docs/connect/assistants.mdx` is the page for people connecting an assistant. It is shared by every
release because the endpoint is not versioned. It does not claim that any assistant finds the server
by itself; a person connects it to each client.
