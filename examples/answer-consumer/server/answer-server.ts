import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import { registerPublicOperation, viewUriForHtml } from '@saga-a2ui/mcp/server';
import { z } from 'zod';
import { fixtureAnswers, type AnswerFunction } from '../src/answer-function.js';

// The application's MCP delivery, composed from SAGA's server export alone. The application owns the
// listener (none here: the caller connects a transport), the answer function and the built page it
// serves. SAGA's operation links every result to that page and serves it; this file never builds
// result metadata or a resource of its own.

const AnswerInput = z.object({ question: z.string().min(1).max(200) });

/** The FaithfulCard content contract this application publishes (see packages/components). */
const AnswerOutput = z.strictObject({ contractVersion: z.literal(1), markdown: z.string() });

/**
 * Builds an MCP server for one built answer page. `html` is the final document, after the build
 * has inlined the application and the SDK: its identity is derived from exactly those bytes, so a
 * rebuilt page with any change is a different resource to a host that caches by URI.
 */
export function createAnswerServer(html: string, answer: AnswerFunction = fixtureAnswers): McpServer {
  const server = new McpServer({ name: 'answer-consumer', version: '0.0.0' });
  registerPublicOperation(server, {
    name: 'answer_question',
    title: 'Answer a question',
    description: 'Answers a question with Markdown that the answer view shows.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    input: AnswerInput,
    output: AnswerOutput,
    view: { uri: viewUriForHtml(html, 'mcp.html'), title: 'Answer view', html, csp: CLOSED_VIEW_CSP },
    failures: {
      absent: 'There is no answer.',
      unavailable: 'The answer is unavailable.',
      invalidOutput: 'The answer could not be shown.',
    },
    async handle(input) {
      const { markdown } = await answer(input.question);
      return { kind: 'record', record: markdown };
    },
    project: (markdown) => ({ text: markdown, data: { contractVersion: 1, markdown } }),
  });
  return server;
}
