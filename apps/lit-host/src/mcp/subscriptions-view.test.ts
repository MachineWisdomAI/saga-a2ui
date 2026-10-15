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

async function harness(capabilities: { serverTools?: Record<string, never> } = {}) {
  const states: SubscriptionsViewState[] = [];
  const app = new App({ name: 'test-view', version: '0.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, capabilities);
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

  it('stays cleared after a failure until a correlated authenticated response arrives', async () => {
    const h = await harness({ serverTools: {} });
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: SIGN_IN_REQUIRED_TEXT }] });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');

    // A delayed copy of the earlier authorized result arrives while the view is invalid. No
    // correlated response has arrived, so it must not become the new trusted label.
    const shown = h.states.length;
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');

    h.bridge.oncalltool = async () => delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One']));
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({ kind: 'subscriptions', subscriptions: { displayName: 'Alice' } });
  });

  it('an unrelated error does not unlock the view after a session mismatch', async () => {
    const h = await harness({ serverTools: {} });
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult(delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])));
    await expect.poll(() => h.last()?.kind).toBe('problem');

    await h.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: 'Subscriptions are unavailable.' }] });
    await expect.poll(() => h.last()?.kind).toBe('problem');

    // The prior session's result still cannot revive the view without a correlated response.
    const shown = h.states.length;
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('problem');

    h.bridge.oncalltool = async () => delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One']));
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
  });

  it('a tool input does not authenticate the next notification; only the correlated response recovers', async () => {
    const h = await harness({ serverTools: {} });
    let release: (value: ReturnType<typeof delivery>) => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const callStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    h.bridge.oncalltool = () => {
      markStarted();
      return new Promise((resolve) => {
        release = resolve;
      });
    };

    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: SIGN_IN_REQUIRED_TEXT }] });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');

    // The host reports a new call, then a delayed copy of the earlier result arrives before that
    // call's authenticated response. The copy must not become the new trusted label.
    await h.bridge.sendToolInput({ arguments: {} });
    const shown = h.states.length;
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    await callStarted;
    release(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator Two'])));
    await expect.poll(() => (h.last() as { subscriptions?: SubscriptionsResult })?.subscriptions?.subscriptions[0]?.creator).toBe('Creator Two');
  });

  it('an older in-flight read cannot take a later read’s identity after a refusal', async () => {
    const h = await harness({ serverTools: {} });
    const pending: {
      resolve: (value: ReturnType<typeof delivery>) => void;
      reject: (error: Error) => void;
    }[] = [];
    h.bridge.oncalltool = () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });

    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    // A stays in flight. B is a newer read that refuses and clears the view. C is the current
    // read. A's generation must not be reusable just because B's refusal returned the view to idle.
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => pending.length).toBe(1);
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => pending.length).toBe(2);
    pending[1]?.reject(new Error('listener refused the proxied tools/call'));
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => pending.length).toBe(3);
    const shown = h.states.length;
    pending[0]?.resolve(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    pending[2]?.resolve(delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({ kind: 'subscriptions', subscriptions: { displayName: 'Bob' } });
    expect(JSON.stringify(h.last())).not.toContain('Alice');
  });

  it.each([
    [
      'a sign-in-required error',
      { isError: true, content: [{ type: 'text' as const, text: SIGN_IN_REQUIRED_TEXT }] },
      'sign-in-required' as const,
    ],
    [
      'a changed view-session label',
      delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])),
      'problem' as const,
    ],
    [
      'an unknown session shape',
      { content: [], structuredContent: { displayName: 'Alice', subscriptions: [] } },
      'problem' as const,
    ],
  ])('session loss via %s clears immediately while a read is pending, and only a later correlated read recovers', async (_name, loss, clearedKind) => {
    const h = await harness({ serverTools: {} });
    const pending: { resolve: (value: ReturnType<typeof delivery>) => void }[] = [];
    h.bridge.oncalltool = () => new Promise((resolve) => {
      pending.push({ resolve });
    });

    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    // A is in flight. The host then reports session loss on the notification path. That evidence
    // must clear the private view now; it is not stale positive data to suppress.
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => pending.length).toBe(1);
    await h.bridge.sendToolResult(loss);
    await expect.poll(() => h.last()?.kind).toBe(clearedKind);
    expect(JSON.stringify(h.last())).not.toMatch(/Alice|Bob|Creator/);

    // The read that started before the loss cannot put Alice back.
    pending[0]?.resolve(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.last()?.kind).toBe(clearedKind);
    expect(JSON.stringify(h.last())).not.toMatch(/Alice|Bob|Creator/);

    // A correlated read started after the loss is the only recovery. It must show Bob, not a
    // session-mismatch leftover from the pin the loss should have cleared.
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => pending.length).toBe(2);
    pending[1]?.resolve(delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({ kind: 'subscriptions', subscriptions: { displayName: 'Bob' } });
    expect(JSON.stringify(h.last())).not.toContain('Alice');
  });

  it('a refused correlated read clears the private view, and a later notification cannot revive it', async () => {
    const h = await harness({ serverTools: {} });
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    h.bridge.oncalltool = () => Promise.reject(new Error('listener refused the proxied tools/call'));
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    const shown = h.states.length;
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');
  });

  it('ignores results after disposal', async () => {
    const h = await harness();
    h.view.dispose();
    await h.bridge.sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa'))).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states).toEqual([]);
  });
});
