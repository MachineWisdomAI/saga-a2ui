import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type FetchLike,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
} from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  admitUrl,
  ByteBudget,
  createAdmittedFetch,
  createConnector,
  createMcpClient,
  isAdmittedAddress,
  MAX_PAGE_ITEMS,
  NetworkRefused,
  openAdmittedMcp,
  refusalOf,
  SchemaIdentifierValidator,
} from './maintainer-network.js';

// The admission boundary of every maintainer network command. Each case states the request the
// boundary must stop and, beside it, the legitimate request that must still pass.

type Connector = FetchLike;

const seen = (
  answer: (url: URL, headers: Headers, method: string) => Response,
): { connector: Connector; log: { url: string; auth: string | null }[] } => {
  const log: { url: string; auth: string | null }[] = [];
  return {
    log,
    connector: async (input, init) => {
      const url = new URL(input);
      const headers = new Headers(init?.headers);
      log.push({ url: url.href, auth: headers.get('authorization') });
      return answer(url, headers, init?.method ?? 'GET');
    },
  };
};

const redirect = (to: string, status = 308): Response =>
  new Response(null, { status, headers: { location: to } });

const refusal = async (action: () => Promise<unknown>) => {
  try {
    await action();
  } catch (error) {
    return refusalOf(error)?.kind ?? `unrefused: ${String(error)}`;
  }
  return 'admitted';
};

describe('destination admission', () => {
  it.each([
    ['http://docs.example.test/', 'scheme'],
    ['ftp://docs.example.test/', 'scheme'],
    ['not a url', 'scheme'],
    ['https://user:secret@docs.example.test/', 'credentials'],
    ['https://localhost/', 'destination'],
    ['https://intranet/', 'destination'],
    ['https://service.internal/', 'destination'],
    ['https://127.0.0.1/', 'destination'],
    ['https://2130706433/', 'destination'],
    ['https://0x7f.1/', 'destination'],
    ['https://[::1]/', 'destination'],
    ['https://[::ffff:7f00:1]/', 'destination'],
  ] as const)('refuses %s', (url, kind) => {
    expect(() => admitUrl(url)).toThrow(NetworkRefused);
    try {
      admitUrl(url);
    } catch (error) {
      expect((error as NetworkRefused).kind).toBe(kind);
    }
  });

  it('admits an HTTPS URL to a public host name', () => {
    expect(admitUrl('https://docs.example.test/mcp').href).toBe(
      'https://docs.example.test/mcp',
    );
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::7f00:1',
    '64:ff9b:1::a00:1',
    '64:ff9b:1:ffff:ffff:ffff:c0a8:101',
    'fc00::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    'not an address',
  ])('does not admit the address %s', (address) => {
    expect(isAdmittedAddress(address)).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])(
    'admits the public address %s',
    (address) => {
      expect(isAdmittedAddress(address)).toBe(true);
    },
  );
});

describe('the connected address', () => {
  const server = async () => {
    const hits: string[] = [];
    const listener = http.createServer((request, response) => {
      hits.push(request.headers.host ?? '');
      response.end('reached');
    });
    await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
    return {
      port: (listener.address() as AddressInfo).port,
      hits,
      close: () => new Promise<void>((done) => listener.close(() => done())),
    };
  };
  const answering =
    (...addresses: string[]) =>
    (
      _host: string,
      _options: unknown,
      callback: (
        error: null,
        found: { address: string; family: number }[],
      ) => void,
    ) =>
      callback(
        null,
        addresses.map((address) => ({
          address,
          family: address.includes(':') ? 6 : 4,
        })),
      );

  it('is checked inside the connection, so a name that resolves to a private address never reaches the peer', async () => {
    const peer = await server();
    try {
      const connect = createConnector({
        resolve: answering('127.0.0.1'),
        request: http.request,
      });
      expect(
        await refusal(() =>
          connect(`http://rebound.example.test:${peer.port}/`),
        ),
      ).toBe('address');
      expect(peer.hits).toEqual([]);
    } finally {
      await peer.close();
    }
  });

  it('refuses a connection when any answer in the set is not public', async () => {
    const peer = await server();
    try {
      const connect = createConnector({
        resolve: answering('93.184.216.34', '127.0.0.1'),
        request: http.request,
      });
      expect(
        await refusal(() => connect(`http://mixed.example.test:${peer.port}/`)),
      ).toBe('address');
      expect(peer.hits).toEqual([]);
    } finally {
      await peer.close();
    }
  });

  it('refuses an IP literal that is not public without resolving anything', async () => {
    const connect = createConnector({
      resolve: () => {
        throw new Error('resolved');
      },
    });
    expect(await refusal(() => connect('https://10.0.0.5/'))).toBe('address');
  });

  it('connects to the address it was given when that address is admitted', async () => {
    const peer = await server();
    try {
      const connect = createConnector({
        resolve: answering('127.0.0.1'),
        admitAddress: () => true,
        request: http.request,
      });
      const response = await connect(
        `http://public.example.test:${peer.port}/`,
      );
      expect(await response.text()).toBe('reached');
      expect(peer.hits).toEqual([`public.example.test:${peer.port}`]);
    } finally {
      await peer.close();
    }
  });
});

