import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/client';
import {
  connectToolResultView,
  type ToolInput,
  type ToolResult,
  type ToolResultViewConnection,
} from '@saga-a2ui/mcp/view';
import {
  AnswerRequestSchema,
  AnswerResultSchema,
  KNOWN_ANSWER_FAILURE_TEXT,
  type AnswerResult,
} from './answer.js';

/** What the view presents. Each state replaces everything shown before it. */
export type AnswerViewState =
  | { readonly kind: 'waiting'; readonly question?: string }
  | { readonly kind: 'answer'; readonly result: AnswerResult }
  | { readonly kind: 'problem'; readonly message: string };

export interface AnswerViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  readonly show: (state: AnswerViewState) => void;
}

export type AnswerViewConnection = ToolResultViewConnection;

const PROBLEM_TEXT = 'The answer could not be shown.';
const INVALID_QUESTION_TEXT = 'That question could not be read.';

function knownFailureText(result: ToolResult): string | undefined {
  const parts = result.content ?? [];
  if (parts.length > 8) return undefined;
  for (const part of parts) {
    if (part.type !== 'text' || part.text.length > 200) continue;
    const match = KNOWN_ANSWER_FAILURE_TEXT.find((text) => text === part.text);
    if (match) return match;
  }
  return undefined;
}

/**
 * Presents each answer beside the exact question it answers.
 *
 * The binding comes from the result alone: it repeats the question it answers, and the view shows
 * that pair, never an answer next to a question it received separately. When the host has also
 * announced the question being asked (`toolinput`), a result is shown only if its question is
 * exactly that one (no trimming, no case folding). A result for any other question is a delivery
 * for something no longer asked, for example a late copy of an earlier answer, and is ignored
 * instead of replacing what is awaited. Notifications carry no request identity, so this is all
 * the correlation there is.
 *
 * - A result before any input is shown with its own question (hosts may deliver in either order).
 * - An input for the question already answered keeps that answer; any other input clears it and
 *   waits for the new one.
 * - The same answer delivered again is not shown again; a different answer to the same question
 *   replaces the first.
 * - An error, a result outside the published contract, or an unreadable input clears the answer
 *   and shows a problem. Failure text is shown only when it is one of the server's known safe
 *   texts. The next valid delivery recovers.
 * - After dispose or host teardown, nothing is delivered (see `connectToolResultView`).
 */
export function connectAnswerView(
  deps: AnswerViewDependencies,
): Promise<AnswerViewConnection> {
  let awaited: string | undefined;
  let shown: AnswerResult | undefined;

  const present = (state: AnswerViewState) => {
    shown = state.kind === 'answer' ? state.result : undefined;
    deps.show(state);
  };

  const onToolInput = (input: ToolInput) => {
    const asked = AnswerRequestSchema.safeParse(input.arguments);
    if (!asked.success) {
      awaited = undefined;
      return present({ kind: 'problem', message: INVALID_QUESTION_TEXT });
    }
    awaited = asked.data.question;
    if (shown?.question === awaited) return; // the answer to this very question is already on screen
    present({ kind: 'waiting', question: awaited });
  };

  const onToolResult = (result: ToolResult) => {
    if (result.isError)
      return present({
        kind: 'problem',
        message: knownFailureText(result) ?? PROBLEM_TEXT,
      });
    const answer = AnswerResultSchema.safeParse(result.structuredContent);
    if (!answer.success)
      return present({ kind: 'problem', message: PROBLEM_TEXT });
    if (awaited !== undefined && answer.data.question !== awaited) return;
    if (
      shown?.question === answer.data.question &&
      shown.answer === answer.data.answer
    )
      return;
    present({ kind: 'answer', result: answer.data });
  };

  return connectToolResultView({
    app: deps.app,
    transport: deps.transport,
    onToolInput,
    onToolResult,
  });
}
