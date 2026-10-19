import { ServerResponse } from 'node:http';
import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CLOSED_VIEW_CSP } from '../policy/index.js';
import {
  createServerBudgets,
  registerProtectedOperation,
  registerPublicOperation,
  type LifetimeCause,
  type OperationOutcome,
  type OperationRequest,
  type Projection,
  type RequestLifetime,
} from './index.js';
import { startTestHost, type TestHost } from './http-host.test-support.js';

// CORE3: what happens to one server request when it is cancelled, abandoned, misbehaves or ends,
// observed on the wire. The connector is reached only through its public server export, served by
// a real Streamable HTTP transport, and called by raw HTTP and a real MCP client. The domain is
// deliberately unrelated to any SAGA application.

const Input = z.object({ id: z.string().min(1).max(16) });
const Output = z.strictObject({ id: z.string().max(16), text: z.string().max(64) });
const VIEW = { uri: 'ui://test/lifecycle.html', title: 'Lifecycle view', html: '<!doctype html>', csp: CLOSED_VIEW_CSP };
const FAILURES = { absent: 'Not found.', unavailable: 'Unavailable.', invalidOutput: 'Could not be shown.', signInRequired: 'Sign in.' } as const;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const CANARY = 'canary-private-value';

const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const MODES = [
  ['JSON', true],
  ['server-sent events', false],
] as const;

const callTool = (id: number, tool: string) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: { id: 'a' } } });
const cancelled = (requestId: number) => ({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId } });

const open: { host?: TestHost } = {};
afterEach(async () => {
  vi.restoreAllMocks();
  await open.host?.close();
  open.host = undefined;
});

const alice: AuthInfo = { token: 't', clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId: 'acct-alice' } };

interface Probe {
  readonly handled: AbortSignal[];
  readonly projected: string[];
  readonly resolved: number[];
  /** The lifetime each built server ran in, so a test can read the typed causes. */
  readonly lifetimes: RequestLifetime[];
}

const newProbe = (): Probe => ({ handled: [], projected: [], resolved: [], lifetimes: [] });

interface Behaviour {
  readonly handle?: (request: OperationRequest) => OperationOutcome<string> | Promise<OperationOutcome<string>>;
  readonly project?: (record: string) => Projection;
  readonly identity?: (authInfo: AuthInfo | undefined) => unknown;
  readonly budgets?: Parameters<typeof createServerBudgets>[0];
}

/** One per-request server for both access modes: `read` is public, `mine` is protected. */
function serverFor(probe: Probe, behaviour: Behaviour = {}) {
  const budgets = createServerBudgets(behaviour.budgets);
  return (): McpServer => {
    const lifetime = budgets.startRequest();
    probe.lifetimes.push(lifetime);
    const server = new McpServer({ name: 'lifecycle-test', version: '0.0.0' });
    const shared = {
      title: 'Read',
      description: 'Reads.',
      annotations: READ_ONLY,
      input: Input,
      output: Output,
      view: VIEW,
      failures: FAILURES,
    };
    const handle = async (request: OperationRequest): Promise<OperationOutcome<string>> => {
      probe.handled.push(request.signal);
      return behaviour.handle ? behaviour.handle(request) : { kind: 'record', record: 'a' };
    };
    const project = (record: string): Projection => {
      probe.projected.push(record);
      return behaviour.project ? behaviour.project(record) : { text: record, data: { id: record, text: 'ok' } };
    };
    registerPublicOperation(
      server,
      { ...shared, name: 'read', view: { ...VIEW, uri: 'ui://test/read.html', title: 'Read view' }, handle: (_input, request) => handle(request), project },
      { lifetime },
    );
    registerProtectedOperation(
      server,
      {
        ...shared,
        name: 'mine',
        view: { ...VIEW, uri: 'ui://test/mine.html', title: 'Mine view' },
        identity: (authInfo) => {
          probe.resolved.push(probe.resolved.length);
          return (behaviour.identity ? behaviour.identity(authInfo) : { accountId: authInfo?.extra?.accountId }) as { accountId: string } | undefined;
        },
        handle: (_input, _identity, request) => handle(request),
        project: (record) => project(record),
      },
      { lifetime },
    );
    return server;
  };
}

async function host(probe: Probe, jsonResponse: boolean, behaviour?: Behaviour): Promise<TestHost> {
  open.host = await startTestHost({
    jsonResponse,
    buildServer: serverFor(probe, behaviour),
    authenticate: (credential) => (credential === 'alice' ? alice : undefined),
  });
  return open.host;
}

