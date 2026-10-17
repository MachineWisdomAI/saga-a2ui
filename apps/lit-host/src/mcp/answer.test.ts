import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANSWER_INVALID_OUTPUT_TEXT,
  ANSWER_LIMITS,
  ANSWER_NOT_AVAILABLE_TEXT,
  ANSWER_TOOL_NAME,
  ANSWER_UNAVAILABLE_TEXT,
  ANSWER_VIEW_URI,
} from './answer.js';
import type { AnswerBackend } from './answer-server.js';
import { startEpisodeListener, type EpisodeListener } from './listener.js';

// The public answer operation, exercised through the real listener and a real MCP client in both
// supported response modes. Nothing here supplies a credential unless a test says it does.

const VIEW_HTML = '<!doctype html><title>answer</title>';
const CANARY = 'canary-backend-secret';

interface Calls {
  readonly questions: string[];
  readonly signals: AbortSignal[];
}

const open: { listener?: EpisodeListener; clients: Client[] } = { clients: [] };

async function start(
  mode: 'json' | 'event-stream',
  backend: AnswerBackend,
  answerBoundMs?: number,
): Promise<{ listener: EpisodeListener; connect: (headers?: Record<string, string>) => Promise<Client> }> {
  const listener = await startEpisodeListener({
    viewHtml: VIEW_HTML,
    catalog: { find: () => undefined },
    port: 0,
    answer: { viewHtml: VIEW_HTML, backend, responseMode: mode, ...(answerBoundMs === undefined ? {} : { answerBoundMs }) },
  });
  open.listener = listener;
  return {
    listener,
    async connect(headers) {
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(listener.answerUrl ?? ''), { requestInit: { headers: headers ?? {} } }));
      open.clients.push(client);
      return client;
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(open.clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await open.listener?.close();
  open.listener = undefined;
});

const ask = (client: Client, question: unknown, options?: Parameters<Client['callTool']>[1]) =>
  client.callTool({ name: ANSWER_TOOL_NAME, arguments: { question } }, options);

function recording(answerFor: (question: string) => string | undefined = (question) => `Answer to: ${question}`): { backend: AnswerBackend; calls: Calls } {
  const calls: Calls = { questions: [], signals: [] };
  return {
    calls,
    backend: {
      async answer(question, request) {
        calls.questions.push(question);
        calls.signals.push(request.signal);
        return answerFor(question);
      },
    },
  };
}

