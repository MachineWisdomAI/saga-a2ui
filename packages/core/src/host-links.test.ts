import { describe, expect, it } from 'vitest';
import {
  describeLinkOutcome,
  NO_HOST_LINKS,
  type LinkOpenOutcome,
} from './host-links.js';

describe('the host link request contract', () => {
  it('has no host at all by default: every request is unavailable and nothing is opened', async () => {
    await expect(
      NO_HOST_LINKS.open('https://docs.example.com/guide'),
    ).resolves.toBe('unavailable');
    expect(Object.isFrozen(NO_HOST_LINKS)).toBe(true);
  });

  it('keeps successful link requests silent', () => {
    expect(
      describeLinkOutcome('opened', 'https://docs.example.com/guide'),
    ).toBe('');
  });

  it('keeps the destination readable as plain text whenever a link was not opened', () => {
    const url = 'https://docs.example.com/guide';
    const refused: Array<[LinkOpenOutcome, string]> = [
      ['denied', 'The host did not open this link.'],
      ['unavailable', 'This host cannot open links.'],
      ['failed', 'The link could not be opened.'],
    ];
    for (const [outcome, sentence] of refused) {
      expect(describeLinkOutcome(outcome, url), outcome).toBe(
        `${sentence} Destination: ${url}`,
      );
    }
  });
});
