import type { FetchLike } from '@modelcontextprotocol/client';
import {
  ByteBudget,
  MAX_PAGE_ITEMS,
  openAdmittedMcp,
  refusalOf,
  type AdmittedMcp,
} from '../maintainer-network.js';
import { canonicalDigest, sha256, type FixtureInvocation } from './record.js';

// Reading a deployed MCP endpoint for a publication check (CLI3 #66).
//
// Network authority comes from `../maintainer-network.ts`: the destination, the connected address,
// redirects, the bearer, the size of what is read and the tools that may be called are all admitted
// there. This file decides only what to read and how to describe it.
//
// Discovery is read-only by construction: its session authorizes no tool, so it can perform
// `initialize`, `tools/list`, `resources/list` and `resources/read` and nothing else. Calling a tool is
// `invokeFixture`, a separate function the caller runs only when the maintainer asked for it. The
// maintainer's own calls file must name each tool and the digest of the definition it expects (the
// release input, which the endpoint's owner may control, names none); the endpoint's own
// `readOnlyHint` is a further condition and never the authority.
// Whatever cannot be read (a timeout, a refusal, an authentication challenge) is reported as not
// discovered; the caller turns that into an unknown finding, never a pass.

const MAX_PAGES = 20;
const MAX_RESOURCES = 50;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;

export interface DiscoveryOptions {
  /** The connector seam. Tests route a published URL to a local listener; the command line uses the pinned HTTPS connector. */
  readonly fetch?: FetchLike | undefined;
  readonly signal?: AbortSignal | undefined;
  /** A bearer credential for a read-only look at a protected endpoint. It is sent to the endpoint's own origin and never stored or written. */
  readonly bearer?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** What all responses of one assessment may add up to; discovery and a fixture run share it. */
  readonly budget?: ByteBudget | undefined;
}

/** A tool exactly as the endpoint advertised it. */
export type AdvertisedTool = Readonly<Record<string, unknown>> & {
  readonly name: string;
};

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
  readonly unreadable: readonly {
    readonly uri: string;
    readonly reason: string;
  }[];
  /** Bounds that were hit while reading, in words. Empty when everything the endpoint offered was read; otherwise the snapshot is partial. */
  readonly truncated: readonly string[];
}

export type Discovery =
  | { readonly kind: 'discovered'; readonly snapshot: EndpointSnapshot }
  | {
      readonly kind: 'not-discovered';
      readonly reason: string;
      readonly authenticationRequired: boolean;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function connect(
  url: string,
  options: DiscoveryOptions,
  authorizedTools: readonly string[],
): Promise<AdmittedMcp> {
  return openAdmittedMcp(url, {
    clientName: 'saga-publish-check',
    authorizedTools,
    connector: options.fetch,
    bearer: options.bearer,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    budget: options.budget,
  });
}

/**
 * Why a request failed, as a safe diagnostic kind and never as the failure's own text. An endpoint
 * (or a proxy in front of it) controls what an error message says, and one may echo the
 * `Authorization` header it was sent; what this returns is fixed wording plus at most an HTTP
 * status number, so nothing the remote side wrote reaches the console report or the record.
 */
function describeFailure(error: unknown): {
  reason: string;
  authenticationRequired: boolean;
} {
  const refused = refusalOf(error);
  if (refused !== undefined)
    return { reason: refused.message, authenticationRequired: false };
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  const authenticationRequired =
    name === 'UnauthorizedError' ||
    /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(message);
  if (authenticationRequired)
    return {
      reason: 'The endpoint answered with an authentication challenge.',
      authenticationRequired,
    };
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /\b(timed out|timeout|aborted)\b/i.test(message)
  )
    return {
      reason: 'The request timed out or was aborted.',
      authenticationRequired,
    };
  const status = /\b([45]\d\d)\b/.exec(message)?.[1];
  if (status !== undefined)
    return {
      reason: `The endpoint answered with HTTP ${status}.`,
      authenticationRequired,
    };
  if (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|fetch failed|network|socket|certificate/i.test(
      message,
    )
  )
    return {
      reason: 'The endpoint could not be reached (a network error).',
      authenticationRequired,
    };
  return {
    reason: "The endpoint's answer could not be used (an unexpected response).",
    authenticationRequired,
  };
}

