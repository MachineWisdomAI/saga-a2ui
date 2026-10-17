import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { connectToolResultView, type ToolInput, type ToolResult, type ToolResultViewConnection } from './index.js';

// The view connection's lifetime, exercised with a real `App` and `AppBridge` joined by an
// in-memory transport. No DOM and no renderer: the observable result is what the caller's
// callbacks receive and when.

const result = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const textOf = (delivered: ToolResult) => (delivered.content?.[0] as { text: string } | undefined)?.text;

interface Harness {
  readonly app: App;
  readonly bridge: AppBridge;
  readonly results: string[];
  readonly inputs: ToolInput[];
  readonly events: string[];
  connect(onInitialized?: (bridge: AppBridge) => void): Promise<ToolResultViewConnection>;
}

const toClean: { app?: App; bridge?: AppBridge }[] = [];

function harness(): Harness {
  const app = new App({ name: 'test-view', version: '0.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
  toClean.push({ app, bridge });
  const results: string[] = [];
  const inputs: ToolInput[] = [];
  const events: string[] = [];
  return {
    app,
    bridge,
    results,
    inputs,
    events,
    async connect(onInitialized) {
      const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
      bridge.oninitialized = () => onInitialized?.(bridge);
      await bridge.connect(hostSide);
      return connectToolResultView({
        app,
        transport: viewSide,
        onToolResult: (delivered) => results.push(textOf(delivered) ?? ''),
        onToolInput: (input) => inputs.push(input),
        onTeardown: () => events.push('teardown'),
      });
    },
  };
}

/** A second host for the same view `App`, as when a view is mounted again. */
async function reconnect(h: Harness, deliver: (text: string) => void): Promise<AppBridge> {
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
  toClean.push({ bridge });
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  await connectToolResultView({ app: h.app, transport: viewSide, onToolResult: (delivered) => deliver(textOf(delivered) ?? '') });
  return bridge;
}

afterEach(async () => {
  for (const { app, bridge } of toClean.splice(0)) {
    await app?.close().catch(() => undefined);
    await bridge?.close().catch(() => undefined);
  }
});

describe('tool result delivery', () => {
  it('delivers a result sent during initialization exactly once', async () => {
    const h = harness();
    await h.connect((bridge) => void bridge.sendToolResult(result('early')));
    await expect.poll(() => h.results).toEqual(['early']);
  });

  it('delivers each later result in order', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(result('one'));
    await h.bridge.sendToolResult(result('two'));
    await expect.poll(() => h.results).toEqual(['one', 'two']);
  });

  it('hands over the business arguments of a starting call, with the same lifetime as results', async () => {
    const h = harness();
    const view = await h.connect();
    await h.bridge.sendToolInput({ arguments: { question: 'why?' } });
    await expect.poll(() => h.inputs).toHaveLength(1);
    expect(h.inputs[0]?.arguments).toEqual({ question: 'why?' });
    view.dispose();
    await h.bridge.sendToolInput({ arguments: { question: 'ignored' } }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.inputs).toHaveLength(1);
  });
});

describe('ending the connection', () => {
  it('ignores results after dispose', async () => {
    const h = harness();
    const view = await h.connect();
    await h.bridge.sendToolResult(result('before'));
    await expect.poll(() => h.results).toEqual(['before']);
    view.dispose();
    await h.bridge.sendToolResult(result('after')).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.results).toEqual(['before']);
  });

  it('tells the view once when the host asks it to tear down, and ignores results afterwards', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.teardownResource({});
    expect(h.events).toEqual(['teardown']);
    await h.bridge.sendToolResult(result('late')).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.results).toEqual([]);
  });

  it('closes the app on dispose after host teardown so it can reconnect', async () => {
    const h = harness();
    const view = await h.connect();
    await h.bridge.teardownResource({});
    view.dispose();

    const delivered: string[] = [];
    const bridge2 = await reconnect(h, (text) => delivered.push(text));
    await bridge2.sendToolResult(result('again'));
    await expect.poll(() => delivered).toEqual(['again']);
  });

  it('delivers each result once after reconnecting the same app', async () => {
    const h = harness();
    const first = await h.connect();
    first.dispose();
    await h.app.close();
    await h.bridge.close();

    const delivered: string[] = [];
    const bridge2 = await reconnect(h, (text) => delivered.push(text));
    await bridge2.sendToolResult(result('again'));
    await expect.poll(() => delivered).toEqual(['again']);
    expect(h.results).toEqual([]); // the retired connection's callback is not called
  });

  it('ignores a repeated dispose of an old connection after the app reconnects', async () => {
    const h = harness();
    const first = await h.connect();
    first.dispose();
    await h.app.close();
    await h.bridge.close();

    const delivered: string[] = [];
    const bridge2 = await reconnect(h, (text) => delivered.push(text));
    first.dispose();
    await bridge2.sendToolResult(result('still live'));
    await expect.poll(() => delivered).toEqual(['still live']);
    await expect(bridge2.teardownResource({})).resolves.toBeDefined();
  });

  it('releases its handlers when the connection fails', async () => {
    const h = harness();
    const [viewSide] = InMemoryTransport.createLinkedPair();
    // No host is listening: initialize never completes, so close the pipe to make it fail.
    const pending = connectToolResultView({ app: h.app, transport: viewSide, onToolResult: (d) => h.results.push(textOf(d) ?? '') });
    await viewSide.close();
    await expect(pending).rejects.toBeDefined();

    const delivered: string[] = [];
    const bridge2 = await reconnect(h, (text) => delivered.push(text));
    await bridge2.sendToolResult(result('healthy'));
    await expect.poll(() => delivered).toEqual(['healthy']);
    expect(h.results).toEqual([]);
  });
});
