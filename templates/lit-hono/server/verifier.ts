import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';

// APPLICATION-OWNED. This is the one place that decides who a bearer credential belongs to.
//
// The starter ships no accounts and no tokens, so it refuses every credential: the public status
// operation works, and every protected request fails closed until you replace this with the
// verifier for your identity provider. A verifier returns:
//
//   { token, clientId, scopes: [ACCOUNT_SCOPE], expiresAt: <seconds since epoch>,
//     extra: { accountId: '<your stable account identifier>' } }
//
// and throws `OAuthError(OAuthErrorCode.InvalidToken, ...)` for a credential it does not accept.

export const verifier: OAuthTokenVerifier = {
  async verifyAccessToken() {
    throw new OAuthError(
      OAuthErrorCode.InvalidToken,
      'No identity provider is configured',
    );
  },
};
