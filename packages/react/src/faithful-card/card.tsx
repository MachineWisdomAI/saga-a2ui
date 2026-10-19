import { describeContentFailure, type InterpretedCard, type ReadResult } from '@saga-a2ui/components/faithful-card';
import { useContext, useMemo, type ReactElement } from 'react';
import { useCardLifecycle, type CardLifecycle } from './lifecycle.js';
import { Blocks, type Rendering } from './nodes.js';
import { FaithfulCardViewContext, type FaithfulCardView } from './view.js';

/** The supplied values, exactly as an application or an A2UI binding hands them over. Untrusted. */
export interface FaithfulCardProps {
  /** The contract version of the content, as supplied. Validated by the view's reader. */
  readonly contractVersion: unknown;
  /** The Markdown to show, exactly as supplied. Validated by the view's reader. */
  readonly markdown: unknown;
}

function Failure(props: { readonly reason: string; readonly message: string }): ReactElement {
  return (
    <p className="saga-card saga-card-failure" role="alert" data-testid="card-failure" data-reason={props.reason}>
      {props.message}
    </p>
  );
}

/** Strict only. The one control changes visibility only: revealed source stays inert text. */
function Controls(props: { readonly card: InterpretedCard; readonly lifecycle: CardLifecycle }): ReactElement | null {
  const { fragments } = props.card;
  const blockable = fragments.links + fragments.images.length + fragments.rawHtml > 0;
  if (!blockable) return null;
  return (
    <div className="saga-card-controls" data-testid="card-controls">
      <button type="button" data-testid="source-toggle" onClick={() => props.lifecycle.toggleSource()}>
        {props.lifecycle.sourceRevealed ? 'Hide source' : 'Reveal source'}
      </button>
    </div>
  );
}

/**
 * The card for one pair of supplied values under the enclosing provider's trusted view. `isLive`
 * lets an owner that can end before React unmounts the card (an A2UI node) retire its controls at
 * once; a card used directly has no such owner.
 */
export function CardContent(props: FaithfulCardProps & { readonly isLive?: () => boolean }): ReactElement {
  const { contractVersion, markdown, isLive } = props;
  const view: FaithfulCardView | undefined = useContext(FaithfulCardViewContext);
  const lifecycle = useCardLifecycle(view, contractVersion, markdown, isLive);
  const reader = view?.reader;
  // Reading is pure and only cached here: the same reader and values always give the same result.
  const interpretation = useMemo<ReadResult | undefined>(() => reader?.read({ contractVersion, markdown }), [reader, contractVersion, markdown]);

  // Without a view that supplies the trusted reader and policy, nothing is interpreted or shown.
  if (view === undefined || interpretation === undefined) {
    return <Failure reason="no-view" message="This content cannot be shown: no content view is available." />;
  }
  if (!interpretation.ok) return <Failure reason={interpretation.failure.kind} message={describeContentFailure(interpretation.failure)} />;

  const strict = view.policy.level === 'strict';
  const rendering: Rendering = {
    policy: view.policy,
    strict,
    revealed: lifecycle.sourceRevealed,
    linkOutcomes: lifecycle.linkOutcomes,
    openLink: (ordinal, url) => lifecycle.openLink(view.hostLinks, ordinal, url),
  };
  return (
    <div className="saga-card" data-testid="card-root">
      {strict ? <Controls card={interpretation.card} lifecycle={lifecycle} /> : null}
      <div className="saga-card-content" data-testid="card-content">
        <Blocks nodes={interpretation.card.blocks} rendering={rendering} />
      </div>
    </div>
  );
}

/**
 * Shows the supplied Markdown under the enclosing {@link FaithfulCardProvider}'s trusted reader and
 * policy. Supplied values are untrusted: the reader validates them, and the card shows an explicit
 * failure, with nothing of any earlier content, when they are refused. Without a provider it
 * shows only that no view is available; it never interprets, fetches or navigates on its own.
 */
export function FaithfulCard(props: FaithfulCardProps): ReactElement {
  return <CardContent contractVersion={props.contractVersion} markdown={props.markdown} />;
}
