# Content safety: verification contract

Detailed acceptance matrix retained from the [content-safety Blueprint](content_safety_levels.blueprint.md). These are requirements, not claims of new test or host runs. The Blueprint Status owns exact implementation and acceptance evidence.

## Verification outcomes

Use the same ordinary and hostile descriptions in both modes. Browser tests load the built resource and observe the actual host callback and network path, not source strings or declared CSP alone.

| Condition | Required result |
| --- | --- |
| Ordinary text, formatting, blocked fragments | Original input and order preserved. Strict placeholders, optional inert text and keyboard-accessible reveal and hide cause no execution or network effect. |
| Standard, default configuration | Empty allowlist, no content image loads. The parsed hostname is visible and accessible before a validated HTTPS link invokes the callback. |
| Standard, one exact image host | Only permitted HTTPS destinations load; suffix tricks, unlisted subdomains, credentials and non-HTTPS are rejected. Image-only restriction and redirect enforcement shown without widening script, style, font or media. |
| Host callback absent or denying | Explicit readable inert feedback, no direct navigation. |
| Strict before and after Show images | Before consent, even after reveal: zero image requests and link callbacks. After consent only permitted images load; invalid destinations stay unfetched; links stay inert. With no qualifying image, show unavailable feedback instead of enabling the control. |
| Hide images; stale consent | Hide removes images. Content, policy or selection change, replacement, disposal, observable identity or session retirement and consent-owner invalidation reject old controls and late results. Revalidation cannot restore consent; new content needs fresh consent; another view cannot inherit it. |
| Content tries to inject HTML, scripts, policy or actions | Stays inert, including after reveal; configuration and action arguments unchanged. |
| Standard and Strict views interleave updates and disposal | Each keeps its own policy and callback; one cannot enable effects or break the other's cleanup. |
| Resources rebuilt, cached or replaced | Resource metadata and renderer behavior agree; test the built resource and its identity. |
| Authored protected action under either level | Current authorization and applicable resource and delivery policy still apply (for Play: capability, recipient separation, media checks). Strict does not disable it, and content destinations do not inherit its permissions. |
| Empty image host list | Standard `img-src data: blob:`, Strict `img-src data:`. Trusted data images display in both; trusted blob images only in Standard. Answer-supplied data, blob and HTTPS images stay inert, including after reveal and consent. |
| One or several exact hosts, both modes | The mode baseline stays beside every normalized origin; data images display in both, blob images only in Standard. Exact-host, redirect and image-only rules apply; Strict needs current consent. |
| Invalid trusted configuration; attempted answer configuration | Explicit failure. Answer data cannot mutate policy or reach template or CSS control. |
| Policy round-trip; missing or mismatched document policy | Baseline and origins retained; Strict never gains `blob:`; missing enforcement leaves content images inert. |
| Embedded and blob fonts | A data-URL WOFF2 loads in both modes; a trusted blob font only in Standard (Strict falls back readably); invalid font input falls back readably. |
| Font source composition | Empty, one and several origins keep `data: blob:` (Standard) or `data:` (Strict) and add declared origins; normalization, deduplication and round trip preserve origins and ports; invalid entries fail explicitly. |
| Remote font loading and isolation | With working CORS a font loads from its declared origin; unlisted origins and redirects are blocked. Image permission grants no font access and font permission no image, script or stylesheet access; fallback stays readable. |
| Supplied content versus asset slots, every renderer | Content cannot reach template or CSS asset slots directly or by data/blob conversion. Verify with hostile input through real content binding; CSP alone does not prove it. |
| Hostile answer text and font requests | Cannot inject `@font-face`, change font configuration or become a request path or query; application font URLs carry no answer, credential or private data. |
| Attempted external runtime loads | Script, stylesheet, frame and connection restrictions unchanged; embedded assets create no external dependency. |
| Artwork or policy change versus answer change | Artifact changes give a new resource identity; answer-only changes reuse it. |

Local checks establish policy and browser behavior. The authenticated ChatGPT web and Claude web runs still exercise both levels, Strict visibility and image-consent controls and authorized and denied playback with the built resource, recording exact policy, source and resource identity, host and observed callbacks and requests. Deferring final signoff does not defer these runs; failed or unavailable evidence stays an open acceptance result.
