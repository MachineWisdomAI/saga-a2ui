import type { HostLinks, LinkOpenOutcome } from '@saga-a2ui/core/host-links';

/**
 * Asks the host to open a validated link and always answers with an outcome. An adapter that
 * throws or rejects has not opened the link, so the reader is told `failed`. Every renderer's
 * link activation goes through this, so the rule has one owner.
 */
export async function requestLinkOpen(
  hostLinks: HostLinks,
  url: string,
): Promise<LinkOpenOutcome> {
  try {
    return await hostLinks.open(url);
  } catch {
    return 'failed';
  }
}
