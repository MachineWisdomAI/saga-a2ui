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
- Replacement: [Semantic view versioning](semantic_view_versioning.blueprint.md), approved at `c9c44aaa01f3547f1bc3fbcd30273235d61d6f35`.

The rejected proposal is preserved in Git at `a0b581285ffa917f32ef5998159d2921adcdc077`. Its artifact manifests, promotion-order retention, trimming, withdrawal ledger and historical resource delivery are not implementation requirements. Its former flow diagrams were removed from the current proposal because they describe the rejected architecture.

The replacement gives each view one address per compatibility major, so a compatible deploy leaves earlier tool descriptors pointing at a served document. It does not authorize restoring retention machinery.
