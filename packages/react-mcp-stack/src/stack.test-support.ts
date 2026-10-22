import { App } from '@modelcontextprotocol/ext-apps';
import {
  AppBridge,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import type { CardResultOutcome } from '@saga-a2ui/components/faithful-card';
import type { ToolResult } from '@saga-a2ui/mcp/view';
import type { HostConnection } from './host-connection.js';

// Test-only. A real bridge and a real host joined by an in-memory transport: what a stack starts
// over in a test, in place of the page's `postMessage` link to an embedding window. The view side
// is exactly what `connectToHost` makes (an `App` the stack drives), so every ordering rule under
// test is the production one. This is not evidence of any actual host.

export interface TestHost {
  readonly connection: HostConnection;
  readonly bridge: AppBridge;
  /** How many times the stack asked for a connection. */
  readonly connects: () => number;
  /** The factory a stack's `…On` entry takes. */
  readonly connect: () => HostConnection;
  close(): Promise<void>;
}

export interface TestHostOptions {
  readonly hostContext?: McpUiHostContext;
  /** Called while the view's handshake is completing, to deliver a result "during initialization". */
  readonly onInitialized?: (bridge: AppBridge) => void;
  readonly hostCapabilities?: ConstructorParameters<typeof AppBridge>[2];
}

export async function startTestHost(
  options: TestHostOptions = {},
): Promise<TestHost> {
  const app = new App(
    { name: 'test-view', version: '0.0.0' },
    {},
    {
      autoResize: false,
    },
  );
  const bridge = new AppBridge(
    null,
    { name: 'test-host', version: '0.0.0' },
    options.hostCapabilities ?? {},
    options.hostContext === undefined
      ? undefined
      : { hostContext: options.hostContext },
  );
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  bridge.oninitialized = () => options.onInitialized?.(bridge);
  await bridge.connect(hostSide);
  const connection: HostConnection = { app, transport: viewSide };
  let connects = 0;
  return {
    connection,
    bridge,
    connects: () => connects,
    connect: () => {
      connects += 1;
      return connection;
    },
    async close() {
      await app.close().catch(() => undefined);
      await bridge.close().catch(() => undefined);
    },
  };
}

/** A connection whose handshake cannot complete: the transport fails to start. */
export function unreachableHost(): HostConnection {
  const app = new App(
    { name: 'test-view', version: '0.0.0' },
    {},
    {
      autoResize: false,
    },
  );
  return {
    app,
    transport: {
      start: () => Promise.reject(new Error('no host answers')),
      send: () => Promise.reject(new Error('no host answers')),
      close: () => Promise.resolve(),
    },
  };
}

/** A promise the test settles by hand, so a race happens exactly when the test says. */
export function gate<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const toolResult = (structuredContent: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: 'result' }],
  structuredContent: structuredContent as Record<string, unknown>,
  ...(isError ? { isError } : {}),
});

/** Lets pending promises and a React commit settle. */
export const settle = (ms = 30): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

declare global {
  // React's flag that says state updates in this environment are wrapped in `act`.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Synthetic whole-result classification, standing in for an application's own protocol. The
// wording and the envelope belong to this fixture; the stack knows neither.

/** The wording an application supplies when it rejects a result. */
export const UNSUPPORTED_WORDING = 'This answer cannot be shown by this view.';

/** The text a result carries: its first `text` block, when that block's string is not empty. */
function usableText(result: ToolResult): string | undefined {
  const first = result.content.find((block) => block.type === 'text');
  return first?.type === 'text' && first.text !== '' ? first.text : undefined;
}

/**
 * Reads `{version: 1, question, answer}` from `structuredContent`; a result without structured
 * content shows its text; an error result shows its text when it has some. Anything else is
 * rejected with {@link UNSUPPORTED_WORDING}.
 */
export function classifyEnvelopeOrText(result: ToolResult): CardResultOutcome {
  const rejected = { kind: 'rejected', text: UNSUPPORTED_WORDING } as const;
  const text = usableText(result);
  const textOnly: CardResultOutcome =
    text === undefined
      ? rejected
      : { kind: 'content', content: { markdown: text, heading: '' } };
  if (result.isError === true) return textOnly;
  const structured: unknown = result.structuredContent;
  if (structured === undefined || structured === null) return textOnly;
  const envelope = structured as Record<string, unknown>;
  return envelope.version === 1 &&
    typeof envelope.question === 'string' &&
    typeof envelope.answer === 'string'
    ? {
        kind: 'content',
        content: { markdown: envelope.answer, heading: envelope.question },
      }
    : rejected;
}
