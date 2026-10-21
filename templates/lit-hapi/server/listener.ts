import Hapi from '@hapi/hapi';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import type { BudgetSettings } from '@saga-a2ui/mcp/server';
import { authenticate } from './authenticate.js';
import { mcpPlugin, mcpRequestLifetime } from './bridge.js';
import {
  createAccountServer,
  createStatusServer,
  prepareStarterView,
  type AccountServerOptions,
} from './operations.js';

// Application composition: prepare the view, configure authentication and register endpoints.
// The maintained bridge owns admission, body reads, deadlines and transport cleanup.
const HOST = '127.0.0.1';
const ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost'];
const STATUS_PATH = '/status/mcp';
const ACCOUNT_PATH = '/account/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface ListenerOptions {
  /** The built page, read by the caller before the port opens. */
  readonly html: string;
  /** The built page's relative filename; the starter builds index.html. */
  readonly filename?: string;
  /** Decides who a bearer credential belongs to. */
  readonly verifier: OAuthTokenVerifier;
  /** Decides what a verified account may see. */
  readonly authorize: AccountServerOptions['authorize'];
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /**
   * 3,000 ms per operation and 10,000 ms per request unless stated. A field you leave out keeps
   * its default, and an invalid value fails before the port opens.
   */
  readonly budgets?: BudgetSettings;
}

export interface Listener {
  /** Public endpoint: no credential is read. */
  readonly statusUrl: string;
  /** Protected endpoint: a bearer credential is required. */
  readonly accountUrl: string;
  close(): Promise<void>;
}

export async function startListener(
  options: ListenerOptions,
): Promise<Listener> {
  // #region saga-snippet:prepare-view
  // Both endpoint registrations below keep one persistent handler and reuse this immutable view.
  const view = prepareStarterView(options.html, options.filename);
  // #endregion saga-snippet:prepare-view
  let closing: Promise<void> | undefined;
  const http = Hapi.server({ host: HOST, port: options.port });

  http.auth.scheme('account-bearer', () => ({
    async authenticate(request, h) {
      const header = request.headers.authorization;
      const decision = await authenticate(
        typeof header === 'string' ? header : undefined,
        options.verifier,
        mcpRequestLifetime(request),
      );
      if (decision.ok)
        return h.authenticated({
          credentials: { authInfo: decision.authInfo },
        });
      const response = h.response().code(decision.status).takeover();
      if (decision.challenge !== undefined)
        response.header('WWW-Authenticate', decision.challenge);
      return response;
    },
  }));
  http.auth.strategy('account', 'account-bearer');

  await http.register({
    plugin: mcpPlugin,
    options: {
      path: STATUS_PATH,
      auth: false,
      budgets: options.budgets,
      maxRequestBytes: MAX_REQUEST_BYTES,
      allowedHosts: ALLOWED_HOSTNAMES,
      createServer: ({ lifetime }) =>
        createStatusServer({
          view,
          lifetime,
        }),
    },
  });
  await http.register({
    plugin: mcpPlugin,
    options: {
      path: ACCOUNT_PATH,
      auth: 'account',
      budgets: options.budgets,
      maxRequestBytes: MAX_REQUEST_BYTES,
      allowedHosts: ALLOWED_HOSTNAMES,
      // #region saga-snippet:identity-handoff
      // Hapi's authentication strategy snapshots the verified credential before the body wait.
      // The bridge carries that request's auth to this factory and the Node transport; SAGA's
      // identityOf hook reads only that auth. No argument or previous request names an account.
      createServer: ({ lifetime, authInfo }) => {
        if (authInfo === undefined)
          throw new Error(
            'The protected route did not establish request identity.',
          );
        return createAccountServer({
          view,
          lifetime,
          authorize: options.authorize,
        });
      },
      // #endregion saga-snippet:identity-handoff
    },
  });
  await http.start();
  return {
    statusUrl: `${http.info.uri}${STATUS_PATH}`,
    accountUrl: `${http.info.uri}${ACCOUNT_PATH}`,
    close: () => (closing ??= http.stop({ timeout: 0 })),
  };
}
