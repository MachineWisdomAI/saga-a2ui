import type { EndpointSnapshot } from './endpoint.js';
import type { ARCHIVE_FILES, Finding, HandoffItem, PublicationRecord, TargetName } from './record.js';
import type { LoadedReleaseInput, ReleaseInput } from './release-input.js';
import type { ZipEntry } from './zip.js';

// What differs between the host directories a release is prepared for (CLI3 #66, CLI4 #67), as one
// interface. `publish.ts` owns what is the same for every host: reading the build and the endpoint,
// the deployment identity, the record, stale evidence, the secret boundary and the output
// directory. A target owns its package: what goes into it, the rules it is checked against, the tool
// rules its host applies, and what only the owner or the host can do. A further host adds one target
// here and one row in `publish.ts`; nothing in the shared path names a host.

/** What the shared assessment observed, handed to a target so its package can carry the same identities as the record. */
export interface Evidence {
  readonly source: PublicationRecord['source'];
  readonly sagaPackages: PublicationRecord['application']['sagaPackages'];
  readonly releaseInputSha256: string;
  readonly views: PublicationRecord['inputs']['views'];
  readonly endpoint: Pick<PublicationRecord['endpoint'], 'url' | 'server' | 'deploymentIdentity' | 'contractSha256' | 'instructionsSha256' | 'tools' | 'resources'>;
  /** What the endpoint served, or `undefined` when it could not be read. */
  readonly snapshot: EndpointSnapshot | undefined;
}

export interface TargetContext {
  readonly loaded: LoadedReleaseInput;
  readonly evidence: Evidence;
  /** Literal values that must not appear anywhere in the package, such as a credential used for discovery. */
  readonly forbiddenLiterals: readonly string[];
  readonly signal: AbortSignal | undefined;
}

/** The validators a package was judged by, as the record names them. */
export interface ValidatorIdentity {
  readonly name: string;
  readonly identity: string;
  readonly documentationDate: string;
}

export interface PreparedPackage {
  /** The bytes that would be uploaded or submitted from. */
  readonly archive: Buffer;
  /** The files read back out of `archive`; the record lists their digests. */
  readonly entries: readonly ZipEntry[];
  readonly findings: readonly Finding[];
  readonly validators: readonly ValidatorIdentity[];
}

export interface PublicationTarget {
  readonly name: TargetName;
  /** The archive this target writes beside the record. */
  readonly archiveFile: (typeof ARCHIVE_FILES)[TargetName];
  /** What the record says about submission: preparing something submits nothing. */
  readonly submissionNote: string;
  /** Why the release input cannot be used for this target at all, or `null`. A section that is merely incomplete is a finding, not this. */
  inputProblem(input: ReleaseInput): string | null;
  /** `null` when the URL is an endpoint this host's directory accepts. */
  endpointProblem(url: string): string | null;
  /** The findings about the tools the endpoint advertised, by this host's rules. */
  toolFindings(snapshot: EndpointSnapshot): Finding[];
  prepare(context: TargetContext): Promise<PreparedPackage>;
  /** What only the owner or the host can do. It is pending whatever the checks say. */
  handoff(loaded: LoadedReleaseInput): HandoffItem[];
}
