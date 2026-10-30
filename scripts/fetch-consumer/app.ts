import { McpServer } from '@modelcontextprotocol/server';
import {
  createMcpFetchApp,
  type McpFetchApp,
} from '@saga-a2ui/lit-mcp-stack/server/http';
import {
  operationViewFromHtml,
  registerPublicOperation,
} from '@saga-a2ui/lit-mcp-stack/server';
import { z } from 'zod';

// One application composition for both hosts. It stands for an application outside this repository:
// it registers its operations once on a fresh server per request, keeps its state outside that
// factory, and hands the SDK explicit settings. It reads no environment and no file, and it starts
// no listener; the Workers entry (worker.ts) and a Node listener both only call `app.fetch`.

export const VIEW_MARKER = 'fetch-consumer-view';

export interface ConsumerSettings {
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly path?: string;
  readonly responseMode?: 'json' | 'sse';
}

export function createConsumerApp(settings: ConsumerSettings): McpFetchApp {
  // The application's state: it outlives every per-request server.
  let count = 0;
  const view = operationViewFromHtml({
    html: `<!doctype html><title>${VIEW_MARKER}</title>`,
    filename: 'counter.html',
    title: 'Counter',
  });
  return createMcpFetchApp({
    ...settings,
    createServer(lifetime) {
      const server = new McpServer({
        name: 'fetch-consumer',
        version: '0.0.0',
      });
      registerPublicOperation(
        server,
        {
          name: 'count',
          title: 'Count',
          description: 'Increments the application counter.',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
          input: z.strictObject({}),
          output: z.strictObject({ count: z.number() }),
          view,
          failures: {
            absent: 'Absent.',
            unavailable: 'Unavailable.',
            invalidOutput: 'Invalid.',
          },
          handle: () => ({ kind: 'record', record: ++count }),
          project: (value: number) => ({
            text: String(value),
            data: { count: value },
          }),
        },
        { lifetime },
      );
      return server;
    },
  });
}
