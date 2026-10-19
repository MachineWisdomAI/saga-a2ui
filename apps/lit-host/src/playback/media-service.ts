import { createHash, randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, EmbeddedJWK, jwtVerify } from 'jose';
import { throwIfEnded, valueOrThrow, type BoundedScope } from '@saga-a2ui/mcp/server';
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
   */
  read(episodeId: string, signal: AbortSignal): Promise<ProtectedMedia>;
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
  | { readonly kind: 'partial'; readonly media: ProtectedMedia; readonly first: number; readonly last: number; readonly total: number }
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
export type EntitlementLookup = (accountId: string, episodeId: string, signal: AbortSignal) => Promise<EntitlementDecision>;

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

export interface MediaServiceOptions {
  readonly store: MediaStore;
  readonly entitlement: EntitlementLookup;
  /** Capability lifetime from issue. Expiry is measured on this service's clock, never the client's. */
  readonly ttlSeconds?: number;
  readonly nowSeconds?: () => number;
}

const DEFAULT_TTL_SECONDS = 60;
/** A proof older than this, or dated further ahead than the tolerance, is refused. */
const PROOF_MAX_AGE_SECONDS = 60;
const PROOF_CLOCK_TOLERANCE_SECONDS = 5;
const REFUSED: MediaOutcome = { kind: 'refused' };

const sha256Base64Url = (value: string) => createHash('sha256').update(value).digest('base64url');

export function createMediaService(options: MediaServiceOptions): MediaService {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  // Keyed by the capability's hash, so the table never holds the usable value itself.
  const grants = new Map<string, CapabilityGrant & { readonly expiresAt: number }>();
  const usedProofs = new Map<string, number>(); // jti -> when it can be forgotten

  function forgetExpired(now: number): void {
    for (const [hash, grant] of grants) if (grant.expiresAt <= now) grants.delete(hash);
    for (const [jti, forgetAt] of usedProofs) if (forgetAt <= now) usedProofs.delete(jti);
  }

  return {
    issue(grant) {
      const now = nowSeconds();
      forgetExpired(now);
      const capability = randomBytes(32).toString('base64url');
      const expiresAt = now + ttlSeconds;
      grants.set(sha256Base64Url(capability), { ...grant, expiresAt });
      return { capability, expiresAt };
    },

    async acquire(request, scope) {
      throwIfEnded(scope);
      const now = nowSeconds();
      forgetExpired(now);
      if (request.capability === undefined || request.proof === undefined) return REFUSED;
      const capabilityHash = sha256Base64Url(request.capability);
      const grant = grants.get(capabilityHash);
      if (!grant || grant.episodeId !== request.episodeId) return REFUSED;

      try {
        const { payload, protectedHeader } = await jwtVerify(request.proof, EmbeddedJWK, {
          algorithms: ['ES256'],
          typ: MEDIA_PROOF_TYP,
          requiredClaims: ['iat', 'jti'],
          maxTokenAge: PROOF_MAX_AGE_SECONDS,
          clockTolerance: PROOF_CLOCK_TOLERANCE_SECONDS,
          currentDate: new Date(now * 1000),
        });
        if (payload.htm !== request.method || payload.htu !== request.url || payload.cap !== capabilityHash) return REFUSED;
        if (!protectedHeader.jwk || (await calculateJwkThumbprint(protectedHeader.jwk)) !== grant.recipientThumbprint) return REFUSED;
        const { jti } = payload;
        if (jti === undefined || usedProofs.has(jti)) return REFUSED;
        usedProofs.set(jti, now + PROOF_MAX_AGE_SECONDS + PROOF_CLOCK_TOLERANCE_SECONDS);
      } catch {
        return REFUSED;
      }

      // The lookup and the storage read are bounded stages of this acquisition. An answer that loses
      // the race is dropped by `run`, so it cannot reach the grant table or start the read below.
      const decision = valueOrThrow(await scope.run('authorization', (stage) => options.entitlement(grant.accountId, grant.episodeId, stage.signal)));
      throwIfEnded(scope);
      if (decision !== 'entitled') {
        // A denial is final for this capability: access granted again later needs a new Play. A
        // lookup that throws or is abandoned never reaches here, so a fault does not revoke anything,
        // and a denial that arrives after the request ended is dropped: the grant stays until its
        // own expiry and the next acquisition asks the lookup again.
        grants.delete(capabilityHash);
        return REFUSED;
      }

      const media = valueOrThrow(await scope.run('storage', (stage) => options.store.read(grant.episodeId, stage.signal)));
      throwIfEnded(scope);
      const range = resolveRange(request.range, media.bytes.length);
      if (range.kind === 'whole') return { kind: 'delivered', media };
      if (range.kind === 'unsatisfiable') return { kind: 'unsatisfiable', total: media.bytes.length };
      const slice = { contentType: media.contentType, bytes: media.bytes.subarray(range.first, range.last + 1) };
      return { kind: 'partial', media: slice, first: range.first, last: range.last, total: media.bytes.length };
    },
  };
}
