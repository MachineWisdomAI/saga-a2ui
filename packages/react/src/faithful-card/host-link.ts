import { requestLinkOpen } from '@saga-a2ui/components/faithful-card';
import {
  describeLinkOutcome,
  type LinkOpenOutcome,
} from '@saga-a2ui/core/host-links';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { FaithfulCardViewContext, type FaithfulCardView } from './view.js';

/** What the host answered for a link, with the sentence a reader sees (empty when it opened). */
export interface HostLinkOutcome {
  readonly kind: LinkOpenOutcome;
  readonly message: string;
}

export interface HostLink {
  /** Whether the enclosing view's policy lets this link be activated. False without a view. */
  readonly allowed: boolean;
  /**
   * Asks the host to open the link, if the policy still allows it: exactly one host request per
   * call, and none when it does not. Resolves once the answer has been shown or dropped.
   */
  open(): Promise<void>;
  /** The host's answer to the latest activation, until the link or the view's selection is replaced. */
  readonly outcome: HostLinkOutcome | undefined;
}

interface Answer {
  readonly view: FaithfulCardView;
  readonly url: string;
  readonly outcome: HostLinkOutcome;
}

/**
 * The card's own link rules for a link an application renders itself, for example in its chrome.
 * The policy of the enclosing {@link FaithfulCardProvider}'s view decides, at activation; that
 * view's host links are asked; the outcome is worded by `describeLinkOutcome`. An answer is shown
 * only while the link it was asked about stands: a replaced `url` or view, an unmounted component
 * and a new selection (the view ending its consent) each drop it. Outside a provider nothing is
 * allowed and nothing throws.
 */
export function useHostLink(url: string): HostLink {
  const view = useContext(FaithfulCardViewContext);
  const allowed = view?.policy.decideLink(url).allowed === true;

  // Advances whenever the link stops being the one an answer may be shown for. It is read when an
  // answer arrives and written only by effects, never in render.
  const generation = useRef(0);
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  useEffect(() => {
    generation.current += 1;
    setAnswer(undefined);
    return () => {
      generation.current += 1;
    };
  }, [view, url]);
  const scope = view?.consent;
  useEffect(() => {
    const subscription = scope?.subscribe(() => {
      generation.current += 1;
      setAnswer(undefined);
    });
    return () => subscription?.unsubscribe();
  }, [scope]);

  const open = useCallback(async (): Promise<void> => {
    if (view === undefined) return;
    const decision = view.policy.decideLink(url);
    if (!decision.allowed) return;
    const asked = generation.current;
    const outcome = await requestLinkOpen(view.hostLinks, decision.url);
    if (generation.current !== asked) return;
    setAnswer({
      view,
      url,
      outcome: {
        kind: outcome,
        message: describeLinkOutcome(outcome, decision.url),
      },
    });
  }, [view, url]);

  return {
    allowed,
    open,
    // An answer shown for another link is never shown, even for the render before the effect clears it.
    outcome:
      answer?.view === view && answer?.url === url ? answer.outcome : undefined,
  };
}
