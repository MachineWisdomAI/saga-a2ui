import type {
  ContentPolicy,
  FaithfulCardReader,
  HostLinks,
  ImageConsentScope,
  ImageEnforcement,
} from '@saga-a2ui/components/faithful-card';
import { createContext, useMemo, type ReactNode } from 'react';

/**
 * Everything a card needs from its application, supplied once and trusted: the reader (Markdown
 * dialect and content bound), the immutable content policy, the one way to ask the host to open a
 * link the policy validated, whether the image restrictions the policy relies on are demonstrably
 * in force in the mounted document, and this view's own scope for the reader's revocable image
 * consent. Content never supplies any of it, and nothing here is module-wide state, so two
 * providers never share or change each other's effects or consent.
 *
 * The consent scope is the one owner of view-wide revocation and is separate from the policy:
 * whoever observes a retirement signal for the view (a new selection, teardown) calls
 * `consent.revokeAll()` or `consent.retire()`. A card asks the scope only for its own grants and
 * gives them back when its content changes or it unmounts; it never revokes or retires the scope.
 */
export interface FaithfulCardView {
  readonly reader: FaithfulCardReader;
  readonly policy: ContentPolicy;
  readonly hostLinks: HostLinks;
  /** `establishImageEnforcement(policy, <the document's Content-Security-Policy values>)`; anything else keeps every image inert. */
  readonly imageEnforcement: ImageEnforcement;
  readonly consent: ImageConsentScope;
}

/** Without a provider the context is empty, and a card refuses to show anything. */
export const FaithfulCardViewContext = createContext<
  FaithfulCardView | undefined
>(undefined);

/**
 * Makes `view` the trusted settings of every FaithfulCard beneath it. The cards below it see a
 * view that is replaced only when one of its parts is: build those once and keep them stable,
 * because replacing one starts every card below from fresh state, as new content does, and ends
 * the consent that card had.
 */
export function FaithfulCardProvider(props: {
  readonly view: FaithfulCardView;
  readonly children: ReactNode;
}) {
  const { reader, policy, hostLinks, imageEnforcement, consent } = props.view;
  // Memoised only so that an unchanged set keeps one object identity across the application's
  // re-renders; a discarded memo costs a card its transient state, never correctness.
  const view = useMemo<FaithfulCardView>(
    () =>
      Object.freeze({ reader, policy, hostLinks, imageEnforcement, consent }),
    [reader, policy, hostLinks, imageEnforcement, consent],
  );
  return (
    <FaithfulCardViewContext.Provider value={view}>
      {props.children}
    </FaithfulCardViewContext.Provider>
  );
}
