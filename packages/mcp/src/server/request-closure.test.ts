import {
  McpServer,
  createMcpHandler,
  type Transport,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RequestLifetimeAttachmentError,
  attachRequestLifetime,
  createServerBudgets,
  type RequestLifetime,
} from './index.js';

// SOC11: an application that builds one MCP server per request must not subclass `McpServer`
// to finish the request's lifetime when the server closes. These tests observe the lifetime
// through its public contract (`cause`, `causes`) and through `finish` calls, reaching the
// helper only through the package's server export.

afterEach(() => {
  vi.useRealTimers();
});

const newServer = () =>
  new McpServer({ name: 'closure-test', version: '0.0.0' });

/** A lifetime whose `finish` calls are counted, without replacing its behaviour. */
function countedLifetime(requestMs = 10_000): {
  lifetime: RequestLifetime;
  finishes: () => number;
} {
  const lifetime = createServerBudgets({ requestMs }).startRequest();
  const finish = vi.spyOn(lifetime, 'finish');
  return { lifetime, finishes: () => finish.mock.calls.length };
}

/** A transport that records nothing and closes the way a real one does: `close` fires `onclose`. */
function fakeTransport(options: { failOnClose?: Error } = {}): Transport {
  const transport: Transport = {
    start: () => Promise.resolve(),
    send: () => Promise.resolve(),
    close: () => {
      if (options.failOnClose) return Promise.reject(options.failOnClose);
      transport.onclose?.();
      return Promise.resolve();
    },
  };
  return transport;
}

describe('attachRequestLifetime', () => {
  it('finishes the lifetime once when the transport closes after a connection', async () => {
    const server = newServer();
    const { lifetime, finishes } = countedLifetime();
    attachRequestLifetime(server, lifetime);
    const transport = fakeTransport();
    await server.connect(transport);
    expect(finishes()).toBe(0);

    transport.onclose?.();
    expect(finishes()).toBe(1);
    expect(lifetime.cause).toEqual({ kind: 'completed' });

    await server.close(); // the application closes it as well
    expect(finishes()).toBe(1);
  });

  it('finishes the lifetime when close() runs before any transport connected', async () => {
    const server = newServer();
    const { lifetime, finishes } = countedLifetime();
    attachRequestLifetime(server, lifetime);

    await server.close();

    expect(finishes()).toBe(1);
    expect(lifetime.cause).toEqual({ kind: 'completed' });
  });

  it('finishes the lifetime once when close() is called twice', async () => {
    const server = newServer();
    const { lifetime, finishes } = countedLifetime();
    attachRequestLifetime(server, lifetime);

    await server.close();
    await server.close();

    expect(finishes()).toBe(1);
  });

  it('finishes the lifetime when the upstream close throws, and still reports the failure', async () => {
    const server = newServer();
    const { lifetime, finishes } = countedLifetime();
    attachRequestLifetime(server, lifetime);
    const failure = new Error('transport refused to close');
    await server.connect(fakeTransport({ failOnClose: failure }));

    await expect(server.close()).rejects.toBe(failure);

    expect(finishes()).toBe(1);
    expect(lifetime.cause).toEqual({ kind: 'completed' });
  });

  it('keeps a close callback the application installed before attaching', async () => {
    const server = newServer();
    const { lifetime, finishes } = countedLifetime();
    const closed = vi.fn();
    server.server.onclose = closed;
    attachRequestLifetime(server, lifetime);
    const transport = fakeTransport();
    await server.connect(transport);

    transport.onclose?.();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(finishes()).toBe(1);
  });

  it('finishes even when an earlier close callback throws', async () => {
    const server = newServer();
    const { lifetime, finishes } = countedLifetime();
    server.server.onclose = () => {
      throw new Error('callback failed');
    };
    attachRequestLifetime(server, lifetime);
    const transport = fakeTransport();
    await server.connect(transport);

    expect(() => transport.onclose?.()).toThrow('callback failed');
    expect(finishes()).toBe(1);
  });

  it('treats a second application of the same lifetime as no change', async () => {
    const server = newServer();
    const { lifetime, finishes } = countedLifetime();
    attachRequestLifetime(server, lifetime);
    attachRequestLifetime(server, lifetime);

    await server.close();

    expect(finishes()).toBe(1);
  });

  it('refuses a different lifetime for a server that already has one, leaving both untouched', async () => {
    const server = newServer();
    const first = countedLifetime();
    const second = countedLifetime();
    attachRequestLifetime(server, first.lifetime);

    expect(() => attachRequestLifetime(server, second.lifetime)).toThrow(
      RequestLifetimeAttachmentError,
    );
    await server.close();

    expect(first.finishes()).toBe(1);
    expect(second.finishes()).toBe(0);
    expect(second.lifetime.cause).toBeUndefined();
    second.lifetime.finish();
  });
});

describe('a stateless handler factory', () => {
  const LISTEN_META = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
  };

  /**
   * `subscriptions/listen` is a request the pinned handler answers by closing the per-request
   * server it just built, before any transport is connected to it.
   */
  function listen(
    handler: ReturnType<typeof createMcpHandler>,
    signal: AbortSignal,
  ): Promise<Response> {
    const parsedBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'subscriptions/listen',
      params: { notifications: {}, _meta: LISTEN_META },
    };
    return handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'subscriptions/listen',
        },
        body: JSON.stringify(parsedBody),
        signal,
      }),
      { parsedBody },
    );
  }

  /** Runs one request through a factory that starts a lifetime per request, as the adapters do. */
  async function serve(attach: boolean): Promise<RequestLifetime> {
    vi.useFakeTimers();
    const budgets = createServerBudgets({ requestMs: 5_000 });
    const lifetimes: RequestLifetime[] = [];
    const handler = createMcpHandler(() => {
      const lifetime = budgets.startRequest();
      lifetimes.push(lifetime);
      const server = new McpServer(
        { name: 'stateless-closure', version: '0.0.0' },
        { capabilities: { resources: { subscribe: true } } },
      );
      if (attach) attachRequestLifetime(server, lifetime);
      return server;
    });
    const abort = new AbortController();
    try {
      const response = await listen(handler, abort.signal);
      expect(response.status).toBe(200);
      await vi.advanceTimersByTimeAsync(5_001);
    } finally {
      abort.abort();
      await handler.close();
    }
    expect(lifetimes).toHaveLength(1);
    return lifetimes[0]!;
  }

  it('releases the request timer although no transport ever connected', async () => {
    const lifetime = await serve(true);

    expect(lifetime.cause).toEqual({ kind: 'completed' });
    expect(lifetime.causes).toEqual([]);
  });

  it('would otherwise let the request deadline expire (the scenario the helper removes)', async () => {
    const lifetime = await serve(false);

    expect(lifetime.cause).toMatchObject({ kind: 'request-timeout' });
  });
});
