// @vitest-environment jsdom
import {
  A2uiLitElement,
  basicCatalog,
  type LitComponentApi,
} from '@a2ui/lit/v0_9';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  defineSurface,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { Action } from '@saga-a2ui/core/actions';
import { html, nothing } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionButton, actionButtonEntry } from '../actions/action-button.js';
import { createLitActions } from '../actions/lit-actions.js';
import { defineElements } from '../element-registration.js';
import {
  createA2uiAppElement,
  type A2uiActions,
  type A2uiSession,
} from './app-element.js';

// The element through its public interface in a DOM, with the same catalog shape the starter uses:
// Column from upstream's basic catalog, an own text line, and SAGA's ActionButton.

const LineApi = {
  name: 'Line',
  schema: z
    .object({
      text: CommonSchemas.DynamicString,
      kind: z.enum(['title', 'body']),
    })
    .strict(),
};
class LineElement extends A2uiLitElement<typeof LineApi> {
  protected readonly api = LineApi;
  render() {
    const props = this.controller?.props;
    if (props === undefined) return nothing;
    return html`<span data-kind=${props.kind}
      >${String(props.text ?? '')}</span
    >`;
  }
}
const Line: LitComponentApi = {
  ...LineApi,
  tagName: 'test-line',
  element: LineElement,
};
const Column = basicCatalog.components.get('Column');
if (!Column) throw new Error('the basic catalog has no Column');
const entries: LitComponentApi[] = [Column, Line, actionButtonEntry];
const CATALOG_ID = 'https://example.test/catalogs/starter/v1';
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', entries);
defineElements(entries);

const layout = defineSurface({
  surfaceId: 'starter',
  catalogId: CATALOG_ID,
  data: z.object({ headline: z.string() }),
  initial: { headline: 'Opening' },
  root: {
    component: 'Column',
    bind: {},
    props: { children: ['headline', 'clear'] },
  },
  components: [
    {
      id: 'headline',
      component: 'Line',
      kind: 'title',
      text: { path: '/headline' },
    },
    { id: 'clear', component: 'ActionButton', child: 'clear-label' },
    {
      id: 'clear-label',
      component: 'Line',
      kind: 'body',
      text: 'Clear the note',
    },
  ],
});

let tagCount = 0;
const sessions: A2uiSession[] = [];
const disposed: A2uiSession[] = [];

function mount(
  options: {
    layout?: Parameters<typeof createA2uiAppElement>[0]['layout'];
    onClear?: () => void;
    actions?: A2uiActions;
  } = {},
) {
  const clear = Action.local('clear')
    .run(() => options.onClear?.())
    .build();
  const App = createA2uiAppElement({
    catalog,
    createSession: (given) => {
      expect(given).toBe(catalog);
      const session = createMessageSession({
        catalogs: [given],
        decoder: a2uiV0_9Decoder,
      });
      sessions.push(session);
      const dispose = session.dispose.bind(session);
      session.dispose = () => {
        disposed.push(session);
        dispose();
      };
      return session;
    },
    layout: options.layout ?? layout,
    actions:
      options.actions ??
      createLitActions({
        attach: (view) =>
          void view.watchById(
            'clear',
            ActionButton,
            (handle) => void handle.bindAction('activate', clear),
          ),
        onSetupError: () => undefined,
      }),
  });
  const tag = `test-app-${++tagCount}`;
  customElements.define(tag, App);
  const element = document.createElement(tag) as InstanceType<typeof App>;
  document.body.append(element);
  return element;
}

const settle = async (
  element: HTMLElement & { updateComplete: Promise<unknown> },
) => {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 20));
};
/** The first element matching `selector` in `root`, looking through open shadow roots. */
function deepQuery(
  root: ParentNode,
  selector: string,
): HTMLElement | undefined {
  const direct = root.querySelector<HTMLElement>(selector);
  if (direct) return direct;
  for (const host of root.querySelectorAll('*')) {
    const inner = host.shadowRoot && deepQuery(host.shadowRoot, selector);
    if (inner) return inner;
  }
  return undefined;
}
const headline = (element: Element) =>
  deepQuery(element.shadowRoot!, '[data-kind="title"]')?.textContent;
