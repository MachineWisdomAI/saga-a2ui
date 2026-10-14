import type { IncomingMessage } from 'node:http';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';

// Application-owned request authentication for protected MCP endpoints. A pluggable
// `OAuthTokenVerifier` (the SDK's own interface) decides who the caller is; this module decides
// what the application accepts and turns the outcome into HTTP. It never reads an identity
// from tool arguments or from shared "current user" state.

export const SUBSCRIPTIONS_SCOPE = 'subscriptions:read';
const REALM = 'saga-a2ui-subscriptions';

/** Who is calling, as established by the verifier for exactly one request. */
export interface VerifiedIdentity {
  readonly accountId: string;
  /** Identifies one sign-in (not one request); the source of the view-session label. */
  readonly signInId: string;
}

export type AuthDecision =
  | { readonly ok: true; readonly authInfo: AuthInfo }
  | { readonly ok: false; readonly status: 401 | 403 | 500; readonly challenge?: string; readonly error: string };

const IdentityClaims = z.object({ accountId: z.string().min(1), signInId: z.string().min(1) });

/**
 * Reads the verified identity from the SDK's per-request auth context. A credential that was
 * verified but names no account (a service credential) yields `undefined`.
 */
export function identityFromAuthInfo(authInfo: AuthInfo | undefined): VerifiedIdentity | undefined {
  const claims = IdentityClaims.safeParse(authInfo?.extra);
  return claims.success ? Object.freeze({ accountId: claims.data.accountId, signInId: claims.data.signInId }) : undefined;
}

/**
 * Copies the accepted request's authorization into an object this request owns. A verifier may
 * reuse or mutate the `AuthInfo` it returns — a cached token record, for example — and the
 * transport reads `req.auth` only after the request body arrives. Attaching the verifier's own
 * object would then let a later request's claims decide an earlier request's user. The copy is
 * frozen so nothing downstream can mutate it either; the validated identity is written last so
 * it always describes the credential this request was authenticated with.
 */
function snapshotAuthInfo(authInfo: AuthInfo, identity: VerifiedIdentity): AuthInfo {
  return Object.freeze({
    ...authInfo,
    scopes: [...authInfo.scopes],
    extra: Object.freeze({ ...authInfo.extra, accountId: identity.accountId, signInId: identity.signInId }),
  });
}

function reject(status: 401 | 403, error: string, description: string, scope?: string): AuthDecision {
  const parts = [`realm="${REALM}"`, `error="${error}"`, `error_description="${description}"`];
  if (scope) parts.push(`scope="${scope}"`);
  return { ok: false, status, challenge: `Bearer ${parts.join(', ')}`, error };
}

/**
 * Checks the `Authorization` header: a bearer credential the verifier accepts, not expired,
 * carrying the subscriptions scope, and naming an account. Anything else is refused with the
 * HTTP status and `WWW-Authenticate` challenge RFC 6750 prescribes, before any protected work.
 */
export async function authenticate(
  request: Pick<IncomingMessage, 'headers'>,
  verifier: OAuthTokenVerifier,
  nowSeconds: () => number = () => Date.now() / 1000,
): Promise<AuthDecision> {
  const header = request.headers.authorization;
  if (header === undefined) return { ok: false, status: 401, challenge: `Bearer realm="${REALM}"`, error: 'missing_token' };

  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match?.[1]) return reject(401, 'invalid_token', 'Malformed credential');

  let authInfo: AuthInfo;
  try {
    authInfo = await verifier.verifyAccessToken(match[1]);
  } catch (error) {
    if (error instanceof InvalidTokenError) return reject(401, 'invalid_token', 'Invalid credential');
    return { ok: false, status: 500, error: 'server_error' };
  }
  if (typeof authInfo.expiresAt !== 'number' || authInfo.expiresAt <= nowSeconds()) {
    return reject(401, 'invalid_token', 'Token has expired');
  }
  if (!authInfo.scopes.includes(SUBSCRIPTIONS_SCOPE)) {
    return reject(403, 'insufficient_scope', 'User sign-in required', SUBSCRIPTIONS_SCOPE);
  }
  const identity = identityFromAuthInfo(authInfo);
  if (!identity) return reject(403, 'insufficient_scope', 'User sign-in required', SUBSCRIPTIONS_SCOPE);
  return { ok: true, authInfo: snapshotAuthInfo(authInfo, identity) };
}
