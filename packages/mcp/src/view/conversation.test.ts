import { App } from '@modelcontextprotocol/ext-apps';
import {
  AppBridge,
  type McpUiHostCapabilities,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { conversationFromApp } from './conversation.js';

// The conversation, exercised with a real `App` and `AppBridge` joined by an in-memory transport.
// The host's own handlers are the only place a context update or a message can arrive, so what they
// record, and in which order, is the observable effect.

type Answer = 'accept' | 'refuse' | 'fail' | 'hold';

interface Recorded {
  readonly kind: 'context' | 'message';
  readonly params: unknown;
}

const toClose: { app: App; bridge: AppBridge }[] = [];

async function connected(
  capabilities: McpUiHostCapabilities,
  answers: { context?: Answer; message?: Answer } = {},
) {
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
  const recorded: Recorded[] = [];
  const held: Array<() => void> = [];
  const answer = async (kind: Recorded['kind'], params: unknown) => {
    recorded.push({ kind, params });
    const how = answers[kind] ?? 'accept';
    if (how === 'fail') throw new Error('host exploded');
    if (how === 'hold')
      await new Promise<void>((resolve) => held.push(resolve));
    // Only `ui/message` can answer with `isError`; the cast lets the one handler serve both.
    return (how === 'refuse' ? { isError: true } : {}) as never;
  };
  bridge.onupdatemodelcontext = (params) => answer('context', params);
  bridge.onmessage = (params) => answer('message', params);
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  await app.connect(viewSide);
  toClose.push({ app, bridge });
  return { app, recorded, release: () => held.splice(0).forEach((f) => f()) };
}

afterEach(async () => {
  for (const { app, bridge } of toClose.splice(0)) {
    await app.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
});

const BOTH = { message: {}, updateModelContext: {} };
const CONTEXT = {
  text: 'The board',
  data: { game: { gameId: 'g1' } },
};

describe('appending a message through the host', () => {
  it('sends exactly one message as the person, and no context request, when there is no context', async () => {
    const { app, recorded } = await connected(BOTH);
    await expect(
      conversationFromApp(app).appendMessage('Your move'),
    ).resolves.toEqual({ outcome: 'appended' });
    expect(recorded).toEqual([
      {
        kind: 'message',
        params: {
          role: 'user',
          content: [{ type: 'text', text: 'Your move' }],
        },
      },
    ]);
  });

  it('sends the context update, then the message, in that order', async () => {
    const { app, recorded } = await connected(BOTH);
    await expect(
      conversationFromApp(app).appendMessage('Your move', {
        context: CONTEXT,
      }),
    ).resolves.toEqual({ outcome: 'appended' });
    expect(recorded).toEqual([
      {
        kind: 'context',
        params: {
          content: [{ type: 'text', text: 'The board' }],
          structuredContent: { game: { gameId: 'g1' } },
        },
      },
      {
        kind: 'message',
        params: {
          role: 'user',
          content: [{ type: 'text', text: 'Your move' }],
        },
      },
    ]);
  });

  it('sends the context without structured content when it has no data', async () => {
    const { app, recorded } = await connected(BOTH);
    await conversationFromApp(app).appendMessage('Hi', {
      context: { text: 'Just words' },
    });
    expect(recorded[0]).toEqual({
      kind: 'context',
      params: { content: [{ type: 'text', text: 'Just words' }] },
    });
  });

  it('does not send the message until the host has answered the context', async () => {
    const { app, recorded, release } = await connected(BOTH, {
      context: 'hold',
    });
    const pending = conversationFromApp(app).appendMessage('Your move', {
      context: CONTEXT,
    });
    await expect.poll(() => recorded.length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(recorded.map((one) => one.kind)).toEqual(['context']);
    release();
    await expect(pending).resolves.toEqual({ outcome: 'appended' });
    expect(recorded.map((one) => one.kind)).toEqual(['context', 'message']);
  });

  describe.each([
    {
      cause: 'withheld',
      capabilities: { message: {} } as McpUiHostCapabilities,
      answers: {},
      outcome: 'unavailable',
      attempted: false,
    },
    {
      // The pinned bridge cannot carry `isError` for a context update, so a host that refuses
      // it rejects the request.
      cause: 'refused or failed by the host',
      capabilities: BOTH,
      answers: { context: 'fail' } as const,
      outcome: 'failed',
      attempted: true,
    },
  ])('when the context is $cause', (one) => {
    it('stops the message by default and names the context stage', async () => {
      const { app, recorded } = await connected(one.capabilities, one.answers);
      await expect(
        conversationFromApp(app).appendMessage('Your move', {
          context: CONTEXT,
        }),
      ).resolves.toEqual({ outcome: one.outcome, stage: 'context' });
      expect(recorded.map((r) => r.kind)).toEqual(
        one.attempted ? ['context'] : [],
      );
    });

    it('still sends the message when the context is best effort, and says why it was skipped', async () => {
      const { app, recorded } = await connected(one.capabilities, one.answers);
      await expect(
        conversationFromApp(app).appendMessage('Your move', {
          context: { ...CONTEXT, bestEffort: true },
        }),
      ).resolves.toEqual({ outcome: 'appended', context: one.outcome });
      expect(recorded.map((r) => r.kind)).toEqual(
        one.attempted ? ['context', 'message'] : ['message'],
      );
    });
  });

  it('reads an isError answer to a context update as a refusal, should a bridge allow one', async () => {
    const sent: string[] = [];
    const stub = {
      getHostCapabilities: () => BOTH,
      updateModelContext: () => Promise.resolve({ isError: true }),
      sendMessage: () => {
        sent.push('message');
        return Promise.resolve({});
      },
    } as unknown as App;
    await expect(
      conversationFromApp(stub).appendMessage('Your move', {
        context: CONTEXT,
      }),
    ).resolves.toEqual({ outcome: 'denied', stage: 'context' });
    expect(sent).toEqual([]);
  });

  it('reports a refused message as denied at the message stage, without a retry', async () => {
    const { app, recorded } = await connected(BOTH, { message: 'refuse' });
    await expect(
      conversationFromApp(app).appendMessage('Your move'),
    ).resolves.toEqual({ outcome: 'denied', stage: 'message' });
    expect(recorded).toHaveLength(1);
  });

  it('reports a failing message as failed at the message stage, without a retry', async () => {
    const { app, recorded } = await connected(BOTH, { message: 'fail' });
    await expect(
      conversationFromApp(app).appendMessage('Your move', {
        context: CONTEXT,
      }),
    ).resolves.toEqual({ outcome: 'failed', stage: 'message' });
    expect(recorded.map((r) => r.kind)).toEqual(['context', 'message']);
  });

  it('reports the message as unavailable at the message stage when the host does not advertise it', async () => {
    const { app, recorded } = await connected({ updateModelContext: {} });
    await expect(
      conversationFromApp(app).appendMessage('Your move'),
    ).resolves.toEqual({ outcome: 'unavailable', stage: 'message' });
    await expect(
      conversationFromApp(app).appendMessage('Your move', {
        context: { ...CONTEXT, bestEffort: true },
      }),
    ).resolves.toEqual({ outcome: 'unavailable', stage: 'message' });
    // The second call's context was delivered; the message was not, and was never requested.
    expect(recorded.map((r) => r.kind)).toEqual(['context']);
  });

  it('reads the capabilities when it is called, not when it is built', async () => {
    const app = new App(
      { name: 'unconnected', version: '0.0.0' },
      {},
      { autoResize: false },
    );
    const conversation = conversationFromApp(app);
    await expect(conversation.appendMessage('Early')).resolves.toEqual({
      outcome: 'unavailable',
      stage: 'message',
    });
  });
});

describe('a view that has ended', () => {
  it('sends nothing once the signal has aborted', async () => {
    const { app, recorded } = await connected(BOTH);
    const lifetime = new AbortController();
    const conversation = conversationFromApp(app, lifetime.signal);
    await expect(conversation.appendMessage('First')).resolves.toEqual({
      outcome: 'appended',
    });
    lifetime.abort();
    await expect(conversation.appendMessage('Second')).resolves.toEqual({
      outcome: 'unavailable',
      stage: 'message',
    });
    await expect(
      conversation.appendMessage('Third', { context: CONTEXT }),
    ).resolves.toEqual({ outcome: 'unavailable', stage: 'context' });
    expect(recorded.map((r) => r.kind)).toEqual(['message']);
  });

  it('ignores the late answer to an outstanding context and sends no message', async () => {
    const { app, recorded, release } = await connected(BOTH, {
      context: 'hold',
    });
    const lifetime = new AbortController();
    const pending = conversationFromApp(app, lifetime.signal).appendMessage(
      'Your move',
      { context: CONTEXT },
    );
    await expect.poll(() => recorded.length).toBe(1);
    lifetime.abort();
    release();
    await expect(pending).resolves.toEqual({
      outcome: 'unavailable',
      stage: 'context',
    });
    expect(recorded.map((r) => r.kind)).toEqual(['context']);
  });

  it('sends no message after an outstanding best-effort context when the view ended', async () => {
    const { app, recorded, release } = await connected(BOTH, {
      context: 'hold',
    });
    const lifetime = new AbortController();
    const pending = conversationFromApp(app, lifetime.signal).appendMessage(
      'Your move',
      { context: { ...CONTEXT, bestEffort: true } },
    );
    await expect.poll(() => recorded.length).toBe(1);
    lifetime.abort();
    release();
    await expect(pending).resolves.toEqual({
      outcome: 'unavailable',
      stage: 'message',
    });
    expect(recorded.map((r) => r.kind)).toEqual(['context']);
  });

  it('ignores the late answer to an outstanding message', async () => {
    const { app, recorded, release } = await connected(BOTH, {
      message: 'hold',
    });
    const lifetime = new AbortController();
    const pending = conversationFromApp(app, lifetime.signal).appendMessage(
      'Your move',
    );
    await expect.poll(() => recorded.length).toBe(1);
    lifetime.abort();
    release();
    await expect(pending).resolves.toEqual({
      outcome: 'unavailable',
      stage: 'message',
    });
  });
});
