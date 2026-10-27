---
feature_name: application_setup
status: approved
module_blueprints: []
dependencies: [reusable_mcp_connector]
date_added: 2026-10-16
---

# Application setup for new and existing backends

## Status

**Approved; scoped starter, demo, guide and source-CLI deliveries implemented.** The original approved design is [`6785ae1d8205a45e668f478ea303fbdd7e474663`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6785ae1d8205a45e668f478ea303fbdd7e474663/blueprints/features/application_setup.blueprint.md). The [lifecycle records](application_setup.lifecycle.md#status) preserve the Hapi ownership/lifecycle and view-composition amendments, every reviewed candidate and actual landed revision, and the detailed acceptance tables. This refresh changes no approved contract and does not declare the broader feature finally accepted.

The source CLI currently offers five Lit/MCP starter pairs and one separate Node demo. Hapi's maintained bridge and identity handoff are implemented, not pending. Both Lit and React stacks are published packages, but React has no qualified starter pair; published renderer availability does not add a CLI row. Source reconciliation here uses `cdad54747dfbba756464676ac3b1b8c90148a566`.

The SDK's published `0.7.7-rc.1` packages are distinct from source CLI output pinned to matched development candidates. Use [public installation](../../docs/public-install.md) for registry-based applications and [getting started](../../docs/getting-started.md) for source starters. Historical local transport/browser and packed-consumer qualification does not establish production deployment, OAuth or new named-host/audio acceptance.

## Problem and current behavior

A TypeScript developer with a new or existing backend needs maintained setup code whose authentication, transport and view ownership agree. SAGA uses one template source per supported server integration: the CLI exports those files for a new project, and the existing-backend guide extracts snippets from them. The synthetic demonstration keeps its identities and business fixtures outside those clean templates.

Four roles remain distinct: the **starter** supplies clean application source, the **demo** shows a synthetic workflow, the **guides** explain setup and actions, and the **CLI** exports or prepares artifacts. A template is not an npm package. A stack is an npm package connecting one renderer to MCP delivery. Neither a package's availability nor a template directory's existence alone qualifies a CLI pair.

The current maintained templates all use `lit-mcp`. `QUALIFIED_STARTERS` in [`scripts/qualified-starters.ts`](../../scripts/qualified-starters.ts) owns the tested inventory; `SUPPORTED_PAIRS` in [`scripts/saga.ts`](../../scripts/saga.ts) separately owns what init offers. Their five current server targets are:

| Server target | Integration |
| --- | --- |
| `node` | [`lit-node`](../../templates/lit-node/), official `@modelcontextprotocol/node` adapter |
| `express` | [`lit-express`](../../templates/lit-express/), official `@modelcontextprotocol/express` adapter |
| `hono` | [`lit-hono`](../../templates/lit-hono/), official `@modelcontextprotocol/hono` adapter |
| `fastify` | [`lit-fastify`](../../templates/lit-fastify/), official `@modelcontextprotocol/fastify` adapter |
| `hapi` | [`lit-hapi`](../../templates/lit-hapi/), SAGA-maintained bridge over the official Node/server SDK |

SAGA owns the Hapi integration in `templates/lit-hapi`, whose bridge (`server/bridge.ts`) was adapted from an earlier proof of concept. That proof of concept is not part of this repository, is not a production deployment, and creates no external repository, maintainer, package or runtime prerequisite. SAGA maintains the bridge and qualifies its request identity handoff and transport protections independently. The template is the single maintained source for exported applications and generated attach recipes. Route authentication alone does not show that identity reaches SAGA’s handlers. Framework adapters, HTTP handling and authentication remain application or template integration; none of them is a SAGA package.

## Proposed behavior

This section describes the approved behavior as currently implemented for the offered pairs. It adds no new renderer or server proposal.

**New project.** Run the repository's source CLI from a prepared checkout, with an explicit supported pair and a new destination:

```sh
npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server hono ./my-app
```

The `lit-mcp` choice selects a maintained Lit template whose browser code imports `@saga-a2ui/lit-mcp-stack`; server code uses `@saga-a2ui/mcp/server`. `startA2uiView` owns connection/readiness and surface lifetime, while application code supplies its catalog, actions, result interpretation and application cleanup. The surface owns presentation bindings. This replaces hand-composed bridge/readiness/pagehide sequencing in a consumer.

The CLI is a repository script, not a published `saga` tooling package. Its exported project pins SDK dependencies to the source build's candidate version; obtain and install that matched candidate set as the [setup guide](../../docs/getting-started.md) describes. Running init does not install the output. For a registry-based application, use the separate public-install recipe rather than assuming a commit-specific candidate exists on npm. React and Lynx are not offered starter pairs.

Init creates a new directory only. It refuses to overwrite existing files, follow unsafe symlinks, install dependencies implicitly or run remote hooks, and it never modifies an existing application. It offers only the explicit supported pairs qualified by CI; a newly qualified template still needs its CLI row. For any other pair it refuses and prints the list of supported pairs. The generated starter is clean: it contains no demo content, synthetic identity or media, and no test verifier.

**Existing backend.** A developer with a running server follows the attach-SAGA recipe in the developer guides, which also cover Hapi. The recipe's authentication and server snippets are not hand-written copies. They are generated from the same maintained, tested template files that init uses, and CI qualifies those templates. Both paths therefore use qualified stack and server pairs and share glue, but not business fixtures.

**Identity handoff.** In both paths the application authenticates the request and gives SAGA its verified identity through the verified-identity hook implemented by the [reusable MCP connector](reusable_mcp_connector.blueprint.md). The application keeps authentication and domain authorization. For Hapi, the application’s authentication strategy snapshots and freezes the verified identity before any body wait. The bridge starts and owns the admission lifetime before authentication, which accesses it through `mcpRequestLifetime(request)`. Its factory receives `{ authInfo, lifetime, request }`; the official Node transport carries request-local auth to SAGA’s verified-identity hook. The bridge owns bounded parsing, deadlines and connection cleanup, scoped to its registered endpoint. Identity stays per-request. A protected operation that receives no verified identity fails closed; a declared public operation needs none and receives no fabricated identity.

**Demo.** One qualified stack and server pair serves as the demo. It matches the source-built standalone download and keeps the full synthetic allowed, denied, expired and recovery semantics. There is no demo for every pair. The demo reuses the shared glue but keeps its own fixtures, separate from the starter, and the selected pair is Lit/MCP on Node. `SUPPORTED_DEMO_PAIRS` is selected from `DEMO_TEMPLATE`; adding another init pair does not add a demo.

The ownership flow below remains applicable. “Qualified pairs” does not bypass the explicit CLI offer table, and the diagram's shorthand `saga init` is invoked through the source script above.

![Shared maintained templates are qualified by CI; both new-directory init and the existing-backend recipe use qualified pairs and hand identity to the verified-identity hook; the one separate demo reuses the shared glue with its own fixtures.](../../diagrams/application-setup.svg)

[Editable Mermaid](../../diagrams/application-setup.mmd) · [Editable Excalidraw](../../diagrams/application-setup.excalidraw) · [PNG](../../diagrams/application-setup.png)

## Responsibilities and interfaces

The SDK repository owns the maintained templates and their qualification; applications own authentication, domain authorization and business data. A test harness may supply synthetic identity from outside, but a clean starter's verifier refuses credentials until the application configures it. No test verifier or demonstration credential is exported in starter source.

| Owner | Responsibility |
| --- | --- |
| `templates/<name>` | Authoritative source for the exported project, metadata and marked authentication/operation/action snippet regions. Framework-independent files stay aligned across the maintained templates. |
| `scripts/qualified-starters.ts` | Qualification inventory and the one `DEMO_TEMPLATE`. |
| `scripts/saga.ts` | The single parser, explicit offered pairs, safe destination handling and command output. Optional publication commands load only when selected. |
| `scripts/starter-template.ts` | Export and snippet extraction, exclusive destination creation, device/inode ownership checks and interruptible cleanup. |
| `scripts/guide-recipes.ts` | Generates `docs/attach-to-existing-backend.md` from qualified template snippets and the offered-pair table. Never edit the generated guide by hand. `npm run guide:recipes` regenerates it; `scripts/guide.test.ts` checks freshness. |
| Template listener/adapter | Framework integration and per-request identity/lifetime handoff. Hapi's bridge owns its scoped route lifecycle; the application configures paths, policy and authentication. |
| Application view and stack | The application defines meaning and presentation; the stack owns readiness/connection and surface cleanup. Application teardown releases only application-owned resources. |
| Demo/tour owners | Keep synthetic fixtures and simulated outcomes separate from the starter and from real server/host evidence. |

The optional `publish` and `publish handoff` commands are implemented source tooling with their own [host-publication design](host_publication.blueprint.md) and [usage](../../scripts/publish/README.md). They prepare artifacts and record manual submission; they do not deploy, upload or submit. Their existence does not make this CLI an npm package or establish a host listing.

## Failure and recovery

| Trigger | Observable result and recovery |
| --- | --- |
| The requested pair is not offered | Init exits without writing, names the pair as unsupported and lists supported pairs. |
| The target directory exists, or contains an unsafe symlink | Init refuses and writes nothing; the developer chooses a new path. |
| Init is interrupted while copying | Cleanup removes only output still owned by this run; a replacement directory is preserved. The developer retries with a clean path. Hard termination can leave partial output, and adjacent filesystem races are not adversarial-filesystem immunity. |
| A request to a protected operation carries no authentication | The request fails closed; no handler runs. A declared public operation is unaffected. |
| Two requests with different identities overlap | Each handler sees only its own request's identity. |
| A template changes and a pair fails CI | Its owner must remove the explicit supported-pair row until qualification passes; the CLI does not run CI or change that table at invocation. |

## Verification outcomes

The [lifecycle companion](application_setup.lifecycle.md) retains the complete STARTER1, DEMO1, CLI1/CLI2, GUIDE1/GUIDE2, framework/Hapi and TOUR1 acceptance records with exact design, reviewed and landed SHAs. Their test counts describe those runs, not new runs performed for this refresh.

For changes to an offered pair, preserve the existing qualification boundaries:

- Export and build its clean source outside the workspace from matched packages; verify its public imports and exclude synthetic verifier/fixture code.
- Exercise public and protected calls, allowed/denied/missing credentials, concurrent immutable identities, and request/body/finite-delivery bounds with the real local adapter. Hapi additionally proves route-authentication identity reaches the factory's admitted request context.
- Exercise setup, direct instance actions, prerequisite refusal and cleanup through the built browser view. Cancellation does not prove server rollback; the surface's ownership must leave retained controls inert.
- Check actual CLI refusals, no implicit installation/output hooks, interruption and destination replacement. Demo qualification remains separate from init.
- Regenerate template-derived recipes when their source changes and check their freshness, commands, imports and links. Guides must match the offered pairs without turning historical experiments into setup promises.

Local listener, browser, packed-artifact and actual registry installation evidence answer different questions. A static tour's simulated server does not authenticate or establish backend enforcement. The synthetic download is not a deployment, and local audio progress is not remote-host audio acceptance.

## Implementation sequence

The original sequence first qualified the starter and demo against package release-readiness, then added guides and CLI export. Later framework registration, Hapi ownership/lifecycle and stack composition completed the recorded scoped deliveries. Those dependency and acceptance records remain in the [lifecycle companion](application_setup.lifecycle.md); they are not an outstanding dispatch list.

A new pair must qualify its own maintained template, register an explicit CLI row and regenerate the existing-backend recipe. A demonstration needs its own maintained implementation and qualification; a working starter does not imply a demo. Existing-backend setup remains an application integration, never CLI mutation of an existing project. Ansari adoption and broader React/Lynx support are not prerequisites for the existing five Lit starters.

## Open decisions and limits

The original demo choice, Hapi callback handoff and required server-target questions are resolved for the recorded scope: the demo is Lit/MCP/Node; Hapi factories receive `{ authInfo, lifetime, request }`; and all five required server targets have qualified Lit templates. Preserve their tested adapter/framework versions in template manifests and qualification records; no other version inherits that evidence automatically.

React stack publication does not establish a React starter. Lynx has no offered setup recipe. Any further renderer/server pair or bridge packaging requires its own scope and qualification. Publication, deployment, named-host authentication and final human acceptance remain separate from this source documentation refresh.

## References

- [Reusable MCP connector](reusable_mcp_connector.blueprint.md), [package layout](../../packages/README.md), [host publication](host_publication.blueprint.md), [coding standards](../../CODING_STANDARDS.md).
- Issues: [PACK2 #22](https://github.com/MachineWisdomAI/saga-a2ui/issues/22), [STARTER1 #23](https://github.com/MachineWisdomAI/saga-a2ui/issues/23), [DEMO1 #24](https://github.com/MachineWisdomAI/saga-a2ui/issues/24), [GUIDE1 #25](https://github.com/MachineWisdomAI/saga-a2ui/issues/25), [CLI1 #26](https://github.com/MachineWisdomAI/saga-a2ui/issues/26), [GUIDE2 #27](https://github.com/MachineWisdomAI/saga-a2ui/issues/27), [CLI2 #29](https://github.com/MachineWisdomAI/saga-a2ui/issues/29).
- Upstream [typescript-sdk middleware packages](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/middleware), checked 2026-10-16.
