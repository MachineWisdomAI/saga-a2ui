import { randomBytes } from 'node:crypto';

/** The bytes of one protected episode, as the application's storage returns them. */
export interface ProtectedMedia {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * The application's protected storage seam. Reading here is the "protected media fetch": no
 * code path may reach it before authentication, entitlement and the capability check.
 */
export interface MediaStore {
  read(episodeId: string): Promise<ProtectedMedia>;
}

/** What a capability is scoped to. The recipient is the view's key, not the person's name. */
export interface CapabilityGrant {
  readonly accountId: string;
  readonly episodeId: string;
  /** RFC 7638 thumbprint of the public key the media request must prove possession of. */
  readonly recipientThumbprint: string;
}

export interface IssuedCapability {
  /** Opaque and unguessable. Possession alone is not enough to acquire bytes. */
  readonly capability: string;
  /** Epoch seconds after which the service refuses the capability. */
  readonly expiresAt: number;
}

/** Issues the short-lived capability the synthetic media service later checks on every acquisition. */
export interface MediaService {
  issue(grant: CapabilityGrant): IssuedCapability;
}

export interface MediaServiceOptions {
  readonly ttlSeconds?: number;
  readonly nowSeconds?: () => number;
}

const DEFAULT_TTL_SECONDS = 60;

export function createMediaService(options: MediaServiceOptions = {}): MediaService {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const grants = new Map<string, CapabilityGrant & { readonly expiresAt: number }>();
  return {
    issue(grant) {
      const capability = randomBytes(32).toString('base64url');
      const expiresAt = nowSeconds() + ttlSeconds;
      grants.set(capability, { ...grant, expiresAt });
      return { capability, expiresAt };
    },
  };
}