/** Posts raw JSON-RPC and gives the caller `waitMs` for an answer; a cancelled request gets none. */
async function post(url: URL, body: unknown, options: { credential?: string; waitMs?: number } = {}): Promise<{ status?: number; text?: string }> {
  const waiting = new AbortController();
  const timer = setTimeout(() => waiting.abort(), options.waitMs ?? 1_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...HEADERS, ...(options.credential ? { 'x-test-credential': options.credential } : {}) },
      signal: waiting.signal,
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text().catch(() => undefined) };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

const causesOf = (probe: Probe): LifetimeCause[] => probe.lifetimes.flatMap((lifetime) => [...lifetime.causes]);

describe('a request cancelled before its handler could start', () => {
  it('reaches a tool callback with an already-aborted signal in the pinned SDK', async () => {
    // Characterization of the dependency, not of this package: it is why the connector has to check.
    const seen: boolean[] = [];
    open.host = await startTestHost({
      jsonResponse: true,
      buildServer: () => {
        const server = new McpServer({ name: 'probe', version: '0.0.0' });
        server.registerTool('read', { inputSchema: Input }, async (_args, ctx) => {
          seen.push(ctx.mcpReq.signal.aborted);
          return { content: [{ type: 'text', text: 'x' }] };
        });
        return server;
      },
    });
    await post(open.host.url, [callTool(1, 'read'), cancelled(1)], { waitMs: 300 });
    expect(seen).toEqual([true]);
  });

  it.each(MODES)('does not enter a public handler or project anything (%s)', async (_name, jsonResponse) => {
    const probe = newProbe();
    const started = await host(probe, jsonResponse);
    await post(started.url, [callTool(1, 'read'), cancelled(1)], { waitMs: 300 });
    expect(probe.handled).toEqual([]);
    expect(probe.projected).toEqual([]);
    // Nothing is left half-served: the next request runs its handler once.
    const client = await started.connect();
    const next = await client.callTool({ name: 'read', arguments: { id: 'a' } });
    expect(next.structuredContent).toEqual({ id: 'a', text: 'ok' });
    expect(probe.handled).toHaveLength(1);
  });

  it.each(MODES)('does not resolve an identity or enter a protected handler (%s)', async (_name, jsonResponse) => {
    const probe = newProbe();
    const started = await host(probe, jsonResponse);
    await post(started.url, [callTool(1, 'mine'), cancelled(1)], { credential: 'alice', waitMs: 300 });
    expect(probe.resolved).toEqual([]);
    expect(probe.handled).toEqual([]);
    expect(probe.projected).toEqual([]);
  });
});

