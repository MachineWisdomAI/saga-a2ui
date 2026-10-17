import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { Catalog, type ComponentApi, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { afterEach, describe, expect, it } from 'vitest';
import { a2uiV0_9Decoder } from '../protocols/a2ui/v0_9/decoder.js';
import { createMessageSession, type MessageSession } from '../protocols/a2ui/v0_9/session.js';
import { SAGA_CATALOG_ID, SagaPanelApi } from '../saga-panel/contract.js';
import { panelSurface, SURFACE_ID } from '../saga-panel/fixture.js';
import { connectEpisodeView, type EpisodeViewConnection } from './view.js';

// The view's bridge seam, exercised with a real `App` and `AppBridge` joined by an in-memory
// transport, and a real A2UI session. Only rendering is absent (no DOM in these tests): the
// observable result is the surface the session holds and the problem text shown.

const catalog = new Catalog<ComponentApi>(SAGA_CATALOG_ID, 'v0.9', [SagaPanelApi]);

const episode = (id: string, title: string) => ({
  content: [{ type: 'text' as const, text: title }],
  structuredContent: { episodeId: id, title, description: `About ${title}` },
});

interface Harness {
  readonly session: MessageSession<ComponentApi>;
  readonly bridge: AppBridge;
  readonly app: App;
  readonly problems: (string | undefined)[];
  deliveries: unknown[];
  surface(): SurfaceModel<ComponentApi> | undefined;
  title(): unknown;
  /** Connects a view. Pass `onInitialized` to act while the handshake is still in flight. */
  connect(onInitialized?: (bridge: AppBridge) => void): Promise<EpisodeViewConnection>;
}

const toClean: { session?: MessageSession<ComponentApi>; app?: App; bridge?: AppBridge }[] = [];

function harness(): Harness {
  const session = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
  let current: SurfaceModel<ComponentApi> | undefined;
  session.onSurfaceCreated((surface) => (current = surface));
  session.onSurfaceDeleted(() => (current = undefined));
  // The session the Lit `saga-app` would own: it starts with the panel surface.
  session.ingest(panelSurface);

  const app = new App({ name: 'test-view', version: '0.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
  toClean.push({ session, app, bridge });
  const problems: (string | undefined)[] = [];
  const deliveries: unknown[] = [];

  return {
    session,
    bridge,
    app,
    problems,
    deliveries,
    surface: () => current,
    title: () => current?.dataModel.get('/title'),
    async connect(onInitialized) {
      const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
      bridge.oninitialized = () => onInitialized?.(bridge);
      await bridge.connect(hostSide);
      return connectEpisodeView({
        app,
        transport: viewSide,
        deliver: (input) => {
          deliveries.push(input);
          return session.ingest(input);
        },
        showProblem: (message) => problems.push(message),
      });
    },
  };
}

afterEach(async () => {
  for (const { session, app, bridge } of toClean.splice(0)) {
    session?.dispose();
    await app?.close().catch(() => undefined);
    await bridge?.close().catch(() => undefined);
  }
});

describe('episode view result handling', () => {
  it('renders a result delivered during initialization exactly once', async () => {
    const h = harness();
    const early = episode('ep-001', 'Early title');
    await h.connect((bridge) => void bridge.sendToolResult(early));
    await expect.poll(() => h.title()).toBe('Early title');
    expect(h.deliveries).toHaveLength(1);
  });

  it('replaces the shown episode with a later result', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(episode('ep-001', 'First'));
    await expect.poll(() => h.title()).toBe('First');
    await h.bridge.sendToolResult(episode('ep-002', 'Second'));
    await expect.poll(() => h.title()).toBe('Second');
  });

  it.each([
    ['an error result', { isError: true, content: [{ type: 'text' as const, text: 'nope' }] }],
    ['a result that is not a public episode', { content: [], structuredContent: { surprise: true } }],
    ['a result with extra private fields', { content: [], structuredContent: { ...episode('x', 'T').structuredContent, secret: 1 } }],
    ['a result without structured content', { content: [{ type: 'text' as const, text: 'plain' }] }],
  ])('clears the prior surface and shows a fallback for %s', async (_name, bad) => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(episode('ep-001', 'First'));
    await expect.poll(() => h.title()).toBe('First');

    await h.bridge.sendToolResult(bad);
    await expect.poll(() => h.surface()).toBeUndefined();
    expect(h.problems.at(-1)).toEqual(expect.any(String));
    expect(h.problems.at(-1)).not.toBe('');
  });

  it('shows the next valid result after a failure and clears the fallback', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult({ isError: true, content: [] });
    await expect.poll(() => h.surface()).toBeUndefined();
    await h.bridge.sendToolResult(episode('ep-002', 'Recovered'));
    await expect.poll(() => h.title()).toBe('Recovered');
    expect(h.problems.at(-1)).toBeUndefined();
  });

  it('keeps showing nothing across repeated failures', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult({ isError: true, content: [] });
    await h.bridge.sendToolResult({ isError: true, content: [] });
    await expect.poll(() => h.problems.length).toBe(2);
    expect(h.surface()).toBeUndefined();
  });

  it('ignores results after disposal', async () => {
    const h = harness();
    const view = await h.connect();
    await h.bridge.sendToolResult(episode('ep-001', 'Before'));
    await expect.poll(() => h.title()).toBe('Before');

    view.dispose();
    await h.bridge.sendToolResult(episode('ep-002', 'After')).catch(() => undefined);
    await h.bridge.sendToolResult({ isError: true, content: [] }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.title()).toBe('Before');
    expect(h.deliveries).toHaveLength(1);
  });

  it('is disposed by the host teardown request', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(episode('ep-001', 'Before'));
    await expect.poll(() => h.title()).toBe('Before');

    await h.bridge.teardownResource({});
    await h.bridge.sendToolResult(episode('ep-002', 'After')).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.title()).toBe('Before');
  });

  it('clears the prior surface when the session rejects a later result', async () => {
    const h = harness();
    let reject = false;
    const app = new App({ name: 'reject-view', version: '0.0.0' }, {}, { autoResize: false });
    const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
    toClean.push({ app, bridge });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge.connect(hostSide);
    await connectEpisodeView({
      app,
      transport: viewSide,
      // Rejects episode data only; the panel-removal message still reaches the real session.
      deliver: (input) =>
        reject && (input as { updateDataModel?: unknown }[]).some((m) => m.updateDataModel)
          ? { ok: false, failure: { kind: 'rejected', message: 'Controlled ingestion rejection' } }
          : h.session.ingest(input),
      showProblem: (message) => h.problems.push(message),
    });
    await bridge.sendToolResult(episode('ep-001', 'Before'));
    await expect.poll(() => h.title()).toBe('Before');
    reject = true;
    await bridge.sendToolResult(episode('ep-002', 'Rejected'));
    await expect.poll(() => h.surface()).toBeUndefined();
    expect(h.problems.at(-1)).toBe('Controlled ingestion rejection');
    reject = false;
    await bridge.sendToolResult(episode('ep-003', 'Recovered'));
    await expect.poll(() => h.title()).toBe('Recovered');
    expect(h.problems.at(-1)).toBeUndefined();
  });

  it('closes the app on dispose after host teardown so it can reconnect', async () => {
    const h = harness();
    const view = await h.connect();
    await h.bridge.sendToolResult(episode('ep-001', 'Before'));
    await expect.poll(() => h.title()).toBe('Before');
    await h.bridge.teardownResource({});
    view.dispose();

    const bridge2 = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
    toClean.push({ bridge: bridge2 });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge2.connect(hostSide);
    await connectEpisodeView({
      app: h.app,
      transport: viewSide,
      deliver: (input) => h.session.ingest(input),
      showProblem: (message) => h.problems.push(message),
    });
    await bridge2.sendToolResult(episode('ep-002', 'Again'));
    await expect.poll(() => h.title()).toBe('Again');
  });

  it('delivers each result once after reconnecting the same app', async () => {
    const h = harness();
    const first = await h.connect();
    first.dispose();
    await h.app.close();
    await h.bridge.close();

    const bridge2 = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
    toClean.push({ bridge: bridge2 });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge2.connect(hostSide);
    await connectEpisodeView({
      app: h.app,
      transport: viewSide,
      deliver: (input) => {
        h.deliveries.push(input);
        return h.session.ingest(input);
      },
      showProblem: (message) => h.problems.push(message),
    });

    h.deliveries.length = 0;
    await bridge2.sendToolResult(episode('ep-001', 'Again'));
    await expect.poll(() => h.title()).toBe('Again');
    expect(h.deliveries).toHaveLength(1);
  });

  it('ignores a repeated dispose of an old connection after the app reconnects', async () => {
    const h = harness();
    const first = await h.connect();
    first.dispose();
    await h.app.close();
    await h.bridge.close();

    const bridge2 = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
    toClean.push({ bridge: bridge2 });
    const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
    await bridge2.connect(hostSide);
    await connectEpisodeView({
      app: h.app,
      transport: viewSide,
      deliver: (input) => h.session.ingest(input),
      showProblem: (message) => h.problems.push(message),
    });

    first.dispose();
    await bridge2.sendToolResult(episode('ep-001', 'Still live'));
    await expect.poll(() => h.title()).toBe('Still live');
    await expect(bridge2.teardownResource({})).resolves.toBeDefined();
  });

  it('releases its handlers when the connection fails', async () => {
    const h = harness();
    const [viewSide] = InMemoryTransport.createLinkedPair();
    // No host is listening: initialize never completes, so close the pipe to make it fail.
    const pending = connectEpisodeView({
      app: h.app,
      transport: viewSide,
      deliver: (input) => h.session.ingest(input),
      showProblem: (message) => h.problems.push(message),
    });
    await viewSide.close();
    await expect(pending).rejects.toBeDefined();

    // A later, healthy connection delivers once.
    const bridge2 = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
    toClean.push({ bridge: bridge2 });
    const [view2, host2] = InMemoryTransport.createLinkedPair();
    await bridge2.connect(host2);
    await connectEpisodeView({
      app: h.app,
      transport: view2,
      deliver: (input) => {
        h.deliveries.push(input);
        return h.session.ingest(input);
      },
      showProblem: () => undefined,
    });
    await bridge2.sendToolResult(episode('ep-001', 'Healthy'));
    await expect.poll(() => h.title()).toBe('Healthy');
    expect(h.deliveries).toHaveLength(1);
  });
});
