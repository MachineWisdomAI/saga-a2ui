---
feature_name: semantic_view_versioning
status: draft
module_blueprints: []
dependencies: [reusable_mcp_connector]
date_added: 2026-10-31
---

# Semantic view versioning

A tool and the UI rendering its results must share a compatible contract. Changing a resource URI for every HTML byte change creates unnecessary identities; keeping every old document available does not make an incompatible document safe to use with the current server. This proposal gives each view contract an explicit semantic version and asks the host to refresh the tool/UI pairing when compatibility changes.

## Status

- Design: draft awaiting approval of this replacement contract. The direction is semantic compatibility versioning; the prior retention architecture is rejected.
- Implementation: not started.
- Acceptance: pending confirmation and qualification of host cache invalidation and mounted-view behavior.
- Predecessor: [retained view resources](retained_view_resources.blueprint.md), rejected at its proposed revision `a0b581285ffa917f32ef5998159d2921adcdc077`. No part of that proposal was implemented or approved.

## Evidence and motivation

OpenAI's [UI resource guidance](https://developers.openai.com/plugins/build/chatgpt-ui#embed-the-component-in-the-server-response) uses a versioned URI and instructs developers to publish a new URI and update referencing tools for breaking changes. It does not specify that hosts interpret semantic version numbers, nor that updating a descriptor evicts an existing iframe.

![OpenAI documentation showing a versioned UI URI and guidance to change it for breaking changes](../../docs/evidence/semantic-view-versioning/openai-resource-versioning.png)

User-supplied documentation capture, included on 31 October 2026. The screenshot is evidence of the published guidance, not a host conformance test.

