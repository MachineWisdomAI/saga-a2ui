import { createHash, randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, EmbeddedJWK, jwtVerify } from 'jose';
import {
  throwIfEnded,
  valueOrThrow,
  type BoundedScope,
} from '@saga-a2ui/mcp/server';
import {
  assertByteLimit,
  MAX_MEDIA_BODY_BYTES,
  MediaTooLargeError,
} from './media-limits.js';
import { MEDIA_PROOF_TYP } from './media-proof.js';
import { resolveRange } from './media-range.js';

/** The bytes of one protected episode, as the application's storage returns them. */
export interface ProtectedMedia {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * The application's protected storage seam. Reading here is the "protected media fetch": no
 * code path may reach it before the capability, the recipient's proof and the scope all check out.
 */
export interface MediaStore {
  /**
   * `signal` aborts when the acquisition is abandoned (its budget, the request's deadline or the
   * caller). A store that ignores it still cannot hold the request open, but one that honors it
   * stops its own work. Bytes that arrive after the abort are never delivered.
   *
   * `limits.maxBytes` is the most the service will deliver. A store that can learn an episode's size
   * before it loads the episode should refuse a larger one (reject) instead of loading it; the
   * service refuses any body above the limit whether or not the store honors the hint.
   */
  read(
    episodeId: string,
    signal: AbortSignal,
    limits: { readonly maxBytes: number },
  ): Promise<ProtectedMedia>;
}

/** What a capability is scoped to. The recipient is the view's key, not the person's name. */
export interface CapabilityGrant {
  readonly accountId: string;
  readonly episodeId: string;
  /** RFC 7638 thumbprint of the public key every media request must prove possession of. */
  readonly recipientThumbprint: string;
}

export interface IssuedCapability {
  /** Opaque and unguessable. Possession alone is not enough to acquire bytes. */
  readonly capability: string;
  /** Epoch seconds after which the service refuses the capability. */
  readonly expiresAt: number;
}

/** One fresh acquisition, as the HTTP edge saw it. */
export interface MediaRequest {
  readonly episodeId: string;
  /** The absolute URL the client requested; the proof must name exactly this. */
  readonly url: string;
  readonly method: string;
  readonly capability: string | undefined;
  readonly proof: string | undefined;
  /** The raw `Range` header, if the client sent one. Interpreted only after every check passed. */
  readonly range: string | undefined;
}

/** A refusal carries no reason: telling a caller which check failed would help it probe. */
export type MediaOutcome =
  | { readonly kind: 'delivered'; readonly media: ProtectedMedia }
  /** A supported byte range: `media.bytes` is exactly bytes `first`..`last` of a body of `total`. */
  | {
      readonly kind: 'partial';
      readonly media: ProtectedMedia;
      readonly first: number;
      readonly last: number;
      readonly total: number;
    }
  /** An authorized caller asked for a range that cannot be served. It carries the length and no bytes. */
  | { readonly kind: 'unsatisfiable'; readonly total: number }
  | { readonly kind: 'refused' };

export type EntitlementDecision = 'entitled' | 'denied';

/**
 * The application's current answer to "may this account hear this episode?". It is also the
 * current revocation lookup: the service asks it on every fresh acquisition, with the account and
 * episode the capability was issued for, so a revoked entitlement refuses new bytes even though the
 * capability has not expired. A lookup that throws is a fault, not a revocation. `signal` aborts
 * when the lookup is abandoned; an answer that arrives after that changes nothing.
 */
export type EntitlementLookup = (
  accountId: string,
  episodeId: string,
  signal: AbortSignal,
) => Promise<EntitlementDecision>;

/**
 * The synthetic media service. It issues capabilities and decides every later acquisition.
 *
 * A capability is only a handle: acquiring bytes also needs a fresh proof signed by the key the
 * capability was bound to (RFC 9449 style proof of possession), so another user or another
 * episode cannot use a copy of it.
 *
 * Every acquisition, whole or byte range, repeats the same checks in this order and stops at the
 * first failure with `refused` and no read of protected storage: capability known and unexpired on
 * the service's clock, episode scope, proof of the bound recipient key, then current entitlement.
 * Only after all pass is storage read and the `Range` header interpreted.
 *
 * What it cannot do: a response that already passed these checks is not tracked or cancelled, and
 * bytes the client already received or buffered cannot be retracted. Revocation and expiry decide
 * the next acquisition only.
 */
export interface MediaService {
  issue(grant: CapabilityGrant): IssuedCapability;
  /**
   * Decides one acquisition inside `scope`, the request's acquisition budget. Rejects when the
   * entitlement lookup or the storage read fails, or when the scope ends first (a `StageFailure`
   * with the typed cause); the caller maps that to "try again". Once the scope has ended nothing
   * more starts: no lookup, no storage read, and a late denial deletes no grant.
   */
  acquire(request: MediaRequest, scope: BoundedScope): Promise<MediaOutcome>;
}

/** The finite bounds on what the service keeps for as long as it lives. */
export interface MediaRetentionLimits {
  /**
   * Most capabilities held at once. When the table is full, capabilities past their expiry go
   * first, then the one issued longest ago: its holder simply plays again. Default 1,024.
   */
  readonly maxGrants?: number;
  /**
   * Most spent proof identifiers held at once. A spent identifier is what makes a proof
   * single-use, so none is forgotten while its proof could still be accepted (until its `iat`
   * plus the maximum age and the clock tolerance, inclusive): when the table is full of
   * identifiers that are still needed, a new proof is refused until room returns (at most
   * {@link PROOF_MAX_RETENTION_SECONDS} after the identifier was spent). Default 4,096.
   */
  readonly maxProofs?: number;
}

export interface MediaServiceOptions extends MediaRetentionLimits {
  readonly store: MediaStore;
  readonly entitlement: EntitlementLookup;
  /**
   * Capability lifetime from issue: a whole number of seconds from 1 to
   * {@link MAX_CAPABILITY_TTL_SECONDS}. Expiry is measured on this service's clock, never the client's.
   */
  readonly ttlSeconds?: number;
  /** Must return finite seconds; a reading that is not is a fault of the service and issues or accepts nothing. */
  readonly nowSeconds?: () => number;
  /**
   * The most bytes one episode may be. A store that returns more makes the acquisition fail as a
   * storage fault. Defaults to `MAX_MEDIA_BODY_BYTES`, the view's own limit, so the service never
   * sends a body the view would refuse.
   */
  readonly maxBytes?: number;
}

const DEFAULT_TTL_SECONDS = 60;
/** The longest a capability may live. A longer setting is a mistake, not a policy. */
export const MAX_CAPABILITY_TTL_SECONDS = 3_600;
const DEFAULT_MAX_GRANTS = 1_024;
const DEFAULT_MAX_PROOFS = 4_096;
/** A proof older than this, or dated further ahead than the tolerance, is refused. */
const PROOF_MAX_AGE_SECONDS = 60;
const PROOF_CLOCK_TOLERANCE_SECONDS = 5;
/**
 * A verified proof is accepted while `iat - tolerance <= now <= iat + maxAge + tolerance`, both
 * ends inclusive. The identifier of a spent proof must outlive that whole interval, so its
 * retention runs from the proof's own `iat`, not from the moment it was first used: a proof dated
 * ahead of the clock stays acceptable for longer after its first use than one dated now.
 */
const PROOF_ACCEPTED_AFTER_ISSUE_SECONDS =
  PROOF_MAX_AGE_SECONDS + PROOF_CLOCK_TOLERANCE_SECONDS;
/**
 * The longest a spent identifier is held after its first use: the worst-case future `iat`
 * (the tolerance), the accepted interval, and the one second that makes the last accepted second
 * inclusive. The proof table makes room again within this time.
 */
const PROOF_MAX_RETENTION_SECONDS =
  PROOF_CLOCK_TOLERANCE_SECONDS + PROOF_ACCEPTED_AFTER_ISSUE_SECONDS + 1;
const REFUSED: MediaOutcome = { kind: 'refused' };

// Formats and sizes of everything a caller can make the service keep or parse. With the entry
// limits they bound the retained bytes: a grant is at most a few hundred bytes, a spent proof
// identifier at most 64.
const CAPABILITY_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const EPISODE_FORMAT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const THUMBPRINT_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const PROOF_ID_FORMAT = /^[A-Za-z0-9._~-]{1,64}$/;
const MAX_ACCOUNT_ID_BYTES = 256;
/** Real proofs are under a kilobyte; this stops a signed envelope of any size reaching the parser. */
const MAX_PROOF_CHARS = 4_096;

const sha256Base64Url = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

const isSafeSeconds = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Math.abs(value) <= Number.MAX_SAFE_INTEGER;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * Why a capability lifetime setting is unusable, or `undefined` when it is usable. The listener asks
 * this before it opens its port, so a bad setting never starts a host.
 */
export function capabilityTtlProblem(ttlSeconds: unknown): string | undefined {
  return ttlSeconds === undefined ||
    (typeof ttlSeconds === 'number' &&
      Number.isSafeInteger(ttlSeconds) &&
      ttlSeconds >= 1 &&
      ttlSeconds <= MAX_CAPABILITY_TTL_SECONDS)
    ? undefined
    : `The capability ttl must be a whole number of seconds from 1 to ${MAX_CAPABILITY_TTL_SECONDS}`;
}

export function createMediaService(options: MediaServiceOptions): MediaService {
  const ttlProblem = capabilityTtlProblem(options.ttlSeconds);
  if (ttlProblem !== undefined) throw new TypeError(ttlProblem);
  const maxGrants = options.maxGrants ?? DEFAULT_MAX_GRANTS;
  const maxProofs = options.maxProofs ?? DEFAULT_MAX_PROOFS;
  if (!isCount(maxGrants) || !isCount(maxProofs))
    throw new TypeError(
      'The media service retention limits must be positive whole numbers',
    );
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const clock = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const nowSeconds = (): number => {
    const reading: unknown = clock();
    if (!isSafeSeconds(reading))
      throw new Error('The media service clock returned an unusable time.');
    return reading;
  };
  const maxBytes = assertByteLimit(
    'maxBytes',
    options.maxBytes ?? MAX_MEDIA_BODY_BYTES,
  );
  // Keyed by the capability's hash, so the table never holds the usable value itself. A Map keeps
  // insertion order, which is the deterministic eviction order: oldest issue first.
  const grants = new Map<
    string,
    CapabilityGrant & { readonly expiresAt: number }
  >();
  const usedProofs = new Map<string, number>(); // jti -> when it can be forgotten

  function forgetExpired(now: number): void {
    for (const [hash, grant] of grants)
      if (grant.expiresAt <= now) grants.delete(hash);
    for (const [jti, forgetAt] of usedProofs)
      if (forgetAt <= now) usedProofs.delete(jti);
  }

  return {
    issue(grant) {
      if (
        !grant.accountId ||
        Buffer.byteLength(grant.accountId) > MAX_ACCOUNT_ID_BYTES ||
        !EPISODE_FORMAT.test(grant.episodeId) ||
        !THUMBPRINT_FORMAT.test(grant.recipientThumbprint)
      )
        throw new TypeError(
          'The capability grant is not in a recordable form.',
        );
      const now = nowSeconds();
      forgetExpired(now);
      // Room for the new grant: the oldest issues go first.
      for (const hash of grants.keys()) {
        if (grants.size < maxGrants) break;
        grants.delete(hash);
      }
      const capability = randomBytes(32).toString('base64url');
      const expiresAt = Math.ceil(now + ttlSeconds);
      grants.set(sha256Base64Url(capability), {
        accountId: grant.accountId,
        episodeId: grant.episodeId,
        recipientThumbprint: grant.recipientThumbprint,
        expiresAt,
      });
      return { capability, expiresAt };
    },

    async acquire(request, scope) {
      throwIfEnded(scope);
      const now = nowSeconds();
      forgetExpired(now);
      if (request.capability === undefined || request.proof === undefined)
        return REFUSED;
      if (
        !CAPABILITY_FORMAT.test(request.capability) ||
        request.proof.length > MAX_PROOF_CHARS
      )
        return REFUSED;
      const capabilityHash = sha256Base64Url(request.capability);
      const grant = grants.get(capabilityHash);
      if (!grant || grant.episodeId !== request.episodeId) return REFUSED;

      try {
        const { payload, protectedHeader } = await jwtVerify(
          request.proof,
          EmbeddedJWK,
          {
            algorithms: ['ES256'],
            typ: MEDIA_PROOF_TYP,
            requiredClaims: ['iat', 'jti'],
            maxTokenAge: PROOF_MAX_AGE_SECONDS,
            clockTolerance: PROOF_CLOCK_TOLERANCE_SECONDS,
            currentDate: new Date(now * 1000),
          },
        );
        if (
          payload.htm !== request.method ||
          payload.htu !== request.url ||
          payload.cap !== capabilityHash
        )
          return REFUSED;
        if (
          !protectedHeader.jwk ||
          (await calculateJwkThumbprint(protectedHeader.jwk)) !==
            grant.recipientThumbprint
        )
          return REFUSED;
        const { jti, iat } = payload;
        if (
          typeof jti !== 'string' ||
          !PROOF_ID_FORMAT.test(jti) ||
          typeof iat !== 'number' ||
          usedProofs.has(jti)
        )
          return REFUSED;
        // Forgetting a spent identifier early would let its proof be used again, so a full table
        // refuses the new proof instead; room returns as the oldest identifiers age out.
        if (usedProofs.size >= maxProofs) return REFUSED;
        // The verified `iat` fixes the last second this proof can be accepted (rounded up, so a
        // fractional `iat` never shortens it); the identifier is forgotten the second after.
        usedProofs.set(
          jti,
          Math.ceil(iat) + PROOF_ACCEPTED_AFTER_ISSUE_SECONDS + 1,
        );
      } catch {
        return REFUSED;
      }

      // The lookup and the storage read are bounded stages of this acquisition. An answer that loses
      // the race is dropped by `run`, so it cannot reach the grant table or start the read below.
      const decision = valueOrThrow(
        await scope.run('authorization', (stage) =>
          options.entitlement(grant.accountId, grant.episodeId, stage.signal),
        ),
      );
      throwIfEnded(scope);
      if (decision !== 'entitled') {
        // A denial is final for this capability: access granted again later needs a new Play. A
        // lookup that throws or is abandoned never reaches here, so a fault does not revoke anything,
        // and a denial that arrives after the request ended is dropped: the grant stays until its
        // own expiry and the next acquisition asks the lookup again.
        grants.delete(capabilityHash);
        return REFUSED;
      }

      const media = valueOrThrow(
        await scope.run('storage', async (stage) => {
          const read = await options.store.read(grant.episodeId, stage.signal, {
            maxBytes,
          });
          // A body past the limit is a storage fault: "try again", never a partial or a whole
          // delivery, and nothing of it reaches the response, a range or a length probe.
          if (read.bytes.length > maxBytes)
            throw new MediaTooLargeError('The stored episode', maxBytes);
          return read;
        }),
      );
      throwIfEnded(scope);
      const range = resolveRange(request.range, media.bytes.length);
      if (range.kind === 'whole') return { kind: 'delivered', media };
      if (range.kind === 'unsatisfiable')
        return { kind: 'unsatisfiable', total: media.bytes.length };
      const slice = {
        contentType: media.contentType,
        bytes: media.bytes.subarray(range.first, range.last + 1),
      };
      return {
        kind: 'partial',
        media: slice,
        first: range.first,
        last: range.last,
        total: media.bytes.length,
      };
    },
  };
}
