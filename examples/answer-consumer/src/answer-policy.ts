import {
  createContentPolicy,
  type ContentPolicy,
} from '@saga-a2ui/components/faithful-card';

/**
 * The content policy of the application's card: the level and the hosts images may come from.
 * Nothing in an answer can change either. The card's view is made from it with
 * `createFaithfulCardView`, together with the Markdown dialect and a finite bound for the long
 * answers of this application, `ANSWER_READER`.
 */
export function createAnswerPolicy(settings: {
  readonly level: 'standard' | 'strict';
  readonly imageHosts: readonly string[];
}): ContentPolicy {
  const policy = createContentPolicy({
    level: settings.level,
    imageHosts: [...settings.imageHosts],
  });
  if (!policy.ok) throw new Error(policy.failure.message);
  return policy.policy;
}

/** The Markdown dialect and the bound (UTF-16 code units) the application's card reads under. */
export const ANSWER_READER = {
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 50_000,
} as const;
