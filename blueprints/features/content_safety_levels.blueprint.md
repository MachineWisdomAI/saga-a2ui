---
feature_name: content_safety_levels
status: draft
module_blueprints: []
dependencies: []
date_added: 2026-10-15
---

# Content safety levels

Draft awaiting human design review.

## Problem and current behavior

Episode descriptions need ordinary Markdown formatting without letting supplied content execute code, navigate the assistant or fetch arbitrary images. The application owner also needs a stricter mode that keeps the same text readable while disabling content links and image loads.

The current [`SagaPanelElement`](../../apps/lit-host/src/lit/integration.ts) displays descriptions through inert Lit text bindings. Its [catalog contract](../../apps/lit-host/src/saga-panel/contract.ts) accepts a bindable description string; it has no Markdown interpretation or selectable content policy. The [public resource](../../apps/lit-host/src/mcp/server.ts) declares empty connection and resource allowlists. This design introduces formatting and controlled effects in that working application. FaithfulCard and reusable packages remain later work.

## Proposed behavior

The application resolves one trusted policy when it creates a view. **Standard** is the default: absolute HTTPS links may open through a supported host callback, and HTTPS images may load only from explicitly configured exact hosts that the host resource policy also permits. The image allowlist defaults to empty. **Strict** preserves links and image references as readable inert text and performs no content-link callback or content-image fetch, even for an otherwise allowlisted host.

For example, a description contains a paragraph, a quotation, a link and an image. Both modes keep their order, supplied wording and useful formatting. Standard can send the validated link to the host after the reader activates it. An image whose host is absent from the allowlist is shown as readable alternative/source text. Strict keeps the link destination and image reference readable without activating or loading either. If Standard has no supported link callback, its link is also readable and inert; it must not fall back to direct browser navigation.

Neither the description, an MCP tool result nor an A2UI property can change this policy. The application's Play control has a separate declared action/media policy and fresh server authorization. Strict therefore leaves an authorized authored Play action available where the host supports it; a Markdown link cannot become a Play action.

![Trusted application configuration supplies one content policy to resource CSP and the view. Markdown becomes inert content or explicitly permitted host-link and image effects; authored playback retains separate authorization.](../../diagrams/content-safety-levels.png)

[Mermaid source](../../diagrams/content-safety-levels.mmd) · [Editable Excalidraw](../../diagrams/content-safety-levels.excalidraw) · [SVG](../../diagrams/content-safety-levels.svg)

## Responsibilities and interfaces

| Owner | Responsibility and boundary |
| --- | --- |
| Application composition | Select Standard or Strict and the exact-host HTTPS image allowlist from trusted configuration. Reject invalid levels, malformed hosts and wildcards before rendering. |
| Application-local policy module | Construct one validated immutable policy value and decide permitted content effects. Keep the contract independent of a card, renderer and host name. Proposed interface responsibilities are policy construction, link decisions, image decisions and resource-policy derivation; concrete API names remain implementation choices. |
| Application-local Markdown module | Retain the original string and interpret the documented dialect in order. Use a maintained library for Markdown syntax; preserve inert HTML and unsupported syntax rather than executing or silently dropping them. Reject over-limit input explicitly. |
| Lit renderer | Render the interpreted content, its inert fallbacks and accessible controls. Execute only effects permitted for this instance; own DOM events and cleanup. |
| MCP resource and host adapter | Derive content-related resource restrictions from the same policy and expose only the supported link-opening callback. A host can impose stricter restrictions; application policy cannot expand its permissions. |
| Authored action/media flow | Retain the separate Play operation, capability routing, origin rules and server authorization described by the playback design. Content policy does not create or authorize business actions. |

One policy value must determine both resource configuration and view behavior. Independently configuring a permissive resource and a stricter renderer invites drift; configuring a restrictive resource cannot excuse a renderer that attempts forbidden effects. Tests therefore inspect both the declared policy and actual requests/callbacks.

Each view receives its policy and callback explicitly. There is no mutable module-wide “current policy,” host-name switch or callback registry. Two interleaved views can have different levels and allowlists without changing one another's effects. Resource identity must distinguish policy variants whenever their required host metadata differs, so a cached Standard resource cannot silently supply a different policy to a Strict instance.

URLs are parsed with supported platform APIs and validated before any effect. Only absolute HTTPS content destinations can activate. Exact-host image matching must reject suffix tricks, subdomains not explicitly listed, credentials and malformed input; wildcard matching is outside the contract. If the host cannot enforce the selected image destination boundary, the image stays inert. Resource permissions for authored media remain separately derived and cannot be borrowed by content images.

The Markdown module and policy module stay renderer independent in the application. Lit registration, templates, styling and host callbacks stay at their existing integration boundary. This separation permits later extraction without introducing placeholder packages or making Markdown a requirement of unrelated application catalog components.

## Failure and recovery