The [Ansari deployment observations](https://github.com/iaser-ai/ansari/issues/335#issuecomment-6523633269) showed hosts requesting prior resource URIs after deployment. ChatGPT also displayed older cached HTML. Those observations establish stale discovery/content, not a demonstrated incompatible-schema incident. The design must nevertheless account for an incompatible old UI receiving a new result or invoking a changed action.

Separate hosted-game observations showed first-display and reload failures after successful tool execution. In one sanitized ChatGPT Network capture, the application widget fetch returned HTTP 200 in 866 ms, while a host sandbox bootstrap document spent approximately 20 seconds in Initial connection. Retry loaded that document from disk cache in approximately 1 ms and rendered the card. Semantic versioning does not repair that sandbox-loading boundary. The cause of the separate Claude rendering failures remains unproven. Retry recovery is not first-load acceptance.

## Proposed contract

The application owns an explicit semantic version for the view's result-and-action contract. It is independent of the SAGA package version, build identifier and HTML digest. The SDK owns URI formatting and validation; consumers supply the version rather than reproduce the rule.

For a stable contract, the proposed mapping is:

| Change | Contract version example | Resource URI example | Compatibility obligation |
| --- | --- | --- | --- |
| Initial stable contract | `1.0.0` | `ui://views/answer/v1.html` | Define the result reader and action inputs/outputs. |
| Compatible fix or addition | `1.0.1` or `1.1.0` | Same `ui://views/answer/v1.html` | Every supported cached v1 UI must still handle current results and actions. New UI must handle supported historical results. |
| Incompatible change | `2.0.0` | `ui://views/answer/v2.html` | Update all referencing tool descriptors and response resource identities together; require a supported host transition before treating deployment as qualified. |

This major-version URI is a proposed compatibility-line policy, not behavior inferred from the screenshot. Versions before `1.0.0` and prereleases need an explicit policy before implementation; this proposal makes no compatibility promise for them. If the host requires a new URI for each compatible release to deliver fixes, revisit the mapping rather than pretending the major-only URI guarantees freshness.

A semantic-version bump is an author assertion backed by compatibility tests. It is not automatic schema negotiation. Changes to result interpretation, action semantics, required capabilities or CSP can be breaking even when the JSON shape is unchanged. Package upgrades and release stamps alone do not establish a break.

The same major URI may serve a newer compatible bundle. It therefore no longer promises immutable byte identity. A content digest may remain a build-verification value, but it is not this resource's cache key. Compatible updates may remain invisible while the host uses cached HTML. A security fix or other mandatory update needs a supported refresh/revocation mechanism; declaring it a patch cannot make cached code disappear.

## Small SDK scope

Current source inspected at `a5cf9d068cf009d997d636cd6c4d5105d610f2da` derives HTML fingerprints in `viewUriForHtml` and `operationViewFromHtml`. Registration already receives an `OperationView` with its URI. The proposed work is limited to an explicit semantic identity option in the supported view-construction API and consistent registration/linkage through both Lit and React stacks.

- Keep version validation and URI formatting in the MCP package, exposed through both stacks. They need no filesystem, Node crypto or Cloudflare dependency.
- Applications choose and test their compatibility versions. FaithfulCard does not own generic versioning; its result compatibility remains with its existing owners.
- Do not silently change existing fingerprint API behavior. Define an explicit migration to semantic identity and preserve existing APIs until a separately reviewed breaking release permits removal.
- Migration from already-cached fingerprint URIs is a host-transition question. No indefinite retention service is added to hide it. If a host mandates overlap, return with the smallest bounded requirement and obtain a new design decision.

Rejected scope: retained artifact manifests, promotion-order selection, count/byte trimming, eager historical sets, withdrawal ledgers, historical resource dispatchers, shared gateways and CDN/storage provisioning. No second application consumer is required.

## Host cache invalidation is the unresolved dependency

Changing the URI is insufficient when the host continues using an old tool descriptor. Refreshing discovery is insufficient when a mounted old UI still receives new results or calls current actions. The required host outcome is a compatible pairing, or a visible refusal to continue until that pairing can be loaded. Historical cards must not silently reinterpret old results under an incompatible UI.

The [MCP 2026-07-28 caching specification](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) defines `ttlMs`, `cacheScope` and invalidation by relevant notifications. These are candidates to investigate, not a verified solution for ChatGPT or Claude web. The negotiated protocol versions and UI-cache behavior in the historical trials have not been established. TTL hints are not a guarantee of synchronous refresh, and the specification permits stale responses on refetch errors.

Ask the host teams:

1. Which cache hints and change notifications affect tool discovery, UI resource content and mounted cards, including across reconnects?
2. What supported action refreshes an incompatible tool/UI pairing before a new result or action is processed? Can a server signal that the old view must stop?
3. How are new chats, existing chats and reopened historical cards handled? Are result-level resource references supported, and what takes precedence over cached descriptors?
4. What differs between development/custom connections and published integrations? Is a bounded compatibility overlap required, and how is its end determined?
5. Which supported diagnostics isolate application delivery from sandbox loading and rendering?

Until answered and demonstrated, no host invalidation API is selected and no first-card reliability claim is made. The next step is upstream clarification, not implementation of an SDK workaround.

## Why ask for HTTP-style behavior

HTTP provides resource validators such as ETags, conditional requests and cache-control semantics, with CDN infrastructure implementing them. Moving UI documents behind MCP `resources/read` leaves developers dependent on the host's MCP-to-UI cache behavior. The engineering criticism is that the supported developer experience must preserve comparable control over freshness and compatibility instead of making every application invent cache-management infrastructure.

ETags are not a drop-in HTTP 304 solution for a JSON-RPC POST to an MCP endpoint. They also do not automatically reload an already-mounted page or coordinate a changed backend contract. The question for host implementers is whether they support an HTTP resource path or equivalent negotiated validators, invalidation and UI replacement semantics. HTTP asset hosting and CDN caching can solve delivery/revalidation when used through their supported contract; neither fixes the captured sandbox connection stall by itself.

## Verification and decisions before implementation

- Verify the chosen version-to-URI rule deterministically through the public SDK API and both stack exports. A compatible HTML change must not change a major-line URI; a major change must.
- Test old-v1 UI with supported current-v1 results/actions and current-v1 UI with supported historical-v1 results. A mislabeled incompatible change fails application compatibility qualification.
- After the host teams identify a supported mechanism, test v1-to-v2 with stale discovery and with an already-mounted v1 card. Observe the actual requested URI, rendered contract version and action behavior. Safe refusal is distinct from successful refresh.
- Record first display, Retry and reload independently, distinguishing resource delivery, iframe/sandbox startup, initialization and rendering where observable. Do not attribute failures to versioning without evidence.
- Verify migration from the existing fingerprint identity separately. If the host has no supported transition, report the limitation and reconsider the deployment contract; do not restore the rejected retention architecture automatically.

Open decisions are the exact SDK option name, treatment of pre-1.0/prerelease versions, host-mandated URI granularity, and the supported invalidation/transition mechanism. No provisioning, implementation, merge or deployment is authorized by this draft.