describe('cancelling a request that is already running', () => {
  /** Starts a call whose handler waits on its own signal and a release, over raw HTTP. */
  async function startSlowCall(jsonResponse: boolean) {
    const probe = newProbe();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = await host(probe, jsonResponse, {
      handle: async () => {
        await gate;
        return { kind: 'record', record: 'a' };
      },
    });
    const controller = new AbortController();
    const answer = fetch(started.url, { method: 'POST', headers: HEADERS, signal: controller.signal, body: JSON.stringify(callTool(7, 'read')) })
      .then(async (response) => ({ status: response.status, text: await response.text() }))
      .catch(() => undefined);
    await expect.poll(() => probe.handled.length).toBe(1);
    return { probe, started, controller, answer, release };
  }

  it.each(MODES)('treats the same request’s disconnection as cancellation and does no further work (%s)', async (_name, jsonResponse) => {
    const { probe, controller, answer, release } = await startSlowCall(jsonResponse);
    controller.abort();
    await answer;
    await expect.poll(() => probe.handled[0]?.aborted).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(probe.projected).toEqual([]); // the late record was never projected
    expect(probe.handled).toHaveLength(1);
    expect(causesOf(probe).map((cause) => cause.kind)).toContain('cancelled');
  });

  it.each(MODES)('does not let a separately posted notifications/cancelled stop a stateless request (%s)', async (_name, jsonResponse) => {
    // Each POST has its own server and transport and the connector keeps no process-wide request
    // registry, so a notification posted on another connection can name no running request.
    const { probe, started, answer, release } = await startSlowCall(jsonResponse);
    const separate = await post(started.url, cancelled(7));
    expect(separate.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(probe.handled[0]?.aborted).toBe(false);
    release();
    const result = await answer;
    expect(result?.status).toBe(200);
    expect(result?.text).toContain('"structuredContent"');
    expect(probe.handled).toHaveLength(1);
  });
});

describe('every callback that stalls, throws or misreports', () => {
  const stall = new Promise<never>(() => undefined);
  const cases: readonly [string, Behaviour, 'unavailable' | 'invalidOutput'][] = [
    ['a handler that throws', { handle: () => { throw new Error(`boom ${CANARY}`); } }, 'unavailable'],
    ['a handler that rejects', { handle: () => Promise.reject(new Error(`boom ${CANARY}`)) }, 'unavailable'],
    ['a handler that never settles', { handle: () => stall, budgets: { operationMs: 40 } }, 'unavailable'],
    ['a projection that throws', { project: () => { throw new Error(`boom ${CANARY}`); } }, 'unavailable'],
    ['a projection that is not an object', { project: () => undefined as unknown as Projection }, 'invalidOutput'],
    ['a projection whose text is not a string', { project: () => ({ text: { canary: CANARY } as unknown as string, data: { id: 'a', text: 'ok' } }) }, 'invalidOutput'],
    ['a projection whose data break the contract', { project: () => ({ text: 'a', data: { id: 'a', text: 'ok', extra: CANARY } }) }, 'invalidOutput'],
    ['a projection whose data are oversized', { project: () => ({ text: 'a', data: { id: 'a', text: CANARY.repeat(100_000) } }) }, 'invalidOutput'],
  ];

  describe.each(MODES)('over %s', (_name, jsonResponse) => {
    it.each(cases)('answers %s with the declared failure alone', async (_label, behaviour, text) => {
      const probe = newProbe();
      const client = await (await host(probe, jsonResponse, behaviour)).connect('alice');
      for (const tool of ['read', 'mine']) {
        const result = await client.callTool({ name: tool, arguments: { id: 'a' } });
        expect(result.isError, tool).toBe(true);
        expect(result.content, tool).toEqual([{ type: 'text', text: FAILURES[text] }]);
        expect(result.structuredContent, tool).toBeUndefined();
        expect(JSON.stringify(result), tool).not.toContain(CANARY);
      }
    });
  });

  it('answers an identity resolver that throws, without running the handler or naming the error', async () => {
    const probe = newProbe();
    const client = await (await host(probe, true, { identity: () => { throw new Error(CANARY); } })).connect('alice');
    const result = await client.callTool({ name: 'mine', arguments: { id: 'a' } });
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.unavailable }]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(probe.handled).toEqual([]);
  });

  it.each([
    ['resolves', () => Promise.resolve({ accountId: 'acct-alice' })],
    ['rejects', () => Promise.reject(new Error(CANARY))],
  ])('refuses an identity resolver whose promise %s instead of returning an identity', async (_name, identity) => {
    // An asynchronous resolver would otherwise hand the handler a Promise as the principal.
    const probe = newProbe();
    const client = await (await host(probe, true, { identity })).connect('alice');
    const result = await client.callTool({ name: 'mine', arguments: { id: 'a' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.unavailable }]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(probe.handled).toEqual([]);
    expect(causesOf(probe)).toEqual([expect.objectContaining({ kind: 'dependency-failure', stage: 'authentication' })]);
  });

  it.each(MODES)('answers an identity whose `then` accessor throws with the declared failure alone (%s)', async (_name, jsonResponse) => {
    // Inspecting the returned identity is inside the same boundary as calling the resolver, so what
    // the accessor throws is kept as the typed authentication cause and never reaches the SDK.
    const probe = newProbe();
    const identity = () => Object.defineProperty({}, 'then', { get: () => { throw new Error(CANARY); } });
    const client = await (await host(probe, jsonResponse, { identity })).connect('alice');
    const result = await client.callTool({ name: 'mine', arguments: { id: 'a' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.unavailable }]);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(probe.handled).toEqual([]);
    expect(causesOf(probe)).toEqual([
      expect.objectContaining({ kind: 'dependency-failure', stage: 'authentication', effect: 'none', error: expect.objectContaining({ message: CANARY }) }),
    ]);
  });

  describe.each(MODES)('a handler outcome or projection that is not the declared shape, over %s', (_name, jsonResponse) => {
    const outcomes: readonly [string, unknown, 'invalidOutput' | 'absent'][] = [
      ['an unknown outcome kind', { kind: 'not-a-valid-outcome', record: 'a' }, 'invalidOutput'],
      ['no outcome at all', undefined, 'invalidOutput'],
      ['a refusal without text', { kind: 'refused' }, 'invalidOutput'],
      ['a refusal whose text is not a string', { kind: 'refused', text: { canary: CANARY } }, 'invalidOutput'],
      ['a refusal with empty text', { kind: 'refused', text: '' }, 'invalidOutput'],
    ];
    it.each(outcomes)('answers %s with the declared failure and projects nothing', async (_label, outcome, text) => {
      const probe = newProbe();
      const client = await (await host(probe, jsonResponse, { handle: () => outcome as OperationOutcome<string> })).connect('alice');
      for (const tool of ['read', 'mine']) {
        const result = await client.callTool({ name: tool, arguments: { id: 'a' } });
        expect(result.isError, tool).toBe(true);
        expect(result.content, tool).toEqual([{ type: 'text', text: FAILURES[text] }]);
        expect(result.structuredContent, tool).toBeUndefined();
        expect(JSON.stringify(result), tool).not.toContain(CANARY);
      }
      expect(probe.projected).toEqual([]);
    });

    it('still passes a well-formed refusal’s own text through', async () => {
      const probe = newProbe();
      const client = await (await host(probe, jsonResponse, { handle: () => ({ kind: 'refused', text: 'That is not allowed.' }) })).connect('alice');
      const result = await client.callTool({ name: 'read', arguments: { id: 'a' } });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: 'That is not allowed.' }]);
    });

    it.each([
      ['rejects', () => Promise.reject(new Error(CANARY))],
      ['resolves', () => Promise.resolve({ text: 'a', data: { id: 'a', text: 'ok' } })],
    ])('refuses an asynchronous projection that %s and consumes its rejection', async (_label, project) => {
      const unhandled: unknown[] = [];
      const record = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', record);
      try {
        const probe = newProbe();
        const client = await (await host(probe, jsonResponse, { project: project as unknown as (record: string) => Projection })).connect('alice');
        for (const tool of ['read', 'mine']) {
          const result = await client.callTool({ name: tool, arguments: { id: 'a' } });
          expect(result.isError, tool).toBe(true);
          expect(result.content, tool).toEqual([{ type: 'text', text: FAILURES.invalidOutput }]);
          expect(JSON.stringify(result), tool).not.toContain(CANARY);
        }
        // Unhandled rejections are reported after the microtask queue drains and a tick passes.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', record);
      }
    });
  });

  it('keeps the typed cause of each failure for the application and out of the answer', async () => {
    const probe = newProbe();
    const client = await (await host(probe, true, { handle: () => Promise.reject(new Error(CANARY)) })).connect();
    await client.callTool({ name: 'read', arguments: { id: 'a' } });
    const [cause] = causesOf(probe);
    expect(cause).toMatchObject({ kind: 'dependency-failure', stage: 'handler' });
  });
});

