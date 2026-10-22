import { App } from '@modelcontextprotocol/ext-apps';
import {
  AppBridge,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
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
