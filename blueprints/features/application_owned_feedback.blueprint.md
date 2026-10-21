---
feature_name: application_owned_feedback
status: draft
module_blueprints: [action_binding]
dependencies: [content_safety_levels, reusable_lit_adapter]
date_added: 2026-10-21
---

# Application-owned outcome feedback

## Status

Draft for design review; implementation has not started. This amends presentation in [content safety](content_safety_levels.blueprint.md#proposed-behavior) and [the Lit adapter](reusable_lit_adapter.blueprint.md). Policy restrictions remain unchanged.

## Problem and current behavior

The supplied Lit and React FaithfulCards render their own link, content-error and image notices. Applications need control over wording and placement while retaining the shipped renderer. [PR #202](https://github.com/MachineWisdomAI/saga-a2ui/pull/202) silences successful links but leaves this ownership unchanged.

## Proposed behavior

```diff
 User activates a card control
   SDK enforces policy and performs the permitted operation
-  SDK chooses wording and inserts an outcome notice
+  SDK reports an outcome enum and typed details
+  Application chooses default wording, custom wording, or silence
+  Application chooses the notice location
```

Applications can call a pure default-description function:

```tsx
const text = describeLinkOutcome(feedback.outcome, feedback.url);
return text ? <Toast>{text}</Toast> : null;
```

`Opened` still means the host accepted the request, and its default description is empty. Unsuccessful link descriptions retain the destination.

## Responsibilities and interfaces

Expose named string enum values beside their owning contracts, preserving existing strings and typed details:

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

React accepts trusted `presentation` on its provider or direct card; Lit accepts it on `provideContentView(host, view, presentation)` or the direct element. Direct configuration replaces inherited configuration. Presentation is separate from effect-bearing view settings; A2UI still supplies only `contractVersion` and `markdown`.

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

## Implementation sequence and scope

Add contracts/helpers, integrate Lit/React and SDK fixtures, then qualify independent packed consumers. Document the prerelease presentation change. Rollback reverts those SDK/fixture changes.

**Ansari and existing consumer applications are out of scope**, including their source, pins, upstream PRs, deployments and host acceptance. No implementation dispatch or package publication is authorized.

## References

Runtime sources inspected at `0bbc6adefef93d1631209b05789f5aeae3bc2943`, unchanged in these areas since PR #202:

- [Neutral link outcomes](../../packages/components/src/faithful-card/host-links.ts) and [content failures](../../packages/components/src/faithful-card/reader.ts)
- [React rendering](../../packages/react/src/faithful-card/nodes.tsx) and [Lit rendering](../../packages/lit/src/faithful-card/faithful-card-element.ts)
- [Action outcomes](../../packages/core/src/actions/outcome.ts) and [application-owned MCP failure text](../../packages/mcp/src/server/operation.ts)
- [Coding standards](../../CODING_STANDARDS.md) and [Blueprint lifecycle](../README.md#lifecycle-and-revision-records)
