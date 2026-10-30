import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import {
  registerProtectedOperation,
  registerPublicOperation,
  viewUriForHtml,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { z } from 'zod';
import {
  ACCOUNT_TOOL,
  AccountOutputSchema,
  READ_ONLY,
  STATUS_TOOL,
  StatusOutputSchema,
  TEXT,
  VIEW_MARKER,
} from '../src/contract.js';
import { identityOf, type AccountIdentity } from './identity.js';

// The application's MCP operations, declared with SAGA's server export. The application owns the
// listener (listener.ts), who is asking (authenticate.ts), what each account may see
// (authorization.ts) and the built view it serves. Each request builds its own server.

/** The built view is required before the server can claim to serve anything. */
export class ViewArtifactMissing extends Error {
  constructor() {
    super(
      'The view has not been built: the server needs the built page and will not start without it.',
    );
    this.name = 'ViewArtifactMissing';
  }
}

/** Validate and fingerprint the deployment document once, before listening. */
export function prepareStarterView(
  html: unknown,
  filename = 'index.html',
): OperationView {
  if (typeof html !== 'string' || !html.includes(VIEW_MARKER))
    throw new ViewArtifactMissing();
  return Object.freeze({
    uri: viewUriForHtml(html, filename),
    title: 'Starter view',
    html,
    csp: CLOSED_VIEW_CSP,
  });
}

export interface StatusServerOptions {
  /** The immutable view prepared before the listener opened. */
  readonly view: OperationView;
  /** The request this server was built for, started by the listener at admission. */
  readonly lifetime: RequestLifetime;
}

/** An explicitly public operation: it reads no credential and has no identity. */
export function createStatusServer({
  view,
  lifetime,
}: StatusServerOptions): McpServer {
  const server = new McpServer({
    name: 'saga-starter-status',
    version: '0.0.0',
  });
  registerPublicOperation(
    server,
    {
      name: STATUS_TOOL,
      title: 'Show the service status',
      description: 'Shows whether the service is running.',
      annotations: READ_ONLY,
      input: z.strictObject({}),
      output: StatusOutputSchema,
      view,
      failures: {
        absent: TEXT.noStatus,
        unavailable: TEXT.unavailable,
        invalidOutput: TEXT.invalidOutput,
      },
      handle: () => ({
        kind: 'record',
        record: { status: 'running' as const },
      }),
      project: (record) => ({
        text: 'The service is running.',
        data: { status: record.status },
      }),
    },
    { lifetime },
  );
  return server;
}

export interface AccountServerOptions extends StatusServerOptions {
  /** The application's policy for this request's identity (authorization.ts). */
  readonly authorize: (
    identity: AccountIdentity,
    signal: AbortSignal,
  ) => Promise<boolean>;
}

// #region saga-snippet:register-protected-operation
/**
 * A protected operation. The listener verified the request and the transport hands that context
 * to `identity`; with none the handler never runs. `handle` makes the application's own
 * authorization decision for this request's identity, then returns a record, and `project` copies
 * the public fields out of it by name.
 */
export function createAccountServer({
  view,
  lifetime,
  authorize,
}: AccountServerOptions): McpServer {
  const server = new McpServer({
    name: 'saga-starter-account',
    version: '0.0.0',
  });
  registerProtectedOperation(
    server,
    {
      name: ACCOUNT_TOOL,
      title: 'Show my account',
      description: 'Shows the account the server verified for this request.',
      annotations: READ_ONLY,
      input: z.strictObject({}),
      output: AccountOutputSchema,
      view,
      failures: {
        absent: TEXT.noAccount,
        unavailable: TEXT.unavailable,
        invalidOutput: TEXT.invalidOutput,
        signInRequired: TEXT.signInRequired,
      },
      identity: identityOf,
      async handle(_input, identity, request) {
        // Replace this with a call to your backend. The decision to answer is made here, for this request.
        if (
          !(await request.within('authorization', (signal) =>
            authorize(identity, signal),
          ))
        )
          return { kind: 'refused', text: TEXT.notAllowed };
        return { kind: 'record', record: identity };
      },
      project: (record) => ({
        text: 'Signed in.',
        data: { accountId: record.accountId },
      }),
    },
    { lifetime },
  );
  return server;
}
// #endregion saga-snippet:register-protected-operation
