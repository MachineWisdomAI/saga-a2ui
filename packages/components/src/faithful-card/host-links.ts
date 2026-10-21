// How a card asks its host to open a link the content policy has already validated. The contract
// is renderer-neutral, so every renderer's card (Lit, React) and every application's host adapter
// share one definition and one set of reader-facing messages.

/**
 * What happened to a request to open a validated link.
 *
 * - `opened`: the host accepted the request.
 * - `denied`: the host refused it (user preference, blocked destination, cancelled).
 * - `unavailable`: the host offers no link-opening capability, so nothing was requested.
 * - `failed`: the request could not be completed (connection lost, timeout).
 *
 * Every outcome other than `opened` leaves the link inert; there is no other way to navigate.
 */
export type LinkOpenOutcome = 'opened' | 'denied' | 'unavailable' | 'failed';

/**
 * The only way content may leave the view: a request to the host to open a destination the
 * content policy has already validated. A view receives its own instance explicitly.
 */
export interface HostLinks {
  open(url: string): Promise<LinkOpenOutcome>;
}

/** For a page that has no host at all: every link stays inert and nothing navigates. */
export const NO_HOST_LINKS: HostLinks = Object.freeze({
  open: () => Promise.resolve<LinkOpenOutcome>('unavailable'),
});

const LINK_OUTCOME_MESSAGES: Record<LinkOpenOutcome, string> = {
  opened: '',
  denied: 'The host did not open this link.',
  unavailable: 'This host cannot open links.',
  failed: 'The link could not be opened.',
};

/**
 * The text a reader sees for a link request's outcome. A link that was not opened stays readable:
 * its destination follows as plain text.
 */
export function describeLinkOutcome(
  outcome: LinkOpenOutcome,
  url: string,
): string {
  return outcome === 'opened'
    ? LINK_OUTCOME_MESSAGES.opened
    : `${LINK_OUTCOME_MESSAGES[outcome]} Destination: ${url}`;
}
