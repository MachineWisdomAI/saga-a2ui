import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from '@modelcontextprotocol/client';

// The one place where a maintainer command (`saga publish`, `docs-probe`) obtains network authority.
//
// A command that contacts a deployed endpoint or a documentation site is run by a trusted
// maintainer, but the destination, its answers and, for publication, the release input that names it
// are not trusted (SECURITY.md invariants 1, 3 and 4). This module admits all of it in one place so a
// caller cannot take part of the authority and omit the rest:
//
//   - destination: HTTPS only, no credentials in the URL, a public-looking host name and no IP literal;
//   - connected address: the name is resolved inside the connection (`lookup`), and one answer outside
//     the public range refuses the whole connection, so the address that was checked is the address
//     that is used and a changed answer cannot move a request to a private peer;
//   - redirects: followed only for an uncredentialed GET or HEAD, each hop admitted again; a request
//     that carries a credential, or any other method, is never redirected;
//   - credential: held here, never by the caller or the MCP transport, and attached only to the first
//     request to the origin it was bound to;
//   - operations: an MCP session can call only the tools its caller names exactly, and that is a
//     local decision; what the endpoint advertises or asserts about a tool never adds to it;
//   - size and time: every response body is counted as it streams, against a per-response limit and one
//     remaining budget shared by everything the command reads, and the lists an endpoint returns are
//     capped. A diagnostic is a fixed kind, never text the remote side wrote.
//
// The lowest layer, the connector, is the only injectable part: tests supply a stand-in for the socket
// and a command line never does. If a refusal needs repairing, change `RefusalKind`, the address list
// or `createAdmittedFetch` here; callers have no second copy of any rule.

export type RefusalKind =
  | 'scheme'
  | 'credentials'
  | 'destination'
  | 'address'
  | 'redirect'
  | 'body-limit'
  | 'total-limit'
  | 'operation';

const REFUSALS: Readonly<Record<RefusalKind, string>> = {
  scheme: 'The URL is not an absolute HTTPS URL.',
  credentials: 'The URL contains credentials.',
  destination:
    'The host is a local, internal or IP-literal address, not a public host name.',
  address: 'The host resolves to a non-public address.',
  redirect: 'A redirect was refused.',
  'body-limit': 'A response is larger than the limit this tool reads.',
  'total-limit': 'The responses together are larger than this tool reads.',
  operation: 'That operation is not authorized for this session.',
};

/** A request this module refused. The text is fixed; nothing a remote side wrote is carried in it. */
export class NetworkRefused extends Error {
  readonly kind: RefusalKind;
  constructor(kind: RefusalKind) {
    super(REFUSALS[kind]);
    this.name = 'NetworkRefused';
    this.kind = kind;
  }
}

/** The refusal an error is or was caused by, or `undefined`. */
export function refusalOf(error: unknown): NetworkRefused | undefined {
  for (
    let one: unknown = error, depth = 0;
    one !== undefined && depth < 4;
    depth += 1, one = (one as { cause?: unknown } | null)?.cause
  )
    if (one instanceof NetworkRefused) return one;
  return undefined;
}

// --- Destination ---------------------------------------------------------------------------------

/** Whether a host name could be reached from outside the maintainer's own network. IP literals are refused. */
export function isPublicHostName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return false;
  if (!host.includes('.') || host.endsWith('.')) return false;
  return ![
    'localhost',
    'local',
    'internal',
    'lan',
    'home.arpa',
    'localdomain',
  ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

const NON_PUBLIC = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  NON_PUBLIC.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  NON_PUBLIC.addSubnet(address, prefix, 'ipv6');

/** Whether a connected-to address is a public unicast address. Anything unparsable is not. */
export function isAdmittedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  // An IPv4-mapped IPv6 address is a way to spell an IPv4 peer; a DNS answer never needs it.
  if (family === 6 && /^(?:0{0,4}:){2,5}ffff:/i.test(address)) return false;
  return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** The URL, if it is an HTTPS URL to a public host name without credentials; otherwise a refusal. */
export function admitUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new NetworkRefused('scheme');
  }
  if (url.protocol !== 'https:') throw new NetworkRefused('scheme');
  if (url.username !== '' || url.password !== '')
    throw new NetworkRefused('credentials');
  if (!isPublicHostName(url.hostname) || net.isIP(url.hostname) !== 0)
    throw new NetworkRefused('destination');
  return url;
}

// --- Budgets -------------------------------------------------------------------------------------

/** What every response read during one command may add up to. */
export const DEFAULT_TOTAL_BYTES = 128 * 1024 * 1024;
export const DEFAULT_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** A list an endpoint returns is cut at this many items per page. */
export const MAX_PAGE_ITEMS = 200;

/** One remaining allowance, shared by everything a command reads. */
export class ByteBudget {
  #remaining: number;
  constructor(total: number = DEFAULT_TOTAL_BYTES) {
    this.#remaining = total;
  }
  get remaining(): number {
    return this.#remaining;
  }
  take(bytes: number): void {
    if (bytes > this.#remaining) {
      this.#remaining = 0;
      throw new NetworkRefused('total-limit');
    }
    this.#remaining -= bytes;
  }
}

