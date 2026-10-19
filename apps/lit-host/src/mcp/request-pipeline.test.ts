import { ServerResponse } from 'node:http';
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_TOOL_NAME, ANSWER_UNAVAILABLE_TEXT, ANSWER_VIEW_URI } from './answer.js';
import type { AnswerBackend } from './answer-server.js';
import { createDevelopmentVerifier, DEV_TOKENS } from './dev-auth.js';
import { startEpisodeListener, type EpisodeListener, type EpisodeListenerOptions, type RequestOutcome } from './listener.js';
import { SUBSCRIPTIONS_TOOL_NAME, SUBSCRIPTIONS_UNAVAILABLE_TEXT, SUBSCRIPTIONS_VIEW_URI } from './subscriptions.js';
import type { SubscriptionBackend } from './subscriptions-server.js';

// CORE3 through the real application listener, over real sockets, in both response modes: which
// layer reports each failure, what an observer of any layer can learn, what happens to a request
// that is cancelled or abandoned, and what the transport writes afterwards. The listener is the
// application's; the operations under it are the connector's.

const VIEW_HTML = '<!doctype html><title>view</title>';
const CANARY = 'canary-pipeline-secret';
const open: { listener?: EpisodeListener } = {};
const outcomes: RequestOutcome[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await open.listener?.close();
  open.listener = undefined;
  outcomes.length = 0;
});