describe.each(['json', 'event-stream'] as const)('public answer operation (%s responses)', (mode) => {
  it('answers the exact question asked, once, with the question echoed beside the answer', async () => {
    const { backend, calls } = recording();
    const { connect } = await start(mode, backend);
    const result = await ask(await connect(), '  Why is the sky blue?  ');
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ question: '  Why is the sky blue?  ', answer: 'Answer to:   Why is the sky blue?  ' });
    expect(calls.questions).toEqual(['  Why is the sky blue?  ']);
  });

  it('declares a read-only tool and view without asking for any credential', async () => {
    const { backend } = recording();
    const { connect, listener } = await start(mode, backend);
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([ANSWER_TOOL_NAME]);
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools[0]?._meta).toMatchObject({ ui: { resourceUri: ANSWER_VIEW_URI } });
    const { contents } = await client.readResource({ uri: ANSWER_VIEW_URI });
    expect(contents[0]).toMatchObject({ uri: ANSWER_VIEW_URI, text: VIEW_HTML });
    // A bare request with no Authorization header is answered, not challenged.
    const raw = await fetch(listener.answerUrl ?? '', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('www-authenticate')).toBeNull();
  });

  it('does not treat a presented credential as an identity', async () => {
    const { backend, calls } = recording();
    const { connect } = await start(mode, backend);
    const client = await connect({ authorization: 'Bearer not-a-real-token' });
    const result = await ask(client, 'Who am I?');
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result)).not.toContain('not-a-real-token');
    expect(calls.questions).toEqual(['Who am I?']);
  });

  it.each([
    ['an empty question', ''],
    ['a non-string question', 7],
    ['an over-long question', 'q'.repeat(ANSWER_LIMITS.maxQuestion + 1)],
  ])('refuses %s before the application is asked', async (_name, question) => {
    const { backend, calls } = recording();
    const { connect } = await start(mode, backend);
    const result = await ask(await connect(), question).catch((error: unknown) => error);
    expect(result instanceof Error || (result as { isError?: boolean }).isError === true).toBe(true);
    expect(calls.questions).toEqual([]);
  });

  it('answers a missing answer with the declared text and no data', async () => {
    const { backend } = recording(() => undefined);
    const { connect } = await start(mode, backend);
    const result = await ask(await connect(), 'Unknown?');
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: ANSWER_NOT_AVAILABLE_TEXT }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it('turns a failing application into a safe failure without its message', async () => {
    const calls: string[] = [];
    const { connect } = await start(mode, {
      async answer(question) {
        calls.push(question);
        throw new Error(`database exploded: ${CANARY}`);
      },
    });
    const result = await ask(await connect(), 'Anything?');
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: ANSWER_UNAVAILABLE_TEXT }]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(calls).toEqual(['Anything?']); // failure is not retried behind the caller's back
  });

  it('does not publish an answer that breaks the contract, nor the validator message', async () => {
    const { backend } = recording(() => `${CANARY}${'x'.repeat(ANSWER_LIMITS.maxAnswer)}`);
    const { connect } = await start(mode, backend);
    const result = await ask(await connect(), 'Too long?');
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: ANSWER_INVALID_OUTPUT_TEXT }]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(result.structuredContent).toBeUndefined();
  });

  it('completes a delayed answer, reporting progress in order while it waits', async () => {
    let release: (answer: string) => void = () => undefined;
    const delayed = new Promise<string>((resolve) => (release = resolve));
    const started: string[] = [];
    const { connect } = await start(mode, {
      async answer(question, request) {
        started.push(question);
        await request.reportProgress({ progress: 1, total: 3, message: 'searching' });
        await request.reportProgress({ progress: 2, total: 3, message: 'writing' });
        return delayed;
      },
    });
    const client = await connect();
    const seen: string[] = [];
    const pending = ask(client, 'Slowly?', { onprogress: (progress) => void seen.push(String(progress.message)) });
    await expect.poll(() => started.length).toBe(1);
    const state = await Promise.race([pending.then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('waiting'), 60))]);
    expect(state).toBe('waiting'); // still one outstanding request: delayed, not failed
    release('Eventually.');
    const result = await pending;
    expect(result.structuredContent).toEqual({ question: 'Slowly?', answer: 'Eventually.' });
    expect(started).toEqual(['Slowly?']);
    // Progress is only visible to the caller when the answer is streamed.
    if (mode === 'event-stream') expect(seen).toEqual(['searching', 'writing']);
  });

  it('retires an answer that outlasts its bound; a late answer is not returned', async () => {
    let release: (answer: string) => void = () => undefined;
    const late = new Promise<string>((resolve) => (release = resolve));
    const { connect } = await start(mode, { answer: () => late }, 40);
    const result = await ask(await connect(), 'Never in time?');
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: ANSWER_UNAVAILABLE_TEXT }]);
    release(`${CANARY} late answer`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(JSON.stringify(result)).not.toContain(CANARY);
  });

  it('aborts the application’s signal when the caller disconnects, and its late answer has nowhere to go', async () => {
    let release: (answer: string) => void = () => undefined;
    const late = new Promise<string>((resolve) => (release = resolve));
    const signals: AbortSignal[] = [];
    const { listener } = await start(mode, {
      answer: (_question, request) => {
        signals.push(request.signal);
        return late;
      },
    });
    const controller = new AbortController();
    const call = fetch(listener.answerUrl ?? '', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: ANSWER_TOOL_NAME, arguments: { question: 'Hello?' } } }),
    }).catch((error: unknown) => error);
    await expect.poll(() => signals.length).toBe(1);
    controller.abort();
    await call;
    await expect.poll(() => signals[0]?.aborted).toBe(true);
    release('too late');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signals).toHaveLength(1);
  });

  it('keeps the question out of ordinary logs', async () => {
    const written: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void written.push(args.map(String).join(' ')));
    }
    const { backend } = recording();
    const { connect } = await start(mode, backend);
    await ask(await connect(), 'canary-question-text');
    expect(written.join('\n')).not.toContain('canary-question-text');
  });
});

describe('the answer endpoint', () => {
  it('does not exist unless the application configured it', async () => {
    const listener = await startEpisodeListener({ viewHtml: VIEW_HTML, catalog: { find: () => undefined }, port: 0 });
    open.listener = listener;
    expect(listener.answerUrl).toBeUndefined();
    const response = await fetch(new URL('/answer/mcp', listener.url), { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('streams server-sent events only when the application chose them', async () => {
    const { backend } = recording();
    const sse = await start('event-stream', backend);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: ANSWER_TOOL_NAME, arguments: { question: 'Hi?' } } });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const streamed = await fetch(sse.listener.answerUrl ?? '', { method: 'POST', headers, body });
    expect(streamed.headers.get('content-type')).toContain('text/event-stream');
    await streamed.text();
    await open.listener?.close();

    const json = await start('json', backend);
    const single = await fetch(json.listener.answerUrl ?? '', { method: 'POST', headers, body });
    expect(single.headers.get('content-type')).toContain('application/json');
  });
});
