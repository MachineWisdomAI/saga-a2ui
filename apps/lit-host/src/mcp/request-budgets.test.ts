import { connect as tcpConnect, type Socket } from 'node:net';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { BudgetConfigurationError } from '@saga-a2ui/mcp/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ANSWER_TOOL_NAME, ANSWER_UNAVAILABLE_TEXT } from './answer.js';
import type { AnswerBackend } from './answer-server.js';
import { createDevelopmentVerifier, DEV_TOKENS } from './dev-auth.js';
import {
  ListenerConfigurationError,
  startEpisodeListener,
  type EpisodeListener,
  type EpisodeListenerOptions,
  type RequestOutcome,
} from './listener.js';
import {
  SUBSCRIPTIONS_TOOL_NAME,
  SUBSCRIPTIONS_UNAVAILABLE_TEXT,
} from './subscriptions.js';
import type {
  AccountSubscriptions,
  SubscriptionBackend,
} from './subscriptions-server.js';

// Budget behavior through the real listener, over real sockets. Limits are small so the waits are
// short; every assertion leaves generous slack so scheduling jitter cannot decide the result.

const VIEW_HTML = '<!doctype html><title>view</title>';
const open: { listener?: EpisodeListener; sockets: Socket[] } = { sockets: [] };
const outcomes: RequestOutcome[] = [];

afterEach(async () => {
  for (const socket of open.sockets.splice(0)) socket.destroy();
  await open.listener?.close();
  open.listener = undefined;
  outcomes.length = 0;
});

async function start(
  extra: Partial<EpisodeListenerOptions>,
): Promise<EpisodeListener> {
  const listener = await startEpisodeListener({
    viewHtml: VIEW_HTML,
    catalog: { find: () => undefined },
    port: 0,
    observe: (outcome) => void outcomes.push(outcome),
    ...extra,
  });
  open.listener = listener;
  return listener;
}

const never = () => new Promise<never>(() => undefined);
/** A backend that records who it was asked about and has nothing to say. */
const noting =
  (seen: string[]) =>
  async (id: string): Promise<undefined> => {
    seen.push(id);
    return undefined;
  };
const accountFor = (name: string): AccountSubscriptions => ({
  displayName: name,
  subscriptions: [],
});

/** A verifier that records every call and answers as the test directs. */
function scriptedVerifier(
  answer: (token: string) => Promise<AuthInfo>,
): OAuthTokenVerifier & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    verifyAccessToken: (token) => {
      calls.push(token);
      return answer(token);
    },
  };
}

const developmentIdentity = (): Promise<AuthInfo> =>
  createDevelopmentVerifier().verifyAccessToken(DEV_TOKENS.alice);

const subscriptionsCall = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} },
};

async function callSubscriptions(
  listener: EpisodeListener,
  token: string = DEV_TOKENS.alice,
) {
  const response = await fetch(listener.subscriptionsUrl ?? '', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(subscriptionsCall),
  });
  const text = await response.text();
  return {
    status: response.status,
    body:
      text.length === 0 ? undefined : (JSON.parse(text) as Record<string, any>),
  };
}

/** Opens a raw connection and sends head (and any partial body) exactly as given, then lets the caller stall or drop. */
async function rawRequest(
  listener: EpisodeListener,
  path: string,
  head: Record<string, string>,
  partialBody: string,
  declaredLength: number,
) {
  const url = new URL(listener.url);
  const socket = tcpConnect(Number(url.port), url.hostname);
  open.sockets.push(socket);
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  const lines = [
    `POST ${path} HTTP/1.1`,
    `Host: ${url.host}`,
    `Content-Length: ${declaredLength}`,
    ...Object.entries(head).map(([name, value]) => `${name}: ${value}`),
  ];
  socket.write(`${lines.join('\r\n')}\r\n\r\n${partialBody}`);
  let received = '';
  socket.on('data', (chunk) => void (received += chunk.toString('utf8')));
  const closed = new Promise<void>((resolve) =>
    socket.once('close', () => resolve()),
  );
  return { socket, closed, received: () => received };
}

