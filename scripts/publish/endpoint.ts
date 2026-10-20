import { Client, StreamableHTTPClientTransport, type FetchLike } from '@modelcontextprotocol/client';
import { canonicalDigest, sha256, type FixtureInvocation } from './record.js';

// Reading a deployed MCP endpoint for a publication check (CLI3 #66).
//
// Discovery is read-only by construction: it performs `initialize`, `tools/list`, `resources/list`
// and `resources/read`, and nothing in this file's discovery path can issue `tools/call`. Calling a
// tool is `invokeFixture`, a separate function the caller runs only when the maintainer asked for
// it, and it refuses any tool that does not advertise `readOnlyHint: true`.
// Whatever cannot be read (a timeout, a refusal, an authentication challenge) is reported as not
// discovered; the caller turns that into an unknown finding, never a pass.

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PAGES = 20;
const MAX_RESOURCES = 50;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;

export interface DiscoveryOptions {
  /** The network seam. Tests route a published URL to a local listener; the command line uses the platform's `fetch`. */
  readonly fetch?: FetchLike | undefined;
  readonly signal?: AbortSignal | undefined;
  /** A bearer credential for a read-only look at a protected endpoint. It is sent and never stored or written. */
  readonly bearer?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/** A tool exactly as the endpoint advertised it. */
export type AdvertisedTool = Readonly<Record<string, unknown>> & { readonly name: string };

export interface ServedResource {
  readonly uri: string;
  readonly mimeType: string | null;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  /** The `_meta` of the served contents, where a view's content security policy is declared. */
  readonly meta: Readonly<Record<string, unknown>> | null;
}

export interface EndpointSnapshot {
  readonly server: { readonly name: string; readonly version: string } | null;
  readonly instructions: string | null;
  readonly tools: readonly AdvertisedTool[];
  /** Every `ui://` resource the endpoint lists, read once. */
  readonly resources: readonly ServedResource[];
  /** Listed resources that could not be read, with the reason; a view that cannot be read cannot be compared. */
  readonly unreadable: readonly { readonly uri: string; readonly reason: string }[];
}

export type Discovery =
  | { readonly kind: 'discovered'; readonly snapshot: EndpointSnapshot }
  | { readonly kind: 'not-discovered'; readonly reason: string; readonly authenticationRequired: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function budget(options: DiscoveryOptions): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
}

async function connect(url: string, options: DiscoveryOptions): Promise<Client> {
  const client = new Client({ name: 'saga-publish-check', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.bearer === undefined ? {} : { authProvider: { token: async () => options.bearer } }),
  });
  await client.connect(transport, { signal: budget(options) });
  return client;
}

function describeFailure(error: unknown): { reason: string; authenticationRequired: boolean } {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const authenticationRequired = name === 'UnauthorizedError' || /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(message);
  return { reason: message, authenticationRequired };
}

function bytesOfContents(contents: { text?: unknown; blob?: unknown }): Uint8Array | undefined {
  if (typeof contents.text === 'string') return Buffer.from(contents.text, 'utf8');
  if (typeof contents.blob === 'string') return Buffer.from(contents.blob, 'base64');
  return undefined;
}

export async function discoverEndpoint(url: string, options: DiscoveryOptions = {}): Promise<Discovery> {
  let client: Client | undefined;
  try {
    client = await connect(url, options);
    const signal = budget(options);
    const tools: AdvertisedTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const listed = await client.listTools(cursor === undefined ? {} : { cursor }, { signal });
      tools.push(...(listed.tools as unknown as AdvertisedTool[]));
      cursor = listed.nextCursor;
      if (cursor === undefined) break;
    }
    const listedResources: { uri: string; mimeType?: string | undefined }[] = [];
    if (client.getServerCapabilities()?.resources !== undefined) {
      cursor = undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const listed = await client.listResources(cursor === undefined ? {} : { cursor }, { signal });
        listedResources.push(...listed.resources);
        cursor = listed.nextCursor;
        if (cursor === undefined) break;
      }
    }
    const resources: ServedResource[] = [];
    const unreadable: { uri: string; reason: string }[] = [];
    for (const listed of listedResources.filter((resource) => resource.uri.startsWith('ui://')).slice(0, MAX_RESOURCES)) {
      try {
        const read = await client.readResource({ uri: listed.uri }, { signal });
        const contents = read.contents.find((one) => one.uri === listed.uri) ?? read.contents[0];
        const bytes = contents === undefined ? undefined : bytesOfContents(contents);
        if (contents === undefined || bytes === undefined) {
          unreadable.push({ uri: listed.uri, reason: 'The endpoint returned no content for it.' });
        } else if (bytes.length > MAX_RESOURCE_BYTES) {
          unreadable.push({ uri: listed.uri, reason: `It is larger than ${MAX_RESOURCE_BYTES} bytes.` });
        } else {
          const meta = (contents as { _meta?: unknown })._meta;
          resources.push({ uri: listed.uri, mimeType: contents.mimeType ?? listed.mimeType ?? null, bytes, sha256: sha256(bytes), meta: isRecord(meta) ? meta : null });
        }
      } catch (error) {
        unreadable.push({ uri: listed.uri, reason: describeFailure(error).reason });
      }
    }
    const server = client.getServerVersion();
    return {
      kind: 'discovered',
      snapshot: {
        server: server === undefined ? null : { name: server.name, version: server.version },
        instructions: client.getInstructions() ?? null,
        tools,
        resources,
        unreadable,
      },
    };
  } catch (error) {
    return { kind: 'not-discovered', ...describeFailure(error) };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

/** The digest of one tool's whole advertised definition. */
export const toolDigest = (tool: AdvertisedTool): string => canonicalDigest(tool);

/**
 * Calls the declared fixture tools. Only a maintainer's explicit request reaches this function. A
 * tool that does not advertise `readOnlyHint: true` is refused without a call, so a fixture run
 * cannot cause a domain effect through a tool whose effects the endpoint does not rule out. Only a
 * digest of each result is kept: the content may be domain data.
 */
export async function invokeFixture(
  url: string,
  calls: readonly { readonly tool: string; readonly arguments?: Readonly<Record<string, unknown>> | undefined }[],
  advertised: readonly AdvertisedTool[],
  options: DiscoveryOptions = {},
): Promise<FixtureInvocation[]> {
  const results: FixtureInvocation[] = [];
  let client: Client | undefined;
  try {
    for (const call of calls) {
      const tool = advertised.find((one) => one.name === call.tool);
      const annotations = tool === undefined ? undefined : tool.annotations;
      if (tool === undefined || !isRecord(annotations) || annotations.readOnlyHint !== true) {
        results.push({ tool: call.tool, outcome: 'refused', resultSha256: null });
        continue;
      }
      try {
        client ??= await connect(url, options);
        const result = await client.callTool({ name: call.tool, arguments: { ...call.arguments } }, { signal: budget(options) });
        results.push({ tool: call.tool, outcome: result.isError === true ? 'error' : 'ok', resultSha256: canonicalDigest({ content: result.content, structuredContent: result.structuredContent ?? null }) });
      } catch {
        results.push({ tool: call.tool, outcome: 'error', resultSha256: null });
      }
    }
  } finally {
    await client?.close().catch(() => undefined);
  }
  return results;
}
