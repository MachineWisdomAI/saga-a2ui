import { describe, expect, it } from 'vitest';
import type { PanelData } from '../saga-panel/fixture.js';
import { createEpisodeView, NO_EPISODE } from './view.js';

// What the episode view decides about each delivered result. Delivery order, holding an early
// result and ending are the stack's (packages/*-mcp-stack tests); the page that composes them is
// exercised in a real browser by e2e/mcp-view.spec.ts. The observable result is the panel data
// asked for, the problem text shown, and when image consent is revoked relative to them.

const episode = (id: string, title: string) => ({
  content: [{ type: 'text' as const, text: title }],
  structuredContent: { episodeId: id, title, description: `About ${title}` },
});

function harness(rejectWith?: () => string | undefined) {
  const events: string[] = [];
  const updates: PanelData[] = [];
  const problems: (string | undefined)[] = [];
  const view = createEpisodeView({
    update(data) {
      events.push('update');
      updates.push(data);
      const rejection = rejectWith?.();
      return rejection === undefined
        ? { ok: true }
        : { ok: false, failure: { kind: 'rejected', message: rejection } };
    },
    showProblem: (message) => void problems.push(message),
    revokeImageConsent: () => void events.push('revoke'),
  });
  return { view, events, updates, problems };
}

describe('episode view result handling', () => {
  it('shows a delivered episode with its title and description and no problem', () => {
    const h = harness();
    h.view.onToolResult(episode('ep-001', 'First'));
    expect(h.updates).toEqual([{ title: 'First', description: 'About First' }]);
    expect(h.problems).toEqual([undefined]);
  });

  it('replaces the shown episode with a later result', () => {
    const h = harness();
    h.view.onToolResult(episode('ep-001', 'First'));
    h.view.onToolResult(episode('ep-002', 'Second'));
    expect(h.updates.at(-1)).toEqual({
      title: 'Second',
      description: 'About Second',
    });
  });

  it.each([
    [
      'an error result',
      { isError: true, content: [{ type: 'text' as const, text: 'nope' }] },
    ],
    [
      'a result that is not a public episode',
      { content: [], structuredContent: { surprise: true } },
    ],
    [
      'a result with extra private fields',
      {
        content: [],
        structuredContent: {
          ...episode('x', 'T').structuredContent,
          secret: 1,
        },
      },
    ],
    [
      'a result without structured content',
      { content: [{ type: 'text' as const, text: 'plain' }] },
    ],
  ])('empties the panel and shows a fallback for %s', (_name, bad) => {
    const h = harness();
    h.view.onToolResult(episode('ep-001', 'First'));
    h.view.onToolResult(bad);
    expect(h.updates.at(-1)).toEqual(NO_EPISODE);
    expect(h.problems.at(-1)).toEqual(expect.any(String));
    expect(h.problems.at(-1)).not.toBe('');
    expect(JSON.stringify([h.updates.at(-1), h.problems])).not.toContain(
      'secret',
    );
  });

  it('shows the next valid result after a failure and clears the fallback', () => {
    const h = harness();
    h.view.onToolResult({ isError: true, content: [] });
    h.view.onToolResult(episode('ep-002', 'Recovered'));
    expect(h.updates.at(-1)).toEqual({
      title: 'Recovered',
      description: 'About Recovered',
    });
    expect(h.problems.at(-1)).toBeUndefined();
  });

  it('keeps showing nothing across repeated failures', () => {
    const h = harness();
    h.view.onToolResult({ isError: true, content: [] });
    h.view.onToolResult({ isError: true, content: [] });
    expect(h.updates).toEqual([NO_EPISODE, NO_EPISODE]);
    expect(h.problems).toHaveLength(2);
  });

  it.each([
    ['a valid result', episode('ep-001', 'First')],
    ['an error result', { isError: true, content: [] }],
    [
      'a result that is not a public episode',
      { content: [], structuredContent: { surprise: true } },
    ],
  ])('revokes image consent before it applies %s', (_name, result) => {
    const h = harness();
    h.view.onToolResult(result);
    expect(h.events[0]).toBe('revoke');
  });

  it('starts a new consent period for every result, even a repeat of the one shown', () => {
    const h = harness();
    h.view.onToolResult(episode('ep-001', 'Same'));
    h.view.onToolResult(episode('ep-001', 'Same'));
    expect(h.events).toEqual(['revoke', 'update', 'revoke', 'update']);
  });

  it('empties the panel and shows the reason when the surface rejects a later result', () => {
    let rejection: string | undefined;
    const h = harness(() => rejection);
    h.view.onToolResult(episode('ep-001', 'Before'));
    rejection = 'Controlled surface rejection';
    h.view.onToolResult(episode('ep-002', 'Rejected'));
    // The rejected data is followed by the emptied panel; the rejection is what is told.
    expect(h.updates.at(-1)).toEqual(NO_EPISODE);
    expect(h.problems.at(-1)).toBe('Controlled surface rejection');
    rejection = undefined;
    h.view.onToolResult(episode('ep-003', 'Recovered'));
    expect(h.updates.at(-1)).toEqual({
      title: 'Recovered',
      description: 'About Recovered',
    });
    expect(h.problems.at(-1)).toBeUndefined();
  });
});