const JSON_HEAD = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

describe('budget configuration at the listener', () => {
  it.each([
    ['listener operationMs', { budgets: { operationMs: 0 } }],
    [
      'listener requestMs',
      { budgets: { requestMs: Number.POSITIVE_INFINITY } },
    ],
    [
      'a route budget',
      {
        subscriptions: {
          viewHtml: VIEW_HTML,
          backend: {
            listSubscriptions: async (): Promise<undefined> => undefined,
          },
          verifier: createDevelopmentVerifier(),
          budgets: { requestMs: -5 },
        },
      },
    ],
    [
      'a route budget shadowing an invalid instance value',
      {
        budgets: { operationMs: Number.NaN },
        answer: {
          viewHtml: VIEW_HTML,
          backend: { answer: async (): Promise<undefined> => undefined },
          budgets: { operationMs: 10, requestMs: 10 },
        },
      },
    ],
    [
      'an operation limit',
      {
        subscriptions: {
          viewHtml: VIEW_HTML,
          backend: {
            listSubscriptions: async (): Promise<undefined> => undefined,
          },
          verifier: createDevelopmentVerifier(),
          readBoundMs: Number.NaN,
        },
      },
    ],
    [
      'an answer limit',
      {
        answer: {
          viewHtml: VIEW_HTML,
          backend: { answer: async (): Promise<undefined> => undefined },
          answerBoundMs: '40' as unknown as number,
        },
      },
    ],
  ] as const)(
    'refuses %s before any port opens or callback runs',
    async (_name, extra) => {
      const verifier = scriptedVerifier(developmentIdentity);
      await expect(
        startEpisodeListener({
          viewHtml: VIEW_HTML,
          catalog: { find: () => undefined },
          port: 0,
          ...(extra as Partial<EpisodeListenerOptions>),
        }),
      ).rejects.toThrow(BudgetConfigurationError);
      expect(verifier.calls).toEqual([]);
    },
  );

  it('refuses an unusable streaming policy, and selects a finite default when none is given', async () => {
    const answer = {
      viewHtml: VIEW_HTML,
      backend: { answer: async (): Promise<undefined> => undefined },
      responseMode: 'event-stream',
    } as const;
    for (const idleMs of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '10' as unknown as number,
    ]) {
      await expect(
        startEpisodeListener({
          viewHtml: VIEW_HTML,
          catalog: { find: () => undefined },
          port: 0,
          answer: { ...answer, streaming: { idleMs } },
        }),
      ).rejects.toThrow(ListenerConfigurationError);
    }
    await expect(start({ answer })).resolves.toBeDefined();
  });
});

