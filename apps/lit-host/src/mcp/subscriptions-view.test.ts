import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { SIGN_IN_REQUIRED_TEXT, type SubscriptionsResult } from './subscriptions.js';
import { connectSubscriptionsView, type SubscriptionsViewState } from './subscriptions-view.js';

// The view's private-data handling, exercised with a real App/AppBridge pair. The observable
// result is the state the presenter is told to show.

const result = (displayName: string, viewSession: string, creators: string[] = ['Creator']): SubscriptionsResult => ({
  displayName,
  viewSession,
  subscriptions: creators.map((creator, index) => ({
    subscriptionId: `sub-${index}`,
    creator,
    tier: 'Gold',
    status: 'active' as const,
  })),
});
const delivery = (value: SubscriptionsResult) => ({
  content: [{ type: 'text' as const, text: 'ok' }],
  structuredContent: value,
});

const toClean: { app: App; bridge: AppBridge }[] = [];

async function harness() {
  const states: SubscriptionsViewState[] = [];
  const app = new App({ name: 'test-view', version: '0.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
  toClean.push({ app, bridge });
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  const view = await connectSubscriptionsView({ app, transport: viewSide, show: (state) => states.push(state) });
  return { bridge, view, states, last: () => states.at(-1) };
}

afterEach(async () => {
  for (const { app, bridge } of toClean.splice(0)) {
    await app.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
});

describe('subscriptions view', () => {
  it('shows the signed-in user’s subscriptions', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({ kind: 'subscriptions', subscriptions: { displayName: 'Alice' } });
  });

  it('shows a sign-in-required state and no private data when the tool reports it', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa')));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: SIGN_IN_REQUIRED_TEXT }] });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');
  });

  it('clears the private view on any other failure', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa')));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: 'Subscriptions are unavailable.' }] });
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).not.toContain('Alice');
  });

  it.each([
    ['an unknown field', { ...result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa'), email: 'x@example.invalid' }],
    ['a missing session label', { displayName: 'Alice', subscriptions: [] }],
    ['a label that is not opaque-shaped', { ...result('Alice', 'alice-token') }],
  ])('treats %s as an unknown session and shows nothing private', async (_name, bad) => {
    const h = await harness();
    await h.bridge.sendToolResult({ content: [], structuredContent: bad });
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.states)).not.toContain('Alice');
  });

  it('clears the private view when the session label changes, and stays cleared', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult(delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])));
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).not.toMatch(/Bob|Alice|Creator/);

    // The label is not authorization: even the original label no longer revives the view.
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa')));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.last()?.kind).toBe('problem');
  });

  it('accepts a fresh result with the same label as a refresh', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One', 'Creator Two'])));
    await expect.poll(() => (h.last() as { subscriptions?: SubscriptionsResult })?.subscriptions?.subscriptions.length).toBe(2);
  });

  it('keeps the view cleared after a failure until a new call starts a round trip', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: SIGN_IN_REQUIRED_TEXT }] });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');

    // A delayed copy of the earlier authorized result arrives while the view is invalid: it must
    // not become the new trusted first label, because no new call started it.
    const shown = h.states.length;
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown); // nothing was shown
    expect(h.last()?.kind).toBe('sign-in-required');

    // A fresh authenticated round trip reestablishes the private view.
    await h.bridge.sendToolInput({ arguments: {} });
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({ kind: 'subscriptions', subscriptions: { displayName: 'Alice' } });
  });

  it('an unrelated error does not unlock the view after a session mismatch', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult(delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])));
    await expect.poll(() => h.last()?.kind).toBe('problem');

    await h.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: 'Subscriptions are unavailable.' }] });
    await expect.poll(() => h.last()?.kind).toBe('problem');

    // The prior session's result still cannot revive the view without a fresh round trip.
    const shown = h.states.length;
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown); // nothing was shown
    expect(h.last()?.kind).toBe('problem');

    // A fresh round trip with the current session's label recovers safely.
    await h.bridge.sendToolInput({ arguments: {} });
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
  });

  it('ignores results after disposal', async () => {
    const h = await harness();
    h.view.dispose();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa'))).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states).toEqual([]);
  });
});