/** The bytes of served contents, or `'too-large'` when the encoded form already exceeds the bound, before anything is decoded. */
function bytesOfContents(contents: {
  text?: unknown;
  blob?: unknown;
}): Uint8Array | 'too-large' | undefined {
  // UTF-8 is up to three bytes per UTF-16 code unit, so the size is measured in bytes, never in `length`.
  if (typeof contents.text === 'string')
    return Buffer.byteLength(contents.text, 'utf8') > MAX_RESOURCE_BYTES
      ? 'too-large'
      : Buffer.from(contents.text, 'utf8');
  if (typeof contents.blob === 'string')
    return (contents.blob.length / 4) * 3 > MAX_RESOURCE_BYTES
      ? 'too-large'
      : Buffer.from(contents.blob, 'base64');
  return undefined;
}

/** Reads at most `maxPages` pages of a paginated list. `more` is whether the server still offered another page when the bound was reached; `capped` whether a page held more items than are read. */
async function walkPages<T>(
  maxPages: number,
  fetchPage: (cursor: string | undefined) => Promise<{
    readonly items: readonly T[];
    readonly nextCursor?: string | undefined;
    readonly capped: boolean;
  }>,
): Promise<{ items: T[]; more: boolean; capped: boolean }> {
  const items: T[] = [];
  let cursor: string | undefined;
  let capped = false;
  for (let page = 0; page < maxPages; page += 1) {
    const read = await fetchPage(cursor);
    items.push(...read.items);
    capped ||= read.capped;
    cursor = read.nextCursor;
    if (cursor === undefined) return { items, more: false, capped };
  }
  return { items, more: true, capped };
}

export async function discoverEndpoint(
  url: string,
  options: DiscoveryOptions = {},
): Promise<Discovery> {
  let session: AdmittedMcp | undefined;
  try {
    session = await connect(url, options, []);
    const mcp = session;
    // The bounds stay, but a bound that was hit is said so: what was not read is not certified.
    // Pages are requested one at a time by this function, so a server that never stops offering pages
    // cannot look complete.
    const truncated: string[] = [];
    const tools: AdvertisedTool[] = [];
    if (mcp.hasTools) {
      const walked = await walkPages(MAX_PAGES, async (cursor) => {
        const page = await mcp.listTools(cursor);
        return { ...page, items: page.items as readonly AdvertisedTool[] };
      });
      tools.push(...walked.items);
      if (walked.more)
        truncated.push(
          `tools/list still offered another page after ${MAX_PAGES} pages, so some tool definitions were not read.`,
        );
      if (walked.capped)
        truncated.push(
          `tools/list returned more than ${MAX_PAGE_ITEMS} tools in a page, so some tool definitions were not read.`,
        );
    }
    const listedResources: { uri: string; mimeType?: string | undefined }[] =
      [];
    if (mcp.hasResources) {
      const walked = await walkPages(MAX_PAGES, (cursor) =>
        mcp.listResources(cursor),
      );
      listedResources.push(...walked.items);
      if (walked.more)
        truncated.push(
          `resources/list still offered another page after ${MAX_PAGES} pages, so some resources were not listed.`,
        );
      if (walked.capped)
        truncated.push(
          `resources/list returned more than ${MAX_PAGE_ITEMS} resources in a page, so some resources were not listed.`,
        );
    }
    const resources: ServedResource[] = [];
    const unreadable: { uri: string; reason: string }[] = [];
    const viewResources = listedResources.filter((resource) =>
      resource.uri.startsWith('ui://'),
    );
    if (viewResources.length > MAX_RESOURCES)
      truncated.push(
        `The endpoint lists ${viewResources.length} ui:// resources; only the first ${MAX_RESOURCES} were read.`,
      );
    for (const listed of viewResources.slice(0, MAX_RESOURCES)) {
      try {
        const contentsList = await mcp.readResource(listed.uri);
        const contents =
          contentsList.find((one) => one.uri === listed.uri) ?? contentsList[0];
        const bytes =
          contents === undefined ? undefined : bytesOfContents(contents);
        if (contents === undefined || bytes === undefined) {
          unreadable.push({
            uri: listed.uri,
            reason: 'The endpoint returned no content for it.',
          });
        } else if (bytes === 'too-large' || bytes.length > MAX_RESOURCE_BYTES) {
          unreadable.push({
            uri: listed.uri,
            reason: `It is larger than ${MAX_RESOURCE_BYTES} bytes.`,
          });
        } else {
          const meta = contents._meta;
          resources.push({
            uri: listed.uri,
            mimeType: contents.mimeType ?? listed.mimeType ?? null,
            bytes,
            sha256: sha256(bytes),
            meta: isRecord(meta) ? meta : null,
          });
        }
      } catch (error) {
        // An exhausted allowance ends discovery; any other failure belongs to this view alone.
        if (refusalOf(error)?.kind === 'total-limit') throw error;
        unreadable.push({
          uri: listed.uri,
          reason: describeFailure(error).reason,
        });
      }
    }
    return {
      kind: 'discovered',
      snapshot: {
        server: mcp.server,
        instructions: mcp.instructions,
        tools,
        resources,
        unreadable,
        truncated,
      },
    };
  } catch (error) {
    return { kind: 'not-discovered', ...describeFailure(error) };
  } finally {
    await session?.close();
  }
}

