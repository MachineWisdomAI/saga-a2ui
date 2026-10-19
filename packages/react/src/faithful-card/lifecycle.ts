import type { HostLinks, LinkOpenOutcome } from '@saga-a2ui/components/faithful-card';
import { useLayoutEffect, useRef, useState } from 'react';
import type { FaithfulCardView } from './view.js';

// The committed lifecycle of one card: what belongs to the content the reader is looking at, and
// which controls may still act for it. It is separate from the templates (`nodes.tsx`), which only
// turn the interpreted content and this state into elements, and from the styles.
//
// A function component is not the card the reader sees: React can run it again, discard a render
// before commit, or run it twice under Strict Mode. So rendering here only *derives* values. State
// that belongs to a content revision is reset by a render-phase update (React's documented way to
// derive state from changed inputs), and nothing runs during render except that derivation. A
// control is bound to the revision it was rendered for: its effect on state applies only while that
// revision is still the card's current one, and it asks the owner (an A2UI node) whether it still
// stands before it asks the host for anything. So a late host answer, a control of a node that was
// disposed but not yet unmounted, and an unmounted card are all stale and show or do nothing.

/** The state that belongs to one content revision, and so starts over when the revision changes. */
interface Revision {
  /** Advances on every new revision, so a control from an earlier one is recognisable even for equal content. */
  readonly generation: number;
  readonly view: FaithfulCardView | undefined;
  readonly contractVersion: unknown;
  readonly markdown: unknown;
  readonly sourceRevealed: boolean;
  readonly linkOutcomes: ReadonlyMap<number, LinkOpenOutcome>;
}

/** What the templates need from the lifecycle. Its controls are bound to the revision it was rendered for. */
export interface CardLifecycle {
  /** Whether blocked fragments are shown as source text rather than placeholders. */
  readonly sourceRevealed: boolean;
  /** What the host answered for each link, by the link's position in the content. */
  readonly linkOutcomes: ReadonlyMap<number, LinkOpenOutcome>;
  toggleSource(): void;
  /** Asks the host to open a link the policy validated, and shows its answer if this revision still stands. */
  openLink(hostLinks: HostLinks, ordinal: number, url: string): void;
}

const ALWAYS_LIVE = (): boolean => true;

function startOf(generation: number, view: FaithfulCardView | undefined, contractVersion: unknown, markdown: unknown): Revision {
  return {
    generation,
    view,
    contractVersion,
    markdown,
    // New content starts from the policy's own presentation of what it blocks.
    sourceRevealed: view?.policy.blockedPresentation === 'inert-text',
    linkOutcomes: new Map(),
  };
}

/**
 * Tracks the card for the supplied content under `view`. `isLive` reports whether the owner of the
 * card (an A2UI node) still stands; a card with no such owner passes nothing.
 */
export function useCardLifecycle(
  view: FaithfulCardView | undefined,
  contractVersion: unknown,
  markdown: unknown,
  isLive: () => boolean = ALWAYS_LIVE,
): CardLifecycle {
  const [stored, setStored] = useState<Revision>(() => startOf(0, view, contractVersion, markdown));
  let revision = stored;
  // `Object.is` so that a value that is not equal to itself (NaN) cannot restart the revision forever.
  if (!Object.is(stored.view, view) || !Object.is(stored.contractVersion, contractVersion) || !Object.is(stored.markdown, markdown)) {
    revision = startOf(stored.generation + 1, view, contractVersion, markdown);
    setStored(revision);
  }
  const { generation } = revision;

  // Written only by the layout effect below, so it is the owner of the card as committed, and read
  // only when a control is used, never in render.
  const owner = useRef(isLive);
  useLayoutEffect(() => {
    owner.current = isLive;
  });

  /** Applies a change to the card's state, but only if this control's revision is still current. */
  const update = (change: (previous: Revision) => Revision): void =>
    setStored((previous) => (previous.generation === generation ? change(previous) : previous));

  return {
    sourceRevealed: revision.sourceRevealed,
    linkOutcomes: revision.linkOutcomes,
    toggleSource() {
      if (owner.current()) update((previous) => ({ ...previous, sourceRevealed: !previous.sourceRevealed }));
    },
    openLink(hostLinks, ordinal, url) {
      if (!owner.current()) return;
      void (async () => {
        let outcome: LinkOpenOutcome;
        try {
          outcome = await hostLinks.open(url);
        } catch {
          // An adapter that rejects has not opened the link; the reader is told so.
          outcome = 'failed';
        }
        // An answer for a revision that is gone (new content, a replaced view, an unmounted card) is not shown.
        if (owner.current()) update((previous) => ({ ...previous, linkOutcomes: new Map(previous.linkOutcomes).set(ordinal, outcome) }));
      })();
    },
  };
}
