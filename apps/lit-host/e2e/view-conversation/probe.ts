// Test-only probe of `ViewHost.conversation` in both stacks, in a real browser. It is a minimal
// consumer of one stack's `startA2uiView`: the actions callback keeps the conversation it is given
// and the page offers it to the specification as `window.appendMessage`, so the specification can
// make the call from inside the sandboxed view. The two stacks differ only in the catalog and the
// start call, which each main file supplies. Nothing here is an SDK feature or part of an app bundle.

interface ProbeConversation {
  appendMessage(
    text: string,
    options?: {
      readonly role?: 'user';
      readonly context?: {
        readonly text: string;
        readonly data?: Record<string, unknown>;
        readonly bestEffort?: boolean;
      };
    },
  ): Promise<unknown>;
}

export interface ProbeOptions {
  readonly container: Element;
  readonly actions: (host: {
    readonly conversation: ProbeConversation;
  }) => undefined;
}

export interface ProbeStack {
  start(options: ProbeOptions): { readonly ready: Promise<void> };
}

declare global {
  interface Window {
    /** Adds a message through the view's own `host.conversation`. Set once the view is ready. */
    appendMessage?: ProbeConversation['appendMessage'];
  }
}

export function runConversationProbe(stack: ProbeStack): void {
  const container = document.querySelector('[data-testid="root"]');
  if (container === null) throw new Error('the probe has no root');
  let conversation: ProbeConversation | undefined;
  const view = stack.start({
    container,
    actions(host) {
      conversation = host.conversation;
      return undefined;
    },
  });
  void view.ready.then(() => {
    window.appendMessage = (text, options) => {
      if (conversation === undefined)
        throw new Error('the view has no conversation');
      return conversation.appendMessage(text, options);
    };
    document.body.dataset.ready = 'true';
  });
}
