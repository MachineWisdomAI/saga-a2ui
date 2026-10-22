// @vitest-environment jsdom
import { NO_HOST_LINKS } from '@saga-a2ui/core/host-links';
import { createContentPolicy } from '@saga-a2ui/components/faithful-card';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import {
  createFaithfulCardView,
  FaithfulCard,
  FaithfulCardProvider,
} from './index.js';

// The factory an application calls once for its card. The card suites (card.test.ts and the rest)
// build their views through it, so they are its behavioral coverage; this file holds what only the
// factory decides.

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

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('createFaithfulCardView', () => {
  it('gives a provider a view that reads under the trusted dialect and bound', () => {
    mounted = mount();
    mounted.render(
      createElement(FaithfulCardProvider, {
        view: createFaithfulCardView(settings),
        children: [
          createElement(FaithfulCard, {
            key: 'ok',
            contractVersion: 1,
            markdown: '~~gone~~ **kept**',
          }),
          createElement(FaithfulCard, {
            key: 'long',
            contractVersion: 1,
            markdown: 'x'.repeat(201),
          }),
        ],
      }),
    );
    expect(mounted.container.querySelector('s')?.textContent).toBe('gone');
    expect(
      mounted.container
        .querySelector('[data-testid="card-failure"]')
        ?.getAttribute('data-reason'),
    ).toBe('too-long');
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

  it('gives every view its own consent scope', () => {
    const one = createFaithfulCardView(settings);
    const two = createFaithfulCardView(settings);
    one.consent.retire();
    expect(one.consent.retired).toBe(true);
    expect(two.consent.retired).toBe(false);
  });

  it('throws naming the setting when the reader settings are invalid, and builds no view', () => {
    expect(() =>
      createFaithfulCardView({ ...settings, dialect: 'markdown' as never }),
    ).toThrow(/dialect/);
    expect(() =>
      createFaithfulCardView({ ...settings, maxLength: Infinity }),
    ).toThrow(/maxLength/);
  });
});
