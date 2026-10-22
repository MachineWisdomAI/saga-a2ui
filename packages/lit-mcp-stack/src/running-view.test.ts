// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostConnection } from './host-connection.js';
import { runView, type RunViewOptions } from './running-view.js';
import {
  gate,
  startTestHost,
  unreachableHost,
  type TestHost,
} from './stack.test-support.js';
import type { StartFailure } from './start-failure.js';

// What every entry of the stack relies on once it has something to show: the order in which a view
// ends, over a real bridge joined to a real host. The entries' own tests cover what each one shows.

let host: TestHost | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
  vi.restoreAllMocks();
});

interface Run {
  readonly view: ReturnType<typeof runView>;
  /** What happened, in order: the view's own steps and the connection's close. */
  readonly steps: string[];
}

function run(
  connection: HostConnection,
  options: Partial<RunViewOptions> & {
    readonly throwing?: ReadonlyArray<'retire' | 'unmount' | 'reporter'>;
  } = {},
): Run {
  const steps: string[] = [];
  const { throwing = [], ...rest } = options;
  const original = connection.app.close.bind(connection.app);
  vi.spyOn(connection.app, 'close').mockImplementation(() => {
    // The first request to close; the connection may be asked again as it winds down.
    if (!steps.includes('close')) steps.push('close');
    return original();
  });
  const step = (name: 'retire' | 'unmount'): void => {
    steps.push(name);
    if (throwing.includes(name)) throw new Error(`${name} broke`);
  };
  const view = runView({
    connection,
    lifetime: new AbortController(),
    sizing: 'host',
    onToolResult: () => undefined,
    retire: () => step('retire'),
    unmount: () => step('unmount'),
    releaseContainer: () => steps.push('release'),
    onError: () => {
      steps.push('report');
      if (throwing.includes('reporter')) throw new Error('reporter broke');
    },
    ...rest,
  });
  return { view, steps };
}

describe('a view that ends while it is still starting', () => {
  it('is retired and unmounted, and frees its container, before the connection closes', async () => {
    host = await startTestHost();
    const fonts = gate();
    const { view, steps } = run(host.connection, {
      readyWhen: () => fonts.promise,
    });
    await view.dispose();
    await expect(view.ready).rejects.toMatchObject({ kind: 'disposed' });
    expect(steps).toEqual(['retire', 'unmount', 'release', 'close']);
  });

  it('is unmounted before the connection closes when the page goes away', async () => {
    host = await startTestHost();
    const fonts = gate();
    const { view, steps } = run(host.connection, {
      readyWhen: () => fonts.promise,
    });
    dispatchEvent(new Event('pagehide'));
    await view.dispose();
    expect(steps).toEqual(['retire', 'unmount', 'release', 'close']);
  });

  it('is unmounted before the connection closes when the host tears it down', async () => {
    host = await startTestHost();
    const fonts = gate();
    const { view, steps } = run(host.connection, {
      readyWhen: () => fonts.promise,
    });
    await host.bridge.teardownResource({});
    await view.dispose();
    expect(steps).toEqual(['retire', 'unmount', 'release', 'close']);
  });
});

describe.each(['starting', 'ready'] as const)(
  'a %s view whose own cleanup throws',
  (state) => {
    it('still unmounts, frees its container once and closes the connection, and a later pagehide does nothing', async () => {
      host = await startTestHost();
      const fonts = gate();
      const { view, steps } = run(host.connection, {
        readyWhen: () => fonts.promise,
        throwing: ['retire', 'unmount', 'reporter'],
      });
      if (state === 'ready') {
        fonts.resolve();
        await view.ready;
      }
      await view.dispose();
      dispatchEvent(new Event('pagehide'));
      await view.dispose();
      expect(steps.filter((step) => step !== 'report')).toEqual([
        'retire',
        'unmount',
        'release',
        'close',
      ]);
    });
  },
);

describe('a view that failed to start', () => {
  const failures: StartFailure['kind'][] = [];
  const showing = (failure: StartFailure): boolean => {
    failures.push(failure.kind);
    return true;
  };

  it('keeps the failure on screen until it is disposed, whether the handshake or the readiness work failed', async () => {
    host = await startTestHost();
    const ready = run(host.connection, {
      readyWhen: () => Promise.reject(new Error('fonts failed')),
      showFailure: showing,
    });
    await expect(ready.view.ready).rejects.toMatchObject({ kind: 'ready' });
    await vi.waitFor(() => expect(failures).toEqual(['ready']));
    expect(ready.steps).toEqual(['retire', 'close']); // the failure is still shown
    await ready.view.dispose();
    expect(ready.steps).toEqual(['retire', 'close', 'unmount', 'release']);

    failures.length = 0;
    const connect = run(unreachableHost(), { showFailure: showing });
    await expect(connect.view.ready).rejects.toMatchObject({
      kind: 'connect',
    });
    await vi.waitFor(() => expect(failures).toEqual(['connect']));
    expect(connect.steps).not.toContain('unmount');
    await connect.view.dispose();
    expect(connect.steps).toContain('unmount');
    expect(connect.steps.filter((step) => step === 'release')).toHaveLength(1);
  });
});
