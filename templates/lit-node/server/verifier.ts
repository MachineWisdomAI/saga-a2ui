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
//     resource: new URL('<the protected endpoint this token was issued for>'),
//     extra: { accountId: '<your stable account identifier>' } }
//
// `resource` is the audience your identity provider put in the token (RFC 8707). The listener's
// `resource` option states the endpoint's own URL, and a token naming anything else is refused:
// a token issued for another service must not work here. A verifier that returns no `resource`
// is refused for every request.
//
// A verifier throws `OAuthError(OAuthErrorCode.InvalidToken, ...)` for a credential it does not accept.
//
// The listener calls the verifier through `boundVerifier`: at most 64 calls run at once (a full cap
// answers 503 without calling you). The call also receives an `AbortSignal` as an optional second
// argument, aborted when the request stops waiting or the call has not settled after 30 seconds. Declare
// `verifyAccessToken(token, signal?: AbortSignal)` and pass the signal to your identity provider's
// client (for example `fetch(url, { signal })`) so abandoned work actually stops and its slot is freed.
// A slot is freed only when your call settles. A verifier that ignores the signal and never settles
// keeps its slot for the life of the process; enough of those and every credential is refused 503.

export const verifier: OAuthTokenVerifier = {
  async verifyAccessToken() {
    throw new OAuthError(
      OAuthErrorCode.InvalidToken,
      'No identity provider is configured',
    );
  },
};
