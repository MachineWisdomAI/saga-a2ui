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

Episode descriptions need ordinary Markdown formatting without letting supplied content execute code, navigate the assistant or fetch arbitrary images. The application owner also needs a stricter mode that can hide blocked fragments and lets the reader decide whether to load permitted images.

The current [`SagaPanelElement`](../../apps/lit-host/src/lit/integration.ts) displays descriptions through inert Lit text bindings. Its [catalog contract](../../apps/lit-host/src/saga-panel/contract.ts) accepts a bindable description string; it has no Markdown interpretation or selectable content policy. The [public resource](../../apps/lit-host/src/mcp/server.ts) declares empty connection and resource allowlists. This design introduces formatting and controlled effects in that working application. FaithfulCard and reusable packages remain later work.

## Proposed behavior

The application resolves one trusted policy when it creates a view. **Standard** is the default: absolute HTTPS links may open through a supported host callback, and HTTPS images may load only from explicitly configured exact hosts under the image restrictions below. The image allowlist defaults to empty.

**Strict** keeps links inert and makes no automatic content-image requests. By default, blocked fragments—links, image references and unsupported markup—appear as accessible placeholders in their original positions. The trusted application can instead choose readable inert text. In either presentation, the reader can reveal or hide the source as text. Revealing source changes visibility only: raw HTML, scripts, invalid URLs and unallowlisted images remain unable to execute, navigate or fetch.

A separate **Show images** action lets the reader load otherwise-permitted images for the current description revision in the current live view. Enable it only when an image qualifies under the demonstrated host path; otherwise show blocked or unavailable feedback. It cannot expand the exact-host allowlist or bypass image restrictions. Content, policy or selection changes, view replacement, identity/session retirement and disposal revoke that consent. Retained-state expiry or invalidation also revokes it; focus/resume revalidation cannot restore old consent. **Hide images** removes displayed images and revokes consent; it cannot undo requests already sent. These controls do not introduce another content level or a persistent trust setting.

For example, a description contains a paragraph, a quotation, a link and an image. Both modes preserve ordinary text, order and useful formatting without changing the original input. Standard shows the parsed link hostname visibly and accessibly before activation, then sends the validated URL through the host callback. Strict initially shows placeholders for the link and image; revealing their source makes neither active. Only Show images can load the image, and only if its destination is otherwise permitted. A missing or denied host link callback leaves an explicit readable inert state, with no direct-navigation fallback.

The content policy governs description visibility, link activation and image requests. The same policy value drives the content-related restrictions declared in the resource’s content security policy (CSP). The application owns the surrounding A2UI tree; this feature does not sanitize arbitrary A2UI components.

Two other kinds of decision are separate from it. *Delivery policy* belongs to the MCP connector: which recipient receives which projection and which host capabilities a protected operation requires, as the [reusable MCP connector design](reusable_mcp_connector.blueprint.md) describes. *Domain authorization* belongs to the application: the Play control has its own declared action/media policy and fresh server authorization. Strict therefore leaves an authorized authored Play action available where the host supports it; a Markdown link cannot become a Play action.

Neither the description, an MCP tool result nor an A2UI property can change the content policy.

![Trusted policy governs description rendering and resource restrictions. Strict separates inert source reveal from consent to load permitted images; authored playback retains separate authorization.](../../diagrams/content-safety-levels.png)

[Mermaid source](../../diagrams/content-safety-levels.mmd) · [Editable Excalidraw](../../diagrams/content-safety-levels.excalidraw) · [SVG](../../diagrams/content-safety-levels.svg)

## Responsibilities and interfaces

| Owner | Responsibility and boundary |
| --- | --- |
| Application composition | Select Standard or Strict, the exact-host HTTPS image allowlist and Strict’s initial blocked-fragment presentation: hidden or readable inert text. Reject invalid configuration before rendering. |
| Application-local policy module | Construct one validated immutable policy value and decide permitted content effects. Keep the contract independent of a card, renderer and host name. Proposed interface responsibilities are policy construction, link decisions, image decisions and resource-policy derivation; concrete API names remain implementation choices. |
| Application-local Markdown module | Retain the original string and use a maintained parser to produce restricted tokens in order. Raw HTML and unsupported markup remain source text, visible or collapsed under the presentation choice. Reject over-limit input explicitly. |
| Lit renderer | Map restricted tokens to fixed templates and text bindings. Own accessible reveal/image controls, consent for the current description and view, events and cleanup. |
| MCP resource and host adapter | Derive content-related resource restrictions from the same policy and expose only the supported link-opening callback. A host can impose stricter restrictions; application policy cannot expand its permissions. |
| Authored action/media flow | Retain the separate Play operation, capability routing, origin rules and server authorization described by the playback design. Content policy does not create or authorize business actions. |

