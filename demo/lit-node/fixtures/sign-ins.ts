import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import {
  createDevelopmentVerifier,
  DEV_TOKENS,
} from '../../../apps/lit-host/src/mcp/dev-auth.js';
import { ACCOUNT_SCOPE } from '../../../templates/lit-node/server/authenticate.js';

// DEMO-OWNED, LOCAL-ONLY authentication. The credentials are fixed, public strings that anyone who
// reads this file knows. They prove nothing about a person and there is no password, OAuth flow or
// registration behind them. A real deployment supplies its own `OAuthTokenVerifier` for its
// identity provider; nothing in the SDK or in the clean starter depends on this file. The host page
// shows these choices under a banner that says so, and `NODE_ENV=production` refuses to start.

export interface SignIn {
  readonly id:
    'alice' | 'bob' | 'expired' | 'service' | 'unknown' | 'signed-out';
  readonly label: string;
  /** What the host would send as the bearer credential; `undefined` sends none. */
  readonly token: string | undefined;
  /** What the server does with it, for the person choosing. */
  readonly effect: string;
}

export const SIGN_INS: readonly SignIn[] = [
  {
    id: 'alice',
    label: 'Alice',
    token: DEV_TOKENS.alice,
    effect: 'A subscriber who may play the first episode.',
  },
  {
    id: 'bob',
    label: 'Bob',
    token: DEV_TOKENS.bob,
    effect: 'A subscriber who may not play any episode.',
  },
  {
    id: 'expired',
    label: 'Expired credential',
    token: DEV_TOKENS.expired,
    effect: 'Alice’s credential after it ran out; the server refuses it.',
  },
  {
    id: 'service',
    label: 'Service credential',
    token: DEV_TOKENS.service,
    effect:
      'Valid for the application itself, not for any account; protected endpoints refuse it.',
  },
  {
    id: 'unknown',
    label: 'Unknown credential',
    token: 'not-a-demo-credential',
    effect: 'Nobody issued it; the server refuses it.',
  },
  {
    id: 'signed-out',
    label: 'Signed out',
    token: undefined,
    effect: 'No credential at all; protected endpoints refuse the request.',
  },
];

/**
 * The development verifier, plus the scope the starter's request authentication requires of the
 * notes endpoint. Only a credential that names an account receives it, so the service credential
 * stays refused there.
 */
export function createDemoVerifier(): OAuthTokenVerifier {
  const development = createDevelopmentVerifier();
  return {
    async verifyAccessToken(token) {
      const info = await development.verifyAccessToken(token);
      return typeof info.extra?.accountId === 'string'
        ? { ...info, scopes: [...info.scopes, ACCOUNT_SCOPE] }
        : info;
    },
  };
}
