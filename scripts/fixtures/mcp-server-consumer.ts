import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import {
  attachRequestLifetime,
  createServerBudgets,
  registerPublicOperation,
  viewUriForHtml,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { z } from 'zod';

// An independently installable server, as an application that serves a view and installs no
// renderer writes it: this file imports the delivery package's server export, the MCP server
// package and Zod, and nothing else from the SDK or from a renderer. It is compiled in an
// application that installs neither React nor Lit, with strict peers.

const StatusOutput = z.strictObject({ status: z.literal('running') });

export function createStatusServer(
  page: string,
  lifetime: RequestLifetime,
): McpServer {
  const view: OperationView = Object.freeze({
    uri: viewUriForHtml(page, 'index.html'),
    title: 'Status',
    html: page,
    csp: CLOSED_VIEW_CSP,
  });
  const server = new McpServer({ name: 'status', version: '0.0.0' });
  registerPublicOperation(
    server,
    {
      name: 'show_status',
      title: 'Show the service status',
      description: 'Shows whether the service is running.',
      annotations: { readOnlyHint: true },
      input: z.strictObject({}),
      output: StatusOutput,
      view,
      failures: {
        absent: 'No status.',
        unavailable: 'Unavailable.',
        invalidOutput: 'Invalid output.',
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
export const budgets = createServerBudgets({ operationMs: 2_000 });
export { attachRequestLifetime };