async function start(extra: Partial<EpisodeListenerOptions>): Promise<EpisodeListener> {
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

const noAccount = async (): Promise<undefined> => undefined;
const quietBackend: SubscriptionBackend = { listSubscriptions: noAccount };

interface Wire {
  readonly status: number;
  readonly headers: Headers;
  /** Every JSON-RPC message in the body, whether it arrived as one JSON document or as server-sent events. */
  readonly messages: readonly Record<string, any>[];
  readonly raw: string;
}

const JSON_HEAD = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

function parseWire(status: number, headers: Headers, raw: string): Wire {
  const messages: Record<string, any>[] = [];
  if (headers.get('content-type')?.includes('text/event-stream')) {
    for (const line of raw.split('\n')) if (line.startsWith('data:') && line.slice(5).trim().length > 0) messages.push(JSON.parse(line.slice(5)));
  } else if (raw.length > 0) {
    try {
      const body: unknown = JSON.parse(raw);
      if (typeof body === 'object' && body !== null) messages.push(...(Array.isArray(body) ? body : [body]));
    } catch {
      // A non-JSON body is left in `raw` for the assertion that cares.
    }
  }
  return { status, headers, messages, raw };
}

async function send(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Wire> {
  const response = await fetch(url, { method: 'POST', headers: { ...JSON_HEAD, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return parseWire(response.status, response.headers, await response.text());
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const callSubscriptions = (args: Record<string, unknown> = {}, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: SUBSCRIPTIONS_TOOL_NAME, arguments: args } });
const callAnswer = (question: string, id = 1, meta?: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: ANSWER_TOOL_NAME, arguments: { question }, ...(meta ? { _meta: meta } : {}) },
});

/** The three places a failure can be reported, observed separately. */
function layers(wire: Wire) {
  const message = wire.messages[0];
  return {
    http: wire.status,
    challenge: wire.headers.get('www-authenticate') !== null,
    rpcError: message?.error?.code as number | undefined,
    toolError: message?.result?.isError as boolean | undefined,
  };
}

describe('which layer reports each failure', () => {
  const stalled: OAuthTokenVerifier = { verifyAccessToken: () => new Promise(() => undefined) };
  const faulty: OAuthTokenVerifier = {
    verifyAccessToken: () => {
      throw new Error(`identity provider down ${CANARY}`);
    },
  };

  async function protectedWire(extra: Partial<EpisodeListenerOptions>, body: unknown, headers: Record<string, string>) {
    const listener = await start(extra);
    return send(listener.subscriptionsUrl ?? '', body, headers);
  }
  const subscriptions = (verifier: OAuthTokenVerifier, backend: SubscriptionBackend = quietBackend, budgets = {}) =>
    ({ budgets, subscriptions: { viewHtml: VIEW_HTML, backend, verifier } }) satisfies Partial<EpisodeListenerOptions>;

  it.each([
    ['no credential', subscriptions(createDevelopmentVerifier()), callSubscriptions(), {}, { http: 401, challenge: true, rpcError: undefined, toolError: undefined }],
    ['an unknown credential', subscriptions(createDevelopmentVerifier()), callSubscriptions(), bearer('nope'), { http: 401, challenge: true, rpcError: undefined, toolError: undefined }],
    ['an expired credential', subscriptions(createDevelopmentVerifier()), callSubscriptions(), bearer(DEV_TOKENS.expired), { http: 401, challenge: true, rpcError: undefined, toolError: undefined }],
    ['a service-only credential', subscriptions(createDevelopmentVerifier()), callSubscriptions(), bearer(DEV_TOKENS.service), { http: 403, challenge: true, rpcError: undefined, toolError: undefined }],
    ['a verifier that fails', subscriptions(faulty), callSubscriptions(), bearer('t'), { http: 500, challenge: false, rpcError: undefined, toolError: undefined }],
    ['a verifier that stalls', subscriptions(stalled, quietBackend, { operationMs: 60, requestMs: 400 }), callSubscriptions(), bearer('t'), { http: 500, challenge: false, rpcError: undefined, toolError: undefined }],
    ['a body that is not JSON', subscriptions(createDevelopmentVerifier()), `{${CANARY}`, bearer(DEV_TOKENS.alice), { http: 400, challenge: false, rpcError: -32700, toolError: undefined }],
    ['an unknown tool', subscriptions(createDevelopmentVerifier()), { ...callSubscriptions(), params: { name: 'nope', arguments: {} } }, bearer(DEV_TOKENS.alice), { http: 200, challenge: false, rpcError: -32602, toolError: undefined }],
    ['an input the tool refuses', subscriptions(createDevelopmentVerifier()), callSubscriptions({ status: 'bogus' }), bearer(DEV_TOKENS.alice), { http: 200, challenge: false, rpcError: undefined, toolError: true }],
    ['a backend that fails', subscriptions(createDevelopmentVerifier(), { listSubscriptions: () => Promise.reject(new Error(CANARY)) }), callSubscriptions(), bearer(DEV_TOKENS.alice), { http: 200, challenge: false, rpcError: undefined, toolError: true }],
    ['a backend that stalls', subscriptions(createDevelopmentVerifier(), { listSubscriptions: () => new Promise(() => undefined) }, { operationMs: 60 }), callSubscriptions(), bearer(DEV_TOKENS.alice), { http: 200, challenge: false, rpcError: undefined, toolError: true }],
    ['a backend result that breaks the contract', subscriptions(createDevelopmentVerifier(), { listSubscriptions: async () => ({ displayName: 'A', subscriptions: [{ subscriptionId: 's', creator: 'c', tier: 't', status: CANARY }] }) }), callSubscriptions(), bearer(DEV_TOKENS.alice), { http: 200, challenge: false, rpcError: undefined, toolError: true }],
  ] as const)('reports %s as one layer only', async (_name, extra, body, headers, expected) => {
    const wire = await protectedWire(extra, body, headers);
    expect(layers(wire)).toEqual(expected);
    expect(wire.raw).not.toContain(CANARY);
  });

  describe.each([401, 429, 503])('a backend that answers %i', (status) => {
    const failing = (): SubscriptionBackend => ({
      listSubscriptions: () => Promise.reject(Object.assign(new Error(`upstream ${status} ${CANARY}`), { status, headers: { 'retry-after': '30', 'www-authenticate': 'Bearer realm="upstream"' } })),
    });

    it('stays inside the tool result: the endpoint keeps its own status, challenge and retry hints', async () => {
      const wire = await protectedWire(subscriptions(createDevelopmentVerifier(), failing()), callSubscriptions(), bearer(DEV_TOKENS.alice));
      expect(layers(wire)).toEqual({ http: 200, challenge: false, rpcError: undefined, toolError: true });
      expect(wire.headers.get('retry-after')).toBeNull();
      expect(wire.messages[0]?.result?.content).toEqual([{ type: 'text', text: SUBSCRIPTIONS_UNAVAILABLE_TEXT }]);
      expect(wire.raw).not.toContain(CANARY);
      expect(wire.raw).not.toContain(String(status));
      expect(outcomes.at(-1)?.causes).toMatchObject([{ kind: 'dependency-failure', stage: 'storage' }]);
    });

    it('is the same for a public operation', async () => {
      const backend: AnswerBackend = { answer: () => Promise.reject(Object.assign(new Error(`upstream ${status} ${CANARY}`), { status })) };
      const listener = await start({ answer: { viewHtml: VIEW_HTML, backend } });
      const wire = await send(listener.answerUrl ?? '', callAnswer('Why?'));
      expect(layers(wire)).toEqual({ http: 200, challenge: false, rpcError: undefined, toolError: true });
      expect(wire.messages[0]?.result?.content).toEqual([{ type: 'text', text: ANSWER_UNAVAILABLE_TEXT }]);
      expect(wire.raw).not.toContain(CANARY);
    });
  });

  it('keeps a verifier that rejects the credential apart from one that could not decide', async () => {
    const refusing: OAuthTokenVerifier = { verifyAccessToken: () => Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, 'no')) };
    expect(layers(await protectedWire(subscriptions(refusing), callSubscriptions(), bearer('t')))).toMatchObject({ http: 401, challenge: true });
    await open.listener?.close();
    expect(layers(await protectedWire(subscriptions(faulty), callSubscriptions(), bearer('t')))).toMatchObject({ http: 500, challenge: false });
  });
});

