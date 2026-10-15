import { createHash, randomBytes } from 'node:crypto';
import { calculateJwkThumbprint, EmbeddedJWK, jwtVerify } from 'jose';
import { MEDIA_PROOF_TYP } from './media-proof.js';

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
  read(episodeId: string): Promise<ProtectedMedia>;
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
}

/** A refusal carries no reason: telling a caller which check failed would help it probe. */
export type MediaOutcome =
  | { readonly kind: 'delivered'; readonly media: ProtectedMedia }
  | { readonly kind: 'refused' };

/**
 * The synthetic media service. It issues capabilities and decides every later acquisition.
 * A capability is only a handle: acquiring bytes also needs a fresh proof signed by the key the
 * capability was bound to (RFC 9449 style proof of possession), so another user or another
 * episode cannot use a copy of it.
 */
export interface MediaService {
  issue(grant: CapabilityGrant): IssuedCapability;
  acquire(request: MediaRequest): Promise<MediaOutcome>;
}

export interface MediaServiceOptions {
  readonly store: MediaStore;
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

    async acquire(request) {
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

      return { kind: 'delivered', media: await options.store.read(grant.episodeId) };
    },
  };
}
