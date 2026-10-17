import type { IncomingMessage } from 'node:http';
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { z } from 'zod';

// Application-owned request authentication for protected MCP endpoints. A pluggable
// `OAuthTokenVerifier` (the SDK's own interface) decides who the caller is; this module decides
// what the application accepts and turns the outcome into HTTP. It never reads an identity
// from tool arguments or from shared "current user" state.

export const SUBSCRIPTIONS_SCOPE = 'subscriptions:read';
export const PLAYBACK_SCOPE = 'playback:play';

/** What one protected endpoint requires of a credential: the challenge realm and the scope. */
export interface AuthRequirement {
  readonly realm: string;
  readonly scope: string;
}

export const SUBSCRIPTIONS_REQUIREMENT: AuthRequirement = { realm: 'saga-a2ui-subscriptions', scope: SUBSCRIPTIONS_SCOPE };
export const PLAYBACK_REQUIREMENT: AuthRequirement = { realm: 'saga-a2ui-playback', scope: PLAYBACK_SCOPE };

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

function reject(requirement: AuthRequirement, status: 401 | 403, error: string, description: string, scope?: string): AuthDecision {
  const parts = [`realm="${requirement.realm}"`, `error="${error}"`, `error_description="${description}"`];
  if (scope) parts.push(`scope="${scope}"`);
  return { ok: false, status, challenge: `Bearer ${parts.join(', ')}`, error };
}

/**
 * Checks the `Authorization` header: a bearer credential the verifier accepts, not expired,
 * carrying the endpoint's required scope, and naming an account. Anything else is refused with
 * the HTTP status and `WWW-Authenticate` challenge RFC 6750 prescribes, before any protected work.
 */
export async function authenticate(
  request: Pick<IncomingMessage, 'headers'>,
  verifier: OAuthTokenVerifier,
  requirement: AuthRequirement,
  nowSeconds: () => number = () => Date.now() / 1000,
): Promise<AuthDecision> {
  const header = request.headers.authorization;
  if (header === undefined) return { ok: false, status: 401, challenge: `Bearer realm="${requirement.realm}"`, error: 'missing_token' };

  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match?.[1]) return reject(requirement, 401, 'invalid_token', 'Malformed credential');

  let authInfo: AuthInfo;
  try {
    authInfo = await verifier.verifyAccessToken(match[1]);
  } catch (error) {
    if (OAuthError.isInstance(error) && error.code === OAuthErrorCode.InvalidToken) return reject(requirement, 401, 'invalid_token', 'Invalid credential');
    return { ok: false, status: 500, error: 'server_error' };
  }
  if (typeof authInfo.expiresAt !== 'number' || authInfo.expiresAt <= nowSeconds()) {
    return reject(requirement, 401, 'invalid_token', 'Token has expired');
  }
  if (!authInfo.scopes.includes(requirement.scope)) {
    return reject(requirement, 403, 'insufficient_scope', 'User sign-in required', requirement.scope);
  }
  const identity = identityFromAuthInfo(authInfo);
  if (!identity) return reject(requirement, 403, 'insufficient_scope', 'User sign-in required', requirement.scope);
  return { ok: true, authInfo: snapshotAuthInfo(authInfo, identity) };
}
