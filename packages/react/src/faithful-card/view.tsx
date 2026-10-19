import type { ContentPolicy, FaithfulCardReader, HostLinks } from '@saga-a2ui/components/faithful-card';
import { createContext, useMemo, type ReactNode } from 'react';

/**
 * Everything a card needs from its application, supplied once and trusted: the reader (Markdown
 * dialect and content bound), the immutable content policy, and the one way to ask the host to open
 * a link the policy validated. Content never supplies any of it, and nothing here is module-wide
 * state, so two providers never share or change each other's effects.
 *
 * Image loading and consent are not part of this view yet: a card in this renderer never fetches
 * an image reference.
 */
export interface FaithfulCardView {
  readonly reader: FaithfulCardReader;
  readonly policy: ContentPolicy;
  readonly hostLinks: HostLinks;
}

/** Without a provider the context is empty, and a card refuses to show anything. */
export const FaithfulCardViewContext = createContext<FaithfulCardView | undefined>(undefined);

/**
 * Makes `view` the trusted settings of every FaithfulCard beneath it. The cards below it see a
 * view that is replaced only when its reader, policy or host-link adapter is: build those once and
 * keep them stable, because replacing one starts every card below from fresh state, as new content
 * does.
 */
export function FaithfulCardProvider(props: { readonly view: FaithfulCardView; readonly children: ReactNode }) {
  const { reader, policy, hostLinks } = props.view;
  // Memoised only so that an unchanged trio keeps one object identity across the application's
  // re-renders; a discarded memo costs a card its transient state, never correctness.
  const view = useMemo<FaithfulCardView>(() => Object.freeze({ reader, policy, hostLinks }), [reader, policy, hostLinks]);
  return <FaithfulCardViewContext.Provider value={view}>{props.children}</FaithfulCardViewContext.Provider>;
}
