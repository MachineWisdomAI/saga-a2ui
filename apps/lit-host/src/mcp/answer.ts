import { z } from 'zod';

// Contract shared by the public answer server and its view. It imports only `zod`, so the browser
// bundle can use it without pulling in any server code.
//
// The answer operation is a synthetic stand-in for an application's answer tool: the caller sends a
// question, the application takes its time, and the view shows the answer beside the exact
// question it answers. It is explicitly public: no credential is read and no identity exists.

export const ANSWER_TOOL_NAME = 'answer_question';
export const ANSWER_VIEW_URI = 'ui://saga-a2ui/answer-view.html';

/** Finite bounds on what crosses the boundary. Longer input or output is refused, never truncated. */
export const ANSWER_LIMITS = {
  maxQuestion: 500,
  maxAnswer: 2_000,
} as const;

/** Tool failure: the application has no answer for that question. */
export const ANSWER_NOT_AVAILABLE_TEXT =
  'No answer is available for that question.';

/** Tool failure: the answer could not be produced. Safe to retry. Carries no backend detail. */
export const ANSWER_UNAVAILABLE_TEXT = 'The answer is unavailable.';

/** Tool failure: the answer broke the published contract. Carries no field values. */
export const ANSWER_INVALID_OUTPUT_TEXT = 'The answer could not be shown.';

/** Caller input: the question, exactly as asked. */
export const AnswerRequestSchema = z.object({
  question: z.string().min(1).max(ANSWER_LIMITS.maxQuestion),
});

/**
 * The only data this operation publishes. It repeats the question it answers, exactly as asked, so
 * a view can bind an answer to its question from the result alone and never pairs an answer with
 * a question it received separately.
 */
export const AnswerResultSchema = z
  .object({
    question: z.string().min(1).max(ANSWER_LIMITS.maxQuestion),
    answer: z.string().min(1).max(ANSWER_LIMITS.maxAnswer),
  })
  .strict();

export type AnswerResult = z.infer<typeof AnswerResultSchema>;

/** Failure texts the view may show verbatim. Anything else it shows is its own fixed wording. */
export const KNOWN_ANSWER_FAILURE_TEXT = [
  ANSWER_NOT_AVAILABLE_TEXT,
  ANSWER_UNAVAILABLE_TEXT,
  ANSWER_INVALID_OUTPUT_TEXT,
] as const;
