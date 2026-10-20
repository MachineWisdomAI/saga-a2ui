# Pull requests and retained artifacts

## Describe the change

Use a Conventional Commit title. Start the PR description with the concrete problem and resulting behavior; include a before/after example when useful. Explain the final implementation, why it solves the problem, checks actually run and material limits. Keep simple changes to a few sentences plus validation. Link the community issue when one exists. Internal delivery records link outward to this PR; do not expose private ticket links or create a public ticket solely for an internal change.

Rewrite the title and description when scope changes. Remove abandoned approaches and drafting history unless they explain a tradeoff. Separate source readiness from installation, deployment and actual-host acceptance. State explicit merge holds. Report version updates under [the version policy](version-policy.md); a bump does not authorize publication.

## Collect only useful evidence

Choose the acceptance claim before capturing evidence. Prefer a reproducible command and concise result with the exact revision. Keep one representative screenshot for a visual claim when it adds information a test result cannot convey. Retain another capture only for a distinct required state, failure or host behavior. Reuse valid evidence for unchanged behavior and test the affected boundary after a repair; do not repeat whole host matrices or generate screenshots to decorate a completion report.

Keep raw runs, duplicate screenshots, video, traces and reports in ignored `.wise-agents/`, `test-results/` or `playwright-report/` directories. Promote only the smallest sanitized artifact needed to reproduce a failure or support an acceptance decision. Summarize what it proves, its source revision and its limitations in the PR or acceptance record. Historical evidence stays historical; version updates must not rewrite it. Keep private records, credentials and personal data out of artifacts even when stored in LFS.

## Store retained artifacts with Git LFS

Use `docs/evidence/` for retained captures, receipts, logs and traces, and `docs/artifacts/` for retained generated deliverables. Both directories, including text/JSON payloads, use LFS. Authored Markdown decisions and acceptance summaries stay outside these directories in normal Git. Common image, media, office-document and archive extensions use LFS wherever stored; `.gitattributes` is authoritative. Add a matching rule before retaining a new binary format or evidence directory.

Install Git LFS, then stage explicit paths normally. Verify the staged pointers with `python3 scripts/check-lfs.py`; CI runs the same check. If a file was staged before its LFS rule, restage that explicit path with `git add --renormalize PATH`. Inspect the resulting diff. Do not rewrite repository history to migrate old blobs without explicit authority.

The MachineWisdom pre-push guard may not invoke LFS. Preserve that guard and upload objects explicitly before publishing a branch:

```sh
git lfs push origin YOUR_BRANCH
git push origin YOUR_BRANCH
```

Fetch only the artifacts needed for a task with `git lfs pull --include='PATH_OR_PATTERN'`. CI jobs that consume retained artifacts must fetch those paths before testing; the pointer check alone does not prove object upload or runtime validity.