const findButton = (element: Element) =>
  deepQuery(element.shadowRoot!, 'saga-action-button');

afterEach(() => {
  document.body.replaceChildren();
  sessions.length = 0;
  disposed.length = 0;
});

describe('createA2uiAppElement with a layout', () => {
  it('opens the layout when connected and shows its initial data', async () => {
    const element = mount();
    await settle(element);
    expect(headline(element)).toBe('Opening');
    expect(findButton(element)).toBeDefined();
  });

  it('updateData changes what is shown without remounting: same control, still bound, still focused', async () => {
    let cleared = 0;
    const element = mount({ onClear: () => (cleared += 1) });
    await settle(element);
    const before = findButton(element)!;
    const inner = (before.shadowRoot?.querySelector('button') ??
      before) as HTMLElement;
    inner.focus();
    const focusedBefore = document.activeElement;
    expect(focusedBefore).not.toBe(document.body); // focus really is on the control

    expect(element.updateData({ headline: 'Signed in' })).toEqual({ ok: true });
    await settle(element);

    expect(headline(element)).toBe('Signed in');
    expect(findButton(element)).toBe(before);
    expect(document.activeElement).toBe(focusedBefore);
    inner.click();
    await settle(element);
    expect(cleared).toBe(1); // its binding survived the update, and ran once
  });

  it('a rejected update returns the failure and changes nothing', async () => {
    const element = mount();
    await settle(element);
    const before = findButton(element)!;

    const result = element.updateData({ headline: 3 } as never);
    await settle(element);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('invalid-data');
      expect(result.failure.message).toContain('headline');
    }
    expect(headline(element)).toBe('Opening');
    expect(findButton(element)).toBe(before);
    expect(
      element.shadowRoot?.querySelector('[data-testid="failure"]'),
    ).toBeNull();
  });

  it('shows the safe fallback when the layout cannot be opened', async () => {
    const element = mount({
      layout: defineSurface({
        surfaceId: 'ghost',
        catalogId: CATALOG_ID,
        data: z.object({}),
        initial: {},
        root: { component: 'NoSuchComponent', bind: {} },
      }),
    });
    await settle(element);
    const failure = element.shadowRoot?.querySelector(
      '[data-testid="failure"]',
    );
    expect(failure?.getAttribute('role')).toBe('alert');
    expect(
      element.shadowRoot?.querySelector('[data-testid="failure-detail"]')
        ?.textContent,
    ).toContain('NoSuchComponent');
    expect(element.shadowRoot?.querySelector('a2ui-surface')).toBeNull();
  });

  it('shows the fallback instead of the surface when the actions cannot start', async () => {
    const element = mount({
      actions: {
        begin: () => {
          throw new Error('cannot start');
        },
      },
    });
    await settle(element);
    expect(
      element.shadowRoot?.querySelector('[data-testid="failure-detail"]')
        ?.textContent,
    ).toContain('actions for this content could not be attached');
    expect(element.shadowRoot?.querySelector('a2ui-surface')).toBeNull();
  });

  it('an update after disconnect fails explicitly without throwing, and the session is disposed once', async () => {
    const element = mount();
    await settle(element);
    element.remove();

    const late = element.updateData({ headline: 'Late' });
    expect(late).toEqual({
      ok: false,
      failure: { kind: 'rejected', message: 'The app is not connected.' },
    });
    expect(disposed).toHaveLength(1);
  });

  it('a reconnected element opens the layout afresh on a new session', async () => {
    const element = mount();
    await settle(element);
    element.updateData({ headline: 'Changed' });
    await settle(element);
    element.remove();
    document.body.append(element);
    await settle(element);

    expect(sessions).toHaveLength(2);
    expect(headline(element)).toBe('Opening');
    expect(disposed).toEqual([sessions[0]]);
  });

  it('an update on a session disposed under the element fails explicitly', async () => {
    const element = mount();
    await settle(element);
    sessions[0]!.dispose();
    const result = element.updateData({ headline: 'After dispose' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('rejected');
  });
});
