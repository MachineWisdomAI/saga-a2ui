// @vitest-environment jsdom
import { App } from '@modelcontextprotocol/ext-apps';
import {
  AppBridge,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runToolResultView,
  ViewStartFailure,
  type ToolInput,
  type ToolResult,
  type ViewFailureKind,
  type ToolResultView,
} from './run-tool-result-view.js';

// The view lifecycle, exercised with a real `App` and `AppBridge` joined by an in-memory
// transport. No renderer: the observable result is what the caller's callbacks receive, in which
// order, and what is left behind (listeners, an open connection) once the view has ended.
//
// A callback that throws is reported and cleaned up after; what it already changed stays. The
// "mutation" cases below stand for an application callback that changes the page and then throws.

const result = (text: string) => ({
  content: [{ type: 'text' as const, text }],
});
const textOf = (delivered: ToolResult) =>
  (delivered.content?.[0] as { text: string } | undefined)?.text;

/** A promise the test settles by hand, so a race happens exactly when the test says. */
function gate<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Run {
  readonly app: App;
  readonly bridge: AppBridge;
  /** Everything the caller's callbacks saw, in order. */
  readonly log: string[];
  readonly failures: Array<{ kind: ViewFailureKind; cause: unknown }>;
  readonly errors: Array<{ error: unknown; phase: string }>;
  readonly view: ToolResultView;
}

const toClean: { app: App; bridge: AppBridge }[] = [];

interface RunOptions {
  /** Host context in the initialize response. */
  readonly hostContext?: McpUiHostContext;
  readonly hostName?: string;
  readonly hostCapabilities?: ConstructorParameters<typeof AppBridge>[2];
  /** Called when the host has initialized, i.e. in the middle of `connect`. */
  readonly onInitialized?: (bridge: AppBridge) => void;
  readonly readyWhen?: (signal: AbortSignal) => Promise<void>;
  readonly onToolResult?: (result: ToolResult, log: string[]) => void;
  readonly onHostContext?: (
    context: McpUiHostContext | undefined,
    hostName: string | undefined,
    log: string[],
  ) => void;
  readonly onTeardown?: (log: string[]) => void;
  readonly withInput?: boolean;
  /** Leaves `onError` unset, so the default reporter is used. */
  readonly defaultErrorReporter?: boolean;
  /** The transport to use for the view side. Defaults to a linked in-memory pair to the host. */
  readonly connectHost?: boolean;
}

async function startRun(options: RunOptions = {}): Promise<Run> {
  const app = new App(
    { name: 'test-view', version: '0.0.0' },
    {},
    { autoResize: false },
  );
  const bridge = new AppBridge(
    null,
    { name: options.hostName ?? 'test-host', version: '0.0.0' },
    options.hostCapabilities ?? {},
    options.hostContext === undefined
      ? undefined
      : { hostContext: options.hostContext },
  );
  toClean.push({ app, bridge });
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  bridge.oninitialized = () => options.onInitialized?.(bridge);
  if (options.connectHost !== false) await bridge.connect(hostSide);

  const log: string[] = [];
  const failures: Run['failures'] = [];
  const errors: Run['errors'] = [];
  const view = runToolResultView({
    app,
    transport: viewSide,
    readyWhen: options.readyWhen,
    onToolResult: (delivered) => {
      log.push(`result:${textOf(delivered)}`);
      options.onToolResult?.(delivered, log);
    },
    onToolInput: options.withInput
      ? (input: ToolInput) =>
          log.push(`input:${JSON.stringify(input.arguments)}`)
      : undefined,
    onHostContext: (context, hostName) => {
      log.push(`context:${context?.theme ?? '-'}:${hostName ?? '-'}`);
      options.onHostContext?.(context, hostName, log);
    },
    onTeardown: () => {
      log.push('teardown');
      options.onTeardown?.(log);
    },
    onFailure: (failure) =>
      failures.push({ kind: failure.kind, cause: failure.cause }),
    onError: options.defaultErrorReporter
      ? undefined
      : (error, phase) => errors.push({ error, phase }),
  });
  return { app, bridge, log, failures, errors, view };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { app, bridge } of toClean.splice(0)) {
    await app.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
});

