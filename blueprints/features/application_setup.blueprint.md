---
feature_name: application_setup
status: draft
module_blueprints: []
dependencies: [reusable_mcp_connector]
date_added: 2026-10-16
---

# Application setup for new and existing backends

Draft awaiting human design review.

## Problem and current behavior

A TypeScript developer who already runs a backend, and an SDK implementer who maintains the starting points, need one way to get SAGA's MCP delivery into an application without copying an unverified example. No SAGA CLI, template, starter or guide exists today, and the packages described in the [package layout](../../packages/README.md) are not yet installable.

The planned work is already ticketed. [STARTER1](https://github.com/MachineWisdomAI/saga-a2ui/issues/23) is the clean starter, [DEMO1](https://github.com/MachineWisdomAI/saga-a2ui/issues/24) the demo, [GUIDE1](https://github.com/MachineWisdomAI/saga-a2ui/issues/25) and [GUIDE2](https://github.com/MachineWisdomAI/saga-a2ui/issues/27) the developer guides with their attach-to-an-existing-backend recipes, and [CLI1](https://github.com/MachineWisdomAI/saga-a2ui/issues/26) and [CLI2](https://github.com/MachineWisdomAI/saga-a2ui/issues/29) the CLI. This feature covers the scope of those four roles (starter, demo, developer guide, CLI) and adds the decisions below. It dispatches nothing; the Blueprint and the implementation breakdown still need review.

The server side depends on official `@modelcontextprotocol` middleware. Package choices were checked against the upstream typescript-sdk `packages/middleware` source on 2026-10-16 and are compared below. Available source is not proof that an adapter installs or works with SAGA. The [reusable MCP connector](reusable_mcp_connector.blueprint.md) already selects Node integration 2.1.1, together with MCP Apps 2.0.3, split MCP SDK 2.3.1 and Zod 4.2+, and that selection is not yet qualified. This design pins no further versions; the versions for the other adapters, and qualification of each pair, remain open.

| Server target | Integration |
| --- | --- |
| `node` | Official `@modelcontextprotocol/node` adapter |
| `express` | Official `@modelcontextprotocol/express` adapter |
| `hono` | Official `@modelcontextprotocol/hono` adapter |
| `fastify` | Official `@modelcontextprotocol/fastify` adapter |
| `hapi` | No official adapter; reuse the existing owned Hapi bridge over the official Node/server SDK |

The Hapi bridge is existing owned source that lives outside SAGA. It has explicit Hapi route authentication and synthetic denial tests, but its callback does not yet receive request identity. Route authentication alone therefore does not show that identity reaches SAGA's handlers. This design makes no production, deployment or existing test matrix success claim. Framework adapters, HTTP handling and authentication remain application or template integration; none of them is a SAGA package.

## Proposed behavior

**New project.** A developer runs `saga init --stack <renderer>-mcp --server <target>`, for example `lynx-mcp` with `hono`. The stack value names a renderer plus MCP delivery, never a combined word such as `lymcp`. A stack is a template choice, not an npm package; the packages remain the flat `@saga-a2ui/*` names. Required server targets are the five in the table above. Hapi is required scope, not postponed because it lacks an official adapter. It reuses the existing bridge with no transport redesign and without inventing a Hapi npm package; this does not decide any later packaging of the bridge.

Init creates a new directory only. It refuses to overwrite existing files, follow unsafe symlinks, install dependencies implicitly or run remote hooks, and it never modifies an existing application. It offers only pairs that CI has qualified. For any other pair it refuses and prints the list of supported pairs. The generated starter is clean: it contains no demo content, synthetic identity or media, and no test verifier.

**Existing backend.** A developer with a running server follows the attach-SAGA recipe in the developer guides, which also cover Hapi. The recipe's authentication and server snippets are not hand-written copies. They are generated from the same maintained, tested template files that init uses, and CI qualifies those templates. Both paths therefore use qualified stack and server pairs and share glue, but not business fixtures.

**Identity handoff.** In both paths the application authenticates the request and gives SAGA its verified identity through the verified-identity hook proposed in the [reusable MCP connector](reusable_mcp_connector.blueprint.md). The application keeps authentication and domain authorization. For Hapi, the bridge callback does not yet receive the identity that route authentication establishes, so passing it to the hook is new work. Identity stays per-request. A protected operation that receives no verified identity fails closed; a declared public operation needs none and receives no fabricated identity.

**Demo.** One qualified stack and server pair serves as the demo. It matches the standalone release download and keeps the full synthetic allowed, denied, expired and recovery semantics. There is no demo for every pair. The demo reuses the shared glue but keeps its own fixtures, separate from the starter, and the choice of pair is open (below).

![Shared maintained templates are qualified by CI; both new-directory init and the existing-backend recipe use qualified pairs and hand identity to the verified-identity hook; the one separate demo reuses the shared glue with its own fixtures.](../../diagrams/application-setup.svg)

[Editable Mermaid](../../diagrams/application-setup.mmd) · [Editable Excalidraw](../../diagrams/application-setup.excalidraw) · [PNG](../../diagrams/application-setup.png)

## Responsibilities and interfaces

The shared template files are owned by the SDK, tested in CI, and are the single source for init output and guide snippets. The CLI tickets own the flags, the supported-pair list and the safety refusals. The starter ticket owns the clean starter and the demo ticket owns the demo. The guide tickets own the attach recipes. The application owns authentication, domain authorization and its business fixtures. No new runtime API is introduced here; the identity hook is the connector's existing proposal. The CI harness may supply a test identity from outside, but test verifiers are not placed in production starter output.

## Failure and recovery

| Trigger | Observable result and recovery |
| --- | --- |
| The requested pair is not qualified | Init exits without writing, names the pair as unsupported and lists supported pairs. |
| The target directory exists, or contains an unsafe symlink | Init refuses and writes nothing; the developer chooses a new path. |
| Init is interrupted while copying | Only output that this run newly created is cleaned up; nothing that existed before is touched, and the developer reruns with a clean path. |
| A request to a protected operation carries no authentication | The request fails closed; no handler runs. A declared public operation is unaffected. |
| Two requests with different identities overlap | Each handler sees only its own request's identity. |
| A template changes and a pair fails CI | The pair is withdrawn from the supported list until it passes again. |

## Verification outcomes

Planned checks, not yet run: every offered stack and server pair is exported or installed from clean artifacts in CI, using only public imports. For each pair the check sends allowed and denied requests, a protected request with missing authentication, and concurrent requests showing identity isolation. Hapi's check additionally proves that identity reaches the hook, which its existing tests do not. Init tests cover overwrite, unsafe symlink, implicit install and remote hook refusal, the unsupported-pair refusal, and an interrupted copy that removes only newly created output. The guide snippets are checked against the template files they are generated from. The demo reproduces the full synthetic allowed, denied, expired and recovery semantics. PACK1/PACK2 evidence and the renderer recipe evidence are reused, and full existing SDK and host qualification is not weakened. No pair test has run, and no observed evidence is claimed here.

## Implementation sequence

Delivery keeps the existing dependency edges. Both the starter and the demo wait on PACK2 ([#22](https://github.com/MachineWisdomAI/saga-a2ui/issues/22)), the package release-readiness ticket. The developer guide GUIDE1 waits on the starter and the demo, and GUIDE2 waits on GUIDE1. The first CLI ticket waits on the starter, and the second CLI ticket waits on the first CLI ticket and the demo. The first supported pair needs only itself to be qualified; the other combinations are not a precondition, and Ansari adoption is not gated on React, Lynx or a complete matrix. The public source and npm gate, required host runs, deferred final signoff, ownership and license checks, and optional publish tooling (see [host publication](host_publication.blueprint.md)) are unchanged.

## Open decisions

1. **Which qualified pair is the demo?** No evidence selects one yet; the choice is made from qualification results.
2. **How is framework-authenticated identity wired through the Hapi bridge callback into the identity hook?** The bridge's callback does not yet receive identity; the design settles it with the Hapi qualification.
3. **Which adapter versions, beyond the selected Node integration 2.1.1, are qualified for each server target?** The connector design selects Node integration 2.1.1 without qualifying it. Versions for the express, hono and fastify adapters are not selected, and no pair is qualified until it passes the checks above.

## References

- [Reusable MCP connector](reusable_mcp_connector.blueprint.md), [package layout](../../packages/README.md), [host publication](host_publication.blueprint.md), [coding standards](../../CODING_STANDARDS.md).
- Issues: [PACK2 #22](https://github.com/MachineWisdomAI/saga-a2ui/issues/22), [STARTER1 #23](https://github.com/MachineWisdomAI/saga-a2ui/issues/23), [DEMO1 #24](https://github.com/MachineWisdomAI/saga-a2ui/issues/24), [GUIDE1 #25](https://github.com/MachineWisdomAI/saga-a2ui/issues/25), [CLI1 #26](https://github.com/MachineWisdomAI/saga-a2ui/issues/26), [GUIDE2 #27](https://github.com/MachineWisdomAI/saga-a2ui/issues/27), [CLI2 #29](https://github.com/MachineWisdomAI/saga-a2ui/issues/29).
- Upstream [typescript-sdk middleware packages](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/middleware), checked 2026-10-16.
