import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { RequestLifetime } from '@saga-a2ui/mcp/server';
import { identityOf } from './identity.js';

// APPLICATION-OWNED request authentication for the protected endpoint. A verifier (verifier.ts)
// decides who a bearer credential belongs to; this module decides what the application accepts
// and turns the outcome into HTTP. It never reads an identity from tool arguments or from shared
// "current user" state: the result belongs to exactly one request.

/** The scope a credential must carry to reach the protected endpoint. */
export const ACCOUNT_SCOPE = 'account:read';
const REALM = 'saga-starter';

/**
 * Whether a verified credential was issued for this protected resource (RFC 8707). A credential that
 * names no resource, or another one, is refused: a token minted for a different service the same
 * identity provider also serves must never become authority here. A fragment is not part of a
 * resource identifier, so it is ignored on both sides.
 */
function isIssuedFor(resource: unknown, expected: URL): boolean {
  if (!(resource instanceof URL)) return false;
  const bare = (value: URL): string => {
    const copy = new URL(value);
    copy.hash = '';
    return copy.href;
  };
  return bare(resource) === bare(expected);
}

/** Throws before the listener opens when the protected resource is not an absolute http(s) URL. */
export function assertResource(resource: unknown): asserts resource is URL {
  if (!(resource instanceof URL) || !/^https?:$/.test(resource.protocol))
    throw new Error(
      'The listener is not configured: resource must be the absolute http(s) URL of the protected endpoint.',
    );
}

export type AuthDecision =
  | { readonly ok: true; readonly authInfo: AuthInfo }
  | {
      readonly ok: false;
      readonly status: 401 | 403 | 503;
      readonly challenge?: string;
    };

const refuse = (
  status: 401 | 403,
  error: string,
  scope?: string,
): AuthDecision => ({
  ok: false,
  status,
  challenge: `Bearer realm="${REALM}", error="${error}"${scope === undefined ? '' : `, scope="${scope}"`}`,
});

/**
 * Checks the value of the `Authorization` header: a bearer credential the verifier accepts, not expired,
 * issued for `resource`, carrying `ACCOUNT_SCOPE` and naming an account. Anything else is refused before any protected
 * work. The verifier runs as the request's `authentication` stage, so a verifier that never
 * answers cannot hold the request past its budget.
 */
export async function authenticate(
  header: string | undefined,
  verifier: OAuthTokenVerifier,
  resource: URL,
  lifetime: RequestLifetime,
): Promise<AuthDecision> {
  if (header === undefined)
    return { ok: false, status: 401, challenge: `Bearer realm="${REALM}"` };
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match?.[1]) return refuse(401, 'invalid_token');

  const token = match[1];
  const verified = await lifetime.run('authentication', () =>
    verifier.verifyAccessToken(token),
  );
  if (!verified.ok) {
    // A verifier that rejects the credential is a 401; one that fails or runs out of time is not the caller's fault.
    const cause = verified.cause;
    const rejected =
      cause.kind === 'dependency-failure' &&
      OAuthError.isInstance(cause.error) &&
      cause.error.code === OAuthErrorCode.InvalidToken;
    return rejected ? refuse(401, 'invalid_token') : { ok: false, status: 503 };
  }
  const authInfo = verified.value;
  if (
    typeof authInfo.expiresAt !== 'number' ||
    authInfo.expiresAt <= Date.now() / 1000
  )
    return refuse(401, 'invalid_token');
  if (!isIssuedFor(authInfo.resource, resource))
    return refuse(401, 'invalid_token');
  if (!authInfo.scopes.includes(ACCOUNT_SCOPE))
    return refuse(403, 'insufficient_scope', ACCOUNT_SCOPE);
  const identity = identityOf(authInfo);
  if (!identity) return refuse(403, 'insufficient_scope', ACCOUNT_SCOPE);
  // The verifier may reuse the object it returned (a cached token record). Copy what this request
  // owns and freeze it, so a later request's claims can never decide this one's account.
  return {
    ok: true,
    authInfo: Object.freeze({
      ...authInfo,
      scopes: [...authInfo.scopes],
      extra: Object.freeze({
        ...authInfo.extra,
        accountId: identity.accountId,
      }),
    }),
  };
}