describe('redirects and the credential', () => {
  const credential = {
    bearer: 'synthetic-bearer-0123456789',
    origin: 'https://api.example.test',
  };

  it('sends the credential to its own origin and to no other', async () => {
    const { connector, log } = seen(() => new Response('ok'));
    const admitted = createAdmittedFetch({ connector, credential });
    await admitted('https://api.example.test/mcp');
    await admitted('https://other.example.test/mcp');
    await admitted('https://api.example.test:8443/mcp');
    expect(log.map((one) => one.auth)).toEqual([
      `Bearer ${credential.bearer}`,
      null,
      null,
    ]);
  });

  it('replaces any authorization header a caller supplies', async () => {
    const { connector, log } = seen(() => new Response('ok'));
    const admitted = createAdmittedFetch({ connector });
    await admitted('https://api.example.test/mcp', {
      headers: { authorization: 'Bearer chosen-by-caller' },
    });
    expect(log[0]?.auth).toBeNull();
  });

  it('never follows a redirect from a request that carries the credential', async () => {
    const { connector, log } = seen(() =>
      redirect('https://attacker.example.test/collect'),
    );
    const admitted = createAdmittedFetch({ connector, credential });
    expect(await refusal(() => admitted('https://api.example.test/mcp'))).toBe(
      'redirect',
    );
    expect(log.map((one) => one.url)).toEqual(['https://api.example.test/mcp']);
  });

  it('never follows a redirect of a request that sends a body', async () => {
    const { connector, log } = seen(() =>
      redirect('https://docs.example.test/elsewhere', 307),
    );
    const admitted = createAdmittedFetch({ connector });
    expect(
      await refusal(() =>
        admitted('https://docs.example.test/mcp', {
          method: 'POST',
          body: '{}',
        }),
      ),
    ).toBe('redirect');
    expect(log).toHaveLength(1);
  });

  it('admits every hop of a redirect again', async () => {
    const { connector, log } = seen((url) =>
      url.pathname === '/'
        ? redirect('https://127.0.0.1/internal')
        : new Response('internal'),
    );
    const admitted = createAdmittedFetch({ connector });
    expect(await refusal(() => admitted('https://docs.example.test/'))).toBe(
      'destination',
    );
    expect(log.map((one) => one.url)).toEqual(['https://docs.example.test/']);
  });

  it('refuses a downgrade to HTTP and a redirect loop', async () => {
    const downgrade = createAdmittedFetch({
      connector: seen(() => redirect('http://docs.example.test/')).connector,
    });
    expect(await refusal(() => downgrade('https://docs.example.test/'))).toBe(
      'scheme',
    );
    const loop = seen(() => redirect('https://docs.example.test/again'));
    const looping = createAdmittedFetch({ connector: loop.connector });
    expect(await refusal(() => looping('https://docs.example.test/'))).toBe(
      'redirect',
    );
    expect(loop.log).toHaveLength(4);
  });

  it('follows a redirect between public hosts for a plain GET and sends no credential on it', async () => {
    const { connector, log } = seen((url) =>
      url.pathname === '/'
        ? redirect('https://docs.example.test/docs/start')
        : new Response('start'),
    );
    const admitted = createAdmittedFetch({ connector, credential });
    const response = await admitted('https://docs.example.test/');
    expect(await response.text()).toBe('start');
    expect(log.map((one) => one.url)).toEqual([
      'https://docs.example.test/',
      'https://docs.example.test/docs/start',
    ]);
    expect(log.every((one) => one.auth === null)).toBe(true);
  });
});

