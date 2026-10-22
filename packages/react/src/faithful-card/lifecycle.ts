import {
  requestLinkOpen,
  type ImageConsent,
  type ImageContext,
} from '@saga-a2ui/components/faithful-card';
import type { HostLinks, LinkOpenOutcome } from '@saga-a2ui/core/host-links';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
//
// Image consent follows the same rule. A grant is made only by the reader's press, never in render,
// and is held in the revision it was made for; the card gives back every grant it made when that
// revision ends (new content or view, or unmount), but only those, so it never retires the view's
// scope that other cards share, and a Strict Mode replay of a mount cannot end a live scope. The
// view-wide revocation signals reach the card through a store subscription, which React makes and
// removes with the commit, not during render.

/** The state that belongs to one content revision, and so starts over when the revision changes. */
interface Revision {
  /** Advances on every new revision, so a control from an earlier one is recognisable even for equal content. */
  readonly generation: number;
  readonly view: FaithfulCardView | undefined;
  readonly contractVersion: unknown;
  readonly markdown: unknown;
  readonly sourceRevealed: boolean;
  readonly linkOutcomes: ReadonlyMap<number, LinkOpenOutcome>;
  /** The reader's consent to load images for this content, from Show images until it is hidden, revoked or replaced. */
  readonly grant: ImageConsent | undefined;
  /** Image positions whose load failed; Show images and Hide images start over with none. */
  readonly failedImages: ReadonlySet<number>;
}

/** What the templates need from the lifecycle. Its controls are bound to the revision it was rendered for. */
export interface CardLifecycle {
  /** Whether blocked fragments are shown as source text rather than placeholders. */
  readonly sourceRevealed: boolean;
  /** What the host answered for each link, by the link's position in the content. */
  readonly linkOutcomes: ReadonlyMap<number, LinkOpenOutcome>;
  /** The inputs of every image decision: the view's enforcement and whether this card holds live consent. */
  readonly images: ImageContext;
  /**
   * Asks the policy again, now, whether `source` may be requested: this render's owner still
   * stands and the grant it showed under is still live. Render decided from the state it saw; this
   * is read at the moment of the side effect, because the application can revoke or retire the
   * scope from an earlier effect of the same commit, and a request cannot be taken back.
   */
  imageStillPermitted(source: string): boolean;
  /** True when the view has ended image consent for good and this card holds none. */
  readonly imagesEnded: boolean;
  /** Image positions that failed to load, which the template shows as not loaded. */
  readonly failedImages: ReadonlySet<number>;
  toggleSource(): void;
  /** Asks the host to open a link the policy validated, and shows its answer if this revision still stands. */
  openLink(hostLinks: HostLinks, ordinal: number, url: string): void;
  /** Records consent for this content, if the policy offers images for `sources`. Replaces any earlier grant. */
  showImages(sources: readonly string[]): void;
  /** Removes the images and gives back this card's grant. */
  hideImages(): void;
  /** An image failed to load. A failure reported for an earlier revision is ignored; a new grant starts with no failures. */
  imageFailed(ordinal: number): void;
}

const ALWAYS_LIVE = (): boolean => true;
const NO_UNSUBSCRIBE = (): void => undefined;

/** What this card's image consent stands at, read from the scope and the card's own grant. */
type Standing = 'granted' | 'ended' | 'none';