describe('what an observer of any layer can learn', () => {
  /** Everything the application writes to its ordinary logs while a test runs. */
  function captureLogs(): string[] {
    const written: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(' ')));
    }
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      }) as never);
    }
    return written;
  }

  it.each([
    ['JSON', 'json'],
    ['server-sent events', 'event-stream'],
  ] as const)('keeps every canary out of results, discovery, resources, errors, metadata and logs (%s)', async (_name, responseMode) => {
    const logs = captureLogs();
    const seen: string[] = [];
    const verifier: OAuthTokenVerifier = {
      verifyAccessToken: async (token) => ({ ...(await createDevelopmentVerifier().verifyAccessToken(DEV_TOKENS.alice)), token, extra: { accountId: 'acct-synthetic-alice', signInId: 'dev-sign-in-alice', secret: CANARY } }),
    };
    const listener = await start({
      subscriptions: {
        viewHtml: VIEW_HTML,
        verifier,
        backend: {
          // The backend record carries private fields the projection must not copy.
          listSubscriptions: async () =>
            ({ displayName: 'Alice', cardToken: CANARY, subscriptions: [{ subscriptionId: 's1', creator: 'C', tier: 'T', status: 'active', email: CANARY }] }) as never,
        },
      },
      answer: { viewHtml: VIEW_HTML, responseMode, backend: { answer: async (question) => `Answer to ${question}` } },
    });
    const auth = bearer(`token-${CANARY}`);
    const exchanges: Wire[] = [];
    const record = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
      const wire = await send(url, body, headers);
      exchanges.push(wire);
      seen.push(wire.raw, JSON.stringify([...wire.headers.entries()]));
      return wire;
    };
    // Success, failure and discovery on both endpoints, with the canary in every field the caller controls.
    await record(listener.subscriptionsUrl ?? '', callSubscriptions({ status: 'active', note: CANARY, accountId: CANARY, _meta: { [CANARY]: CANARY } }), { ...auth, 'x-forwarded-user': CANARY });
    await record(listener.subscriptionsUrl ?? '', callSubscriptions({ status: CANARY }), auth);
    await record(listener.subscriptionsUrl ?? '', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, auth);
    await record(listener.subscriptionsUrl ?? '', { jsonrpc: '2.0', id: 3, method: 'resources/list' }, auth);
    await record(listener.subscriptionsUrl ?? '', { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: SUBSCRIPTIONS_VIEW_URI } }, auth);
    await record(listener.subscriptionsUrl ?? '', { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: `ui://${CANARY}` } }, auth);
    await record(listener.answerUrl ?? '', callAnswer(`question ${CANARY}`));
    await record(listener.answerUrl ?? '', { jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: ANSWER_VIEW_URI } });
    await record(listener.answerUrl ?? '', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: ANSWER_TOOL_NAME, arguments: { question: 7 } } });

    // The canary the caller sent may come back only where the contract returns the caller's own
    // input: the answer repeats its question, and an unknown resource URI is echoed in JSON-RPC errors by the SDK.
    const unexpected = exchanges.flatMap((wire) => (wire.raw.includes(CANARY) ? [wire.raw] : []));
    for (const raw of unexpected) {
      const echoedQuestion = raw.includes(`question ${CANARY}`);
      const echoedUri = raw.includes(`ui://${CANARY}`);
      expect(echoedQuestion || echoedUri, raw).toBe(true);
    }
    const allowedEcho = (text: string) => text.split(`question ${CANARY}`).join('').split(`Answer to ${CANARY}`).join('').split(`ui://${CANARY}`).join('');
    // Nothing else: not the private backend fields, the credential, the forwarded header or the identity secret.
    expect(allowedEcho(seen.join('\n'))).not.toContain(CANARY);
    expect(logs.join('\n')).not.toContain(CANARY);
    // Application diagnostics hold typed causes, never the credential or the backend record.
    expect(JSON.stringify(outcomes.map(({ path, status, finished }) => ({ path, status, finished })))).not.toContain(CANARY);
  });
});

