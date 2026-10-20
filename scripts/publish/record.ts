import { createHash } from 'node:crypto';

// What a publication check concludes (CLI3 #66): findings with a status, one verdict derived from
// them, and the canonical JSON and digests the record is bound by. Nothing here reads a file or the
// network, so the rule "unknown is never ready" lives in one place.

/** `pass` is only ever the result of a check that ran and held; `unknown` is a check that could not run or conclude. */
export type FindingStatus = 'pass' | 'fail' | 'unknown';

export interface Finding {
  readonly id: string;
  readonly status: FindingStatus;
  readonly summary: string;
  /** What was seen, when the summary alone does not say. */
  readonly detail?: string;
  /** What the maintainer changes to resolve a `fail` or `unknown`. */
  readonly repair?: string;
}

/** Something only the owner or the host can do, so it is pending whatever the checks say. It never changes the verdict. */
export interface HandoffItem {
  readonly id: string;
  readonly summary: string;
}

/**
 * `ready`: every check ran and passed. `incomplete`: nothing failed but at least one check could not
 * conclude. `blocked`: at least one check failed.
 */
export type Verdict = 'ready' | 'incomplete' | 'blocked';

export function verdictOf(findings: readonly Finding[]): Verdict {
  if (findings.some((finding) => finding.status === 'fail')) return 'blocked';
  if (findings.some((finding) => finding.status === 'unknown')) return 'incomplete';
  return 'ready';
}

export const pass = (id: string, summary: string, detail?: string): Finding => (detail === undefined ? { id, status: 'pass', summary } : { id, status: 'pass', summary, detail });
export const fail = (id: string, summary: string, repair: string, detail?: string): Finding => ({ id, status: 'fail', summary, repair, ...(detail === undefined ? {} : { detail }) });
export const unknown = (id: string, summary: string, repair: string, detail?: string): Finding => ({ id, status: 'unknown', summary, repair, ...(detail === undefined ? {} : { detail }) });

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** JSON with object keys in sorted order and no insignificant whitespace, so equal values have equal bytes and digests. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
}

export const canonicalDigest = (value: unknown): string => sha256(canonicalJson(value));

/** What the findings record is called on disk, and the format it declares. */
export const RECORD_FILE = 'findings.json';
export const RECORD_FORMAT = 'saga-publication-record/1';
export const ARCHIVE_FILE = 'chatgpt-plugin.zip';

/** A tool as the endpoint advertised it and the digest of its whole definition. */
export interface ToolSnapshot {
  readonly name: string;
  readonly sha256: string;
}

/** A resource as the endpoint served it: identity, type and the digest of the bytes it returned. */
export interface ResourceSnapshot {
  readonly uri: string;
  readonly mimeType: string | null;
  readonly sha256: string;
  readonly bytes: number;
}

export interface FixtureInvocation {
  readonly tool: string;
  readonly outcome: 'ok' | 'error' | 'refused';
  readonly resultSha256: string | null;
}

/** The durable record of one `prepare` (or `check`) of one target. It carries no timestamp, so unchanged inputs give identical bytes. */
export interface PublicationRecord {
  readonly format: typeof RECORD_FORMAT;
  readonly target: 'chatgpt';
  readonly verdict: Verdict;
  readonly source: { readonly revision: string | null; readonly dirty: boolean | null };
  readonly application: {
    readonly name: string;
    readonly version: string;
    /** Who the listing belongs to. Never the operator who ran the tool, and never the SDK's npm publisher. */
    readonly publisher: { readonly name: string; readonly url: string | null };
    readonly contributors: readonly { readonly name: string; readonly url: string | null }[];
    readonly sagaPackages: Readonly<Record<string, string>>;
  };
  readonly inputs: {
    readonly releaseInput: { readonly sha256: string };
    readonly views: readonly { readonly file: string; readonly uri: string | null; readonly sha256: string | null; readonly bytes: number | null }[];
  };
  readonly endpoint: {
    readonly url: string;
    readonly reached: boolean;
    readonly server: { readonly name: string; readonly version: string } | null;
    readonly deploymentIdentity: { readonly status: 'established' | 'unknown' | 'mismatch'; readonly basis: string };
    readonly contractSha256: string | null;
    readonly tools: readonly ToolSnapshot[];
    readonly resources: readonly ResourceSnapshot[];
    /** `tools/call` requests made while discovering. Always 0; fixture invocations are listed apart. */
    readonly toolCallsDuringDiscovery: 0;
  };
  readonly fixture: { readonly declared: number; readonly invoked: boolean; readonly invocations: readonly FixtureInvocation[] };
  readonly artifact: {
    readonly file: typeof ARCHIVE_FILE;
    readonly sha256: string;
    readonly bytes: number;
    readonly files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  } | null;
  readonly validators: readonly { readonly name: string; readonly identity: string; readonly documentationDate: string }[];
  readonly findings: readonly Finding[];
  readonly handoff: readonly HandoffItem[];
  /** Preparing a package submits nothing and does not make anything live. */
  readonly submission: { readonly state: 'not-submitted'; readonly note: string };
}
