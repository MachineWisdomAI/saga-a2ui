import { describe, expect, it } from 'vitest';
import { NO_CONVERSATION } from './conversation.js';

describe('the conversation contract', () => {
  it('has no host at all by default: a message alone is unavailable at the message stage', async () => {
    await expect(NO_CONVERSATION.appendMessage('Your move')).resolves.toEqual({
      outcome: 'unavailable',
      stage: 'message',
    });
    expect(Object.isFrozen(NO_CONVERSATION)).toBe(true);
  });

  it('blocks the message at the context stage when a context cannot be delivered', async () => {
    await expect(
      NO_CONVERSATION.appendMessage('Your move', {
        context: { text: 'The board', data: { game: 1 } },
      }),
    ).resolves.toEqual({ outcome: 'unavailable', stage: 'context' });
  });

  it('leaves a best-effort context to the message, which is still unavailable', async () => {
    await expect(
      NO_CONVERSATION.appendMessage('Your move', {
        context: { text: 'The board', bestEffort: true },
      }),
    ).resolves.toEqual({ outcome: 'unavailable', stage: 'message' });
  });
});