Description text and parser-generated HTML must never reach `unsafeHTML`, `unsafeSVG`, `innerHTML` or equivalent executable markup paths. Fixed Lit templates render only the restricted token cases; revealing source still uses text bindings. Ordinary prose remains text even when it resembles instructions.

One policy value must determine both resource configuration and view behavior. MCP Apps’ [`resourceDomains`](https://github.com/modelcontextprotocol/ext-apps/blob/v2.0.3/src/spec.types.ts) covers images, scripts, stylesheets, fonts and media. It is a broad origin permission, not an image-only control. POL1 must demonstrate additional restrictive resource CSP or an equivalent supported path so adding an image host grants no new script, style, font or media permissions, while preserving authored media policy. If that restriction cannot be enforced, images stay inert even after Show images.

The resource must declare its bounded image origins and applicable restrictions before mounting. Show images can use only those existing permissions; reader consent cannot relax CSP. The renderer sends no Strict image request before consent. Tests inspect the built resource’s effective restrictions and actual requests, not just declared metadata.

Each view receives its immutable policy and callback explicitly. Reader consent is separate, revocable view state and cannot mutate that policy. There is no mutable module-wide “current policy,” host-name switch or callback registry. Interleaved views cannot share consent or change one another’s effects. Resource identity must distinguish policy variants whenever their required host metadata differs, so a cached resource cannot silently supply another policy.

URLs are parsed with supported platform APIs and validated before any effect. Only absolute HTTPS content destinations can activate. Exact-host image matching must reject suffix tricks, subdomains not explicitly listed, credentials and malformed input; wildcard matching is outside the contract. If the host cannot enforce the selected image destination boundary, the image stays inert. Resource permissions for authored media remain separately derived and cannot be borrowed by content images.

The Markdown module and policy module stay renderer independent in the application. Lit registration, templates, styling and host callbacks stay at their existing integration boundary. This separation permits later extraction without introducing placeholder packages or making Markdown a requirement of unrelated application catalog components.

## Failure and recovery

| Trigger | Reader-visible result and effect |
| --- | --- |
| Invalid level, malformed image host or wildcard in trusted configuration | Fail configuration explicitly before mounting a permissive view. Do not guess a looser policy. |
| Oversize description | Present an explicit content-limit failure with no silent truncation or partial success. The original supplied string remains unchanged at its owner. |
| Embedded HTML/script or unsupported markup | Keep source inert, visible or collapsed under the presentation choice. Revealing it cannot execute code, change configuration or alter action arguments. |
| Non-HTTPS or otherwise invalid link | Keep source inert under the presentation choice; make no host callback or direct navigation, including after reveal. |
| Missing or denied host link callback | Show the destination and an explicit readable inert state; do not substitute `window.open` or direct navigation. |
| Image destination is unallowlisted, disallowed by CSP or lacks demonstrated image-only enforcement | Keep its placeholder or inert source text and issue no image request, even after consent. A request blocked by CSP does not excuse the renderer attempting a forbidden fetch. |
| Strict content contains an allowlisted link/image | Links stay inert. Images require current Show images consent as well as the destination and resource restrictions. Source reveal grants neither permission. |
| Description/policy/selection change, retained-state expiry/invalidation, identity/session retirement or view replacement/disposal | Revoke consent and remove displayed images; stale controls and callbacks cannot load or restore them. Release owned state and handlers on teardown. |

Image redirects need the same destination discipline as the initial request. A redirect to an undeclared destination must not become a hidden way around the exact-host policy. The chosen host/CSP path must demonstrate that behavior; otherwise the image retains its placeholder or inert source text. This requirement does not authorize a new media proxy or content-fetching service.

## Verification outcomes

Use the same ordinary and hostile descriptions in both modes. The browser test must load the built resource and observe the actual host callback and network path rather than inspect source strings or rely only on the declared CSP.

| Condition | Required observable result and boundary |
| --- | --- |
| Ordinary text, formatting and blocked fragments | Preserve the original input and content order. Verify Strict’s default placeholders, optional inert-text presentation and keyboard-accessible reveal/hide without execution or network effects. |
| Standard with default configuration | The image allowlist is empty. No content image loads. Show the parsed hostname visibly and accessibly before a validated HTTPS link invokes the host callback. |
| Standard with one exact image host | Load only permitted HTTPS image destinations. Reject suffix tricks, unlisted subdomains, credentials and malformed/non-HTTPS URLs. Demonstrate effective image-only restrictions and redirect enforcement without broadening script/style/font/media permissions. |
| Host link callback is absent or denies navigation | Show explicit readable inert feedback with no direct-navigation fallback. |
| Strict before and after Show images | Before consent, including after source reveal, observe zero image requests and link callbacks. After consent, only otherwise-permitted images load; invalid/unallowlisted destinations remain unfetched and links remain inert. With no qualifying image, show blocked/unavailable feedback instead of enabling Show images. |
| Images are hidden or consent becomes stale | Hide images removes displayed images. Description/policy/selection changes, retained-state expiry/invalidation, identity/session retirement, replacement and disposal reject old controls and late results. Revalidation cannot restore consent. New content requires fresh consent; another view cannot inherit it. |
| Description content tries to inject HTML/scripts, policy or actions | Restricted-token rendering leaves it inert, including after reveal. Trusted configuration and action arguments remain unchanged; ordinary input cannot reach executable markup paths. |
| Standard and Strict views interleave updates and disposal | Each retains its own policy and callback. Updating or disposing one cannot enable effects or break cleanup in the other. |
| Standard/Strict resources are rebuilt, cached or replaced | Resource metadata and renderer behavior agree for the selected policy. Test the actual built resource and its identity, not just a configuration object. |
| Authored Play is used under either level | Current authorization, recipient separation and media checks still apply; Strict alone does not disable the valid authored action or allow a content destination to inherit media permissions. |

The integrated authenticated ChatGPT web and Claude web runs still exercise both levels, Strict’s visibility and image-consent controls, and authorized/denied playback using the actual built resource. A local browser test establishes application behavior, not the host's final enforcement. Record exact policy, source/resource identity, host and observed callbacks/requests. Deferring the final signoff does not remove or defer these required runs; unavailable or failed evidence remains an open acceptance result.

## Implementation sequence

1. [POL1](https://github.com/MachineWisdomAI/saga-a2ui/issues/5) introduces the trusted policy value, maintained Markdown interpretation and Standard rendering in the existing Lit application. It preserves original input and makes configuration/content failures explicit. Browser tests cover restricted-token rendering, destination disclosure, real callbacks and demonstrated image-only enforcement.
2. [POL2](https://github.com/MachineWisdomAI/saga-a2ui/issues/7) adds Strict’s blocked-fragment presentation and revocable Show images interaction, proves interleaved-instance isolation and cleanup, and preserves authored Play’s separate policy. Resource and renderer policy stay aligned.
3. Exercise both modes with the required lifetime behavior and playback in each required host. Implementation review, observed host evidence and final signoff stay separate outcomes.

Content interpretation and policy decisions can proceed independently. [Request and view lifetimes](request_view_lifetimes.blueprint.md) proposes the required lifetime behavior in place of the rejected account/session proposal. The replacement design and breakdown await human approval before integration. Existing authentication, isolation, cancellation and cleanup requirements remain.

## Open decisions

POL1 must select and pin a maintained Markdown library, document the supported dialect and finite input limit, and retain applicable notices. The existing application does not contain a Markdown dependency, so none is represented here as already selected. POL1 must qualify the pinned upstream host callback and the additional image-only CSP or equivalent supported enforcement, including redirects and compatibility with authored media. If no supported path enforces those restrictions, images remain inert, including after consent. Concrete policy and consent interface names remain open; no new host capability or proxy is assumed.

## References

- [Plain-text Lit rendering and catalog integration](../../apps/lit-host/src/lit/integration.ts)
- [Panel contract](../../apps/lit-host/src/saga-panel/contract.ts)
- [Public resource policy](../../apps/lit-host/src/mcp/server.ts)
- [Authorized playback design](authorized_playback.blueprint.md)
- [Reusable MCP connector](reusable_mcp_connector.blueprint.md)
- [Request and view lifetimes](request_view_lifetimes.blueprint.md)
- [Coding standards](../../CODING_STANDARDS.md)