describe('writes after the request has ended', () => {
  /**
   * Records every call that would put bytes or headers on a response that was already destroyed or
   * ended. Observing the client alone cannot show this: a destroyed socket swallows what is
   * written to it. A bare `end()` carries nothing: it is the transport's idempotent close.
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

  it.each(MODES)('makes none after the caller has gone, whatever the handler later reports or returns (%s)', async (_name, jsonResponse) => {
    const late = watchClosedWrites();
    const probe = newProbe();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reports: Promise<void>[] = [];
    const started = await host(probe, jsonResponse, {
      handle: async (request) => {
        await request.reportProgress({ progress: 1, total: 3, message: 'working' });
        await gate;
        reports.push(request.reportProgress({ progress: 2, total: 3, message: 'late' }));
        return { kind: 'record', record: 'a' };
      },
    });
    const controller = new AbortController();
    const withProgress = { ...callTool(1, 'read'), params: { ...callTool(1, 'read').params, _meta: { progressToken: 'p' } } };
    const answer = fetch(started.url, { method: 'POST', headers: HEADERS, signal: controller.signal, body: JSON.stringify(withProgress) })
      .then((response) => response.text())
      .catch(() => undefined);
    await expect.poll(() => probe.handled.length).toBe(1);
    controller.abort();
    await answer;
    await expect.poll(() => probe.handled[0]?.aborted).toBe(true);
    release();
    await expect.poll(() => reports.length).toBe(1);
    await expect(reports[0]).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(probe.projected).toEqual([]);
    expect(late).toEqual([]);
  });

  it.each(MODES)('makes none after the request deadline answered, and the late record is never projected (%s)', async (_name, jsonResponse) => {
    const late = watchClosedWrites();
    const probe = newProbe();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = await host(probe, jsonResponse, {
      budgets: { operationMs: 40 },
      handle: async () => {
        await gate;
        return { kind: 'record', record: 'a' };
      },
    });
    const client = await started.connect();
    const result = await client.callTool({ name: 'read', arguments: { id: 'a' } });
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.unavailable }]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(probe.projected).toEqual([]);
    expect(late).toEqual([]);
  });
});
