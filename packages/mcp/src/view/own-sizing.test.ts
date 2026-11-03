// @vitest-environment jsdom
import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startOwnSizing } from './own-sizing.js';

// Own sizing, exercised with a real `App` and `AppBridge` joined by an in-memory transport: the
// host's size-changed handler is the observable effect. The browser supplies three things jsdom
// cannot: animation frames, layout and resize notifications. Each is a controllable stand-in with
// the browser's contract, so a test decides when a frame runs and what the page measures.

type Size = { width: number; height: number };

class FakeResizeObserver {
  static live = new Set<FakeResizeObserver>();
  constructor(private readonly callback: () => void) {}
  observe(): void {
    FakeResizeObserver.live.add(this);
  }
  disconnect(): void {
    FakeResizeObserver.live.delete(this);
  }
  static notify(): void {
    for (const observer of [...FakeResizeObserver.live]) observer.callback();
  }
}

let frames: Map<number, () => void>;
let nextFrame: number;
let pageHeight: number;
let heightWhileMeasured: string[];

/** Runs every frame that is waiting, as the browser does before the next paint. */
function paint(): void {
  const waiting = [...frames.entries()];
  frames.clear();
  for (const [, callback] of waiting) callback();
}

async function connected(): Promise<{
  app: App;
  bridge: AppBridge;
  sizes: Size[];
}> {
  const app = new App(
    { name: 'test-view', version: '0.0.0' },
    {},
    { autoResize: false },
  );
  const bridge = new AppBridge(
    null,
    { name: 'test-host', version: '0.0.0' },
    {},
  );
  const sizes: Size[] = [];
  bridge.onsizechange = (size) => {
    sizes.push({ width: size.width ?? -1, height: size.height ?? -1 });
  };
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  await app.connect(viewSide);
  toClose.push({ app, bridge });
  return { app, bridge, sizes };
}

const toClose: { app: App; bridge: AppBridge }[] = [];

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  pageHeight = 300;
  heightWhileMeasured = [];
  FakeResizeObserver.live.clear();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('innerWidth', 480);
  document.documentElement.style.height = '';
  document.documentElement.getBoundingClientRect = () => {
    heightWhileMeasured.push(document.documentElement.style.height);
    return { height: pageHeight + 0.4 } as DOMRect;
  };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const { app, bridge } of toClose.splice(0)) {
    await app.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
});

describe('own sizing', () => {
  it('reports the first measured size, rounded up, once a frame has run', async () => {
    const { app, sizes } = await connected();
    const lifetime = new AbortController();
    startOwnSizing(app, lifetime.signal);
    expect(sizes).toEqual([]); // nothing is measured outside a frame
    paint();
    await expect.poll(() => sizes).toEqual([{ width: 480, height: 301 }]);
  });

  it('measures the content at its natural height and leaves the page style as it found it', async () => {
    document.documentElement.style.height = '100%';
    const { app, sizes } = await connected();
    startOwnSizing(app, new AbortController().signal);
    paint();
    await expect.poll(() => sizes).toHaveLength(1);
    expect(heightWhileMeasured).toEqual(['max-content']);
    expect(document.documentElement.style.height).toBe('100%');
  });

  it('sends one size per change, however many resize notifications arrive', async () => {
    const { app, sizes } = await connected();
    startOwnSizing(app, new AbortController().signal);
    paint();
    FakeResizeObserver.notify();
    FakeResizeObserver.notify();
    FakeResizeObserver.notify(); // one pending frame serves all three
    expect(frames.size).toBe(1);
    paint(); // the size is unchanged
    pageHeight = 520;
    FakeResizeObserver.notify();
    paint();
    await expect
      .poll(() => sizes)
      .toEqual([
        { width: 480, height: 301 },
        { width: 480, height: 521 },
      ]);
  });

  it('reports a width change on its own', async () => {
    const { app, sizes } = await connected();
    startOwnSizing(app, new AbortController().signal);
    paint();
    vi.stubGlobal('innerWidth', 360);
    FakeResizeObserver.notify();
    paint();
    await expect
      .poll(() => sizes.map((size) => size.width))
      .toEqual([480, 360]);
  });

  it('sends nothing after the signal aborts, and leaves no pending frame or observer', async () => {
    const { app, sizes } = await connected();
    const lifetime = new AbortController();
    startOwnSizing(app, lifetime.signal);
    paint();
    await expect.poll(() => sizes).toHaveLength(1);

    pageHeight = 900;
    FakeResizeObserver.notify(); // a frame is now waiting
    expect(frames.size).toBe(1);
    lifetime.abort();
    expect(frames.size).toBe(0);
    expect(FakeResizeObserver.live.size).toBe(0);
    paint();
    FakeResizeObserver.notify();
    paint();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sizes).toHaveLength(1);
  });

  it('does nothing when the signal has already aborted', async () => {
    const { app, sizes } = await connected();
    const lifetime = new AbortController();
    lifetime.abort();
    startOwnSizing(app, lifetime.signal);
    expect(frames.size).toBe(0);
    expect(FakeResizeObserver.live.size).toBe(0);
    paint();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sizes).toEqual([]);
  });

  it('survives a host connection that has gone away', async () => {
    const { app, bridge } = await connected();
    startOwnSizing(app, new AbortController().signal);
    await bridge.close();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      paint();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
