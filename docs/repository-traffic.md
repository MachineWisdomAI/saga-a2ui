# Repository traffic

The [Traffic workflow](../.github/workflows/traffic.yml) collects this repository at
07:59 UTC daily and through **Actions → Traffic → Run workflow**. It uses the
same pinned collection and archive actions as FAVA Trails. GitHub may delay
scheduled runs; the observation timestamp records when collection actually ran.

The archive owner is this repository. Its [`traffic` branch](https://github.com/MachineWisdomAI/saga-a2ui/tree/traffic)
retains daily views and clones in `traffic-saga-a2ui/traffic_views.json` and
`traffic-saga-a2ui/traffic_clones.json`. The collector replaces matching UTC
calendar-day timestamps rather than adding overlapping API responses. It omits
the current incomplete day and the oldest partial boundary day. Retained history
starts with the first successful collection; missed history outside GitHub's
14-day window cannot be recovered.

`observations/YYYY-MM-DD/` retains the collected daily series, top referral
sources, popular paths and an `observation.json` receipt with the actual UTC time
and workflow-run URL. Another successful run on the same UTC date replaces that
date's observation; Git history preserves previous revisions. No automatic
archive expiry is configured. Failed runs leave the previous archive intact and
appear as failed Actions runs; a missing date is missing evidence, not zero.

Views count repository page views and clones count clone operations. Daily
`uniques` values count unique visitors or cloners within that day; summing them
does not produce distinct people across days. Referrers and paths are GitHub's
top ten over a rolling 14-day window, not daily counts. Do not add overlapping
snapshots or infer website visits, conversions, campaigns or user identities.
The generated badges are repository counts, not acquisition attribution.

Collection requires an existing `TRAFFIC_TOKEN` Actions secret with repository
**Administration: read** permission. The workflow's short-lived `GITHUB_TOKEN`
writes only this repository's archive. Do not put a personal token in source,
logs or workflow inputs. If collection fails, inspect the failing step, restore
the scoped secret or its access, then rerun the failed job or manually dispatch
Traffic. The concurrency group serializes this repository's writer. Verify a
successful run and its dated receipt on `traffic` before reporting collection
as operational. The API permission and metric definitions are documented in
[GitHub's traffic API](https://docs.github.com/en/rest/metrics/traffic).

This public archive contains only this public repository's measurements. Private
website operational traffic belongs in that private repository's own archive;
never add a private repository to this workflow's `static_list` or public badges.