describe('credential verification', () => {
  it('answers 500 server_error, not 401, when the verifier never settles, and builds no server', async () => {
    const lookups: string[] = [];
    const verifier = scriptedVerifier(never);
    const listener = await start({
      budgets: { operationMs: 80, requestMs: 2_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: noting(lookups) },
        verifier,
      },
    });
    const started = Date.now();
    const response = await callSubscriptions(listener);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'server_error' });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(lookups).toEqual([]);
    expect(outcomes.at(-1)?.causes).toMatchObject([
      { kind: 'operation-timeout', stage: 'authentication', effect: 'none' },
    ]);
  });

  it('drops a valid identity that arrives after the wait ended: no body is read and no tool runs', async () => {
    let release: (info: AuthInfo) => void = () => undefined;
    const late = new Promise<AuthInfo>((resolve) => (release = resolve));
    const lookups: string[] = [];
    const verifier = scriptedVerifier(() => late);
    const listener = await start({
      budgets: { operationMs: 60, requestMs: 2_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: noting(lookups) },
        verifier,
      },
    });
    expect((await callSubscriptions(listener)).status).toBe(500);
    release(await developmentIdentity());
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(lookups).toEqual([]);
  });

  it('keeps refusals that are real: invalid credentials stay 401 and a verifier fault stays 500', async () => {
    const verifier = scriptedVerifier(async (token) => {
      if (token === 'fault') throw new Error('identity provider down');
      throw new OAuthError(OAuthErrorCode.InvalidToken, 'nope');
    });
    const listener = await start({
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: async () => undefined },
        verifier,
      },
    });
    expect((await callSubscriptions(listener, 'bad')).status).toBe(401);
    expect((await callSubscriptions(listener, 'fault')).status).toBe(500);
    expect(outcomes.flatMap((outcome) => outcome.causes)).toMatchObject([
      { kind: 'auth-refused', status: 401 },
      { kind: 'dependency-failure', stage: 'authentication' },
    ]);
  });

  it('charges a slow verifier to the request, so the tool gets only what remains', async () => {
    let started = 0;
    const verifier = scriptedVerifier(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return developmentIdentity();
    });
    const listener = await start({
      budgets: { operationMs: 5_000, requestMs: 450 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: () => ((started += 1), never()) },
        verifier,
      },
    });
    const begun = Date.now();
    const response = await callSubscriptions(listener);
    const elapsed = Date.now() - begun;
    expect(started).toBe(1);
    expect(response.body?.result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: SUBSCRIPTIONS_UNAVAILABLE_TEXT }],
    });
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(1_500); // not the 5,000 ms operation limit
    expect(outcomes.at(-1)?.causes[0]).toMatchObject({
      kind: 'request-timeout',
    });
  });
});

describe('body ingestion', () => {
  it('answers 408 request_timeout and closes the connection when the body never completes', async () => {
    const lookups: string[] = [];
    const listener = await start({
      budgets: { operationMs: 100, requestMs: 2_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: noting(lookups) },
        verifier: createDevelopmentVerifier(),
      },
    });
    const raw = await rawRequest(
      listener,
      '/subscriptions/mcp',
      { ...JSON_HEAD, authorization: `Bearer ${DEV_TOKENS.alice}` },
      '{"jsonrpc"',
      200,
    );
    await raw.closed;
    expect(raw.received()).toMatch(/^HTTP\/1\.1 408 /);
    expect(raw.received()).toContain('request_timeout');
    expect(lookups).toEqual([]);
    expect(outcomes.at(-1)?.causes).toMatchObject([
      { kind: 'operation-timeout', stage: 'body' },
    ]);
  });

  it('writes nothing and builds no server when the caller drops mid-body', async () => {
    const lookups: string[] = [];
    const listener = await start({
      budgets: { operationMs: 5_000, requestMs: 5_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: noting(lookups) },
        verifier: createDevelopmentVerifier(),
      },
    });
    const raw = await rawRequest(
      listener,
      '/subscriptions/mcp',
      { ...JSON_HEAD, authorization: `Bearer ${DEV_TOKENS.alice}` },
      '{"jsonrpc"',
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    raw.socket.destroy();
    await expect.poll(() => outcomes.length).toBe(1);
    expect(raw.received()).toBe('');
    expect(lookups).toEqual([]);
    expect(outcomes[0]).toMatchObject({
      finished: false,
      causes: [{ kind: 'disconnected', stage: 'body', effect: 'none' }],
    });
  });

  it('bounds the body of a public endpoint too, charging it to the request', async () => {
    const listener = await start({
      budgets: { operationMs: 5_000, requestMs: 150 },
      answer: { viewHtml: VIEW_HTML, backend: { answer: async () => 'x' } },
    });
    const raw = await rawRequest(
      listener,
      '/answer/mcp',
      JSON_HEAD,
      '{"json',
      200,
    );
    await raw.closed;
    expect(raw.received()).toMatch(/^HTTP\/1\.1 408 /);
    expect(outcomes.at(-1)?.causes).toMatchObject([
      { kind: 'request-timeout', stage: 'body' },
    ]);
  });

  it('leaves an unrelated request unaffected by a stalled one', async () => {
    const listener = await start({
      budgets: { operationMs: 300, requestMs: 2_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: async () => accountFor('Alice') },
        verifier: createDevelopmentVerifier(),
      },
    });
    const stalled = await rawRequest(
      listener,
      '/subscriptions/mcp',
      { ...JSON_HEAD, authorization: `Bearer ${DEV_TOKENS.alice}` },
      '{"jsonrpc"',
      200,
    );
    const fine = await callSubscriptions(listener);
    expect(fine.body?.result).toMatchObject({
      structuredContent: { displayName: 'Alice' },
    });
    await stalled.closed;
    expect(stalled.received()).toMatch(/^HTTP\/1\.1 408 /);
  });
});

