import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import { registerPublicOperation, type OperationOutcome, type OperationRequest, type RequestLifetime } from '@saga-a2ui/mcp/server';
import {
  ANSWER_INVALID_OUTPUT_TEXT,
  ANSWER_NOT_AVAILABLE_TEXT,
  ANSWER_TOOL_NAME,
  ANSWER_UNAVAILABLE_TEXT,
  ANSWER_VIEW_URI,
  AnswerRequestSchema,
  AnswerResultSchema,
  type AnswerResult,
} from './answer.js';

/**
 * The application's seam to whatever produces an answer. `undefined` means it has none for that
 * question. It may take its time and report progress; it should stop work when `request.signal`
 * aborts. A real application calls its own backend here.
 */
export interface AnswerBackend {
  answer(question: string, request: OperationRequest): Promise<string | undefined>;
}

export interface AnswerServerOptions {
  readonly viewHtml: string;
  readonly backend: AnswerBackend;
  /**
   * This answer's own limit: the per-operation override of the operation limit. Omitted, the
   * route's or SDK instance's operation limit applies (3,000 ms by default).
   */
  readonly answerBoundMs?: number;
  /** The request this server was built for, started by the listener at admission. */
  readonly lifetime: RequestLifetime;
}

/**
 * One explicitly public, read-only operation. Nothing here reads a credential or the transport's
 * verified context: the operation has no identity, and the question is the only input. The
 * question is never logged here; the application's own logging policy covers anything else.
 */
export function createAnswerServer(options: AnswerServerOptions): McpServer {
  const server = new McpServer({ name: 'saga-a2ui-answer-demo', version: '0.0.0' });

  registerPublicOperation(
    server,
    {
    name: ANSWER_TOOL_NAME,
    title: 'Answer a question',
    description: 'Answers one question from the public synthetic knowledge base.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    input: AnswerRequestSchema,
    output: AnswerResultSchema,
    view: { uri: ANSWER_VIEW_URI, title: 'Answer view', html: options.viewHtml, csp: CLOSED_VIEW_CSP },
    ...(options.answerBoundMs === undefined ? {} : { boundMs: options.answerBoundMs }),
    failures: {
      absent: ANSWER_NOT_AVAILABLE_TEXT,
      unavailable: ANSWER_UNAVAILABLE_TEXT,
      invalidOutput: ANSWER_INVALID_OUTPUT_TEXT,
    },
    async handle({ question }, request): Promise<OperationOutcome<AnswerResult>> {
      const answer = await options.backend.answer(question, request);
      // The result repeats the question exactly as asked: that is what binds the two.
      return answer === undefined ? { kind: 'absent' } : { kind: 'record', record: { question, answer } };
    },
    project: (record) => ({
      text: record.answer,
      data: { question: record.question, answer: record.answer },
    }),
    },
    { lifetime: options.lifetime },
  );

  return server;
}
