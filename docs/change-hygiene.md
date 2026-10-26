# Pull requests, evidence and retained artifacts

## Describe the change

Use a Conventional Commit title. Start the PR description with the concrete problem and resulting behavior; include a before/after example when useful. Explain the final implementation, why it solves the problem, checks actually run and material limits. Keep simple changes to a few sentences plus validation. Link the community issue when one exists. Internal delivery records link outward to this PR; do not expose private ticket links or create a public ticket solely for an internal change.

Rewrite the title and description when scope changes. Remove abandoned approaches and drafting history unless they explain a tradeoff. Separate source readiness from installation, deployment and actual-host acceptance. State explicit merge holds. Report version updates under [the version policy](version-policy.md); a bump does not authorize publication.

## Evidence

This section owns how to collect, summarize and place verification evidence. Do these steps in order; each is finished when its condition holds.

1. **Choose the claim.** Name the acceptance claim before capturing anything. Done when you can state what the evidence must show.
2. **Collect proportionally.** Prefer a reproducible command and a concise result with the exact revision. Keep one representative screenshot for a visual claim when it adds information a test result cannot convey. Retain another capture only for a distinct required state, failure or host behavior. Reuse still-valid evidence for unchanged behavior and test the affected boundary after a repair; do not repeat whole host matrices or generate screenshots to decorate a completion report. Done when each capture proves a claim no other item proves.
3. **Keep disposable output ignored.** Raw runs, duplicate screenshots, video, traces and reports stay in ignored `.wise-agents/`, `test-results/` or `playwright-report/` directories. Done when `git status` shows none of them.
4. **Classify what remains.** Place it by purpose, using the table in [CONTRIBUTING.md#documentation](../CONTRIBUTING.md#documentation):
   - A change's observed verification goes in its PR description and, for Blueprint-backed work, the applicable Blueprint Status summary. State the claim, exact revision, command or action, observed result, scope and limitations so a reader without private access can assess it.
   - Detailed maintainer audit trails, probe observations and testing dossiers belong to the private Backstage record lifecycle. Sanitize what acceptance needs and route it there; do not add it to current SDK guides, this repository's `docs/`, or a dated or edition-named file.
   - Public explanatory diagrams, runnable examples and minimal reproduction fixtures stay with their existing source owners, under the storage rules below.
   Done when every kept item has one destination and the PR needs no private access to be understood.
5. **State the boundary.** Keep source readiness, package installation, deployment, actual-host observation and publication as separate claims in every summary, and mark what was inferred or not run. Historical evidence stays historical; version updates must not rewrite it. Keep private records, credentials and personal data out of everything public, even when stored in LFS. Done when no summary claims more than its evidence shows.

## Store retained artifacts with Git LFS

Retained public artifacts (reproduction captures, receipts or generated deliverables kept with a fixture or diagram) follow the storage rules here. `docs/evidence/**` and `docs/artifacts/**`, including text/JSON payloads, are LFS paths for such artifacts; they are not a destination for maintainer dossiers (see [Evidence](#evidence)). Authored Markdown stays outside these directories in normal Git. Common image, media, office-document and archive extensions use LFS wherever stored; `.gitattributes` is authoritative. Add a matching rule before retaining a new binary format or evidence directory.

Install Git LFS, then stage explicit paths normally. Verify the staged pointers with `python3 scripts/check-lfs.py`; CI runs the same check. If a file was staged before its LFS rule, restage that explicit path with `git add --renormalize PATH`. Inspect the resulting diff. Do not rewrite repository history to migrate old blobs without explicit authority.

The MachineWisdom pre-push guard may not invoke LFS. Preserve that guard and upload objects explicitly before publishing a branch:

```sh
git lfs push origin YOUR_BRANCH
git push origin YOUR_BRANCH
```

Fetch only the artifacts needed for a task with `git lfs pull --include='PATH_OR_PATTERN'`. CI jobs that consume retained artifacts must fetch those paths before testing; the pointer check alone does not prove object upload or runtime validity.
