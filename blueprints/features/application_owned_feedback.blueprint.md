---
feature_name: application_owned_feedback
status: draft
module_blueprints: [action_binding]
dependencies: [content_safety_levels, reusable_lit_adapter]
date_added: 2026-10-21
---

# Application-owned outcome feedback

## Status

Draft for design review. The proposed application-owned feedback stream and presentation interface are not implemented; the existing outcome type and description helpers below are shipped foundations, not acceptance of this proposal. This amends presentation in [content safety](content_safety_levels.blueprint.md#proposed-behavior) and [the Lit adapter](reusable_lit_adapter.blueprint.md). Policy restrictions remain unchanged.

## Problem and current behavior

The supplied Lit and React FaithfulCards render their own link, content-error and image notices. Applications need control over wording and placement while retaining the shipped renderer. [PR #202](https://github.com/MachineWisdomAI/saga-a2ui/pull/202) silences successful links but leaves this ownership unchanged.

At source `cdad54747dfbba756464676ac3b1b8c90148a566`, `@saga-a2ui/core/host-links` exports the `LinkOpenOutcome` string-union type and `describeLinkOutcome`. It does not export a runtime `LinkOpenOutcome` value object. Both card renderers still call the description helper and render their own link status; `describeContentFailure` also already exists. `CardFeedback`, `CardFeedbackSnapshot`, `CardPresentation` and `describeCardFeedback` below are proposed APIs, not options an application can use today.

The core, components, Lit and React `src/` files at this baseline match the 69 shipped files in their npm `0.7.7-rc.1` tarballs, whose registry integrity values were verified. This establishes the published source boundary only; no new installation, runtime or host acceptance is claimed.

## Proposed behavior

```diff
 User activates a card control
   SDK enforces policy and performs the permitted operation
-  SDK chooses wording and inserts an outcome notice
+  SDK reports an outcome enum and typed details
+  Application chooses default wording, custom wording, or silence
+  Application chooses the notice location
```

The proposed application flow is to receive a snapshot through `onFeedback`, replace the notice state for that card, and render that state wherever the application chooses. Replacement clears previous feedback; an empty retired snapshot clears notices for the ended card. For example, a toast owner could follow this illustrative pseudocode:

```text
onFeedback(snapshot):
  identify the card stream using snapshot.instance
  replace that card's stored notice state with this snapshot
  if snapshot.lifetime is retired, clear that card's notices
  otherwise render the current feedback at the application's chosen location
```

This synchronous illustration assumes ordered delivery for one subscribed card stream; the proposed guarantees and unresolved details are separated below. It does not define the shape of `snapshot.feedback`, a storage API, or asynchronous observer behavior. Once the application has selected a proposed `link` feedback item from its stored state, rendering can use the existing pure description helper:

```tsx
const text = describeLinkOutcome(feedback.outcome, feedback.url);
return text ? <Toast>{text}</Toast> : null;
```

The proposed named value `Opened` preserves the existing string `opened`: it means the host accepted the request, and its default description is empty. Unsuccessful link descriptions retain the destination.

## Responsibilities and interfaces

Add named string enum values beside their owning contracts, preserving existing strings and typed details. The value object shown below is proposed; the string-union type and description function already exist. The link outcome's owner is now `@saga-a2ui/core/host-links` (moved there from the components FaithfulCard export by the view composition delivery slice), so the enum below applies at that module, not in components:

```ts
export const LinkOpenOutcome = Object.freeze({
  Opened: 'opened', Denied: 'denied', Unavailable: 'unavailable', Failed: 'failed',
} as const);
export type LinkOpenOutcome = typeof LinkOpenOutcome[keyof typeof LinkOpenOutcome];
export function describeLinkOutcome(outcome: LinkOpenOutcome, url: string): string;
```

The neutral FaithfulCard export reports:

| Feedback kind | Typed details |
| --- | --- |
| `link` | Link position, `LinkOpenOutcome`, normalized destination |
| `content` | Existing `ContentFailure`, including safe length/limit details |
| `images` | `CardImageState`: `NotRequested`, `Shown`, `Hidden`, `Unavailable` or `ViewEnded`; failed image positions |
| `view` | `CardViewFailure.NoView` |

Use named enum values and a discriminated `CardFeedback` union. Keep `describeContentFailure`; add `describeCardFeedback`, delegating existing cases. Never include answer text or raw exceptions.

```ts
export interface CardPresentation {
  readonly onFeedback?:
    (snapshot: CardFeedbackSnapshot) => void | PromiseLike<void>;
  readonly controlLabel?: (control: CardControl) => string;
  readonly markerLabel?: (marker: CardMarker, alt: string) => string;
}
```

`CardFeedbackSnapshot` carries immutable `instance`, `revision`, `lifetime` (`active`/`retired`) and current `feedback`. `CardControl` covers Show/Hide images and Reveal/Hide source; `CardMarker` covers blocked link/markup/image and failed-image substitutions. Both have pure default-label functions. Controls and inert markers remain usable; outcome notices and error prose become application-owned.

Under this proposal, React would accept trusted `presentation` on its provider or direct card; Lit would accept it on `provideContentView(host, view, presentation)` or the direct element. Direct configuration replaces inherited configuration. Presentation is separate from effect-bearing view settings; A2UI still supplies only `contractVersion` and `markdown`.

### SDK-wide inventory and bounded migration

Change the card renderers and shared feedback/label contracts. Preserve existing typed policy/configuration, consent, action and A2UI results, application-supplied MCP failure text and application-owned fixture UI. Developer diagnostics remain diagnostics. Do not add a universal enum, message registry or event bus.

## Failure and recovery

- Publish after commit. Identify each card and content revision; keep only the latest outcome per link. Suppress older settlements and stale callbacks.
- Replacement clears feedback; disposal sends an empty retired snapshot. Observer replacement clears the old stream and supplies current feedback to the new observer. React replay cannot duplicate effects or grants.
- Presentation changes preserve consent and pending work. Contain observer failures as diagnostics. Invalid custom labels fall back to escaped accessible defaults. Without an observer, render no outcome notices.

## Verification outcomes

| Case | Required result |
| --- | --- |
| Four link outcomes | Typed outcome/destination, no automatic notice, optional default description |
| Content refusal or missing view | Safe typed failure, no stale answer or automatic error prose |
| Image consent, revocation or load failure | Correct image state and markers; unchanged policy/network restrictions |
| Labels, observer replacement or failure | Application text is escaped; defaults recover invalid labels; effect state is preserved |
| Replacement, reverse settlement or disposal | Current feedback only; retired notices clear; cards remain isolated |
| Independent packed Lit and React consumers | Applications choose wording and placement while using the shipped cards; keyboard, RTL and theme checks pass |

## Open design decisions

The lifecycle requirements above describe intended outcomes, but do not yet specify all interfaces needed to implement them:

- **Snapshot shape and replacement.** Decide whether `feedback` is a collection of current outcomes or another representation, how multiple feedback kinds coexist, and how a link position is scoped to `instance` and `revision`. The existing requirement is to keep only the latest outcome per link, clear feedback on content replacement, and keep cards isolated. The snapshot's concrete type and application replacement key must express those rules before implementation; the table of feedback kinds does not settle cardinality.
- **Asynchronous observers and freshness.** Decide what the SDK guarantees once an observer has begun awaiting and the card is replaced, disposed, or assigned another observer. Suppressing an older SDK delivery alone cannot retract application work already started. Specify which owner must prevent a stale post-await notice write and how that owner can check freshness, including whether obsolete observers may still settle. The proposed `PromiseLike<void>` callback type does not by itself supply cancellation or a freshness check.

These are unresolved choices within this unapproved draft, not newly approved APIs. The synchronous illustration above deliberately avoids choosing an asynchronous coordination mechanism.

## Implementation sequence and scope

Add contracts/helpers, integrate Lit/React and SDK fixtures, then qualify independent packed consumers. Document the prerelease presentation change. Rollback reverts those SDK/fixture changes.

**Ansari and existing consumer applications are out of scope**, including their source, pins, upstream PRs, deployments and host acceptance. No implementation dispatch or package publication is authorized.

## References

The original investigation used [`0bbc6adefef93d1631209b05789f5aeae3bc2943`](https://github.com/MachineWisdomAI/saga-a2ui/tree/0bbc6adefef93d1631209b05789f5aeae3bc2943). Its [former components-owned link module](https://github.com/MachineWisdomAI/saga-a2ui/blob/0bbc6adefef93d1631209b05789f5aeae3bc2943/packages/components/src/faithful-card/host-links.ts) remains a historical reference; current ownership is core. Current source references:

- [Neutral link outcomes](../../packages/core/src/host-links.ts) and [content failures](../../packages/components/src/faithful-card/reader.ts)
- [React rendering](../../packages/react/src/faithful-card/nodes.tsx) and [Lit rendering](../../packages/lit/src/faithful-card/faithful-card-element.ts)
- [Action outcomes](../../packages/core/src/actions/outcome.ts) and [application-owned MCP failure text](../../packages/mcp/src/server/operation.ts)
- [Coding standards](../../CODING_STANDARDS.md) and [Blueprint lifecycle](../README.md#lifecycle-and-revision-records)
