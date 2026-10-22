import { describe, expect, it } from 'vitest';
import { createCardView, type CardViewSettings } from './card-view.js';
import { NO_HOST_LINKS } from './host-links.js';
import { createContentPolicy, type ContentPolicy } from './policy.js';

// The trusted parts of a card's view, established from values the caller passes in. Nothing here
// reads a document: the Content-Security-Policy values are data.

function policy(imageHosts: readonly string[] = []): ContentPolicy {
  const created = createContentPolicy({
    level: 'standard',
    imageHosts: [...imageHosts],
  });
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
}

const settings = (over: Partial<CardViewSettings> = {}): CardViewSettings => ({
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 1000,
  policy: policy(),
  contentSecurityPolicies: [],
  hostLinks: NO_HOST_LINKS,
  ...over,
});

describe('createCardView', () => {
  it('builds a reader that enforces the trusted dialect and bound', () => {
    const view = createCardView(settings({ maxLength: 20 }));
    const ok = view.reader.read({ contractVersion: 1, markdown: 'short' });
    expect(ok.ok).toBe(true);
    const tooLong = view.reader.read({
      contractVersion: 1,
      markdown: 'x'.repeat(21),
    });
    expect(tooLong.ok).toBe(false);
  });

  it('hands over the caller’s policy and host links unchanged', () => {
    const one = policy();
    const view = createCardView(settings({ policy: one }));
    expect(view.policy).toBe(one);
    expect(view.hostLinks).toBe(NO_HOST_LINKS);
  });

  it('establishes image enforcement only from the Content-Security-Policy values it is given', () => {
    const withImages = policy(['images.example.com']);
    expect(
      createCardView(settings({ policy: withImages })).imageEnforcement,
    ).toBe('unestablished');
    const derived = withImages.resource.contentSecurityPolicy;
    expect(typeof derived).toBe('string');
    expect(
      createCardView(
        settings({ policy: withImages, contentSecurityPolicies: [derived] }),
      ).imageEnforcement,
    ).toBe('established');
  });

  it('gives each view a fresh consent scope', () => {
    const first = createCardView(settings());
    const second = createCardView(settings());
    expect(first.consent).not.toBe(second.consent);
    first.consent.retire();
    expect(first.consent.retired).toBe(true);
    expect(second.consent.retired).toBe(false);
  });

  it('refuses an unsupported dialect, naming the setting, and builds no view', () => {
    expect(() =>
      createCardView(settings({ dialect: 'markdown' as never })),
    ).toThrow(/dialect/);
  });

  it('refuses a non-finite or non-positive bound, naming the setting', () => {
    for (const maxLength of [Infinity, NaN, 0, -3, 1.5]) {
      expect(
        () => createCardView(settings({ maxLength })),
        String(maxLength),
      ).toThrow(/maxLength/);
    }
  });
});
