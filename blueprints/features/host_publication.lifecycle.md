# Host publication lifecycle

The current contract is in the [host publication Blueprint](host_publication.blueprint.md). These are historical design, reviewed-head and landed-code records, with their original acceptance limits. Dated issue-closeout statements and the original implementation sequence describe their recorded stage, not new implementation work or authority to publish.

## Status

- Design: approved on 2026-10-16 at [`19fb26c84116b15a56fec31bfa358898fe96d791`](https://github.com/MachineWisdomAI/saga-a2ui/blob/19fb26c84116b15a56fec31bfa358898fe96d791/blueprints/features/host_publication.blueprint.md).
- Implementation: ChatGPT preparation (CLI3) and Claude connector materials (CLI4) are implemented and independently verified. The resumable submission handoff (CLI5, [#68](https://github.com/MachineWisdomAI/saga-a2ui/issues/68)) is implemented as `saga publish handoff` and independently verified through fixtures, as recorded below.
- Acceptance: application-owner agreement, authorized submissions and each host’s directory approval remain separate; design approval authorizes none of those actions.

## CLI3 implementation and acceptance — 20 October 2026

Blueprint `19fb26c84116b15a56fec31bfa358898fe96d791` implemented for the ChatGPT preparation slice at `MachineWisdomAI/saga-a2ui@373f467761251d34c621d5d83ba2a321c22308d7` ([PR186](https://github.com/MachineWisdomAI/saga-a2ui/pull/186)). Independent approval [5588900817](https://github.com/MachineWisdomAI/saga-a2ui/pull/186#pullrequestreview-5588900817) covers exact head `9ccd7f70b133c03418c4f2b6dd7851d738a85c83`; [application CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39464761155) and [version policy](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39464761231) passed.

The five [SDK66 criteria](https://github.com/MachineWisdomAI/saga-a2ui/issues/66) map to the following accepted behavior:

| Criterion | Accepted scope and evidence |
| --- | --- |
| Release inputs, records and supported validators | The implementation pins portable manifest schemas with source/license/digest attribution, records validator identities, and keeps the OpenAI authorization extension as an explicit portal handoff rather than silently accepting it under a closed schema. Official requirements were checked during independent review. |
| Complete application and identity validation | Qualification reuses the existing packed starter build and listener, serves its actual built Lit resource, and records observed installed package versions separately from declarations. Build/resource correspondence, tool/resource definitions, assets and publisher/contributor attribution are checked. Declared endpoint name/version equality is bounded evidence, not proof of publisher or domain authority; unresolved deployment identity stays explicit. |
| No-effect discovery and secret boundaries | Default discovery invokes no application tools; fixture invocation requires explicit opt-in. Sanitized output includes unexpected errors escaping assessment, with synthetic-token regressions covering stdout/stderr as well as artifacts. |
| Readiness, determinism and interruption | Missing/invalid inputs, unavailable validators and truncated discovery prevent readiness. Contract metadata/instructions and validator changes invalidate affected freshness. Repeated unchanged inputs retain content digests. Directory identity checks preserve replacement user data and staged interruption tests prevent an apparently complete partial artifact. PNG structure and SVG XML validation reject malformed assets; unavailable XML validation remains unknown. |
| Single optional CLI, preparation only | Commands reuse the existing parser and output-ownership safety. No deployment, directory submission, runtime extension implementation or package publication is performed. |

Independent verification retained 81 passing publication/original-regression checks, then ran 18 affected checks for the final reporting/XML repairs. The final integration changed synchronized version values and prepared-version prose only; those accepted runtime checks were reused. The original broader run passed 137 of 139 cases; the two unrelated framework typechecks lacked adapters in the reused review dependency tree and were not represented as passing. Existing qualified framework evidence remains separate. No new host matrix or live application effects were needed for this preparation scope.

CLI3 source acceptance and its reviewed lifecycle record are complete; SDK66 is closed. CLI4 and CLI5 retain their own acceptance criteria. Application-owner authority, authorized submission, platform review, actual listing installation and named-host evidence are not supplied by generating a ZIP or a ready preparation record.

## CLI4 implementation and acceptance — 20 October 2026

Blueprint `19fb26c84116b15a56fec31bfa358898fe96d791` implemented for Claude connector preparation at `MachineWisdomAI/saga-a2ui@63e857ea6ca9326735657caa0dc2b75622d1082a` ([PR189](https://github.com/MachineWisdomAI/saga-a2ui/pull/189)). Final head `0c149400c07b7c437fdc7938e3bcf895c55115d9` received [independent approval 5590281447](https://github.com/MachineWisdomAI/saga-a2ui/pull/189#pullrequestreview-5590281447); [application CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39481128657) and [version policy](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39481128672) passed.

| SDK67 criterion | Accepted scope and evidence |
| --- | --- |
| Shared records, validators and deterministic generation | `saga publish --target claude` reuses CLI3 release inputs, record identities, output ownership/interruption safety and target-aware prior-artifact checks. The locally available official Claude plugin validator passed; unavailable validation remains an explicit finding. |
| Connector-specific identity without distribution claims | The dossier records the declared endpoint and exact tool/resource/release evidence, including the documented UI-domain calculation. Official submission/authentication/MCP Apps guidance was inspected during review. Local well-formedness and dossier preparation do not establish directory approval, Desktop/Code installation or web distribution. |
| Optional bundle requires supplied scope | Bundle assembly uses only supplied skills, README and license scope and points to the declared endpoint. No sidebar, invented onboarding capability or runtime extension is created. Excess screenshot input is rejected explicitly rather than silently truncated; the independently checked official constraint was three to five screenshots. |
| No effects, safe outputs and honest missing inputs | Default discovery against the qualified synthetic Node listener makes no application-tool calls. Supported bundled text, extensionless files and LICENSE content are scanned for recognized credentials; original public-command credential regressions pass after repair. Missing publisher authority, materials and validators remain explicit findings. |

Independent verification passed 122 supplied Claude/shared publication checks and root TypeScript. After two verified output-validation repairs, 21 affected Claude/independent regression cases and 11 affected shared cases passed; unchanged evidence was reused. Final main integration imported only the accepted TOUR1 record and preserved the reviewed runtime and version outputs. No package installation, named-host tests, deployment, submission or publication was performed. SDK67 is closed after its reviewed lifecycle record; CLI5 retains the separate resumable-handoff scope.

## CLI5 implementation and acceptance — 20 October 2026

Blueprint `19fb26c84116b15a56fec31bfa358898fe96d791` implemented for the fixture-verified resumable-handoff scope at `MachineWisdomAI/saga-a2ui@260b475fdc457dd3d3ca45f7caa9c8b59dcf2bdb` ([PR193](https://github.com/MachineWisdomAI/saga-a2ui/pull/193)). Final head `067e05a64eb58f0dc4a7ac9382922b404e056793` received [independent approval 5591522127](https://github.com/MachineWisdomAI/saga-a2ui/pull/193#pullrequestreview-5591522127); [application CI](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39494167535) and [version policy](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39494167594) passed.

| SDK68 criterion | Accepted behavior and boundary |
| --- | --- |
| Durable identity, evidence and freshness | The local handoff record retains host-specific identity, release evidence, explicit unverified publisher-authority references and observed timestamps. Changed current preparation/deployment evidence invalidates affected readiness even when a historical live-listing observation exists. Review observations cannot supersede a newer observation with an older one. |
| Uncertain outcomes and safe retry | Persisted attempt/submission/review/listing states remain distinct. Uncertain outcomes require inspecting the existing record before retry; fixtures cover interruption, concurrency and state transitions without duplicate upload or silent publication. Directory and staged-file ownership checks refuse replacement and preserve foreign files, including the native macOS non-`/proc` cleanup path. |
| Supported handoff, no invented service | `saga publish handoff` supports local records for documented manual/native handoff. It makes no network submission, provides no undocumented submission API or hosting service, and bundles no credentials. |
| Fixture verification versus actual publication | Implementation acceptance uses fixtures and public-command regressions. Recorded authority references are not independently verified publisher authority, and recording a listing is not named-host installation evidence. Actual submission, platform review and live installation require their own authorized evidence. |

Independent verification passed 89 affected handoff/parser checks, then 27 focused checks after the first repairs and 11 focused ownership/cleanup/interruption/race/state checks after the final repair, with TypeScript and current-base version policy passing. The final independent macOS reproduction verified that a directory replaced after staging keeps its foreign file and the command refuses the write. Unchanged cases were reused; the Linux-only `/proc` branch was not newly qualified by that macOS run. Worker-reported broad-suite failures were assessed proportionately: 22 request-consumer/playback-budget checks passed in isolation, while a missing Lynx dependency prevented collection in the reused environment and was not a new CLI5 defect. No broad runtime or host matrix was repeated.

All four scoped SDK68 criteria are supported by this evidence; the issue remains open until this lifecycle record is independently reviewed and merged. No actual upload, submission, installation, deployment or publication was performed. The implementation records observations and readiness boundaries; it cannot grant platform approval or establish a live listing by itself.

## Original sequencing and decisions

The following records the approved design’s sequencing before CLI3–CLI5 were implemented. Current record formats and behavior are described in the Blueprint and publication tooling README.

## Implementation sequence

After design approval, reconcile additive coverage with CLI1 and CLI2 and consider a further CLI implementation slice, here called CLI3; no new issue is assigned to it. Establish the release-input and evidence interface, then exercise both host adapters with one application before adding portal handoff. Preserve init/demo and the full renderer matrix, including init's fail-closed behavior against overwrites, unsafe symlinks, implicit installs and remote hooks.

Publication tooling is optional developer tooling, and neither it nor external directory approval is a new prerequisite for the [Ansari migration](ansari_adoption.blueprint.md). If the tooling is not ready, a first listing can be prepared through each platform's native flow. The migration's existing gate remains unchanged: the SAGA source must be public and the exact required package versions must install anonymously from public npm. Design approval creates no implementation tickets or publication authority.

## Open decisions

Design review must settle the smallest configuration and durable record format, the supported upstream validator versions, and how application deployment identity is supplied. Portal automation requires a supported interface or an explicitly authorized browser workflow; credentials, publisher ownership and platform review remain outside package generation.

