# Repository version policy

The updater needs Python 3.11 or newer and no third-party libraries. Select that
interpreter explicitly if the system `python3` is older (for example,
`python3.13 scripts/mw-version.py ...` on macOS).

Bump affected product versions in the original change PR. Documentation,
tests, CI, repository metadata, and development checks alone do not need a bump.
The updater determines this from changed paths, not the PR title; a mixed PR
still bumps the affected product. Run it before review and after updating from main:

```bash
git fetch origin main
python3 scripts/mw-version.py update --base origin/main --title 'chore(deps): update transitive dependency'
python3 scripts/mw-version.py check --base origin/main --title 'chore(deps): update transitive dependency'
```

Use the actual PR title. Supply `--body-file PATH` for its body, or `--event-file`
with a GitHub pull-request event containing title/body. The updater also reads
the PR branch's commits. One PR gets the largest applicable increment: features
are minor; fixes and other product changes, including runtime dependencies,
are patch. `!`, `BREAKING CHANGE:`, or
`BREAKING-CHANGE:` is major from 1.0 onward and minor before 1.0. A dependency's
own major number does not establish a breaking change in this project.

For an explicitly agreed additive change, a PR body may contain the standalone
footer `Version-Bump: patch`. This selects a patch even when the PR or its commits
use `feat`; without the footer the automatic rules above apply. A breaking
indicator in the PR or any commit still takes precedence. Pass the same body
through `--body-file` locally; CI reads it from the pull-request event. This is a
reviewed version decision, not permission to publish or to hide a breaking change.

Every versioned unit shares one major.minor; patch numbers may differ. A minor or
major increment (before 1.0, `feat` and `feat!`) therefore applies to every unit,
while a patch increment applies only to the units the PR touched. Prerelease
handling is unchanged: `0.6.4-rc.1` becomes `0.7.0-rc.1` on every unit. `check`
fails, naming the units, when any two differ in major.minor. Sibling pins (a
package depending on another package of the repository) keep mirroring the exact
sibling version. Unversioned workspace packages are outside the rule.

An integration branch freezes the version of a release that lands as many PRs. Its
`.version-policy.json` carries `"integration": {"base": "BRANCH", "version": "X.Y.Z-rc.1"}`.
The updater takes the PR's base branch from `pull_request.base.ref` in the event
file, otherwise from `--base` without `refs/remotes/origin/` or `origin/`. For a PR
into `BRANCH`, every unit must equal the pinned version, `update` changes nothing and
prints the pin, any bump fails naming the pin, and a head whose `integration` entry
differs from the base's entry (changed or removed) fails. The ancestry, sibling-mirror,
enrollment, exclusion and release-path checks still apply. A PR into any other
branch, including `main`, follows the ordinary rule above.

Integration release procedure:

1. Create the branch from `main`. Its first PR (`feat!:`) into it bumps every unit to
   the pinned version and adds the `integration` entry; it passes because it
   introduces the pin at the pinned value. An entry can be introduced only by a PR
   into its own base.
2. Child PRs into the branch leave every version alone, whatever they change.
3. To release, open one `feat!:` PR from the branch into `main` with the
   `integration` entry removed. Run `update` against `main` after removing the entry:
   `main`'s ordinary rule advances its baseline (`0.6.4-rc.1` becomes `0.7.0-rc.1`),
   and the reviewer confirms that this equals the pin. If `main` has moved on, merge
   `main` into the branch and let `update` write the version that follows `main`'s
   baseline; `check` fails until the versions match, and the pin is re-decided in that
   final PR, never by a child.

`.version-policy.json` lists version units, paths, and synchronized files. Changes
outside all unit paths affect every unit, except configured `exclude_paths`.
The standard non-release paths cover Markdown/reStructuredText, `docs/`, test
directories and test files, `.github/`, Git/editor metadata, and repository
version/test/check scripts. Other paths conservatively count as product changes.
Use optional `release_paths` glob patterns for files that ship as product despite
those defaults, such as `skills/**`, `skillsets/**`, or `src/content/**`. Review
the actual package/build inputs when adopting the policy: installed skills,
runtime prompts, templates, and rendered site content are product, even in
Markdown. Use `exclude_paths` for paths that never ship, such as demos and
repository tooling; a change PR may add or remove either list.
Documentation images under `assets/brand/` and `diagrams/` also remain exempt.
Root units use `**`. JSON mirrors can select a field with a `key` array; separate
units may own different fields in the same workspace lockfile. Use `regex` mirrors
with a named `version` capture and a `count` (default 1) for runtime constants or
HTML markers. Each non-JSON mirror owns its file; use one counted regex pattern
for repeated markers in that file. Changes to configured version values alone do not affect component
selection. Lockfiles retain their resolved dependencies. Updating again
uses the base version, so it does not accumulate bumps. Update your branch from
current main before merging; the required check rejects a stale base.

Prereleases advance the base and reset the counter: `0.1.0-rc.5` becomes
`0.1.1-rc.1` for a patch. Python metadata serializes the same version as
`0.1.1rc1`. Date prereleases retain that format and refresh the date; `--date`
accepts YYYY-MM-DD for reproducible runs. CI accepts a valid date between the
previous version's date and today, so an overnight review does not invalidate it.

Explicit release promotion uses the exact title `chore(release): promote version`
and changes only configured version values: `0.1.1-rc.1` becomes `0.1.1`, without
another base increment. Existing release review and publication authority still
apply. The updater never creates a tag, release, publication, or deployment.

For a new versioned component, run the toolkit bootstrap again or run
`python3 scripts/mw-version.py enroll --repo PATH --unit COMPONENT_PATH` from an
installed copy. Review the generated configuration and add any runtime/plugin
mirrors. Captured templates and vendored packages are not owned version units.
