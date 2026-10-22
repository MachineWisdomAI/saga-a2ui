// @vitest-environment jsdom
import { NO_HOST_LINKS } from '@saga-a2ui/core/host-links';
import { createContentPolicy } from '@saga-a2ui/components/faithful-card';
import { describe, expect, it } from 'vitest';
import { createFaithfulCardView } from './index.js';

// The factory an application calls once for its card. What a card does with the view is covered
// by the card element tests; this holds what only the factory decides.

const created = createContentPolicy({
  level: 'standard',
  imageHosts: ['images.example.com'],
});
if (!created.ok) throw new Error(created.failure.message);
const policy = created.policy;
const settings = {
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 200,
  policy,
  contentSecurityPolicies: [] as string[],
  hostLinks: NO_HOST_LINKS,
} as const;

describe('createFaithfulCardView', () => {
  it('builds a reader that enforces the trusted dialect and bound', () => {
    const view = createFaithfulCardView(settings);
    const kept = view.reader.read({
      contractVersion: 1,
      markdown: '~~gone~~',
    });
    expect(kept.ok && kept.card.blocks[0]?.kind).toBe('paragraph');
    const tooLong = view.reader.read({
      contractVersion: 1,
      markdown: 'x'.repeat(201),
    });
    expect(tooLong.ok).toBe(false);
  });

  it('establishes image enforcement from the Content-Security-Policy values it is given, and from nothing else', () => {
    expect(createFaithfulCardView(settings).imageEnforcement).toBe(
      'unestablished',
    );
    expect(
      createFaithfulCardView({
        ...settings,
        contentSecurityPolicies: [policy.resource.contentSecurityPolicy],
      }).imageEnforcement,
    ).toBe('established');
  });

  it('hands over the policy and host links as given, with a consent scope of its own', () => {
    const one = createFaithfulCardView(settings);
    const two = createFaithfulCardView(settings);
    expect(one.policy).toBe(policy);
    expect(one.hostLinks).toBe(NO_HOST_LINKS);
    one.consent.retire();
    expect(one.consent.retired).toBe(true);
    expect(two.consent.retired).toBe(false);
  });

  it('throws naming the setting when the reader settings are invalid, and builds no view', () => {
    expect(() =>
      createFaithfulCardView({ ...settings, dialect: 'markdown' as never }),
    ).toThrow(/dialect/);
    expect(() =>
      createFaithfulCardView({ ...settings, maxLength: NaN }),
    ).toThrow(/maxLength/);
  });
});
