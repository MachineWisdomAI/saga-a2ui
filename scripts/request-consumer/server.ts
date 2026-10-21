import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import {
  createServerBudgets,
  registerProtectedOperation,
  registerPublicOperation,
  type BudgetSettings,
  type OperationOutcome,
  type OperationRequest,
  type Projection,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { z } from 'zod';

// A consumer's MCP delivery, composed from the installed server export alone. It stands for an
// application that owns its listener and its callbacks: the test hands in the behavior of each
// callback, and this file declares the operations and starts a request lifetime per request as an
// application listener does at admission. Nothing here imports a workspace path.

const Input = z.object({ id: z.string().min(1).max(16) });
const Output = z.strictObject({
  id: z.string().max(16),
  text: z.string().max(64),
});
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const FAILURES = {
  absent: 'Not found.',
  unavailable: 'Unavailable.',
  invalidOutput: 'Could not be shown.',
  signInRequired: 'Sign in.',
} as const;

export const FAILURE_TEXT = FAILURES;

export interface Callbacks {
  handle?(
    request: OperationRequest,
    accountId: string | undefined,
  ): OperationOutcome<string> | Promise<OperationOutcome<string>>;
  project?(record: string): Projection;
  identity?(authInfo: AuthInfo | undefined): unknown;
}

export interface RequestConsumer {
  /** One server per request, with its own lifetime, as an application listener builds it. */
  buildServer(): McpServer;
  readonly lifetimes: RequestLifetime[];
}

export function createRequestConsumer(
  callbacks: Callbacks = {},
  budgets?: BudgetSettings,
): RequestConsumer {
  const instance = createServerBudgets(budgets);
  const lifetimes: RequestLifetime[] = [];
  return {
    lifetimes,
    buildServer() {
      const lifetime = instance.startRequest();
      lifetimes.push(lifetime);
      const server = new McpServer({
        name: 'request-consumer',
        version: '0.0.0',
      });
      const view = (name: string) => ({
        uri: `ui://consumer/${name}.html`,
        title: `${name} view`,
        html: '<!doctype html>',
        csp: CLOSED_VIEW_CSP,
      });
      const project = (record: string): Projection =>
        callbacks.project
          ? callbacks.project(record)
          : { text: record, data: { id: record, text: 'ok' } };
      registerPublicOperation(
        server,
        {
          name: 'read',
          title: 'Read',
          description: 'Reads.',
          annotations: READ_ONLY,
          input: Input,
          output: Output,
          view: view('read'),
          failures: FAILURES,
          handle: async (input, request) =>
            callbacks.handle
              ? callbacks.handle(request, undefined)
              : { kind: 'record', record: input.id },
          project,
        },
        { lifetime },
      );
      registerProtectedOperation(
        server,
        {
          name: 'mine',
          title: 'Mine',
          description: 'Reads for the signed-in account.',
          annotations: READ_ONLY,
          input: Input,
          output: Output,
          view: view('mine'),
          failures: FAILURES,
          identity: (authInfo) =>
            (callbacks.identity
              ? callbacks.identity(authInfo)
              : { accountId: authInfo?.extra?.accountId }) as
              { accountId: string } | undefined,
          handle: async (input, identity, request) =>
            callbacks.handle
              ? callbacks.handle(request, identity.accountId)
              : { kind: 'record', record: input.id },
          project: (record) => project(record),
        },
        { lifetime },
      );
      return server;
    },
  };
}
