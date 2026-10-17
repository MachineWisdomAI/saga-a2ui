import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { PLAYBACK_SCOPE, SUBSCRIPTIONS_SCOPE } from './request-auth.js';

// DEVELOPMENT ONLY. Fixed, public, synthetic credentials for the local recipe and its tests.
// This verifier proves nothing about a real user. It is not exported from any package, refuses
// to be constructed when NODE_ENV is "production", and is wired only by the local demo entry
// (`serve.ts`), which listens on loopback. A real remote host supplies its own configured
// `OAuthTokenVerifier` (for example one that validates tokens from its identity provider).

export const DEV_ACCOUNTS = { alice: 'acct-synthetic-alice', bob: 'acct-synthetic-bob' } as const;

export const DEV_TOKENS = {
  alice: 'dev-only-token-alice',
  bob: 'dev-only-token-bob',
  /** A valid credential for the application itself, not for any user. */
  service: 'dev-only-token-service',
  expired: 'dev-only-token-expired',
} as const;

const HOUR_SECONDS = 3600;

export function createDevelopmentVerifier(): OAuthTokenVerifier {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The development-only token verifier cannot be used in a production environment.');
  }
  const user = (accountId: string, signInId: string, token: string, expiresAt: number): AuthInfo => ({
    token,
    clientId: 'development-client',
    scopes: [SUBSCRIPTIONS_SCOPE, PLAYBACK_SCOPE],
    expiresAt,
    extra: { accountId, signInId },
  });

  return {
    async verifyAccessToken(token) {
      const now = Date.now() / 1000;
      switch (token) {
        case DEV_TOKENS.alice:
          return user(DEV_ACCOUNTS.alice, 'dev-sign-in-alice', token, now + HOUR_SECONDS);
        case DEV_TOKENS.bob:
          return user(DEV_ACCOUNTS.bob, 'dev-sign-in-bob', token, now + HOUR_SECONDS);
        case DEV_TOKENS.expired:
          return user(DEV_ACCOUNTS.alice, 'dev-sign-in-expired', token, now - 60);
        case DEV_TOKENS.service:
          return { token, clientId: 'development-service', scopes: ['service'], expiresAt: now + HOUR_SECONDS };
        default:
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'Unknown credential');
      }
    },
  };
}
