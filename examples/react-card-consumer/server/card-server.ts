import { McpServer } from '@modelcontextprotocol/server';
import {
  createContentPolicy,
  type ContentPolicy,
} from '@saga-a2ui/components/faithful-card';
import { CLOSED_VIEW_CSP, type ViewCsp } from '@saga-a2ui/mcp/policy';
import { registerPublicOperation, viewUriForHtml } from '@saga-a2ui/mcp/server';
import { z } from 'zod';
import { embedPolicy } from '../src/embedded-policy.js';

// The application's MCP delivery, composed from SAGA's server export alone. The application owns the
// answer function and the built page it serves; SAGA's operation links every result to that page and
// serves it. This file never builds result metadata or a resource of its own, and holds no answer.

/** The application's backend call. Any implementation of the type can be composed in. */
export type AnswerFunction = (
  question: string,
) => Promise<{ readonly markdown: string }>;

const AnswerInput = z.object({ question: z.string().min(1).max(200) });

/** The FaithfulCard content contract this application publishes (see packages/components). */
const AnswerOutput = z.strictObject({
  contractVersion: z.literal(1),
  markdown: z.string(),
});

/**
 * What the host mounts: the document with the policy's restrictions and configuration embedded, the
 * identity derived from exactly those bytes (`viewUriForHtml`), and the host permission the policy
 * declares. An answer is never part of the document, so a new answer reuses the resource; a change to
 * code, policy, CSS, font or artwork bytes is a new one.
 */
export interface CardResource {
  readonly uri: string;
  readonly html: string;
  readonly csp: ViewCsp;
}

export function cardResource(
  builtHtml: string,
  policy: ContentPolicy,
  filename: string,
): CardResource {
  const html = embedPolicy(builtHtml, policy);
  return {
    uri: viewUriForHtml(html, filename),
    html,
    // The origins the policy allows for images and fonts are the only declarations; the data: and blob: baseline needs none.
    csp: {
      ...CLOSED_VIEW_CSP,
      resourceDomains: policy.resource.resourceDomains,
    },
  };
}

/**
 * Builds an MCP server for one built page (`builtHtml`, as the build wrote it) under the content policy
 * created from `policyConfiguration` (`createContentPolicy` rejects an invalid one, and so does this).
 */
export function createCardServer(
  builtHtml: string,
  settings: {
    readonly filename: string;
    readonly policyConfiguration: unknown;
    readonly answer: AnswerFunction;
  },
): McpServer {
  const created = createContentPolicy(settings.policyConfiguration);
  if (!created.ok) throw new Error(created.failure.message);
  const view = cardResource(builtHtml, created.policy, settings.filename);
  const server = new McpServer({
    name: 'react-card-consumer',
    version: '0.0.0',
  });
  registerPublicOperation(server, {
    name: 'answer_question',
    title: 'Answer a question',
    description: 'Answers a question with Markdown that the card shows.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    input: AnswerInput,
    output: AnswerOutput,
    view: {
      uri: view.uri,
      title: 'Answer card',
      html: view.html,
      csp: view.csp,
    },
    failures: {
      absent: 'There is no answer.',
      unavailable: 'The answer is unavailable.',
      invalidOutput: 'The answer could not be shown.',
    },
    async handle(input) {
      const { markdown } = await settings.answer(input.question);
      return { kind: 'record', record: markdown };
    },
    project: (markdown) => ({
      text: markdown,
      data: { contractVersion: 1, markdown },
    }),
  });
  return server;
}
