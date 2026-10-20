import type { AuthInfo } from '@modelcontextprotocol/server';

/** The application's own immutable value for who is asking. Nothing a caller sends can name it. */
export interface AccountIdentity {
  readonly accountId: string;
}

/**
 * Turns the verified request context into an identity. A credential that was verified but names
 * no account (a service credential, for example) yields `undefined`, and a protected operation
 * then fails closed without running its handler.
 */
export function identityOf(authInfo: AuthInfo | undefined): AccountIdentity | undefined {
  const accountId = authInfo?.extra?.accountId;
  return typeof accountId === 'string' && accountId !== '' ? Object.freeze({ accountId }) : undefined;
}