describe('the tool handler', () => {
  it('returns the fixed unavailable result at the operation limit, and a late backend answer changes nothing', async () => {
    let release: (account: AccountSubscriptions) => void = () => undefined;
    const slow = new Promise<AccountSubscriptions>(
      (resolve) => (release = resolve),
    );
    const backend: SubscriptionBackend = {
      listSubscriptions: (id) =>
        id === 'acct-synthetic-alice'
          ? slow
          : Promise.resolve(accountFor('Bob')),
    };
    const listener = await start({
      budgets: { operationMs: 120, requestMs: 5_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend,
        verifier: createDevelopmentVerifier(),
      },
    });
    const [stuck, other] = await Promise.all([
      callSubscriptions(listener, DEV_TOKENS.alice),
      callSubscriptions(listener, DEV_TOKENS.bob),
    ]);
    expect(stuck.body?.result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: SUBSCRIPTIONS_UNAVAILABLE_TEXT }],
    });
    expect(other.body?.result).toMatchObject({
      structuredContent: { displayName: 'Bob' },
    });
    release(accountFor('Alice'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(outcomes.flatMap((outcome) => outcome.causes)).toMatchObject([
      { kind: 'operation-timeout', stage: 'handler', limitMs: 120 },
    ]);
  });

  it('asks the backend read to stop through a signal that aborts at expiry', async () => {
    const signals: AbortSignal[] = [];
    const listener = await start({
      budgets: { operationMs: 80 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: {
          listSubscriptions: (_id, signal) => (signals.push(signal), never()),
        },
        verifier: createDevelopmentVerifier(),
      },
    });
    await callSubscriptions(listener);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('keeps the tighter existing readBoundMs and lets the route override the instance limit', async () => {
    const listener = await start({
      budgets: { operationMs: 5_000, requestMs: 5_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: () => never() },
        verifier: createDevelopmentVerifier(),
        readBoundMs: 60,
      },
    });
    const begun = Date.now();
    expect((await callSubscriptions(listener)).body?.result).toMatchObject({
      isError: true,
    });
    expect(Date.now() - begun).toBeLessThan(1_500);
    expect(outcomes.at(-1)?.causes).toMatchObject([
      { kind: 'operation-timeout', limitMs: 60 },
    ]);
  });

  it('applies a route’s own limits without touching the other routes', async () => {
    const listener = await start({
      budgets: { operationMs: 5_000, requestMs: 5_000 },
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: { listSubscriptions: () => never() },
        verifier: createDevelopmentVerifier(),
        budgets: { operationMs: 70 },
      },
      answer: { viewHtml: VIEW_HTML, backend: { answer: async () => 'fine' } },
    });
    const begun = Date.now();
    await callSubscriptions(listener);
    expect(Date.now() - begun).toBeLessThan(1_500);
    expect(outcomes.at(-1)?.causes).toMatchObject([
      { kind: 'operation-timeout', limitMs: 70 },
    ]);
  });
});