describe('response budgets', () => {
  const body = (bytes: number, headers: HeadersInit = {}) =>
    new Response(new Uint8Array(bytes), { headers });
  const streamed = (chunks: number, size: number) =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunks-- === 0) controller.close();
          else controller.enqueue(new Uint8Array(size));
        },
      }),
    );

  it('refuses a declared size above the limit before reading', async () => {
    const admitted = createAdmittedFetch({
      connector: async () => body(10, { 'content-length': '100000' }),
      maxResponseBytes: 1000,
    });
    expect(await refusal(() => admitted('https://docs.example.test/'))).toBe(
      'body-limit',
    );
  });

  it('stops a chunked body that grows past the limit', async () => {
    const admitted = createAdmittedFetch({
      connector: async () => streamed(100, 100),
      maxResponseBytes: 1000,
    });
    const response = await admitted('https://docs.example.test/');
    await expect(response.arrayBuffer()).rejects.toMatchObject({
      kind: 'body-limit',
    });
  });

  it('spends one budget across responses', async () => {
    const budget = new ByteBudget(250);
    const admitted = createAdmittedFetch({
      connector: async () => body(100),
      budget,
    });
    await (await admitted('https://docs.example.test/a')).arrayBuffer();
    await (await admitted('https://docs.example.test/a')).arrayBuffer();
    const third = await admitted('https://docs.example.test/c');
    await expect(third.arrayBuffer()).rejects.toMatchObject({
      kind: 'total-limit',
    });
  });

  it('reads a response within the limits unchanged', async () => {
    const admitted = createAdmittedFetch({
      connector: async () => new Response('fine', { status: 201 }),
      maxResponseBytes: 1000,
    });
    const response = await admitted('https://docs.example.test/');
    expect([response.status, await response.text()]).toEqual([201, 'fine']);
  });
});

