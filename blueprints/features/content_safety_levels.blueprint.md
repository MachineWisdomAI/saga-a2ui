---
feature_name: content_safety_levels
status: draft
module_blueprints: [action_binding]
dependencies: []
date_added: 2026-10-15
---

# Content safety levels

## Status

- Draft amendment, 2026-10-19: [Trusted embedded artwork](#trusted-embedded-artwork) proposes baseline `data:` and `blob:` image sources in both modes for [REACT3](https://github.com/MachineWisdomAI/saga-a2ui/issues/31), preserving the existing content rules. This replaces the earlier flag-based draft. It is not approved or implemented. The prior approved content-safety and lifetime contracts, and their design-to-code records below, remain current until human approval of this amendment.

- Design: approved on 2026-10-16 at [`6785ae1d8205a45e668f478ea303fbdd7e474663`](https://github.com/MachineWisdomAI/saga-a2ui/blob/6785ae1d8205a45e668f478ea303fbdd7e474663/blueprints/features/content_safety_levels.blueprint.md).
- Implementation: partial overall. Blueprint `6785ae1d8205a45e668f478ea303fbdd7e474663` implemented for POL1/POL2 at [`MachineWisdomAI/saga-a2ui@6d3916da15a6207a5a546f06a86f772fd31b9ce3`](https://github.com/MachineWisdomAI/saga-a2ui/commit/6d3916da15a6207a5a546f06a86f772fd31b9ce3) through [PR #70](https://github.com/MachineWisdomAI/saga-a2ui/pull/70) and [PR #72](https://github.com/MachineWisdomAI/saga-a2ui/pull/72). The [POL1 review](https://github.com/MachineWisdomAI/saga-a2ui/pull/70#pullrequestreview-5555182721) and [POL2 review](https://github.com/MachineWisdomAI/saga-a2ui/pull/72#pullrequestreview-5555391827) record local source qualification, including actual browser requests and stale-control regressions.
- Remaining: integration with the required request/view lifetimes and authenticated ChatGPT/Claude checks. The public episode view has no identity/session-retirement signal; this record does not claim retained-state TTL, focus/resume behavior or integrated host acceptance.
- Passive FaithfulCard preparation: Blueprint `6785ae1d8205a45e668f478ea303fbdd7e474663` is implemented for this bounded slice at [`MachineWisdomAI/saga-a2ui@b66a616d86ae3729f09efd48cfa07545350f4943`](https://github.com/MachineWisdomAI/saga-a2ui/commit/b66a616d86ae3729f09efd48cfa07545350f4943) through [PR #100](https://github.com/MachineWisdomAI/saga-a2ui/pull/100) ([#99](https://github.com/MachineWisdomAI/saga-a2ui/issues/99)). The application-local Markdown, policy and consent behavior is now owned by the optional private `@saga-a2ui/components/faithful-card` export, with the Lit renderer in `@saga-a2ui/lit/faithful-card`. The episode view retains its 2,000-unit CommonMark configuration; a second consumer selects tables and strikethrough with its own finite bound through the same implementation. The [independent review](https://github.com/MachineWisdomAI/saga-a2ui/pull/100#pullrequestreview-5564083004) records verification at `184ed288511924a9adabd1520bee46be8a8abf15`: 853 headless, 218 Lit browser and 58 Lynx browser tests, build/typecheck and the packed external consumer; [CI passed on that head](https://github.com/MachineWisdomAI/saga-a2ui/actions/runs/39150040967). Review regressions cover retired controls and table-overflow reference/line-ending fidelity. The Remaining item above is unchanged; complete CARD1 integration, CARD2 and VIEW2 stay open. Local artifact and browser verification establishes no authenticated-host acceptance or public npm release.
- Approved lifetime amendment: [Request and view lifetimes at `7836c80345cec2aeb474d2eb026a1b9455819ef2`](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/request_view_lifetimes.blueprint.md), approved by the human owner on 2026-10-17 in [PR #69](https://github.com/MachineWisdomAI/saga-a2ui/pull/69), together with [this Blueprint’s related amendment](https://github.com/MachineWisdomAI/saga-a2ui/blob/7836c80345cec2aeb474d2eb026a1b9455819ef2/blueprints/features/content_safety_levels.blueprint.md). It replaces only the request/view-lifetime scope; the unaffected contract and all earlier design-to-code records above remain intact. The rejected account/session machinery remains rejected. The earlier [`d62c2232ecd8e100d90fe9dbffa072f6cd3dd4a7`](https://github.com/MachineWisdomAI/saga-a2ui/blob/d62c2232ecd8e100d90fe9dbffa072f6cd3dd4a7/blueprints/features/request_view_lifetimes.blueprint.md) remains a historical draft record. The general action vocabulary follows the independently approved [action binding](../modules/action_binding.blueprint.md) module at `a60acdaf002b8fcca57bcdbd88e30e9c96acfda8`. The [lifetime status](request_view_lifetimes.blueprint.md#status) now records partial STATE1 teardown/cleanup delivery for the subscriptions and playback views. PR #84 changed no content-consent implementation; remaining lifetime integration and required host acceptance stay outstanding.

## Problem and current behavior

Episode descriptions need ordinary Markdown formatting without letting supplied content execute code, navigate the assistant or fetch arbitrary images. The application owner also needs a stricter mode that can hide blocked fragments and lets the reader decide whether to load permitted images.

The current [`SagaPanelElement`](../../apps/lit-host/src/lit/integration.ts) displays descriptions through inert Lit text bindings. Its [catalog contract](../../apps/lit-host/src/saga-panel/contract.ts) accepts a bindable description string; it has no Markdown interpretation or selectable content policy. The [public resource](../../apps/lit-host/src/mcp/server.ts) declares empty connection and resource allowlists. This design introduces formatting and controlled effects in that working application. FaithfulCard and reusable packages remain later work.

## Proposed behavior

The application resolves one trusted policy when it creates a view. **Standard** is the default: absolute HTTPS links may open through a supported host callback, and HTTPS images may load only from explicitly configured exact hosts under the image restrictions below. The image allowlist defaults to empty.

**Strict** keeps links inert and makes no automatic content-image requests. By default, blocked fragments—links, image references and unsupported markup—appear as accessible placeholders in their original positions. The trusted application can instead choose readable inert text. In either presentation, the reader can reveal or hide the source as text. Revealing source changes visibility only: raw HTML, scripts, invalid URLs and unallowlisted images remain unable to execute, navigate or fetch.

Show images and Hide images are local actions in the shared [action vocabulary](../README.md#action-vocabulary): the view owns them and the consent they change is revocable view state. **Show images** lets the reader load otherwise-permitted images for the current description revision in the current live view. Enable it only when an image qualifies under the demonstrated host path; otherwise show blocked or unavailable feedback. It cannot expand the exact-host allowlist or bypass image restrictions. Content, policy or selection changes, view replacement and disposal revoke that consent. So does identity or session retirement wherever the view receives such a signal (the public episode view has none today; see [Status](#status)), and so does any invalidation of its state by the consent owner. Revalidation cannot restore old consent. **Hide images** removes displayed images and revokes consent; it cannot undo requests already sent. These controls do not introduce another content level or a persistent trust setting. The existing consent owner keeps this behavior, and the action module adds no second consent lifetime.

For example, a description contains a paragraph, a quotation, a link and an image. Both modes preserve ordinary text, order and useful formatting without changing the original input. Standard shows the parsed link hostname visibly and accessibly before activation, then sends the validated URL through the host callback. Strict initially shows placeholders for the link and image; revealing their source makes neither active. Only Show images can load the image, and only if its destination is otherwise permitted. A missing or denied host link callback leaves an explicit readable inert state, with no direct-navigation fallback.

The content policy governs description visibility, link activation and image requests. The same policy value drives the content-related restrictions declared in the resource’s content security policy (CSP). The application owns the surrounding A2UI tree; this feature does not sanitize arbitrary A2UI components.

Two other kinds of decision are separate from it. *Delivery policy* belongs to the MCP connector: which recipient receives which projection and which host capabilities a protected operation requires, as the [reusable MCP connector design](reusable_mcp_connector.blueprint.md) describes. *Domain authorization* belongs to the application: an authored protected action has application-owned authorization, checked fresh on the server, and answers to whatever resource policy applies to it. In the playback example, Play has its own declared action and media policy. Strict therefore leaves an authorized authored protected action available where the host supports it. A content link does not acquire an authored control's binding or protected-operation authority; the host-link callbacks that Standard permits for safe links are unchanged.

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
| Authored action/media flow | Retain the separate protected operation (the example's Play), capability routing, origin rules and server authorization described by the playback design. Content policy does not create or authorize business actions. |

Description text and parser-generated HTML must never reach `unsafeHTML`, `unsafeSVG`, `innerHTML` or equivalent executable markup paths. Fixed Lit templates render only the restricted token cases; revealing source still uses text bindings. Ordinary prose remains text even when it resembles instructions.

One policy value must determine both resource configuration and view behavior. MCP Apps’ [`resourceDomains`](https://github.com/modelcontextprotocol/ext-apps/blob/v2.0.3/src/spec.types.ts) covers images, scripts, stylesheets, fonts and media. It is a broad origin permission, not an image-only control. POL1 must demonstrate additional restrictive resource CSP or an equivalent supported path so adding an image host grants no new script, style, font or media permissions, while preserving authored media policy. If that restriction cannot be enforced, images stay inert even after Show images.

The resource must declare its bounded image origins and applicable restrictions before mounting. Show images can use only those existing permissions; reader consent cannot relax CSP. The renderer sends no Strict content-image request before consent. Tests inspect the built resource’s effective restrictions and actual requests, not just declared metadata.

Each view receives its immutable policy and callback explicitly. Reader consent is separate, revocable view state and cannot mutate that policy. There is no mutable module-wide “current policy,” host-name switch or callback registry. Interleaved views cannot share consent or change one another’s effects. Resource identity must distinguish policy variants whenever their required host metadata differs, so a cached resource cannot silently supply another policy.

URLs are parsed with supported platform APIs and validated before any effect. Only absolute HTTPS content destinations can activate. Exact-host image matching must reject suffix tricks, subdomains not explicitly listed, credentials and malformed input; wildcard matching is outside the contract. If the host cannot enforce the selected image destination boundary, the image stays inert. Resource permissions for authored media remain separately derived and cannot be borrowed by content images.

The Markdown module and policy module stay renderer independent in the application. Lit registration, templates, styling and host callbacks stay at their existing integration boundary. This separation permits later extraction without introducing placeholder packages or making Markdown a requirement of unrelated application catalog components.

## Trusted embedded artwork

A self-contained card can include application-owned artwork without fetching an external image. The current shared [FaithfulCard policy](../../packages/components/src/faithful-card/policy.ts), inspected at SDK revision `78820dfce3d119d4c82d3d12020af65bef1e2fb1`, derives `img-src 'none'` when the image host allowlist is empty. That blocks bundled raster artwork encoded as data URLs, even when the artwork belongs to the trusted template rather than the answer.

The resource CSP always includes `data:` and `blob:` in `img-src`, in both Standard and Strict. There is no embedded-image configuration flag. Construct one image source list from these fixed baseline schemes plus the validated exact HTTPS origins. Configured origins extend that list; they never replace the baseline, whether the host list is empty, contains one entry or contains several entries. Emit one `img-src` directive, without `'none'`:

| Configured image hosts | Derived image directive in either mode |
| --- | --- |
| Empty | `img-src data: blob:` |
| One exact host | `img-src data: blob: https://images.example.com` |
| Multiple exact hosts | `img-src data: blob: https://a.example.com https://b.example.com` |

These are resource permissions for rendering images, not new content permissions. All other directives retain their existing restrictions, including `font-src 'none'` and the existing connection policy. This slice uses system fonts. The exact HTTPS image-origin list remains unchanged: `data:` and `blob:` are scheme sources, not external hosts, and must not be added to broad resource-domain permissions. Reconstructing the immutable policy from `policy.configuration` must produce the same restrictions, including both baseline schemes, without adding a new configuration field.

Allowing `blob:` supports application-owned images represented by browser-managed objects, including generated images and local file previews. It does not itself permit a network fetch. If an application obtains bytes over the network before creating a blob URL, that fetch still needs the applicable connection permission. The application owns creation and revocation of its object URLs; this amendment introduces no blob registry or content-image conversion service. Blob permission is independent of whether the first card consumer uses it. See the [CSP image directive](https://www.w3.org/TR/CSP/#directive-img-src) and [File API object URL model](https://www.w3.org/TR/FileAPI/#url).

### Artwork and answer images take separate paths

The consumer imports its selected static artwork at build time and references those bundled bytes from its trusted template or CSS. The shared policy supplies the matching resource CSP before mounting. Bundled decoration may display in Standard and Strict without Show images consent; Hide images revokes content-image consent and does not remove application decoration.

Answer text still passes through the restricted Markdown reader and typed renderer. `decideImage` and `offerImages` retain their existing meaning: content images require an absolute HTTPS URL, an exactly allowed host and established enforcement, plus current consent in Strict. Markdown `data:` and `blob:` URLs remain rejected even when consent is granted. Raw HTML and revealed source remain inert text. The content wire contract stays exactly `contractVersion` and `markdown`; answers cannot select assets, CSS, templates or policy.

CSP's `data:` and `blob:` allowances do not distinguish trusted image references from untrusted ones. The trust boundary therefore depends on fixed authored templates and the shared content decisions: untrusted content must never be copied into an image source or CSS outside those decisions. The resource allowance is not a sanitizer for arbitrary application markup. It authorizes no new HTML injection path, inline SVG markup, image proxy or renderer-specific policy fork.

![Baseline resource permissions allow embedded and object-URL images, while supplied Markdown images still require shared content checks.](../../diagrams/embedded-artwork-policy.png)

[Mermaid source](../../diagrams/embedded-artwork-policy.mmd) · [Editable Excalidraw](../../diagrams/embedded-artwork-policy.excalidraw) · [SVG](../../diagrams/embedded-artwork-policy.svg)

For example, an application uses an empty external-image allowlist and builds a card containing a decorative raster image. The artwork displays from the immutable HTML resource. A supplied answer containing a data-image reference, a blob URL or an external HTTPS image still displays an inert placeholder or source text. Enabling Strict and revealing source does not change either content-image decision.

### Enforcement, caching and failure

The resource and view reconstruct the same policy through public SDK exports. `establishImageEnforcement` must continue to require the exact derived document policy; the baseline scheme allowances cannot manufacture established enforcement when the required policy is missing or mismatched. A consumer must not hand-edit a more permissive CSP. A host may impose stricter restrictions; blocked artwork remains a visible qualification failure, not a reason to relax other directives or substitute a remote asset.

The immutable resource identity includes its compiled code, policy, CSS and artwork bytes. Changing those bytes changes the identity. Supplying another answer reuses the resource and updates only validated data; it does not rebuild or re-register artwork. The baseline image schemes add no new runtime asset request, connection origin or host-specific branch.

| Verification case | Required result |
| --- | --- |
| Empty host list, Standard and Strict | The directive is `img-src data: blob:`. Trusted data and application-created blob images display; answer-supplied data, blob and HTTPS images stay inert, including after source reveal and consent. |
| One or several exact allowed hosts, Standard and Strict | Both baseline schemes remain in the single derived directive alongside every normalized allowed HTTPS origin. Built-resource checks display data and blob images with a nonempty host list, catching replacement of the baseline by configured sources. |
| Content images with exact allowed hosts | Existing HTTPS, exact-host, redirect and demonstrated image-only enforcement rules still apply. Strict requires current consent; Hide images and invalidation revoke it. |
| Invalid trusted configuration or attempted answer configuration | Existing validation fails invalid configuration explicitly. Answer data cannot mutate the policy or gain template/CSS control. |
| Policy round-trip or missing/mismatched document policy | Round-tripping retains both baseline schemes and the allowed origins. Missing/mismatched enforcement leaves content images inert. |
| Built resource under attempted external runtime loads | Script, stylesheet, font, frame and connection restrictions remain unchanged; bundled artwork creates no external dependency. |
| Changed artwork/policy versus changed answer | Artifact changes yield a new resource identity; answer-only changes reuse it and display the supplied values. |

Run these cases through public policy interfaces and the actual built browser resource, observing image rendering and consequential requests. Local checks establish policy and browser behavior; the required real-host card runs remain separate acceptance evidence.

### Amendment scope and delivery

Approval replaces only the earlier resource-policy assumption that an empty image-host list forbids every image, by permitting data and blob image sources by default in both modes. An empty host list continues to forbid every content image. The earlier Markdown fidelity, content-link rules, image consent, lifetime ownership, delivery policy and server authorization remain unchanged. Existing source-implementation records above do not establish implementation of these baseline permissions.

Implement the shared resource-policy derivation and its built-resource regression cases before consumer adoption. REACT3 then consumes the same policy through the optional React card; consumer branding remains consumer-owned. This amendment does not change the #28 prerequisite, absorb #33's complete React recipe, grant implementation dispatch or authorize publication/deployment. Preserve the accepted consumer artifact during qualification.

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
| Description/policy/selection change, view replacement/disposal, identity/session retirement where the view observes it, or any invalidation of its state by the consent owner | Revoke consent and remove displayed images; stale controls and callbacks cannot load or restore them. Release owned state and handlers on teardown. |

Image redirects need the same destination discipline as the initial request. A redirect to an undeclared destination must not become a hidden way around the exact-host policy. The chosen host/CSP path must demonstrate that behavior; otherwise the image retains its placeholder or inert source text. This requirement does not authorize a new media proxy or content-fetching service.

## Verification outcomes

Use the same ordinary and hostile descriptions in both modes. The browser test must load the built resource and observe the actual host callback and network path rather than inspect source strings or rely only on the declared CSP.

| Condition | Required observable result and boundary |
| --- | --- |
| Ordinary text, formatting and blocked fragments | Preserve the original input and content order. Verify Strict’s default placeholders, optional inert-text presentation and keyboard-accessible reveal/hide without execution or network effects. |
| Standard with default configuration | The image allowlist is empty. No content image loads. Show the parsed hostname visibly and accessibly before a validated HTTPS link invokes the host callback. |
| Standard with one exact image host | Load only permitted HTTPS image destinations. Reject suffix tricks, unlisted subdomains, credentials and malformed/non-HTTPS URLs. Demonstrate effective image-only restrictions and redirect enforcement without broadening script/style/font/media permissions. |
| Host link callback is absent or denies navigation | Show explicit readable inert feedback with no direct-navigation fallback. |
| Strict before and after Show images | Before consent, including after source reveal, observe zero content-image requests and link callbacks. After consent, only otherwise-permitted images load; invalid/unallowlisted destinations remain unfetched and links remain inert. With no qualifying image, show blocked/unavailable feedback instead of enabling Show images. |
| Images are hidden or consent becomes stale | Hide images removes displayed images. Description/policy/selection changes, replacement and disposal, identity/session retirement where observable, and any invalidation by the consent owner reject old controls and late results. Revalidation cannot restore consent. New content requires fresh consent; another view cannot inherit it. |
| Description content tries to inject HTML/scripts, policy or actions | Restricted-token rendering leaves it inert, including after reveal. Trusted configuration and action arguments remain unchanged; ordinary input cannot reach executable markup paths. |
| Standard and Strict views interleave updates and disposal | Each retains its own policy and callback. Updating or disposing one cannot enable effects or break cleanup in the other. |
| Standard/Strict resources are rebuilt, cached or replaced | Resource metadata and renderer behavior agree for the selected policy. Test the actual built resource and its identity, not just a configuration object. |
| An authored protected action is used under either level | The application's current authorization and any applicable resource and delivery policy still apply; Strict alone does not disable the valid authored action, and a content destination does not inherit its permissions. In the playback example, Play's capability, recipient-separation and media checks are the applicable ones. |

The integrated authenticated ChatGPT web and Claude web runs still exercise both levels, Strict’s visibility and image-consent controls, and authorized/denied playback using the actual built resource. A local browser test establishes application behavior, not the host's final enforcement. Record exact policy, source/resource identity, host and observed callbacks/requests. Deferring the final signoff does not remove or defer these required runs; unavailable or failed evidence remains an open acceptance result.

## Implementation sequence

1. [POL1](https://github.com/MachineWisdomAI/saga-a2ui/issues/5) introduces the trusted policy value, maintained Markdown interpretation and Standard rendering in the existing Lit application. It preserves original input and makes configuration/content failures explicit. Browser tests cover restricted-token rendering, destination disclosure, real callbacks and demonstrated image-only enforcement.
2. [POL2](https://github.com/MachineWisdomAI/saga-a2ui/issues/7) adds Strict’s blocked-fragment presentation and revocable Show images interaction, proves interleaved-instance isolation and cleanup, and preserves authored Play’s separate policy. Resource and renderer policy stay aligned.
3. Exercise both modes with the required lifetime behavior and playback in each required host. Implementation review, observed host evidence and final signoff stay separate outcomes.

Content interpretation and policy decisions can proceed independently. [Request and view lifetimes](request_view_lifetimes.blueprint.md) proposes the required lifetime behavior in place of the rejected account/session proposal. The replacement design is approved; breakdown approval remains outstanding before integration. Existing authentication, isolation, cancellation and cleanup requirements remain.

## Open decisions

POL1 must select and pin a maintained Markdown library, document the supported dialect and finite input limit, and retain applicable notices. The existing application does not contain a Markdown dependency, so none is represented here as already selected. POL1 must qualify the pinned upstream host callback and the additional image-only CSP or equivalent supported enforcement, including redirects and compatibility with authored media. If no supported path enforces those restrictions, images remain inert, including after consent. Concrete policy and consent interface names remain open; no new host capability or proxy is assumed.

## References

- [Plain-text Lit rendering and catalog integration](../../apps/lit-host/src/lit/integration.ts)
- [Panel contract](../../apps/lit-host/src/saga-panel/contract.ts)
- [Public resource policy](../../apps/lit-host/src/mcp/server.ts)
- [Authorized playback design](authorized_playback.blueprint.md)
- [Reusable MCP connector](reusable_mcp_connector.blueprint.md)
- [Request and view lifetimes](request_view_lifetimes.blueprint.md)
- [Action binding](../modules/action_binding.blueprint.md)
- [Coding standards](../../CODING_STANDARDS.md)