// --- Connector -----------------------------------------------------------------------------------

type ResolveAll = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: dns.LookupAddress[],
  ) => void,
) => void;

export interface ConnectorOptions {
  /** Stand-ins for tests of the connector itself. Production uses the platform's resolver and `https`. */
  readonly resolve?: ResolveAll | undefined;
  readonly admitAddress?: ((address: string) => boolean) | undefined;
  readonly request?: typeof https.request | typeof http.request | undefined;
}

/**
 * Sends one request over a connection whose address is admitted when the connection is made: the
 * resolver answer used by `connect` is the answer checked here, with TLS verified against the host
 * name. The response is `identity`-encoded so the byte limits count what is really received.
 */
export function createConnector(options: ConnectorOptions = {}): FetchLike {
  const resolve = options.resolve ?? (dns.lookup as ResolveAll);
  const admit = options.admitAddress ?? isAdmittedAddress;
  const send = options.request ?? https.request;
  const lookup: NonNullable<https.RequestOptions['lookup']> = (
    hostname,
    lookupOptions,
    callback,
  ) => {
    resolve(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      if (error !== null) return callback(error, '', 4);
      if (
        addresses.length === 0 ||
        addresses.some((one) => !admit(one.address))
      )
        return callback(new NetworkRefused('address') as never, '', 4);
      if (lookupOptions.all === true)
        return (callback as (e: null, a: dns.LookupAddress[]) => void)(
          null,
          addresses,
        );
      const [first] = addresses;
      return callback(null, first!.address, first!.family);
    });
  };
  return async (input, init) => {
    const url = new URL(input);
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) {
      if (!admit(url.hostname.replace(/^\[|\]$/g, '')))
        throw new NetworkRefused('address');
    }
    const headers = new Headers(init?.headers);
    headers.set('accept-encoding', 'identity');
    const body =
      init?.body === undefined || init.body === null
        ? undefined
        : Buffer.from(await new Response(init.body).arrayBuffer());
    const method = (init?.method ?? 'GET').toUpperCase();
    return new Promise<Response>((resolveResponse, reject) => {
      const request = send(
        url,
        {
          method,
          headers: Object.fromEntries(headers),
          lookup,
          agent: false,
          ...(init?.signal == null ? {} : { signal: init.signal }),
        },
        (response) => {
          const responseHeaders = new Headers();
          for (let i = 0; i + 1 < response.rawHeaders.length; i += 2) {
            try {
              responseHeaders.append(
                response.rawHeaders[i]!,
                response.rawHeaders[i + 1]!,
              );
            } catch {
              // A header this runtime cannot represent is dropped; it is not needed to judge a response.
            }
          }
          const status = response.statusCode ?? 502;
          if (method === 'HEAD' || [101, 204, 205, 304].includes(status)) {
            response.resume();
            resolveResponse(
              new Response(null, { status, headers: responseHeaders }),
            );
            return;
          }
          resolveResponse(
            new Response(
              Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>,
              {
                status,
                statusText: response.statusMessage ?? '',
                headers: responseHeaders,
              },
            ),
          );
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  };
}

// --- Admitted fetch ------------------------------------------------------------------------------

export interface AdmittedFetchOptions {
  /** The lowest layer. Production uses the pinned connector; a test supplies a stand-in for the socket. */
  readonly connector?: FetchLike | undefined;
  /** A bearer and the one origin it may be sent to. */
  readonly credential?:
    { readonly bearer: string; readonly origin: string } | undefined;
  readonly budget?: ByteBudget | undefined;
  readonly maxResponseBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

const REDIRECTS: readonly number[] = [301, 302, 303, 307, 308];

function limitBody(
  response: Response,
  budget: ByteBudget,
  maxResponseBytes: number,
): Response {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new NetworkRefused('body-limit');
  }
  if (Number.isFinite(declared) && declared > budget.remaining) {
    void response.body?.cancel().catch(() => undefined);
    throw new NetworkRefused('total-limit');
  }
  if (response.body === null) return response;
  let seen = 0;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxResponseBytes) throw new NetworkRefused('body-limit');
        budget.take(chunk.byteLength);
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(counted, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** A `fetch` that admits every request it makes, as described at the top of this file. */
export function createAdmittedFetch(
  options: AdmittedFetchOptions = {},
): FetchLike {
  const connector = options.connector ?? createConnector();
  const budget = options.budget ?? new ByteBudget();
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES;
  return async (input, init) => {
    let url = admitUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const signal =
      options.signal === undefined || init?.signal == null
        ? (init?.signal ?? options.signal)
        : AbortSignal.any([options.signal, init.signal]);
    for (let hop = 0; ; hop += 1) {
      const headers = new Headers(init?.headers);
      // A caller never chooses a credential; this module attaches the one it holds, once.
      headers.delete('authorization');
      const credentialed =
        hop === 0 &&
        options.credential !== undefined &&
        url.origin === options.credential.origin;
      if (credentialed)
        headers.set('authorization', `Bearer ${options.credential!.bearer}`);
      const response = await connector(url, {
        ...init,
        method,
        headers,
        redirect: 'manual',
        ...(signal === undefined ? {} : { signal }),
      });
      if (!REDIRECTS.includes(response.status))
        return limitBody(response, budget, maxResponseBytes);
      void response.body?.cancel().catch(() => undefined);
      const location = response.headers.get('location');
      if (
        credentialed ||
        (method !== 'GET' && method !== 'HEAD') ||
        hop >= MAX_REDIRECTS ||
        location === null
      )
        throw new NetworkRefused('redirect');
      try {
        url = admitUrl(new URL(location, url));
      } catch (error) {
        throw refusalOf(error) ?? new NetworkRefused('redirect');
      }
    }
  };
}

// --- MCP session ---------------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 20_000;

/** A tool a local workflow authorizes: its exact name, or an anchored pattern that is itself written locally. */
export type ToolAuthority = string | RegExp;

export interface AdmittedMcpOptions extends Omit<
  AdmittedFetchOptions,
  'credential'
> {
  readonly clientName: string;
  /** Sent to the origin of the endpoint URL only, on the first request, and never across a redirect. */
  readonly bearer?: string | undefined;
  /** The tools this session may call, decided by the local workflow and never by the endpoint. Empty for a read-only session. */
  readonly authorizedTools: readonly ToolAuthority[];
  readonly timeoutMs?: number | undefined;
}

/** A cut list page: the items kept and whether the endpoint offered more than this tool reads at once. */
export interface ListPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | undefined;
  readonly capped: boolean;
}

/**
 * The operations a maintainer command performs on an MCP endpoint, and no others: initialize, one
 * page of tools or resources, one resource, and a call to a tool the caller authorized by name. A
 * caller never receives the client, the transport or a method name.
 */
export interface AdmittedMcp {
  readonly server: { readonly name: string; readonly version: string } | null;
  readonly instructions: string | null;
  readonly hasTools: boolean;
  readonly hasResources: boolean;
  listTools(cursor?: string): Promise<ListPage<Record<string, unknown>>>;
  listResources(
    cursor?: string,
  ): Promise<ListPage<{ uri: string; mimeType?: string | undefined }>>;
  readResource(uri: string): Promise<
    readonly {
      uri: string;
      mimeType?: string | undefined;
      text?: unknown;
      blob?: unknown;
      _meta?: unknown;
    }[]
  >;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<{
    isError?: boolean | undefined;
    content: unknown;
    structuredContent?: unknown;
  }>;
  close(): Promise<void>;
}

/** Connects to an endpoint after admitting its URL. Rejects with a {@link NetworkRefused} for a URL it will not contact. */
export async function openAdmittedMcp(
  url: string,
  options: AdmittedMcpOptions,
): Promise<AdmittedMcp> {
  const admitted = admitUrl(url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = (): AbortSignal => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return options.signal === undefined
      ? timeout
      : AbortSignal.any([options.signal, timeout]);
  };
  for (const one of options.authorizedTools)
    if (
      typeof one !== 'string' &&
      !(one.source.startsWith('^') && one.source.endsWith('$'))
    )
      throw new Error('A tool pattern must match the whole name (^…$).');
  const authorizes = (name: string): boolean =>
    options.authorizedTools.some((one) =>
      typeof one === 'string' ? one === name : one.test(name),
    );
  const client = new Client({ name: options.clientName, version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(admitted, {
    fetch: createAdmittedFetch({
      ...options,
      credential:
        options.bearer === undefined
          ? undefined
          : { bearer: options.bearer, origin: admitted.origin },
    }),
  });
  try {
    await client.connect(transport, { signal: deadline() });
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  const page = <T>(items: readonly T[], nextCursor: string | undefined) => ({
    items: items.slice(0, MAX_PAGE_ITEMS),
    nextCursor,
    capped: items.length > MAX_PAGE_ITEMS,
  });
  const capabilities = client.getServerCapabilities();
  const server = client.getServerVersion();
  return {
    server:
      server === undefined
        ? null
        : { name: server.name, version: server.version },
    instructions: client.getInstructions() ?? null,
    hasTools: capabilities?.tools !== undefined,
    hasResources: capabilities?.resources !== undefined,
    async listTools(cursor) {
      const read = await client.request(
        {
          method: 'tools/list',
          params: cursor === undefined ? {} : { cursor },
        },
        { signal: deadline() },
      );
      return page(
        read.tools as unknown as Record<string, unknown>[],
        read.nextCursor,
      );
    },
    async listResources(cursor) {
      const read = await client.request(
        {
          method: 'resources/list',
          params: cursor === undefined ? {} : { cursor },
        },
        { signal: deadline() },
      );
      return page(read.resources, read.nextCursor);
    },
    async readResource(uri) {
      const read = await client.readResource({ uri }, { signal: deadline() });
      return read.contents.slice(0, MAX_PAGE_ITEMS);
    },
    async callTool(name, args) {
      if (!authorizes(name)) throw new NetworkRefused('operation');
      return client.callTool(
        { name, arguments: { ...args } },
        { signal: deadline() },
      );
    },
    close: () => client.close().catch(() => undefined),
  };
}