| Trigger | Reader-visible result and effect |
| --- | --- |
| Invalid level, malformed image host or wildcard in trusted configuration | Fail configuration explicitly before mounting a permissive view. Do not guess a looser policy. |
| Oversize description | Present an explicit content-limit failure with no silent truncation or partial success. The original supplied string remains unchanged at its owner. |
| Embedded HTML/script, unsupported syntax or instruction-like text | Keep the material inert and readable according to the documented dialect. It cannot execute, change configuration or alter action arguments. |
| Non-HTTPS or otherwise invalid link | Keep readable inert source text; make no host callback and no direct navigation. |
| Missing host link capability | Keep the validated destination readable and inert; do not substitute `window.open` or a direct-navigation fallback. |
| Image host absent from the exact allowlist or blocked by host CSP | Show readable alternative/source text and issue no permitted fetch for that destination. An attempted blocked network request is not equivalent to a renderer policy pass. |
| Strict content contains an allowlisted link/image | Keep both inert. Allowlist membership does not weaken Strict. |
| View replacement or disposal | Remove owned event handlers and content state; callbacks from the retired instance cannot act through another live instance. |

Image redirects need the same destination discipline as the initial request. A redirect to an undeclared destination must not become a hidden way around the exact-host policy. The chosen host/CSP path must demonstrate that behavior; otherwise the image falls back to readable text. This requirement does not authorize a new media proxy or content-fetching service.

## Verification outcomes

Use the same ordinary and hostile descriptions in both modes. The browser test must load the built resource and observe the actual host callback and network path rather than inspect source strings or rely only on the declared CSP.

| Condition | Required observable result and boundary |
| --- | --- |
| Ordinary paragraphs, formatting, code, quotations, links and images | Original content and order remain intact; supported formatting is readable and unsupported syntax stays inert. Compare visible text/structure with independently checked fixtures. |
| Standard with default configuration | The image allowlist is empty. No content image loads. A validated HTTPS link activates only through the available host callback after deliberate activation. |
| Standard with one exact image host | Only allowed HTTPS image destinations can load under host CSP. Other hosts, lookalike suffixes, unlisted subdomains, credentials, non-HTTPS URLs and malformed URLs remain inert. Observe requests and fallbacks. |
| Host capability is absent or the requested destination is blocked | Content remains readable; there is no direct-navigation fallback or unauthorized image request. |
| Strict with the same description and allowlist | Zero content-link callbacks and zero content-image requests; link destinations and image references remain readable in order. |
| Tool/A2UI data tries to set a policy, supply callbacks or inject executable content | Trusted configuration remains unchanged, no code executes, and action arguments are unaffected. |
| Standard and Strict views interleave updates and disposal | Each retains its own policy and callback. Updating or disposing one cannot enable effects or break cleanup in the other. |
| Standard/Strict resources are rebuilt, cached or replaced | Resource metadata and renderer behavior agree for the selected policy. Test the actual built resource and its identity, not just a configuration object. |
| Authored Play is used under either level | Current authorization, recipient separation and media checks still apply; Strict alone does not disable the valid authored action or allow a content destination to inherit media permissions. |

The integrated authenticated ChatGPT web and Claude web runs still exercise both levels, their readable fallbacks and authorized/denied playback using the actual built resource. A local browser test establishes application behavior, not the host's final enforcement. Record exact policy, source/resource identity, host and observed callbacks/requests. Deferring Captain signoff does not remove or defer these required runs; unavailable or failed evidence remains an open acceptance result.

## Implementation sequence

1. [POL1](https://github.com/MachineWisdomAI/saga-a2ui/issues/5) introduces the trusted policy value, maintained Markdown interpretation and Standard rendering in the existing Lit application. It preserves original input and makes configuration/content failures explicit. Browser tests cover visible content, real callbacks and image requests.
2. [POL2](https://github.com/MachineWisdomAI/saga-a2ui/issues/7) adds Strict using the same policy contract, proves interleaved-instance isolation and cleanup, and verifies that authored Play retains its separate policy. Resource and renderer policy stay aligned.
3. Exercise both modes with completed account/session isolation and playback in each required host. Retain implementation review, observed host evidence and final Captain signoff as separate outcomes.

This work can proceed alongside account/session isolation. Content interpretation and policy decisions belong to this lane; session validity and result retirement belong to the lifetime lane. Integration preserves both contracts without sharing mutable configuration between instances.

## Open decisions

POL1 must select and pin a maintained Markdown library, document the supported dialect and finite input limit, and retain applicable notices. The existing application does not contain a Markdown dependency, so none is represented here as already selected. The chosen host callback and resource-policy encoding must come from the pinned upstream interfaces and be verified with the real bridge. Any inability to enforce redirected image destinations resolves to inert rendering until a supported path is demonstrated.

## References

- [Plain-text Lit rendering and catalog integration](../../apps/lit-host/src/lit/integration.ts)
- [Panel contract](../../apps/lit-host/src/saga-panel/contract.ts)
- [Public resource policy](../../apps/lit-host/src/mcp/server.ts)
- [Authorized playback design](authorized_playback.blueprint.md)
- [Account and session isolation](account_session_isolation.blueprint.md)
- [Coding standards](../../CODING_STANDARDS.md)