describe('MCP operations', () => {
  const endpoint = (called: string[], count = 3) => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'peer', version: '1.0.0' });
      for (let i = 0; i < count; i += 1)
        server.registerTool(
          `tool_${i}`,
          {
            inputSchema: z.object({}),
            // The peer's own assertion about a tool; it must not authorize anything.
            annotations: { readOnlyHint: true },
          },
          () => (
            called.push(`tool_${i}`),
            { content: [{ type: 'text', text: 'done' }] }
          ),
        );
      return server;
    });
    return (url: string | URL, init?: RequestInit) =>
      handler.fetch(new Request(url, init));
  };
  const URL_ = 'https://peer.example.test/mcp';

  it('calls only the tool the local workflow named, whatever the peer asserts', async () => {
    const called: string[] = [];
    const session = await openAdmittedMcp(URL_, {
      clientName: 'test',
      connector: endpoint(called),
      authorizedTools: ['tool_1'],
    });
    try {
      expect(await refusal(() => session.callTool('tool_0', {}))).toBe(
        'operation',
      );
      expect((await session.callTool('tool_1', {})).isError).not.toBe(true);
      expect(called).toEqual(['tool_1']);
    } finally {
      await session.close();
    }
  });

  it('can call no tool at all in a read-only session', async () => {
    const called: string[] = [];
    const session = await openAdmittedMcp(URL_, {
      clientName: 'test',
      connector: endpoint(called),
      authorizedTools: [],
    });
    try {
      expect(await refusal(() => session.callTool('tool_0', {}))).toBe(
        'operation',
      );
      const page = await session.listTools();
      expect(page.items.map((tool) => tool.name)).toEqual([
        'tool_0',
        'tool_1',
        'tool_2',
      ]);
      expect(called).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('cuts a list page at the item limit and says so', async () => {
    const session = await openAdmittedMcp(URL_, {
      clientName: 'test',
      connector: endpoint([], MAX_PAGE_ITEMS + 5),
      authorizedTools: [],
    });
    try {
      const page = await session.listTools();
      expect(page.items.length).toBeLessThanOrEqual(MAX_PAGE_ITEMS);
      expect(page.capped).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('does not connect to a URL that is not admitted', async () => {
    let contacted = false;
    const connector: Connector = async () => {
      contacted = true;
      return new Response('x');
    };
    for (const url of [
      'http://peer.example.test/mcp',
      'https://127.0.0.1/mcp',
      'https://user:pw@peer.example.test/mcp',
    ])
      expect(
        await refusal(() =>
          openAdmittedMcp(url, {
            clientName: 'test',
            connector,
            authorizedTools: [],
          }),
        ),
      ).not.toBe('admitted');
    expect(contacted).toBe(false);
  });

  it('keeps the bearer on the connection origin and off a redirect', async () => {
    const seenAuth: (string | null)[] = [];
    const session = openAdmittedMcp(URL_, {
      clientName: 'test',
      authorizedTools: [],
      bearer: 'synthetic-bearer-0123456789',
      connector: async (input, init) => {
        seenAuth.push(new Headers(init?.headers).get('authorization'));
        return redirect('https://attacker.example.test/mcp');
      },
    });
    expect(await refusal(() => session)).toBe('redirect');
    expect(seenAuth).toEqual(['Bearer synthetic-bearer-0123456789']);
  });
});

// A peer's tool list carries JSON Schemas that the MCP client compiles with its bundled engine before
// a call, once a listing is cached. That engine parses every schema identifier and reference with a
// URI parser this repository does not control, so identifiers are constrained before compilation: a
// plain absolute or relative URI reference, optionally with a fragment. Anything else refuses that
// one tool, is never compiled, and the peer's other tools keep working.
describe('remote schema identifiers', () => {
  const URL_ = 'https://peer.example.test/mcp';
  // The peer's own server compiles what it registers, so the hostile schema is substituted in the
  // `tools/list` answer on the wire, as a peer that does not use this SDK would send it.
  const peer = (called: string[], outputSchema: Record<string, unknown>) => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'peer', version: '1.0.0' });
      server.registerTool(
        'probe',
        {
          inputSchema: z.object({}),
          outputSchema: fromJsonSchema({ type: 'object' }),
        },
        () => (
          called.push('probe'),
          { content: [{ type: 'text', text: 'done' }], structuredContent: {} }
        ),
      );
      return server;
    });
    const substitute = (message: unknown): unknown => {
      const tools = (message as { result?: { tools?: unknown } } | null)?.result
        ?.tools;
      if (Array.isArray(tools))
        for (const tool of tools as Record<string, unknown>[])
          tool.outputSchema = { type: 'object', ...outputSchema };
      return message;
    };
    return async (url: string | URL, init?: RequestInit) => {
      const response = await handler.fetch(new Request(url, init));
      const text = await response.text();
      const body = text.startsWith('{')
        ? JSON.stringify(substitute(JSON.parse(text)))
        : text.replace(
            /^data: (\{.*\})$/gm,
            (_line, json: string) =>
              `data: ${JSON.stringify(substitute(JSON.parse(json)))}`,
          );
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    };
  };
  // Lists through the client, which caches the listing the client then compiles a call's schema from.
  const call = async (outputSchema: Record<string, unknown>) => {
    const called: string[] = [];
    const client = createMcpClient('test');
    await client.connect(
      new StreamableHTTPClientTransport(new URL(URL_), {
        fetch: peer(called, outputSchema),
      }),
    );
    try {
      await client.listTools();
      let outcome = 'admitted';
      try {
        await client.callTool({ name: 'probe', arguments: {} });
      } catch (error) {
        outcome = String((error as Error).message);
      }
      return { outcome, called };
    } finally {
      await client.close();
    }
  };
  const REFUSED =
    /^Tool 'probe' has an invalid outputSchema: A tool schema names itself/;

  it.each([
    [
      'a percent-encoded dot segment in $id',
      { $id: 'https://peer.example.test/a/%2e%2e/b' },
    ],
    ['a dot segment in $id', { $id: 'https://peer.example.test/a/../b' }],
    [
      'a scheme that is not http or https in $id',
      { $id: 'javascript:alert(1)' },
    ],
    ['a percent-encoded scheme in $id', { $id: 'ja%76ascript:alert(1)' }],
    ['a %u-encoded scheme in $id', { $id: '%u006Aavascript:alert(1)' }],
    ['credentials in $id', { $id: 'https://user:pw@peer.example.test/s' }],
    ['two @ delimiters in the host of $id', { $id: 'http://a@b@evil.test/s' }],
    [
      'a control character in the host of $id',
      { $id: 'https://peer.example\ttest/s' },
    ],
    ['a colon in the first segment of a relative $id', { $id: 'a:b/c' }],
    ['a query in $id', { $id: 'https://peer.example.test/s?x=1' }],
    ['a backslash in $id', { $id: 'https://peer.example.test\\s' }],
    ['a non-string $id', { $id: { nested: true } }],
    ['an unsafe $ref', { properties: { a: { $ref: 'x:y/../z' } } }],
    [
      'an unsafe $ref below $defs',
      { $defs: { n: { items: { $ref: '../../a' } } } },
    ],
    ['an unsafe $dynamicRef', { properties: { a: { $dynamicRef: 'a:b' } } }],
    ['an unsafe $schema', { $schema: 'x:y/%2e%2e' }],
    ['an unsafe $anchor', { properties: { a: { $anchor: 'a b' } } }],
    [
      'an identifier inside an array of subschemas',
      { allOf: [{ $id: 'a:b' }] },
    ],
  ])('refuses %s before the engine compiles it', async (_label, schema) => {
    const { outcome, called } = await call(schema);
    expect(outcome).toMatch(REFUSED);
    expect(called).toEqual([]);
  });

  it('still calls a tool whose schema uses ordinary identifiers', async () => {
    const { outcome, called } = await call({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://peer.example.test/schemas/out.json',
      $defs: { n: { $anchor: 'node', type: 'object' } },
      properties: {
        a: { $ref: '#/$defs/n' },
        b: { $id: 'item.json', type: 'string' },
        c: { $ref: 'item.json' },
        e: { $ref: '#node' },
        // Property names and data that merely look like keywords are not identifiers.
        $id: { type: 'string' },
        $ref: { type: 'string' },
        d: { const: { $id: 'a:b' }, default: { $ref: '../x' } },
      },
    });
    expect(called).toEqual(['probe']);
    expect(outcome).toBe('admitted');
  });

  it('reads the property names of dependentRequired as data, not as identifier keywords', async () => {
    const { outcome, called } = await call({
      type: 'object',
      properties: { name: { type: 'string' } },
      dependentRequired: { $id: ['name'], $ref: ['name'], $anchor: ['name'] },
    });
    expect(called).toEqual(['probe']);
    expect(outcome).toBe('admitted');
  });

  it('still refuses an unsafe identifier written beside a dependentRequired map', async () => {
    const { outcome, called } = await call({
      type: 'object',
      $id: 'a:b',
      dependentRequired: { $id: ['name'] },
    });
    expect(outcome).toMatch(REFUSED);
    expect(called).toEqual([]);
  });

  it('compiles no peer schema in a session, which lists with a raw request', async () => {
    const called: string[] = [];
    const compile = vi.spyOn(
      SchemaIdentifierValidator.prototype,
      'getValidator',
    );
    const session = await openAdmittedMcp(URL_, {
      clientName: 'test',
      connector: peer(called, { $id: 'javascript:alert(1)' }),
      authorizedTools: ['probe'],
    });
    try {
      expect((await session.listTools()).items).toHaveLength(1);
      expect((await session.callTool('probe', {})).isError).not.toBe(true);
      expect(called).toEqual(['probe']);
      expect(compile).not.toHaveBeenCalled();
    } finally {
      compile.mockRestore();
      await session.close();
    }
  });
});
