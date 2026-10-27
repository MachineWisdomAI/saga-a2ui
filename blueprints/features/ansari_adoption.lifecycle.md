# Ansari adoption lifecycle

The [adoption Blueprint](ansari_adoption.blueprint.md) describes the migration contract and current SDK baseline. The following records preserve the approved design and its original observations. They do not establish the current private application, deployment, destination merge or host acceptance.

## Status

- Design: approved on 2026-10-16 at [`19fb26c84116b15a56fec31bfa358898fe96d791`](https://github.com/MachineWisdomAI/saga-a2ui/blob/19fb26c84116b15a56fec31bfa358898fe96d791/blueprints/features/ansari_adoption.blueprint.md).
- Implementation: not started. The existing application is the migration source; no landed destination migration or public SAGA installation is established.
- The approved 2026-10-17 sequencing amendment permits server preparation after [CORE1 #14](https://github.com/MachineWisdomAI/saga-a2ui/issues/14) and view preparation after CORE1 plus [VIEW1 #17](https://github.com/MachineWisdomAI/saga-a2ui/issues/17). It preserves the single migration and all final release, host and destination-maintainer gates.
- Acceptance: full SDK qualification, required actual-host evidence and publication or destination acceptance remain separate gates.

## Original dependency comparison

This comparison motivated the extraction work. Its prototype versions and TypeScript diagnostics are historical, not the published 0.7.7-rc.1 dependency recipe.

Two dependency sets are involved. The maintained Ansari application currently uses MCP Apps 2.0.3, split MCP server/client 2.3.1 and Node integration 2.1.1 with Zod 4.2-compatible schemas, and its A2UI packages are 0.9.1. SAGA's prototype uses MCP Apps 1.7.5, MCP SDK 1.32.1, Zod 3.25.76 and A2UI 0.13.0. Both A2UI integrations use `/v0_9`. The [connector compatibility decision](reusable_mcp_connector.blueprint.md#responsibilities-and-interfaces) selects ext-apps 2.0.3 and the split MCP target as the extraction direction. That target is selected, not qualified: its complete peer and engine recipe still requires migration work, and the connector Blueprint records that an unchanged copy of SAGA's merged source, installed with complete peers, produced 32 TypeScript diagnostics. This migration does not assume a wire incompatibility, silently downgrade Ansari or retain duplicate conflicting framework instances.

