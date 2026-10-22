// @vitest-environment jsdom
import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import { Action } from '@saga-a2ui/core/actions';
import { html, nothing } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  actionButtonEntry,
  ActionButton,
  createLitActions,
  defineSurface,
  z,
  type RunningA2uiView,
} from './index.js';
import {
  settle,
  startTestHost,
  toolResult,
  type TestHost,
} from './stack.test-support.js';
import { startA2uiViewOn } from './start-a2ui-view.js';
import { StartFailure } from './start-failure.js';

// An own-catalog application started by the stack's main entry, over a real bridge joined to a
// real host by an in-memory transport and rendered by Lit into jsdom. The application here is a
// one-button surface whose label it updates, which is what `surface.update` is for.

const CATALOG_ID = 'https://stack.example/catalogs/own/v1';

const LineApi = {
  name: 'Line',
  schema: z.object({ text: CommonSchemas.DynamicString }).strict(),
};
class LineElement extends A2uiLitElement<typeof LineApi> {
  protected readonly api = LineApi;
  render() {
    const props = this.controller?.props;
    return props === undefined
      ? nothing
      : html`<span data-testid="line">${String(props.text ?? '')}</span>`;
  }
}
const Line: LitComponentApi = {
  ...LineApi,
  tagName: 'stack-test-line',
  element: LineElement,
};
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [
  Line,
  actionButtonEntry,
]);

const layout = defineSurface({
  surfaceId: 'own',
  catalogId: CATALOG_ID,
  data: z.object({ label: z.string() }),
  initial: { label: 'Waiting' },
  root: { component: 'ActionButton', bind: {}, props: { child: 'label' } },
  components: [{ id: 'label', component: 'Line', text: { path: '/label' } }],
});

let container: HTMLElement;
let host: TestHost | undefined;
const views: Array<{ dispose(): Promise<void> }> = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
});
afterEach(async () => {
  for (const view of views.splice(0)) await view.dispose();
  await host?.close();
  host = undefined;
  vi.restoreAllMocks();
});

/** The first element matching `selector`, looking through the shadow roots the A2UI surface renders in. */
function deepQuery(root: ParentNode, selector: string): Element | null {
  const found = root.querySelector(selector);
  if (found) return found;
  for (const element of root.querySelectorAll('*')) {
    const inside =
      element.shadowRoot && deepQuery(element.shadowRoot, selector);
    if (inside) return inside;
  }
  return null;
}
const label = () => deepQuery(container, '[data-testid="line"]');
const labelFor = (result: { structuredContent?: unknown }) =>
  (result.structuredContent as { label: string }).label;

async function start(
  extra: Partial<Parameters<typeof startA2uiViewOn<{ label: string }>>[1]> = {},
) {
  host ??= await startTestHost();
  const view = startA2uiViewOn(host.connect, {
    container,
    layout,
    catalog,
    onToolResult: (result, running) =>
      void running.surface.update({ label: labelFor(result) }),
    ...extra,
  });
  views.push(view);
  return view;
}

describe('startA2uiView', () => {
  it('returns the running view at once, presents the layout, and applies each result as an in-place update', async () => {
    const view = await start();
    await vi.waitFor(() => expect(label()?.textContent).toBe('Waiting'));
    await view.ready;

    const mountedLabel = label();
    await host!.bridge.sendToolResult(toolResult({ label: 'First' }));
    await vi.waitFor(() => expect(label()?.textContent).toBe('First'));
    expect(label()).toBe(mountedLabel); // identity survives an ordinary update
    await host!.bridge.sendToolResult(toolResult({ label: 'Second' }));
    await vi.waitFor(() => expect(label()?.textContent).toBe('Second'));
    expect(label()).toBe(mountedLabel);
  });

  it('refuses an update its layout rejects and leaves the shown data alone', async () => {
    let refused: unknown;
    const view = await start({
      onToolResult: (_result, running) => {
        refused = running.surface.update({ label: 42 as never });
      },
    });
    await view.ready;
    await vi.waitFor(() => expect(label()?.textContent).toBe('Waiting'));
    await host!.bridge.sendToolResult(toolResult({}));
    await vi.waitFor(() => expect(refused).toMatchObject({ ok: false }));
    expect(label()?.textContent).toBe('Waiting');
  });

  it('passes the running view to onToolResult, so the application updates through view.surface', async () => {
    let received: RunningA2uiView<{ label: string }> | undefined;
    const view = await start({
      onToolResult: (_result, running) => {
        received = running;
      },
    });
    await view.ready;
    await host!.bridge.sendToolResult(toolResult({ label: 'x' }));
    await vi.waitFor(() => expect(received).toBeDefined());
    expect(received!.surface).toBe(view.surface);
  });

  it('refuses a second start on a running container; restarts after dispose', async () => {
    const first = await start();
    await first.ready;
    await vi.waitFor(() => expect(label()?.textContent).toBe('Waiting'));
    expect(() =>
      startA2uiViewOn(host!.connect, {
        container,
        layout,
        catalog,
        onToolResult: () => undefined,
      }),
    ).toThrow(/container-busy/);
    expect(label()?.textContent).toBe('Waiting');
    expect(host!.connects()).toBe(1);

    await first.dispose();
    expect(container.childNodes).toHaveLength(0);
    await host!.close();
    host = undefined;
    const second = await start();
    await second.ready;
    await vi.waitFor(() => expect(label()?.textContent).toBe('Waiting'));
  });

  it('throws before connecting for a missing container, and leaves the container free', async () => {
    host = await startTestHost();
    expect(() =>
      startA2uiViewOn(host!.connect, {
        container: null as never,
        layout,
        catalog,
        onToolResult: () => undefined,
      }),
    ).toThrow(/container-missing/);
    expect(host.connects()).toBe(0);
    const view = await start();
    await view.ready;
  });

  it('runs the application’s actions, and gives an actions factory the host’s server transport', async () => {
    host = await startTestHost({ hostCapabilities: { serverTools: {} } });
    const calls: string[] = [];
    host.bridge.oncalltool = (params) => {
      calls.push(params.name);
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
    };
    const view = await start({
      actions: (viewHost) => {
        const press = Action.server<unknown, { content: readonly unknown[] }>(
          'press',
          viewHost.server,
        )
          .input(() => ({}))
          .run(async ({ call }) => call('archive', {}))
          .build();
        return createLitActions({
          attach: (setup) =>
            void setup.watchById(
              'root',
              ActionButton,
              (handle) => void handle.bindAction('activate', press),
            ),
          onSetupError: () => undefined,
        });
      },
    });
    await view.ready;
    await vi.waitFor(() =>
      expect(deepQuery(container, 'button')).not.toBeNull(),
    );
    (deepQuery(container, 'button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls).toEqual(['archive']));
  });

  it('retires the surface and removes the view when the host tears it down', async () => {
    const view = await start();
    await view.ready;
    await host!.bridge.teardownResource({});
    await vi.waitFor(() => expect(container.childNodes).toHaveLength(0));
    expect(view.surface.update({ label: 'late' }).ok).toBe(false);
  });

  it('rejects ready with a typed failure, and leaves nothing on screen, when startup fails', async () => {
    const view = await start({
      readyWhen: () => Promise.reject(new Error('fonts failed')),
    });
    await expect(view.ready).rejects.toBeInstanceOf(StartFailure);
    await expect(view.ready).rejects.toMatchObject({ kind: 'ready' });
    await view.dispose();
    await settle();
    expect(container.childNodes).toHaveLength(0);
  });
});
