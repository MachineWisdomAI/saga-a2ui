import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_SUBSCRIPTIONS_TEXT,
  INVALID_OUTPUT_TEXT,
  INVALID_SUBSCRIPTION_INPUT_TEXT,
  SIGN_IN_REQUIRED_TEXT,
  SUBSCRIPTION_LIMITS,
  SUBSCRIPTIONS_TOOL_NAME,
  SUBSCRIPTIONS_UNAVAILABLE_TEXT,
  type Subscription,
  type SubscriptionsResult,
} from './subscriptions.js';
import {
  connectSubscriptionsView,
  type SubscriptionsViewState,
} from './subscriptions-view.js';

// The view's private-data handling, exercised with a real App/AppBridge pair. The observable
// result is the state the presenter is told to show.

const result = (
  displayName: string,
  viewSession: string,
  creators: string[] = ['Creator'],
): SubscriptionsResult => ({
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

async function harness(
  capabilities: { serverTools?: Record<string, never> } = {},
) {
  const states: SubscriptionsViewState[] = [];
  const app = new App(
    { name: 'test-view', version: '0.0.0' },
    {},
    { autoResize: false },
  );
  const bridge = new AppBridge(
    null,
    { name: 'test-host', version: '0.0.0' },
    capabilities,
  );
  toClean.push({ app, bridge });
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  const view = await connectSubscriptionsView({
    app,
    transport: viewSide,
    show: (state) => states.push(state),
  });
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
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({
      kind: 'subscriptions',
      subscriptions: { displayName: 'Alice' },
    });
  });

  it('shows a sign-in-required state and no private data when the tool reports it', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa')),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: SIGN_IN_REQUIRED_TEXT }],
    });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');
  });

  it('clears the private view on any other failure', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa')),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: 'The subscriptions read failed.' }],
    });
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).not.toContain('Alice');
  });

  it.each([
    [
      'an unknown field',
      {
        ...result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa'),
        email: 'x@example.invalid',
      },
    ],
    ['a missing session label', { displayName: 'Alice', subscriptions: [] }],
    [
      'a label that is not opaque-shaped',
      { ...result('Alice', 'alice-token') },
    ],
  ])(
    'treats %s as an unknown session and shows nothing private',
    async (_name, bad) => {
      const h = await harness();
      await h.bridge.sendToolResult({ content: [], structuredContent: bad });
      await expect.poll(() => h.last()?.kind).toBe('problem');
      expect(JSON.stringify(h.states)).not.toContain('Alice');
    },
  );

  it('clears the private view when the session label changes, and stays cleared', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult(
      delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).not.toMatch(/Bob|Alice|Creator/);

    // The label is not authorization: even the original label no longer revives the view.
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa')),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.last()?.kind).toBe('problem');
  });

  it('accepts a fresh result with the same label as a refresh', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await h.bridge.sendToolResult(
      delivery(
        result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', [
          'Creator One',
          'Creator Two',
        ]),
      ),
    );
    await expect
      .poll(
        () =>
          (h.last() as { subscriptions?: SubscriptionsResult })?.subscriptions
            ?.subscriptions.length,
      )
      .toBe(2);
  });

  it('stays cleared after a failure until a correlated authenticated response arrives', async () => {
    const h = await harness({ serverTools: {} });
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: SIGN_IN_REQUIRED_TEXT }],
    });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');

    // A delayed copy of the earlier authorized result arrives while the view is invalid. No
    // correlated response has arrived, so it must not become the new trusted label.
    const shown = h.states.length;
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');

    h.bridge.oncalltool = async () =>
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One']));
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({
      kind: 'subscriptions',
      subscriptions: { displayName: 'Alice' },
    });
  });

  it('an unrelated error does not unlock the view after a session mismatch', async () => {
    const h = await harness({ serverTools: {} });
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    await h.bridge.sendToolResult(
      delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('problem');

    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: 'The subscriptions read failed.' }],
    });
    await expect.poll(() => h.last()?.kind).toBe('problem');

    // The prior session's result still cannot revive the view without a correlated response.
    const shown = h.states.length;
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('problem');

    h.bridge.oncalltool = async () =>
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One']));
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

    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: SIGN_IN_REQUIRED_TEXT }],
    });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');

    // The host reports a new call, then a delayed copy of the earlier result arrives before that
    // call's authenticated response. The copy must not become the new trusted label.
    await h.bridge.sendToolInput({ arguments: {} });
    const shown = h.states.length;
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    await callStarted;
    release(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator Two'])),
    );
    await expect
      .poll(
        () =>
          (h.last() as { subscriptions?: SubscriptionsResult })?.subscriptions
            ?.subscriptions[0]?.creator,
      )
      .toBe('Creator Two');
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

    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
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
    pending[0]?.resolve(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    pending[2]?.resolve(
      delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({
      kind: 'subscriptions',
      subscriptions: { displayName: 'Bob' },
    });
    expect(JSON.stringify(h.last())).not.toContain('Alice');
  });

  it.each([
    [
      'a sign-in-required error',
      {
        isError: true,
        content: [{ type: 'text' as const, text: SIGN_IN_REQUIRED_TEXT }],
      },
      'sign-in-required' as const,
    ],
    [
      'a changed view-session label',
      delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])),
      'problem' as const,
    ],
    [
      'an unknown session shape',
      {
        content: [],
        structuredContent: { displayName: 'Alice', subscriptions: [] },
      },
      'problem' as const,
    ],
  ])(
    'session loss via %s clears immediately while a read is pending, and only a later correlated read recovers',
    async (_name, loss, clearedKind) => {
      const h = await harness({ serverTools: {} });
      const pending: {
        resolve: (value: ReturnType<typeof delivery>) => void;
      }[] = [];
      h.bridge.oncalltool = () =>
        new Promise((resolve) => {
          pending.push({ resolve });
        });

      await h.bridge.sendToolResult(
        delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
      );
      await expect.poll(() => h.last()?.kind).toBe('subscriptions');

      // A is in flight. The host then reports session loss on the notification path. That evidence
      // must clear the private view now; it is not stale positive data to suppress.
      await h.bridge.sendToolInput({ arguments: {} });
      await expect.poll(() => pending.length).toBe(1);
      await h.bridge.sendToolResult(loss);
      await expect.poll(() => h.last()?.kind).toBe(clearedKind);
      expect(JSON.stringify(h.last())).not.toMatch(/Alice|Bob|Creator/);

      // The read that started before the loss cannot put Alice back.
      pending[0]?.resolve(
        delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(h.last()?.kind).toBe(clearedKind);
      expect(JSON.stringify(h.last())).not.toMatch(/Alice|Bob|Creator/);

      // A correlated read started after the loss is the only recovery. It must show Bob, not a
      // session-mismatch leftover from the pin the loss should have cleared.
      await h.bridge.sendToolInput({ arguments: {} });
      await expect.poll(() => pending.length).toBe(2);
      pending[1]?.resolve(
        delivery(result('Bob', 'vs_bbbbbbbbbbbbbbbbbbbbbb', ['Creator Three'])),
      );
      await expect.poll(() => h.last()?.kind).toBe('subscriptions');
      expect(h.last()).toMatchObject({
        kind: 'subscriptions',
        subscriptions: { displayName: 'Bob' },
      });
      expect(JSON.stringify(h.last())).not.toContain('Alice');
    },
  );

  it('a refused correlated read clears the private view, and a later notification cannot revive it', async () => {
    const h = await harness({ serverTools: {} });
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');

    h.bridge.oncalltool = () =>
      Promise.reject(new Error('listener refused the proxied tools/call'));
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => h.last()?.kind).toBe('sign-in-required');
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    const shown = h.states.length;
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);
    expect(h.last()?.kind).toBe('sign-in-required');
  });

  it('ignores results after disposal', async () => {
    const h = await harness();
    h.view.dispose();
    await h.bridge
      .sendToolResult(delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa')))
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states).toEqual([]);
  });

  it('shows an empty successful read instead of stale rows', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult(
      delivery({
        ...result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa'),
        subscriptions: [],
      }),
    );
    await expect.poll(() => h.last()?.kind).toBe('empty');
    expect(h.last()).toMatchObject({ kind: 'empty', displayName: 'Alice' });
    expect(JSON.stringify(h.last())).toContain(EMPTY_SUBSCRIPTIONS_TEXT);
    expect(JSON.stringify(h.last())).not.toContain('Creator');
  });

  it('shows retry for a backend failure and clears private values', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: SUBSCRIPTIONS_UNAVAILABLE_TEXT }],
    });
    await expect.poll(() => h.last()?.kind).toBe('retry');
    expect(JSON.stringify(h.last())).not.toMatch(/Alice|Creator/);
    expect(JSON.stringify(h.last())).toContain(SUBSCRIPTIONS_UNAVAILABLE_TEXT);
  });

  it('clears the view for invalid projected output and invalid business input', async () => {
    const h = await harness();
    await h.bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: INVALID_OUTPUT_TEXT }],
    });
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).toContain(INVALID_OUTPUT_TEXT);
    expect(JSON.stringify(h.last())).not.toContain('Alice');

    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: INVALID_SUBSCRIPTION_INPUT_TEXT }],
    });
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).toContain(INVALID_SUBSCRIPTION_INPUT_TEXT);
    expect(JSON.stringify(h.last())).not.toContain('not-a-status');
  });

  it('rejects an oversized incoming result before showing any of it', async () => {
    const h = await harness();
    const huge = 'x'.repeat(SUBSCRIPTION_LIMITS.maxIncomingStateBytes);
    await h.bridge.sendToolResult({
      content: [{ type: 'text', text: huge }],
      structuredContent: {
        ...result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa'),
        note: huge,
      },
    });
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.states)).not.toContain(huge);
    expect(JSON.stringify(h.states)).not.toContain('Alice');
  });

  it('retains a selection that is still present and clears it when the read is uncertain', async () => {
    const h = await harness({ serverTools: {} });
    const listed = (ids: string[]): SubscriptionsResult => ({
      displayName: 'Alice',
      viewSession: 'vs_aaaaaaaaaaaaaaaaaaaaaa',
      subscriptions: ids.map((subscriptionId) => ({
        subscriptionId,
        creator: subscriptionId === 'sub-keep' ? 'Creator One' : 'Creator Two',
        tier: 'Gold',
        status: 'active' as const,
      })),
    });
    await h.bridge.sendToolResult(delivery(listed(['sub-keep', 'sub-drop'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    h.view.select('sub-keep');
    expect(h.last()).toMatchObject({
      kind: 'subscriptions',
      selectedId: 'sub-keep',
    });

    await h.bridge.sendToolResult(delivery(listed(['sub-keep', 'sub-drop'])));
    await expect
      .poll(() => (h.last() as { selectedId?: string }).selectedId)
      .toBe('sub-keep');

    await h.bridge.sendToolResult(delivery(listed(['sub-drop'])));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(JSON.stringify(h.last())).not.toContain('sub-keep');

    h.view.select('sub-drop');
    await h.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: SUBSCRIPTIONS_UNAVAILABLE_TEXT }],
    });
    await expect.poll(() => h.last()?.kind).toBe('retry');
    expect(JSON.stringify(h.last())).not.toContain('sub-drop');
  });

  it('retries only the safe read and ignores a late result after the bound', async () => {
    const states: SubscriptionsViewState[] = [];
    const app = new App(
      { name: 'test-view', version: '0.0.0' },
      {},
      { autoResize: false },
    );
    const bridge = new AppBridge(
      null,
      { name: 'test-host', version: '0.0.0' },
      { serverTools: {} },
    );
    toClean.push({ app, bridge });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge.connect(hostSide);
    let release: (value: ReturnType<typeof delivery>) => void = () => undefined;
    const seen: { name?: string; arguments?: Record<string, unknown> }[] = [];
    bridge.oncalltool = (params) => {
      seen.push(params);
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const view = await connectSubscriptionsView({
      app,
      transport: viewSide,
      show: (state) => states.push(state),
      readBoundMs: 30,
    });
    await bridge.sendToolResult(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await expect.poll(() => states.at(-1)?.kind).toBe('subscriptions');
    view.select('sub-0');
    view.retry();
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toMatchObject({
      name: 'list_subscriptions',
      arguments: {},
    });
    expect(seen[0]?.arguments).not.toHaveProperty('status');
    await expect.poll(() => states.at(-1)?.kind).toBe('retry');
    expect(JSON.stringify(states.at(-1))).not.toMatch(/Alice|Creator|sub-0/);
    const shown = states.length;
    release(
      delivery(result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', ['Creator One'])),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(states.length).toBe(shown);
    expect(states.at(-1)?.kind).toBe('retry');
  });
});

// The declared status filter: a host tool input carries the business arguments of the call the
// host is starting. The view forwards only the declared optional `status` filter, so the read it
// starts keeps the filter the host named. A filtered read that returns no rows stays empty.
describe('declared status filter in host-initiated reads', () => {
  const active: Subscription = {
    subscriptionId: 'b1',
    creator: 'Creator One',
    tier: 'Gold',
    status: 'active',
  };
  const paused: Subscription = {
    subscriptionId: 'b2',
    creator: 'Creator Two',
    tier: 'Silver',
    status: 'paused',
  };
  const account: SubscriptionsResult = {
    displayName: 'Bob',
    viewSession: 'vs_bbbbbbbbbbbbbbbbbbbbbb',
    subscriptions: [active, paused],
  };

  type Call = { name?: string; arguments?: Record<string, unknown> };

  /** A host that proxies each read to the real tool: the arguments decide which rows come back. */
  async function filteredHost(
    rows: readonly Subscription[] = account.subscriptions,
  ) {
    const h = await harness({ serverTools: {} });
    const calls: Call[] = [];
    h.bridge.oncalltool = (params) => {
      calls.push(params);
      const status = params.arguments?.status;
      return Promise.resolve(
        delivery({
          ...account,
          subscriptions: rows.filter(
            (item) => status === undefined || item.status === status,
          ),
        }),
      );
    };
    return { ...h, calls };
  }

  it('keeps the declared filter, so a filtered read that returns no rows stays empty', async () => {
    const h = await filteredHost([active]);

    await h.bridge.sendToolInput({ arguments: { status: 'paused' } });
    await expect.poll(() => h.calls.length).toBe(1);
    expect(h.calls[0]).toMatchObject({
      name: SUBSCRIPTIONS_TOOL_NAME,
      arguments: { status: 'paused' },
    });
    await expect.poll(() => h.last()?.kind).toBe('empty');
    expect(h.last()).toMatchObject({ kind: 'empty', displayName: 'Bob' });
    expect(JSON.stringify(h.last())).not.toContain('Creator One');
  });

  it('shows only the rows the declared populated filter returns', async () => {
    const h = await filteredHost();
    await h.bridge.sendToolInput({ arguments: { status: 'paused' } });
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.calls[0]?.arguments).toEqual({ status: 'paused' });
    expect(h.last()).toMatchObject({
      kind: 'subscriptions',
      subscriptions: { displayName: 'Bob', subscriptions: [paused] },
    });
  });

  it('reads with no arguments when the host tool input declares no filter', async () => {
    const h = await filteredHost();
    await h.bridge.sendToolInput({});
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.calls[0]).toMatchObject({
      name: SUBSCRIPTIONS_TOOL_NAME,
      arguments: {},
    });
    expect(h.calls[0]?.arguments).not.toHaveProperty('status');
    expect(h.last()).toMatchObject({
      kind: 'subscriptions',
      subscriptions: { displayName: 'Bob', subscriptions: [active, paused] },
    });
  });

  it('never forwards an undeclared field from the tool input as authority', async () => {
    const h = await filteredHost();
    await h.bridge.sendToolInput({
      arguments: { accountId: 'alice', status: 'paused' },
    });
    await expect.poll(() => h.calls.length).toBe(1);
    expect(h.calls[0]?.arguments).toEqual({ status: 'paused' });

    await h.bridge.sendToolInput({ arguments: { accountId: 'alice' } });
    await expect.poll(() => h.calls.length).toBe(2);
    expect(h.calls[1]?.arguments).toEqual({});
    expect(JSON.stringify(h.calls)).not.toContain('alice');
  });

  it.each([
    ['an unsupported status', { status: 'not-a-status' }],
    ['a status with the wrong case', { status: 'PAUSED' }],
    ['an empty status', { status: '' }],
    ['a status that is not a string', { status: 1 }],
    ['a list of statuses', { status: ['paused'] }],
    ['a null status', { status: null }],
    ['an object status', { status: { $ne: 'paused' } }],
  ])(
    'refuses %s without starting a read or showing rows',
    async (_name, forged) => {
      const h = await filteredHost();
      await h.bridge.sendToolResult(delivery(account));
      await expect.poll(() => h.last()?.kind).toBe('subscriptions');

      await h.bridge.sendToolInput({
        arguments: { accountId: 'alice', ...forged },
      });
      await expect.poll(() => h.last()?.kind).toBe('problem');
      expect(JSON.stringify(h.last())).toContain(
        INVALID_SUBSCRIPTION_INPUT_TEXT,
      );
      expect(JSON.stringify(h.last())).not.toMatch(/Bob|Creator|alice/);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(h.calls).toEqual([]);
    },
  );

  it('retries with the declared safe read, not the filtered input that was shown', async () => {
    const h = await filteredHost([active]);
    await h.bridge.sendToolInput({ arguments: { status: 'paused' } });
    await expect.poll(() => h.last()?.kind).toBe('empty');

    h.view.retry();
    await expect.poll(() => h.calls.length).toBe(2);
    expect(h.calls[1]).toMatchObject({
      name: SUBSCRIPTIONS_TOOL_NAME,
      arguments: {},
    });
    expect(h.calls[1]?.arguments).not.toHaveProperty('status');
  });

  it('retires an older filtered read when a newer read starts, so its late result is not shown', async () => {
    const h = await harness({ serverTools: {} });
    const pending: { resolve: (value: ReturnType<typeof delivery>) => void }[] =
      [];
    h.bridge.oncalltool = () =>
      new Promise((resolve) => {
        pending.push({ resolve });
      });

    await h.bridge.sendToolInput({ arguments: { status: 'paused' } });
    await expect.poll(() => pending.length).toBe(1);
    await h.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => pending.length).toBe(2);

    // The older filtered read finishes after the newer read started. It no longer owns the view.
    const shown = h.states.length;
    pending[0]?.resolve(delivery({ ...account, subscriptions: [paused] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.states.length).toBe(shown);

    pending[1]?.resolve(delivery(account));
    await expect.poll(() => h.last()?.kind).toBe('subscriptions');
    expect(h.last()).toMatchObject({
      subscriptions: { subscriptions: [active, paused] },
    });
  });

  it('does not show a late filtered result after the read bound, and clears rows on disposal', async () => {
    const states: SubscriptionsViewState[] = [];
    const app = new App(
      { name: 'test-view', version: '0.0.0' },
      {},
      { autoResize: false },
    );
    const bridge = new AppBridge(
      null,
      { name: 'test-host', version: '0.0.0' },
      { serverTools: {} },
    );
    toClean.push({ app, bridge });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge.connect(hostSide);
    let release: (value: ReturnType<typeof delivery>) => void = () => undefined;
    bridge.oncalltool = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const view = await connectSubscriptionsView({
      app,
      transport: viewSide,
      show: (state) => states.push(state),
      readBoundMs: 30,
    });

    await bridge.sendToolInput({ arguments: { status: 'paused' } });
    await expect.poll(() => states.at(-1)?.kind).toBe('retry');
    const shown = states.length;
    release(delivery({ ...account, subscriptions: [paused] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(states.length).toBe(shown);

    await bridge.sendToolInput({ arguments: { status: 'paused' } });
    view.dispose();
    release(delivery({ ...account, subscriptions: [paused] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(states.length).toBe(shown);
  });

  it('refuses a status the tool does not support without starting a read and retires the read in flight', async () => {
    const h = await harness({ serverTools: {} });
    const calls: Call[] = [];
    const pending: { resolve: (value: ReturnType<typeof delivery>) => void }[] =
      [];
    h.bridge.oncalltool = (params) => {
      calls.push(params);
      return new Promise((resolve) => {
        pending.push({ resolve });
      });
    };

    await h.bridge.sendToolInput({ arguments: { status: 'paused' } });
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]?.arguments).toEqual({ status: 'paused' });

    // The declared read is refused here for the same reason the server refuses it, so nothing is
    // forwarded and the read that started before the refusal cannot put rows back afterwards.
    await h.bridge.sendToolInput({ arguments: { status: 'not-a-status' } });
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).toContain(INVALID_SUBSCRIPTION_INPUT_TEXT);
    expect(calls.length).toBe(1);

    pending[0]?.resolve(delivery({ ...account, subscriptions: [active] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).not.toMatch(/Bob|Creator/);
  });
});

// Host teardown (STATE1): the bridge stops delivering notifications, but the view's own timer, its
// in-flight proxied read, and its retry and select controls would still run. Teardown retires them
// without closing the connection; the later dispose() closes it once.
describe('host teardown of the subscriptions view', () => {
  const rows = result('Alice', 'vs_aaaaaaaaaaaaaaaaaaaaaa', [
    'Creator One',
    'Creator Two',
  ]);

  async function tearDownRig(readBoundMs?: number) {
    const states: SubscriptionsViewState[] = [];
    const app = new App(
      { name: 'test-view', version: '0.0.0' },
      {},
      { autoResize: false },
    );
    const bridge = new AppBridge(
      null,
      { name: 'test-host', version: '0.0.0' },
      { serverTools: {} },
    );
    toClean.push({ app, bridge });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge.connect(hostSide);
    const pending: {
      resolve(value: ReturnType<typeof delivery>): void;
      reject(error: Error): void;
    }[] = [];
    bridge.oncalltool = () =>
      new Promise((resolve, reject) => void pending.push({ resolve, reject }));
    let closes = 0;
    const close = app.close.bind(app);
    app.close = () => ((closes += 1), close());
    const view = await connectSubscriptionsView({
      app,
      transport: viewSide,
      show: (state) => states.push(state),
      ...(readBoundMs === undefined ? {} : { readBoundMs }),
    });
    return { app, bridge, view, states, pending, closes: () => closes };
  }

  /** Shows rows, then leaves one host read in flight. */
  async function withReadInFlight(readBoundMs?: number) {
    const r = await tearDownRig(readBoundMs);
    await r.bridge.sendToolResult(delivery(rows));
    await expect.poll(() => r.states.at(-1)?.kind).toBe('subscriptions');
    await r.bridge.sendToolInput({ arguments: {} });
    await expect.poll(() => r.pending.length).toBe(1);
    return r;
  }

  it('presents nothing when the in-flight read answers after teardown', async () => {
    const r = await withReadInFlight();
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    r.pending[0]?.resolve(delivery(rows));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(r.states.length).toBe(shown);
  });

  it('presents nothing when the in-flight read is rejected after teardown', async () => {
    const r = await withReadInFlight();
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    r.pending[0]?.reject(new Error('the host closed the call'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(r.states.length).toBe(shown);
  });

  it('presents nothing when the read bound passes after teardown', async () => {
    const r = await withReadInFlight(40);
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(r.states.length).toBe(shown);
  });

  it('starts no read and shows nothing for retry or select after teardown', async () => {
    const r = await withReadInFlight();
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    r.view.retry();
    r.view.select('sub-0');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(r.pending.length).toBe(1);
    expect(r.states.length).toBe(shown);
  });

  it('closes the connection once, when dispose runs after teardown, however often it is called', async () => {
    const r = await withReadInFlight();
    await r.bridge.teardownResource({});
    expect(r.closes()).toBe(0);

    r.view.dispose();
    r.view.dispose();

    expect(r.closes()).toBe(1);
  });

  it('leaves another view on its own App unaffected', async () => {
    const torn = await withReadInFlight();
    const other = await tearDownRig();

    await torn.bridge.teardownResource({});
    await other.bridge.sendToolResult(delivery(rows));

    await expect.poll(() => other.states.at(-1)?.kind).toBe('subscriptions');
  });
});
