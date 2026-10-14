## Change

Describe the concrete problem, resulting behavior and related SDK issue. Explain the final change and its rationale; update this description when scope changes.

## Validation

Record checks performed and any remaining limits. For code changes, explain the standards/refactor review or why no refactor was needed.

## Version and retained artifacts

State the version-policy result (including unversioned when applicable). If artifacts are retained, explain what each proves, confirm LFS pointer checks and upload, and omit redundant or disposable captures. See [change hygiene](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/docs/change-hygiene.md).

## Epic acceptance

For an epic acceptance PR, complete the following with evidence under [CONTRIBUTING.md](https://github.com/MachineWisdomAI/saga-a2ui/blob/main/CONTRIBUTING.md#epic-acceptance). For an ordinary implementation PR, mark this section not applicable; the First Officer reconciles its evidence at epic closeout.

- [ ] Acceptance criteria and final code revisions are identified.
- [ ] Daybreak diff-scan coverage, Helmet repair outcomes or no-findings result, and Daybreak revalidation are recorded.
- [ ] Coding standards/refactor review and required checks pass on the final head.
- [ ] Writing review names the artifacts and outcomes.
- [ ] Retrospective improvements to code, writing and process have dispositions.
- [ ] Required installation, deployment and actual-host evidence is recorded for this epic's scope.
- [ ] First Officer review and required independent approval cover the current head; any human-acceptance hold has been satisfied before merge.

Keep this PR self-contained and free of private planning, customer material, credentials and sensitive security details.
