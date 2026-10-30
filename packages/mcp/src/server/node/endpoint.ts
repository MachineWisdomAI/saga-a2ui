import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  type McpHandlerRequestOptions,
  type McpServer,
} from '@modelcontextprotocol/server';
import type { RequestLifetime } from '../lifetime.js';

/** One endpoint's persistent handler, admission association, notification bus and capacity. */
export function createEndpoint(
  build: (lifetime: RequestLifetime) => McpServer,
  options: CreateMcpHandlerOptions = {},
) {
  const admissions = new WeakMap<Request, RequestLifetime>();
  const handler = createMcpHandler((context) => {
    const lifetime =
      context.requestInfo === undefined
        ? undefined
        : admissions.get(context.requestInfo);
    if (lifetime === undefined)
      throw new Error('The MCP request has no admitted lifetime.');
    return build(lifetime);
  }, options);
  return {
    notify: handler.notify,
    close: handler.close,
    fetch(
      request: Request,
      lifetime: RequestLifetime,
      requestOptions: McpHandlerRequestOptions,
    ): Promise<Response> {
      admissions.set(request, lifetime);
      // A bounded parsedBody must be supplied for POST: the legacy classifier otherwise clones
      // the Request, which would discard this object-identity association.
      return handler.fetch(request, requestOptions);
    },
  };
}

export type Endpoint = ReturnType<typeof createEndpoint>;