function startOf(
  generation: number,
  view: FaithfulCardView | undefined,
  contractVersion: unknown,
  markdown: unknown,
): Revision {
  return {
    generation,
    view,
    contractVersion,
    markdown,
    // New content starts from the policy's own presentation of what it blocks.
    sourceRevealed: view?.policy.blockedPresentation === 'inert-text',
    linkOutcomes: new Map(),
    // New content needs fresh consent.
    grant: undefined,
    failedImages: new Set(),
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
  const [stored, setStored] = useState<Revision>(() =>
    startOf(0, view, contractVersion, markdown),
  );
  let revision = stored;
  // `Object.is` so that a value that is not equal to itself (NaN) cannot restart the revision forever.
  if (
    !Object.is(stored.view, view) ||
    !Object.is(stored.contractVersion, contractVersion) ||
    !Object.is(stored.markdown, markdown)
  ) {
    revision = startOf(stored.generation + 1, view, contractVersion, markdown);
    setStored(revision);
  }
  const { generation, grant } = revision;

  // Written only by the layout effect below, so they are the owner and the revision of the card as
  // committed, and read only when a control is used, never in render.
  const owner = useRef(isLive);
  const committed = useRef(revision);
  useLayoutEffect(() => {
    owner.current = isLive;
    committed.current = revision;
  });

  // Every grant this card made for the revision it was committed with. Giving them back when that
  // revision ends covers a grant whose state update was dropped as stale. Nothing here touches the
  // scope's other grants or its subscribers.
  const made = useRef<ImageConsent[]>([]);
  useLayoutEffect(() => {
    const mine: ImageConsent[] = [];
    made.current = mine;
    return () => {
      for (const one of mine) one.revoke();
    };
  }, [generation]);

  // The scope tells the card when it revokes everything or ends. React subscribes after commit,
  // removes the subscription on unmount, and re-reads the snapshot once it has subscribed, so a
  // revocation between render and commit is not missed.
  const scope = view?.consent;
  const subscribe = useCallback(
    (notify: () => void): (() => void) => {
      if (scope === undefined) return NO_UNSUBSCRIBE;
      const subscription = scope.subscribe(notify);
      return () => subscription.unsubscribe();
    },
    [scope],
  );
  const readStanding = (): Standing =>
    grant?.live === true
      ? 'granted'
      : scope?.retired === true
        ? 'ended'
        : 'none';
  const standing = useSyncExternalStore(subscribe, readStanding, () => 'none');

  /** Whether this control's revision is still the committed one and its owner still stands. */
  const stands = (): boolean =>
    committed.current.generation === generation && owner.current();
  /** Applies a change to the card's state, but only if this control's revision is still current. */
  const update = (change: (previous: Revision) => Revision): void =>
    setStored((previous) =>
      previous.generation === generation ? change(previous) : previous,
    );

  return {
    sourceRevealed: revision.sourceRevealed,
    linkOutcomes: revision.linkOutcomes,
    images: {
      enforcement: view?.imageEnforcement ?? 'unestablished',
      consent: standing === 'granted' ? 'granted' : 'not-granted',
    },
    imageStillPermitted(source) {
      if (view === undefined || !isLive()) return false;
      const consent = grant?.live === true ? 'granted' : 'not-granted';
      return view.policy.decideImage(source, {
        enforcement: view.imageEnforcement,
        consent,
      }).allowed;
    },
    imagesEnded: standing === 'ended',
    failedImages: revision.failedImages,
    toggleSource() {
      if (owner.current())
        update((previous) => ({
          ...previous,
          sourceRevealed: !previous.sourceRevealed,
        }));
    },
    openLink(hostLinks, ordinal, url) {
      if (!owner.current()) return;
      void (async () => {
        // An adapter that rejects has not opened the link; the reader is told so.
        const outcome = await requestLinkOpen(hostLinks, url);
        // An answer for a revision that is gone (new content, a replaced view, an unmounted card) is not shown.
        if (owner.current())
          update((previous) => ({
            ...previous,
            linkOutcomes: new Map(previous.linkOutcomes).set(ordinal, outcome),
          }));
      })();
    },
    showImages(sources) {
      if (view === undefined || !stands()) return;
      if (!view.policy.offerImages(sources, view.imageEnforcement).available)
        return;
      committed.current.grant?.revoke();
      const next = view.consent.grant();
      made.current.push(next);
      // A retired scope hands out only dead grants: nothing to show, and the card reports that the view ended.
      if (next.live)
        update((previous) => ({
          ...previous,
          grant: next,
          failedImages: new Set(),
        }));
    },
    hideImages() {
      if (!stands()) return;
      committed.current.grant?.revoke();
      update((previous) => ({
        ...previous,
        grant: undefined,
        failedImages: new Set(),
      }));
    },
    imageFailed(ordinal) {
      update((previous) =>
        previous.failedImages.has(ordinal)
          ? previous
          : {
              ...previous,
              failedImages: new Set(previous.failedImages).add(ordinal),
            },
      );
    },
  };
}
