---
feature_name: retained_view_resources
status: rejected
module_blueprints: []
dependencies: [reusable_mcp_connector, request_view_lifetimes]
date_added: 2026-10-30
---

# Retained view resources — rejected

## Status

- Design: rejected. Keeping old HTML available does not establish compatibility with the current tool result/action contract.
- Implementation: not started.
- Acceptance: not applicable to this rejected proposal.
- Replacement: [Semantic view versioning](semantic_view_versioning.blueprint.md), draft awaiting human design approval.

The rejected proposal is preserved in Git at `a0b581285ffa917f32ef5998159d2921adcdc077`. Its artifact manifests, promotion-order retention, trimming, withdrawal ledger and historical resource delivery are not implementation requirements. Its former flow diagrams were removed from the current proposal because they describe the rejected architecture.

The replacement focuses on explicit compatibility versions and obtaining a supported host cache-invalidation and UI-transition contract. It does not authorize restoring retention machinery if upstream clarification is inconclusive.