const quiet = () => new Promise((resolve) => setTimeout(resolve, 25));
const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof ViewStartFailure ? error.kind : 'other';
  }
};

describe('starting', () => {
  it('delivers a result sent during the handshake once, after the host context, when ready', async () => {
    const run = await startRun({
      hostContext: { theme: 'dark' },
      onInitialized: (bridge) => void bridge.sendToolResult(result('early')),
    });
    await run.view.ready;
    expect(run.log).toEqual(['context:dark:test-host', 'result:early']);
  });

  it('holds only the latest of several results that arrive before it is ready', async () => {
    const ready = gate();
    const run = await startRun({
      readyWhen: () => ready.promise,
      onInitialized: (bridge) => {
        void bridge.sendToolResult(result('one'));
        void bridge.sendToolResult(result('two'));
      },
    });
    await quiet();
    expect(run.log).toEqual([]); // nothing is delivered before readyWhen settles
    ready.resolve();
    await run.view.ready;
    expect(run.log).toEqual(['context:-:test-host', 'result:two']);
  });

  it('delivers the business arguments of a starting call before its result, once ready', async () => {
    const run = await startRun({
      withInput: true,
      onInitialized: (bridge) => {
        void bridge.sendToolInput({ arguments: { question: 'why?' } });
        void bridge.sendToolResult(result('answer'));
      },
    });
    await run.view.ready;
    expect(run.log).toEqual([
      'context:-:test-host',
      'input:{"question":"why?"}',
      'result:answer',
    ]);
  });

  it('delivers each later result in order', async () => {
    const run = await startRun();
    await run.view.ready;
    await run.bridge.sendToolResult(result('one'));
    await run.bridge.sendToolResult(result('two'));
    await expect
      .poll(() => run.log.slice(1))
      .toEqual(['result:one', 'result:two']);
  });

  it('applies the latest host context, merged, before ready resolves', async () => {
    const ready = gate();
    const run = await startRun({
      hostContext: { theme: 'light', locale: 'en' },
      hostName: 'Claude',
      readyWhen: () => ready.promise,
      onInitialized: (bridge) =>
        // a change the host sends before the view is ready
        setTimeout(() => bridge.sendHostContextChange({ theme: 'dark' }), 0),
    });
    await quiet(); // the change has arrived while readyWhen is still pending
    expect(run.log).toEqual([]);
    ready.resolve();
    await run.view.ready;
    expect(run.log).toEqual(['context:dark:Claude']); // once, and the latest
  });

  it('tells the caller the host context is absent rather than inventing one', async () => {
    const seen: Array<McpUiHostContext | undefined> = [];
    const run = await startRun({
      onHostContext: (context) => seen.push(context),
    });
    await run.view.ready;
    expect(run.log[0]).toBe('context:-:test-host');
    expect(seen).toHaveLength(1);
  });

  it('applies every later host-context change as it arrives, with the merged context', async () => {
    const run = await startRun({ hostContext: { theme: 'light' } });
    await run.view.ready;
    await run.bridge.sendHostContextChange({ theme: 'dark' });
    await run.bridge.sendHostContextChange({ locale: 'fr' });
    await expect
      .poll(() => run.log.slice(1))
      .toEqual(['context:dark:test-host', 'context:dark:test-host']);
  });

  it('starts the readiness work while the handshake is still in progress, and hands it a signal', async () => {
    const seen: AbortSignal[] = [];
    const run = await startRun({
      readyWhen: async (signal) => void seen.push(signal),
    });
    expect(seen).toHaveLength(1); // started synchronously, not after connect
    await run.view.ready;
    expect(seen[0]?.aborted).toBe(false);
    await run.view.dispose();
    expect(seen[0]?.aborted).toBe(true);
  });
});

