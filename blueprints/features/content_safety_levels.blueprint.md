---
feature_name: content_safety_levels
status: approved
module_blueprints: [action_binding]
dependencies: []
date_added: 2026-10-15
---

# Content safety levels

## Status

**Approved; shared policy, passive-card rendering and the scoped Lit/React deliveries are implemented.** The baseline design is `6785ae1d8205a45e668f478ea303fbdd7e474663`. The embedded-artwork, font and Strict-mode revisions retain their separate approval and implementation identities in the [lifecycle records](content_safety_levels.lifecycle.md#status), including the exact reviewed source and bounded host observations.

The components, Lit and React packages are published at `0.7.7-rc.1`. Their 46 included source files match baseline `cdad54747dfbba756464676ac3b1b8c90148a566`, with each registry tarball's integrity verified. This is package/source identity, not a fresh installation or host run. Completed CARD1/CARD2 and passive Ansari host receipts remain limited to their artifacts and observations; they establish neither universal host enforcement, full React parity, screen-reader speech, audible playback nor production deployment.

The public episode view has no identity/session-retirement signal. Its passive content and consent behavior must not inherit the protected player's account-change observations or the rejected retained-state/focus-resume proposals. The application or stack must deliver any lifecycle signal its view is expected to honor.

## Problem and current behavior

Episode descriptions need ordinary Markdown formatting without letting supplied content execute code, navigate the assistant or fetch arbitrary images. The application owner also needs a stricter mode that can hide blocked fragments and lets the reader decide whether to load permitted images.

The original episode panel rendered inert plain text. The implemented [components package](../../packages/components/src/faithful-card/index.ts) now owns the restricted Markdown reader, immutable policy and revocable image-consent scope. Lit and React render those shared decisions through their optional FaithfulCard entries; applications can still use unrelated catalogs without importing the card or parser into their emitted view bundle. The episode application supplies its own finite content bound and chooses the policy rather than letting a description choose either.

## Proposed behavior

The approved behavior below is implemented; it introduces no new policy level or renderer permission.

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
| Components policy module | `createContentPolicy` returns one validated immutable value or a typed failure. Its `decideLink`, `decideImage`, `offerImages` and derived resource policy remain independent of a renderer or host name. |
| Components reader | `createFaithfulCardReader` validates trusted dialect and finite length settings, then reads only the versioned Markdown contract. The maintained parser produces restricted nodes in order, preserves original source and refuses over-limit or too-deep content explicitly. |
| Lit and React renderers | Map restricted nodes to fixed templates/text bindings. Bind controls and grants to the live content revision; release their own grants and handlers on replacement/disconnect. The owning view or stack retires the whole consent scope. |
| MCP resource and host adapter | Derive content-related resource restrictions from the same policy and expose only the supported link-opening callback. A host can impose stricter restrictions; application policy cannot expand its permissions. |
| Authored action/media flow | Retain the separate protected operation (the example's Play), capability routing, origin rules and server authorization described by the playback design. Content policy does not create or authorize business actions. |

Description text and parser-generated HTML must never reach `unsafeHTML`, `unsafeSVG`, `innerHTML` or equivalent executable markup paths. Fixed Lit/React templates render only the restricted node cases; revealing source still uses text bindings. Ordinary prose remains text even when it resembles instructions.

One policy value must determine both resource configuration and view behavior. MCP Apps’ [`resourceDomains`](https://github.com/modelcontextprotocol/ext-apps/blob/v2.0.3/src/spec.types.ts) covers images, scripts, stylesheets, fonts and media. It is a broad origin permission, not an image-only control. The implemented policy derives restrictive document CSP alongside the broader metadata so adding an image origin grants no script, style, font or media permission. Applications keep any separately authored media delivery at its own boundary. If that restriction cannot be enforced, images stay inert even after Show images.

The resource must declare its bounded image origins and applicable restrictions before mounting. Show images can use only those existing permissions; reader consent cannot relax CSP. The renderer sends no Strict content-image request before consent. Tests inspect the built resource’s effective restrictions and actual requests, not just declared metadata.

Each view receives its immutable policy and callback explicitly. Reader consent is separate, revocable view state and cannot mutate that policy. There is no mutable module-wide “current policy,” host-name switch or callback registry. Interleaved views cannot share consent or change one another’s effects. Resource identity must distinguish policy variants whenever their required host metadata differs, so a cached resource cannot silently supply another policy.

URLs are parsed with supported platform APIs and validated before any effect. Only absolute HTTPS content destinations can activate. Exact-host image matching must reject suffix tricks, subdomains not explicitly listed, credentials and malformed input; wildcard matching is outside the contract. If the host cannot enforce the selected image destination boundary, the image stays inert. Resource permissions for authored media remain separately derived and cannot be borrowed by content images.

The Markdown and policy modules are renderer independent in `@saga-a2ui/components/faithful-card`. Renderer registration/templates and host adapters remain separate. The parser is `markdown-it` 15.0.3, with `commonmark` or the explicitly selected `commonmark-tables-strikethrough` dialect; linkification and typographic rewriting are disabled. HTML is recognized to retain it as inert source, never rendered as parser-generated HTML. The reader requires a finite positive integer `maxLength` in UTF-16 code units and refuses nesting at its exported limit of 20 rather than silently dropping content. There is no global default content bound.

Content is exactly `{contractVersion: 1, markdown}`. `read` returns an interpreted card or `invalid`, `unsupported-version`, `too-long` or `too-nested`; `describeContentFailure` produces fixed failure wording without echoing the supplied content. Reader settings, policy configuration and result-content validation are distinct boundaries.

For a card application, the stack reads policy from its document and constructs the content view. Every accepted `present` is a new selection even when the Markdown is equal, so old image consent and pending link outcomes retire. A low-level `present` rejected by the surface's data shape leaves the previous presentation unchanged; the card-app stack explicitly calls `clear()` on that failure or a rejected whole-result reading before showing its problem state. Content accepted by the surface can still fail the Markdown reader (for example, the configured length bound); the renderer then replaces that content with its explicit content failure. A lower-level consumer must handle a rejected `present` itself; a rejection is not an automatic account-retirement signal.

## Trusted embedded artwork

A self-contained card can include application-owned artwork without fetching an external image. The historical [policy at `78820dfce3d119d4c82d3d12020af65bef1e2fb1`](https://github.com/MachineWisdomAI/saga-a2ui/blob/78820dfce3d119d4c82d3d12020af65bef1e2fb1/packages/components/src/faithful-card/policy.ts) emitted `img-src 'none'` for an empty image allowlist, blocking even trusted bundled raster artwork. The approved amendments replaced that restriction with the current shared [policy](../../packages/components/src/faithful-card/policy.ts) below; they did not allow Markdown to supply data/blob images.

The resource CSP includes `data: blob:` in Standard and only `data:` in Strict for `img-src`. Strict never adds `blob:`, including when configured HTTPS origins are present. There is no embedded-image configuration flag. Construct one image source list from the selected mode’s baseline schemes plus the validated exact HTTPS origins. Configured origins extend that list; they never replace the baseline, whether the host list is empty, contains one entry or contains several entries. Emit one `img-src` directive, without `'none'`:

| Configured image hosts | Standard | Strict |
| --- | --- | --- |
| Empty | `img-src data: blob:` | `img-src data:` |
| One exact host | `img-src data: blob: https://images.example.com` | `img-src data: https://images.example.com` |
| Multiple exact hosts | `img-src data: blob: https://a.example.com https://b.example.com` | `img-src data: https://a.example.com https://b.example.com` |

These are resource permissions for rendering images, not new content permissions. The font resource permission is defined below. Other directives, including the connection policy, retain their existing restrictions. The exact HTTPS image-origin list remains unchanged: `data:` and `blob:` are scheme sources, not external hosts, and must not be added to broad resource-domain permissions. Reconstructing the immutable policy from `policy.configuration` must produce the same restrictions, including the selected mode’s baseline schemes, without adding an embedded-image flag.

Standard’s `blob:` allowance supports application-owned images represented by browser-managed objects, including generated images and local file previews. It does not itself permit a network fetch. If an application obtains bytes over the network before creating a blob URL, that fetch still needs the applicable connection permission. The application owns creation and revocation of its object URLs; this amendment introduces no blob registry or content-image conversion service. This is a convenience permission, not proof that blob bytes are trusted. Strict omits it even for application-created object URLs; use embedded data images or permitted HTTPS images there. See the [CSP image directive](https://www.w3.org/TR/CSP/#directive-img-src) and [File API object URL model](https://www.w3.org/TR/FileAPI/#url).

### Trusted fonts

Standard derives `font-src data: blob:` by default; Strict derives `font-src data:`. No opt-in flag is introduced, and Strict cannot regain `blob:` through configured font origins. Trusted application CSS can embed WOFF2 bytes in a data URL or, in Standard, use an application-owned blob URL through `@font-face`; ordinary system-font fallback remains available. The application owns blob URL cleanup. Answer text, tool results and A2UI properties cannot supply font URLs, inject CSS or select a font policy. Font loading does not use Show images consent.

Trusted application resource configuration may additionally supply `fontOrigins`, a separate exact HTTPS origin allowlist that defaults to empty. Validate and normalize origins before constructing the immutable resource policy; reject wildcards, non-HTTPS schemes, credentials, non-root paths, queries and fragments. Keep an explicit non-default port as part of the origin, and deduplicate normalized entries. This is resource configuration, not answer content or a change to the Standard/Strict content level. Configuration serialization and reconstruction must preserve this list. Image hosts never implicitly authorize fonts, and font origins never implicitly authorize images.

Build the font source list from the selected mode’s baseline plus all validated font origins. One configured origin produces `font-src data: blob: https://fonts.example.com` in Standard and `font-src data: https://fonts.example.com` in Strict. Adding origins cannot drop `data:` or Standard’s `blob:`, and cannot introduce `blob:` in Strict. Trusted authored `@font-face` URLs can load automatically in either mode without Show images consent. Redirects must remain within the declared font origins under the effective host/document policies. If enforcement or delivery cannot support that path, use the readable fallback rather than broaden permissions.

Font-file requests carry normal network metadata, and their paths or query strings can encode data. Even fixed URLs may expose which character subsets were needed through `unicode-range` selection. Therefore application-authored font URLs must not be constructed from supplied answer text, credentials or private request data. Static asset-version parameters are allowed; an origin allowlist does not validate the information in a URL. These constraints preserve trusted typography without introducing a font-consent control or treating remote fonts as inherently private.

The resource builder emits one `font-src` directive. Its baseline schemes must survive policy reconstruction and any configured source composition, just as they do for `img-src`. Where the host requires broad resource-domain metadata, declare the required font origins there while retaining restrictive document CSP so the combined policy grants those origins only font access. Font permissions do not grant image, script, stylesheet, frame or connection permissions. A remote font stylesheet is a stylesheet request and is not authorized merely by allowing its font-file origin.

Font loading through `@font-face` follows browser font-fetch and CORS rules; CSP permission alone does not guarantee a font will load. A failed font uses the authored fallback, keeping text readable. Verification must establish that the intended font actually loaded rather than infer success from a CSS family declaration. See [CSP font sources](https://www.w3.org/TR/CSP/#directive-font-src) and [CSS font fetching and privacy considerations](https://www.w3.org/TR/css-fonts-4/).

### Artwork and answer images take separate paths

The consumer imports its selected static artwork at build time and references those bundled bytes from its trusted template or CSS. The shared policy supplies the matching resource CSP before mounting. Bundled decoration may display in Standard and Strict without Show images consent; Hide images revokes content-image consent and does not remove application decoration.

Answer text still passes through the restricted Markdown reader and typed renderer. `decideImage` and `offerImages` retain their existing meaning: content images require an absolute HTTPS URL, an exactly allowed host and established enforcement, plus current consent in Strict. Markdown `data:` and `blob:` URLs remain rejected even when consent is granted. Raw HTML and revealed source remain inert text. The content wire contract stays exactly `contractVersion` and `markdown`; answers cannot select assets, CSS, templates or policy.

CSP cannot establish the provenance of data-URL bytes or, in Standard, blob bytes. Removing `blob:` from Strict narrows its resource permissions but does not make `data:` a trust check. The trust boundary therefore depends on fixed authored templates and the shared content decisions: untrusted MCP content must never reach trusted template/CSS asset slots or be converted to a data/blob URL to bypass those decisions. Every renderer must verify this boundary through its public content-binding path. The resource allowance is not a sanitizer for arbitrary application markup. It authorizes no new HTML injection path, inline SVG markup, image proxy or renderer-specific policy fork.

![Image and font permissions use data: in both modes and blob: only in Standard; supplied Markdown images still require shared content checks.](../../diagrams/embedded-artwork-policy.png)

[Mermaid source](../../diagrams/embedded-artwork-policy.mmd) · [Editable Excalidraw](../../diagrams/embedded-artwork-policy.excalidraw) · [SVG](../../diagrams/embedded-artwork-policy.svg)

For example, an application uses an empty external-image allowlist and builds a card containing a decorative raster image. The artwork displays from the immutable HTML resource. A supplied answer containing a data-image reference, a blob URL or an external HTTPS image still displays an inert placeholder or source text. Enabling Strict and revealing source does not change either content-image decision.

### Enforcement, caching and failure

The resource and view reconstruct the same policy through public SDK exports. `establishImageEnforcement(policy, appliedPolicies)` returns `established` only when the provided list includes the exact derived document-CSP string; otherwise images remain inert. It checks the supplied declaration, not the browser's actual enforcement or a host's redirect behavior. Those still require built-resource/host observations. The baseline scheme allowances cannot manufacture established enforcement when the required policy is missing or mismatched. A consumer must not hand-edit a more permissive CSP. A host may impose stricter restrictions; blocked artwork remains a visible qualification failure, not a reason to relax other directives or substitute a remote asset.

The immutable resource identity includes its compiled code, policy, CSS, embedded font and artwork bytes. Changing those bytes changes the identity. Supplying another answer reuses the resource and updates only validated data; it does not rebuild or re-register artwork. The baseline schemes add no network dependency. Remote fonts are an optional resource capability; the self-contained card recipe embeds any required font bytes and remains usable without external runtime assets.

| Verification case | Required result |
| --- | --- |
| Empty host list | Standard emits `img-src data: blob:`; Strict emits `img-src data:`. Trusted data images display in both; trusted blob images display only in Standard and are blocked in Strict. Answer-supplied data, blob and HTTPS images stay inert, including after source reveal and consent. |
| One or several exact allowed hosts, Standard and Strict | The selected mode’s baseline remains alongside every normalized allowed HTTPS origin. Built-resource checks display data images in both modes and blob images only in Standard with nonempty host lists; Strict blocks blob images. |
| Content images with exact allowed hosts | Existing HTTPS, exact-host, redirect and demonstrated image-only enforcement rules still apply. Strict requires current consent; Hide images and invalidation revoke it. |
| Invalid trusted configuration or attempted answer configuration | Existing validation fails invalid configuration explicitly. Answer data cannot mutate the policy or gain template/CSS control. |
| Policy round-trip or missing/mismatched document policy | Round-tripping retains the selected mode’s baseline and allowed origins; Strict never acquires `blob:`. Missing/mismatched enforcement leaves content images inert. |
| Embedded and blob fonts | A representative data-URL WOFF2 font loads in both modes. A trusted blob font loads in Standard but is blocked in Strict, which uses readable fallback text. Invalid font input also leaves readable fallback text. |
| Font source composition and reconstruction | Empty, one-origin and multiple-origin configurations retain `data: blob:` in Standard and only `data:` in Strict; declared HTTPS origins extend each list without changing these baselines. Normalization, deduplication and round-tripping preserve exact origins and ports; invalid entries fail explicitly. |
| Remote font loading and isolation | With working CORS, a trusted font loads from its declared origin; an unlisted origin or redirect destination is blocked. Image-only permission grants no font access, font-only permission grants no image/script/stylesheet access, and fallback remains readable after failure. |
| MCP content and trusted asset slots, in every renderer | Supplied content cannot reach template/CSS asset slots directly or via data/blob conversion, in either mode. Verify hostile input through actual content binding; a declared CSP alone does not prove this boundary. |
| Answer content and font requests | Hostile answer text cannot inject `@font-face`, change font configuration or become a request path/query. Application font URLs contain no answer, credential or private request data. |
| Built resource under attempted external runtime loads | Script, stylesheet, frame and connection restrictions remain unchanged; embedded fonts and artwork create no external dependency. |
| Changed artwork/policy versus changed answer | Artifact changes yield a new resource identity; answer-only changes reuse it and display the supplied values. |

Run these cases through public policy interfaces and the actual built browser resource, observing image rendering and consequential requests. Local checks establish policy and browser behavior; the required real-host card runs remain separate acceptance evidence.

### Amendment scope and delivery

The [lifecycle companion](content_safety_levels.lifecycle.md#amendment-scope-and-delivery) preserves each bounded amendment and its independent passive-card sequencing. The current image/font baselines above implement those amendments; earlier contract and host observations retain their original scope. Publication and deployment authority are not implied.

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

These are qualification requirements. Completed local and bounded host runs are recorded separately in the lifecycle companion; no new run is claimed by this refresh.

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

The original POL1/POL2 sequence, later lifetime approval and passive-card dependency corrections remain in the [lifecycle companion](content_safety_levels.lifecycle.md#implementation-sequence). The scoped implementation and host records identify what landed and what was observed; new qualification must preserve these boundaries rather than infer all-host acceptance from local tests.

## Open decisions

The parser, policy API and consent owners are implemented as described above; their original selection questions remain in the [historical record](content_safety_levels.lifecycle.md#original-open-decisions). A new host or resource configuration still needs evidence for image-only restrictions, redirects, trusted artwork/font delivery and any authored media alongside it. If the supported host path cannot enforce the declared restrictions, content images stay inert; this design introduces no proxy or new host capability.

## References

- [Plain-text Lit rendering and catalog integration](../../apps/lit-host/src/lit/integration.ts)
- [Panel contract](../../apps/lit-host/src/saga-panel/contract.ts)
- [Public resource policy](../../apps/lit-host/src/mcp/server.ts)
- [Authorized playback design](authorized_playback.blueprint.md)
- [Reusable MCP connector](reusable_mcp_connector.blueprint.md)
- [Request and view lifetimes](request_view_lifetimes.blueprint.md)
- [Action binding](../modules/action_binding.blueprint.md)
- [Coding standards](../../CODING_STANDARDS.md)