describe('a request that is cancelled, abandoned or resumed', () => {
  /**
   * Calls that would put bytes or headers on a response that was already destroyed or ended. The
   * client cannot show these: a destroyed socket swallows what is written to it. A bare `end()` is
   * the transport's idempotent close and carries nothing.
   */
  function watchClosedWrites(): string[] {
    const late: string[] = [];
    for (const method of ['write', 'end', 'writeHead'] as const) {
      const original = ServerResponse.prototype[method] as (this: ServerResponse, ...args: unknown[]) => unknown;
      vi.spyOn(ServerResponse.prototype, method).mockImplementation(function (this: ServerResponse, ...args: unknown[]) {
        const carriesData = method !== 'end' || (args[0] !== undefined && typeof args[0] !== 'function');
        if (carriesData && (this.destroyed || this.writableEnded)) late.push(method);
        return original.apply(this, args);
      } as never);
    }
    return late;
  }

  /** A gate a test opens when it wants the application to continue. */
  function gate(): { readonly opened: Promise<void>; open(): void } {
    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  }

  describe.each(['json', 'event-stream'] as const)('on a public operation answering in %s', (responseMode) => {
    function slowAnswer() {
      const release = gate();
      const entered: AbortSignal[] = [];
      const late: Promise<void>[] = [];
      const backend: AnswerBackend = {
        async answer(question, request) {
          entered.push(request.signal);
          await request.reportProgress({ progress: 1, total: 2, message: `working on ${question}` });
          await release.opened;
          late.push(request.reportProgress({ progress: 2, total: 2, message: 'finished' }));
          return `Answer to ${question}`;
        },
      };
      return { backend, entered, late, release };
    }

    it('writes nothing to a response whose caller has gone, and runs the handler once', async () => {
      const writes = watchClosedWrites();
      const { backend, entered, late, release } = slowAnswer();
      const listener = await start({ answer: { viewHtml: VIEW_HTML, backend, responseMode } });
      const controller = new AbortController();
      const gone = fetch(listener.answerUrl ?? '', { method: 'POST', headers: JSON_HEAD, signal: controller.signal, body: JSON.stringify(callAnswer('Q?', 1, { progressToken: 'p1' })) })
        .then((response) => response.text())
        .catch(() => undefined);
      await expect.poll(() => entered.length).toBe(1);
      controller.abort();
      await gone;
      await expect.poll(() => entered[0]?.aborted).toBe(true);
      release.open();
      await expect.poll(() => late.length).toBe(1);
      await expect(late[0]).resolves.toBeUndefined();
      await expect.poll(() => outcomes.length).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(writes).toEqual([]);
      expect(entered).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ finished: false });
      expect(outcomes[0]?.causes.map((cause) => cause.kind)).toContain('disconnected');
    });

    it('does not resume or replay: the abandoned handler is not run again, and a retry is one new call', async () => {
      const { backend, entered, release } = slowAnswer();
      const listener = await start({ answer: { viewHtml: VIEW_HTML, backend, responseMode } });
      const controller = new AbortController();
      const gone = fetch(listener.answerUrl ?? '', { method: 'POST', headers: JSON_HEAD, signal: controller.signal, body: JSON.stringify(callAnswer('Q?')) })
        .then((response) => response.text())
        .catch(() => undefined);
      await expect.poll(() => entered.length).toBe(1);
      controller.abort();
      await gone;
      // A stateless endpoint has no stream to resume: these are refused without touching the handler.
      for (const [method, headers] of [
        ['GET', { accept: 'text/event-stream', 'last-event-id': '1' }],
        ['DELETE', { 'mcp-session-id': 'abandoned' }],
      ] as const) {
        const resumed = await fetch(listener.answerUrl ?? '', { method, headers });
        expect(resumed.status, method).toBe(405);
        expect(resumed.headers.get('allow')).toBe('POST');
        await resumed.text();
      }
      expect(entered).toHaveLength(1);
      release.open();
      const retry = await send(listener.answerUrl ?? '', callAnswer('Q?', 2));
      expect(retry.messages.at(-1)?.result?.structuredContent).toEqual({ question: 'Q?', answer: 'Answer to Q?' });
      expect(entered).toHaveLength(2); // the retry is a new request with its own handler run
    });

    it('answers a request that outlives its deadline once, and writes nothing more when the handler finishes', async () => {
      const writes = watchClosedWrites();
      const { backend, entered, release } = slowAnswer();
      const listener = await start({ budgets: { operationMs: 60, requestMs: 300 }, answer: { viewHtml: VIEW_HTML, backend, responseMode } });
      const wire = await send(listener.answerUrl ?? '', callAnswer('Q?', 1, { progressToken: 'p1' }));
      expect(wire.messages.filter((message) => message.id === 1)).toHaveLength(1); // exactly one response
      expect(wire.messages.at(-1)?.result).toMatchObject({ isError: true, content: [{ type: 'text', text: ANSWER_UNAVAILABLE_TEXT }] });
      release.open();
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(writes).toEqual([]);
      expect(entered).toHaveLength(1);
    });
  });

  it('does not let one request’s progress or completion reach another concurrent request', async () => {
    const release = { first: gate(), second: gate() };
    const backend: AnswerBackend = {
      async answer(question, request) {
        await request.reportProgress({ progress: 1, total: 2, message: `progress for ${question}` });
        await (question === 'first' ? release.first : release.second).opened;
        return `answer for ${question}`;
      },
    };
    const listener = await start({ answer: { viewHtml: VIEW_HTML, backend, responseMode: 'event-stream' } });
    const first = send(listener.answerUrl ?? '', callAnswer('first', 1, { progressToken: 'tok-first' }));
    const second = send(listener.answerUrl ?? '', callAnswer('second', 1, { progressToken: 'tok-second' }));
    await new Promise((resolve) => setTimeout(resolve, 40)); // both are waiting; the later one finishes first
    release.second.open();
    release.first.open();
    const [one, two] = await Promise.all([first, second]);
    const progressOf = (wire: Wire) => wire.messages.filter((message) => message.method === 'notifications/progress').map((message) => `${message.params.progressToken}:${message.params.message}`);
    expect(progressOf(one)).toEqual(['tok-first:progress for first']);
    expect(progressOf(two)).toEqual(['tok-second:progress for second']);
    expect(one.messages.at(-1)?.result?.structuredContent).toEqual({ question: 'first', answer: 'answer for first' });
    expect(two.messages.at(-1)?.result?.structuredContent).toEqual({ question: 'second', answer: 'answer for second' });
  });

  it('keeps concurrent principals apart while their slow reads overlap and finish out of order', async () => {
    const release = { alice: gate(), bob: gate() };
    const backend: SubscriptionBackend = {
      async listSubscriptions(accountId) {
        await (accountId.endsWith('alice') ? release.alice : release.bob).opened;
        return { displayName: accountId.endsWith('alice') ? 'Alice' : 'Bob', subscriptions: [] };
      },
    };
    const listener = await start({ subscriptions: { viewHtml: VIEW_HTML, backend, verifier: createDevelopmentVerifier() } });
    const alice = send(listener.subscriptionsUrl ?? '', callSubscriptions({}, 1), bearer(DEV_TOKENS.alice));
    const bob = send(listener.subscriptionsUrl ?? '', callSubscriptions({}, 1), bearer(DEV_TOKENS.bob));
    await new Promise((resolve) => setTimeout(resolve, 40));
    release.bob.open();
    expect((await bob).messages[0]?.result?.structuredContent).toMatchObject({ displayName: 'Bob' });
    release.alice.open();
    expect((await alice).messages[0]?.result?.structuredContent).toMatchObject({ displayName: 'Alice' });
  });
});