describe('ending the view', () => {
  it('ignores results after dispose, and dispose is idempotent and settles after cleanup', async () => {
    const run = await startRun();
    await run.view.ready;
    await run.bridge.sendToolResult(result('before'));
    await expect.poll(() => run.log).toContain('result:before');
    const first = run.view.dispose();
    const second = run.view.dispose();
    await Promise.all([first, second]);
    expect(run.log.filter((line) => line === 'teardown')).toHaveLength(1);
    await run.bridge.sendToolResult(result('after')).catch(() => undefined);
    await quiet();
    expect(run.log).not.toContain('result:after');
  });

  it('runs onTeardown once before the connection ends when the host asks the view to tear down', async () => {
    const run = await startRun();
    await run.view.ready;
    run.log.length = 0;
    await run.bridge.teardownResource({});
    expect(run.log).toEqual(['teardown']);
    await run.view.dispose();
    expect(run.log).toEqual(['teardown']); // not twice
    await run.bridge.sendToolResult(result('late')).catch(() => undefined);
    await quiet();
    expect(run.log).toEqual(['teardown']);
  });

  it('answers the host before it closes the connection', async () => {
    const run = await startRun();
    await run.view.ready;
    await expect(run.bridge.teardownResource({})).resolves.toBeDefined();
    await run.view.dispose();
    expect(run.app.transport).toBeUndefined(); // the connection is closed
  });

  it('runs onTeardown on pagehide, before the connection ends', async () => {
    const run = await startRun();
    await run.view.ready;
    const original = run.app.close.bind(run.app);
    vi.spyOn(run.app, 'close').mockImplementation(async () => {
      run.log.push('close');
      return original();
    });
    window.dispatchEvent(new Event('pagehide'));
    await run.view.dispose();
    expect(run.log.filter((l) => l === 'teardown' || l === 'close')).toEqual([
      'teardown',
      'close',
    ]);
  });

  it('removes its pagehide listener once it has ended', async () => {
    const run = await startRun();
    await run.view.ready;
    await run.view.dispose();
    window.dispatchEvent(new Event('pagehide'));
    expect(run.log.filter((line) => line === 'teardown')).toHaveLength(1);
  });

  it('lets the same app connect again, with exactly one listener', async () => {
    const first = await startRun();
    await first.view.ready;
    await first.view.dispose();

    const bridge = new AppBridge(
      null,
      { name: 'test-host', version: '0.0.0' },
      {},
    );
    toClean.push({ app: first.app, bridge });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge.connect(hostSide);
    const delivered: string[] = [];
    const second = runToolResultView({
      app: first.app,
      transport: viewSide,
      onToolResult: (r) => delivered.push(textOf(r) ?? ''),
      onTeardown: () => undefined,
    });
    await second.ready;
    await bridge.sendToolResult(result('again'));
    await expect.poll(() => delivered).toEqual(['again']);
    expect(first.log.filter((line) => line.startsWith('result:'))).toEqual([]);
  });
});

describe('ending during startup', () => {
  it('disposes during connect: the readiness signal aborts, onTeardown runs once, ready rejects as disposed', async () => {
    const aborted: boolean[] = [];
    const run = await startRun({
      connectHost: false, // no host answers: connect stays pending
      readyWhen: (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            aborted.push(true);
            reject(new Error('readiness aborted'));
          }),
        ),
    });
    await run.view.dispose();
    await expect(kindOf(run.view.ready)).resolves.toBe('disposed');
    expect(aborted).toEqual([true]);
    expect(run.log).toEqual(['teardown']);
    expect(run.failures.map((f) => f.kind)).toEqual(['disposed']);
  });

  it('disposes during readyWhen with a held result: the result is dropped and never delivered', async () => {
    const ready = gate();
    const run = await startRun({
      readyWhen: () => ready.promise,
      onInitialized: (bridge) => void bridge.sendToolResult(result('held')),
    });
    await quiet();
    await run.view.dispose();
    await expect(kindOf(run.view.ready)).resolves.toBe('disposed');
    ready.resolve(); // the readiness outcome arrives late
    await quiet();
    expect(run.log).toEqual(['teardown']);
    expect(run.failures.map((f) => f.kind)).toEqual(['disposed']);
  });

  it('host teardown during readyWhen ends the view the same way as dispose', async () => {
    const ready = gate();
    const run = await startRun({ readyWhen: () => ready.promise });
    await quiet();
    await run.bridge.teardownResource({});
    await expect(kindOf(run.view.ready)).resolves.toBe('disposed');
    expect(run.log).toEqual(['teardown']);
    ready.resolve();
    await quiet();
    expect(run.log).toEqual(['teardown']);
    expect(run.failures.map((f) => f.kind)).toEqual(['disposed']);
  });

  it('a readiness failure that arrives after dispose reports nothing new', async () => {
    const ready = gate();
    const run = await startRun({ readyWhen: () => ready.promise });
    await run.view.dispose();
    ready.reject(new Error('fonts failed, too late'));
    await quiet();
    expect(run.failures.map((f) => f.kind)).toEqual(['disposed']);
    expect(run.errors).toEqual([]);
  });

  it('a readiness success that arrives after dispose never delivers a result or a host context', async () => {
    const ready = gate();
    const run = await startRun({
      hostContext: { theme: 'dark' },
      readyWhen: () => ready.promise,
      onInitialized: (bridge) => void bridge.sendToolResult(result('held')),
    });
    await quiet();
    await run.view.dispose();
    ready.resolve();
    await quiet();
    expect(run.log).toEqual(['teardown']);
  });
});

