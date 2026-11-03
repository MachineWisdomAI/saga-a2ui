// How a view adds a message to the conversation around it. The contract is renderer- and
// delivery-neutral, like the host link contract: an application consumes it, a delivery (MCP Apps
// today) supplies an implementation, and neither depends on the other.

/**
 * What happened to one request the host was asked to carry out.
 *
 * - `denied`: the host refused it (the person declined, a policy blocked it).
 * - `unavailable`: the host advertises no capability for the request, or the view has ended. That
 *   request was not sent.
 * - `failed`: the request could not complete (connection lost, timeout). Whether the host acted on
 *   it is unknown.
 */
export type RequestOutcome = 'denied' | 'unavailable' | 'failed';

/**
 * The result of `appendMessage`.
 *
 * - `appended`: the host accepted the message. It does not show that the assistant replied, or
 *   what it said. `context` is set only when a best-effort context was skipped, and says why.
 * - Any other outcome means nothing was appended. `stage` says which request stopped the append.
 */
export type AppendResult =
  | {
      readonly outcome: 'appended';
      readonly context?: RequestOutcome;
    }
  | {
      readonly outcome: RequestOutcome;
      readonly stage: 'context' | 'message';
    };

/**
 * The only way a view reaches the conversation: add a message as the person, which gives the
 * assistant its turn. A view receives its own instance explicitly.
 */
export interface Conversation {
  /**
   * Adds a message to the conversation as the person, which gives the assistant its turn.
   * `context` is information for that turn that the conversation does not show. By default the
   * message is sent only if the context was accepted; `bestEffort: true` sends it regardless.
   * Never rejects. A result of `appended` is a prompt delivered, not an action taken.
   */
  appendMessage(
    text: string,
    options?: {
      /** The only accepted value; the person's role is what hosts permit a view to speak as. */
      readonly role?: 'user';
      readonly context?: {
        readonly text: string;
        readonly data?: Record<string, unknown>;
        /** Send the message even when the context could not be delivered. Default `false`. */
        readonly bestEffort?: boolean;
      };
    },
  ): Promise<AppendResult>;
}

/**
 * For a page that has no host at all: every call resolves `unavailable` and nothing is sent. The
 * stage is the first request the call would have made: the context, unless it is best effort.
 */
export const NO_CONVERSATION: Conversation = Object.freeze<Conversation>({
  appendMessage: (_text, options) => {
    const context = options?.context;
    return Promise.resolve<AppendResult>({
      outcome: 'unavailable',
      stage:
        context !== undefined && context.bestEffort !== true
          ? 'context'
          : 'message',
    });
  },
});