describe('what a caller’s own claims cannot do', () => {
  it('does not let client-side prerequisites, forwarded headers or tool arguments authorize a protected handler', async () => {
    const lookups: string[] = [];
    const listener = await start({
      subscriptions: { viewHtml: VIEW_HTML, verifier: createDevelopmentVerifier(), backend: { listSubscriptions: async (accountId) => void lookups.push(accountId) } },
    });
    const claims = {
      status: 'active',
      authorized: true,
      prerequisite: 'satisfied',
      accountId: 'acct-synthetic-bob',
      signedIn: true,
    };
    const forged = { 'x-forwarded-user': 'acct-synthetic-bob', 'x-authenticated': 'true', cookie: 'session=bob' };
    const anonymous = await send(listener.subscriptionsUrl ?? '', callSubscriptions(claims), forged);
    expect(layers(anonymous)).toMatchObject({ http: 401, challenge: true });
    const serviceOnly = await send(listener.subscriptionsUrl ?? '', callSubscriptions(claims), { ...forged, ...bearer(DEV_TOKENS.service) });
    expect(layers(serviceOnly)).toMatchObject({ http: 403, challenge: true });
    expect(lookups).toEqual([]);
    // A real sign-in reads its own account, whatever the claims say.
    const alice = await send(listener.subscriptionsUrl ?? '', callSubscriptions(claims), { ...forged, ...bearer(DEV_TOKENS.alice) });
    expect(alice.status).toBe(200);
    expect(lookups).toEqual(['acct-synthetic-alice']);
  });

  it('gives a public operation no identity even when the caller presents one', async () => {
    const seen: unknown[] = [];
    const listener = await start({
      answer: { viewHtml: VIEW_HTML, backend: { answer: async (question, request) => (seen.push(Object.keys(request).sort()), `Answer to ${question}`) } },
    });
    const wire = await send(listener.answerUrl ?? '', callAnswer('Who am I?'), { ...bearer(DEV_TOKENS.alice), 'x-forwarded-user': 'acct-synthetic-alice' });
    expect(wire.messages[0]?.result?.isError).toBeUndefined();
    expect(seen).toEqual([['reportProgress', 'signal', 'within']]);
  });
});