describe('startup failures', () => {
  it('a connect failure is reported as connect, ends the view and delivers nothing afterwards', async () => {
    const run = await startRun({ connectHost: false });
    await run.app.close(); // closes the pipe: initialize can never complete
    await expect(kindOf(run.view.ready)).resolves.toBe('connect');
    expect(run.failures.map((f) => f.kind)).toEqual(['connect']);
    expect(run.log).toEqual(['teardown']);
  });

  it('a readyWhen rejection is reported as ready, distinct from a connect failure, and ends the view', async () => {
    const cause = new Error('fonts failed');
    const run = await startRun({
      readyWhen: () => Promise.reject(cause),
      onInitialized: (bridge) => void bridge.sendToolResult(result('held')),
    });
    await expect(kindOf(run.view.ready)).resolves.toBe('ready');
    expect(run.failures).toEqual([{ kind: 'ready', cause }]);
    await quiet();
    expect(run.log).toEqual(['teardown']); // the held result was never delivered
    await run.view.dispose(); // idempotent after a failure
    expect(run.log).toEqual(['teardown']);
  });

  it('a readyWhen that throws synchronously is a ready failure too', async () => {
    const run = await startRun({
      readyWhen: () => {
        throw new Error('no fonts api');
      },
    });
    await expect(kindOf(run.view.ready)).resolves.toBe('ready');
  });

  it('does not leave an unhandled rejection when nobody waits for ready', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const run = await startRun({
        readyWhen: () => Promise.reject(new Error('x')),
      });
      await run.view.dispose();
      await quiet();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('a throwing application callback', () => {
  it('onHostContext throwing during startup fails startup as application, after cleanup', async () => {
    const boom = new Error('bad context');
    const run = await startRun({
      onHostContext: () => {
        throw boom;
      },
    });
    await expect(kindOf(run.view.ready)).resolves.toBe('application');
    expect(run.failures).toEqual([{ kind: 'application', cause: boom }]);
    expect(run.log).toEqual(['context:-:test-host', 'teardown']);
    expect(run.app.transport).toBeUndefined();
  });

  it('onToolResult throwing on the held result fails startup as application, after cleanup', async () => {
    const boom = new Error('bad result');
    const run = await startRun({
      onInitialized: (bridge) => void bridge.sendToolResult(result('held')),
      onToolResult: () => {
        throw boom;
      },
    });
    await expect(kindOf(run.view.ready)).resolves.toBe('application');
    expect(run.failures).toEqual([{ kind: 'application', cause: boom }]);
    expect(run.log).toEqual(['context:-:test-host', 'result:held', 'teardown']);
    expect(run.app.transport).toBeUndefined();
  });

  it('onTeardown throwing while a view is still starting fails startup as application and still closes the connection', async () => {
    const boom = new Error('bad teardown');
    const ready = gate();
    const run = await startRun({
      readyWhen: () => ready.promise,
      onTeardown: () => {
        throw boom;
      },
    });
    await run.view.dispose();
    await expect(kindOf(run.view.ready)).resolves.toBe('application');
    expect(run.failures).toEqual([{ kind: 'application', cause: boom }]);
    expect(run.app.transport).toBeUndefined();
  });

  it('onToolResult throwing after ready is reported, keeps the connection up, and the next result is delivered', async () => {
    const boom = new Error('bad result');
    let first = true;
    const run = await startRun({
      onToolResult: () => {
        if (first) {
          first = false;
          throw boom;
        }
      },
    });
    await run.view.ready;
    await run.bridge.sendToolResult(result('one'));
    await run.bridge.sendToolResult(result('two'));
    await expect.poll(() => run.log).toContain('result:two');
    expect(run.errors).toEqual([{ error: boom, phase: 'result' }]);
    expect(run.failures).toEqual([]);
    expect(run.app.transport).toBeDefined();
  });

  it('onHostContext throwing after ready is reported, keeps the connection up, and a later change is applied', async () => {
    const boom = new Error('bad context');
    let calls = 0;
    const run = await startRun({
      hostContext: { theme: 'light' },
      onHostContext: () => {
        if (++calls === 2) throw boom;
      },
    });
    await run.view.ready;
    await run.bridge.sendHostContextChange({ theme: 'dark' });
    await run.bridge.sendHostContextChange({ theme: 'light' });
    await expect.poll(() => run.log.length).toBe(3); // the initial context and two changes
    expect(run.errors).toEqual([{ error: boom, phase: 'host-context' }]);
    expect(run.app.transport).toBeDefined();
  });

  it('a host-context callback that changes a CSS variable and then throws: reported, the change stays, later teardown cleanup is intact', async () => {
    const boom = new Error('theme broke halfway');
    const run = await startRun({
      hostContext: { theme: 'light' },
      onHostContext: (context) => {
        if (context?.theme === 'dark') {
          document.documentElement.style.setProperty('--card-ink', 'white');
          throw boom;
        }
      },
    });
    await run.view.ready;
    await run.bridge.sendHostContextChange({ theme: 'dark' });
    await expect
      .poll(() => run.errors)
      .toEqual([{ error: boom, phase: 'host-context' }]);
    // the runner does not roll the application's change back ...
    expect(document.documentElement.style.getPropertyValue('--card-ink')).toBe(
      'white',
    );
    // ... and teardown still runs and still closes the connection
    await run.bridge.teardownResource({});
    await run.view.dispose();
    expect(run.log.filter((line) => line === 'teardown')).toHaveLength(1);
    expect(run.app.transport).toBeUndefined();
    document.documentElement.style.removeProperty('--card-ink');
  });

  it('onTeardown throwing after ready is reported, and the connection is still disposed', async () => {
    const boom = new Error('bad teardown');
    const run = await startRun({
      onTeardown: () => {
        throw boom;
      },
    });
    await run.view.ready;
    await run.view.dispose();
    expect(run.errors).toEqual([{ error: boom, phase: 'teardown' }]);
    expect(run.app.transport).toBeUndefined();
    expect(run.failures).toEqual([]);
  });

  it('onTeardown throwing on a host teardown request still answers the host and disposes the connection', async () => {
    const boom = new Error('bad teardown');
    const run = await startRun({
      onTeardown: () => {
        throw boom;
      },
    });
    await run.view.ready;
    await expect(run.bridge.teardownResource({})).resolves.toBeDefined();
    await run.view.dispose();
    expect(run.errors).toEqual([{ error: boom, phase: 'teardown' }]);
    expect(run.app.transport).toBeUndefined();
  });

  it('reports to console.error by default', async () => {
    const boom = new Error('bad result');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = await startRun({
      defaultErrorReporter: true,
      onToolResult: () => {
        throw boom;
      },
    });
    await run.view.ready;
    await run.bridge.sendToolResult(result('one'));
    await expect.poll(() => spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls[0]).toContain(boom);
  });

  it('a throwing onError or onFailure never skips cleanup', async () => {
    const run = await startRun({
      onHostContext: () => {
        throw new Error('startup');
      },
    });
    await kindOf(run.view.ready);
    expect(run.app.transport).toBeUndefined();

    const app = new App({ name: 'v', version: '0' }, {}, { autoResize: false });
    const bridge = new AppBridge(null, { name: 'h', version: '0' }, {});
    toClean.push({ app, bridge });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge.connect(hostSide);
    const view = runToolResultView({
      app,
      transport: viewSide,
      onToolResult: () => undefined,
      onTeardown: () => {
        throw new Error('teardown');
      },
      onError: () => {
        throw new Error('reporter');
      },
    });
    await view.ready;
    await expect(view.dispose()).resolves.toBeUndefined();
    expect(app.transport).toBeUndefined();
  });
});