describe('streaming responses', () => {
  const stream = (
    backend: AnswerBackend,
    streaming: { idleMs: number },
    budgets = { operationMs: 5_000, requestMs: 150 },
  ) =>
    start({
      budgets,
      answer: {
        viewHtml: VIEW_HTML,
        backend,
        responseMode: 'event-stream',
        streaming,
      },
    });

  async function ask(listener: EpisodeListener) {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(listener.answerUrl ?? '')),
    );
    try {
      return await client.callTool(
        { name: ANSWER_TOOL_NAME, arguments: { question: 'What?' } },
        { onprogress: () => undefined },
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  it('keeps an established stream open past the request limit while the transport keeps moving', async () => {
    const listener = await stream(
      {
        async answer(_question, request) {
          for (let step = 1; step <= 6; step += 1) {
            await request.reportProgress({ progress: step, total: 6 });
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          return 'done after about 360 ms';
        },
      },
      { idleMs: 400 },
    );
    const begun = Date.now();
    const result = await ask(listener);
    expect(Date.now() - begun).toBeGreaterThan(300); // longer than the 150 ms request limit
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      answer: 'done after about 360 ms',
    });
  });

  /** Posts one streamed call with a progress token and reports how the response body ended. */
  async function streamEnd(listener: EpisodeListener): Promise<{
    elapsedMs: number;
    chunks: string[];
    ended: 'closed' | 'finished';
  }> {
    const response = await fetch(listener.answerUrl ?? '', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: ANSWER_TOOL_NAME,
          arguments: { question: 'What?' },
          _meta: { progressToken: 'p1' },
        },
      }),
    });
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
    const begun = Date.now();
    const chunks: string[] = [];
    const reader = response.body?.getReader();
    try {
      for (;;) {
        const next = await reader?.read();
        if (!next || next.done)
          return { elapsedMs: Date.now() - begun, chunks, ended: 'finished' };
        chunks.push(new TextDecoder().decode(next.value));
      }
    } catch {
      return { elapsedMs: Date.now() - begun, chunks, ended: 'closed' };
    }
  }

  it('closes an established stream that goes idle, however long the operation limit would allow', async () => {
    const listener = await stream(
      { answer: async () => never() },
      { idleMs: 150 },
      { operationMs: 5_000, requestMs: 5_000 },
    );
    const end = await streamEnd(listener);
    expect(end.elapsedMs).toBeGreaterThanOrEqual(100);
    expect(end.elapsedMs).toBeLessThan(2_500);
    await expect
      .poll(
        () =>
          outcomes
            .at(-1)
            ?.causes.some(
              (cause) =>
                cause.kind === 'operation-timeout' &&
                cause.stage === 'delivery',
            ) ?? false,
      )
      .toBe(true);
  });

  it('does not let application-only progress that delivers nothing keep a stream alive', async () => {
    // The handler stays busy and "alive" in its own terms but writes nothing to the transport.
    const listener = await stream(
      {
        async answer(_question, request) {
          while (!request.signal.aborted)
            await new Promise((resolve) => setTimeout(resolve, 20));
          return undefined;
        },
      },
      { idleMs: 150 },
      { operationMs: 5_000, requestMs: 5_000 },
    );
    const end = await streamEnd(listener);
    expect(end.elapsedMs).toBeLessThan(2_500);
  });

  it('bounds the setup of a stream by the request limit', async () => {
    const listener = await stream(
      { answer: async () => 'x' },
      { idleMs: 5_000 },
      { operationMs: 5_000, requestMs: 150 },
    );
    const raw = await rawRequest(
      listener,
      '/answer/mcp',
      JSON_HEAD,
      '{"json',
      200,
    );
    await raw.closed;
    expect(raw.received()).toMatch(/^HTTP\/1\.1 408 /);
  });

  it('answers a JSON-mode call whose handler stalls with the fixed unavailable result', async () => {
    const listener = await start({
      budgets: { operationMs: 80, requestMs: 2_000 },
      answer: { viewHtml: VIEW_HTML, backend: { answer: never } },
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(listener.answerUrl ?? '')),
    );
    const result = await client.callTool({
      name: ANSWER_TOOL_NAME,
      arguments: { question: 'What?' },
    });
    await client.close();
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: ANSWER_UNAVAILABLE_TEXT }],
    });
  });
});