/** The digest of one tool's whole advertised definition. */
export const toolDigest = (tool: AdvertisedTool): string =>
  canonicalDigest(tool);

/** One fixture call the maintainer authorized (`fixture-calls.ts`): the tool, the digest of the definition it was reviewed against, and its arguments. */
export interface DeclaredCall {
  readonly tool: string;
  /** The `sha256` the record reports for the tool (`endpoint.tools`). Without it the call is refused. */
  readonly toolSha256?: string | undefined;
  readonly arguments?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Calls the fixture tools the maintainer authorized. Only a maintainer's explicit request, with a
 * calls file of the maintainer's own, reaches this function; the release input and the endpoint
 * choose no call. A call is made only when the maintainer's file names the tool and the digest of the
 * definition it was reviewed against, and the endpoint now advertises exactly that definition: what a
 * peer says about itself cannot add a tool to the calls that run. A tool that does not also advertise
 * `readOnlyHint: true` is refused, so a fixture run cannot cause a domain effect through a tool whose
 * effects the endpoint does not rule out (the hint can only narrow what the digest authorizes). Only a
 * digest of each result is kept: the content may be domain data.
 */
export async function invokeFixture(
  url: string,
  calls: readonly DeclaredCall[],
  advertised: readonly AdvertisedTool[],
  options: DiscoveryOptions = {},
): Promise<FixtureInvocation[]> {
  const isAuthorized = (call: DeclaredCall): boolean => {
    const tool = advertised.find((one) => one.name === call.tool);
    return (
      tool !== undefined &&
      call.toolSha256 !== undefined &&
      toolDigest(tool) === call.toolSha256 &&
      isRecord(tool.annotations) &&
      tool.annotations.readOnlyHint === true
    );
  };
  const authorized = [
    ...new Set(calls.filter(isAuthorized).map((call) => call.tool)),
  ];
  const results: FixtureInvocation[] = [];
  let session: AdmittedMcp | undefined;
  try {
    for (const call of calls) {
      if (!isAuthorized(call)) {
        results.push({
          tool: call.tool,
          outcome: 'refused',
          resultSha256: null,
        });
        continue;
      }
      try {
        session ??= await connect(url, options, authorized);
        const result = await session.callTool(call.tool, {
          ...call.arguments,
        });
        results.push({
          tool: call.tool,
          outcome: result.isError === true ? 'error' : 'ok',
          resultSha256: canonicalDigest({
            content: result.content,
            structuredContent: result.structuredContent ?? null,
          }),
        });
      } catch {
        results.push({ tool: call.tool, outcome: 'error', resultSha256: null });
      }
    }
  } finally {
    await session?.close();
  }
  return results;
}
