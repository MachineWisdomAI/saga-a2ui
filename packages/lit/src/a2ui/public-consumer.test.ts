// @vitest-environment jsdom
import {
  A2uiLitElement,
  basicCatalog,
  type LitComponentApi,
} from '@a2ui/lit/v0_9';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import {
  createA2uiAppElement,
  defineElements,
  type A2uiUpdateResult,
} from '@saga-a2ui/lit';
import { html, nothing } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

// An ordinary application through the package's public entry only: it names a catalog and a
// layout, and never constructs a message session, a decoder or protocol input. The type-level
// expectations below are checked by `npm run typecheck`, not by the test run.

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
  tagName: 'public-consumer-line',
  element: LineElement,
};
const Column = basicCatalog.components.get('Column');
if (!Column) throw new Error('the basic catalog has no Column');
const CATALOG_ID = 'https://example.test/catalogs/public-consumer/v1';
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [
  Column,
  Line,
]);
defineElements([Column, Line]);

const layout = defineSurface({
  surfaceId: 'public-consumer',
  catalogId: CATALOG_ID,
  data: z.object({ headline: z.string() }),
  initial: { headline: 'Opening' },
  root: {
    component: 'Column',
    bind: {},
    props: { children: ['headline'] },
  },
  components: [
    { id: 'headline', component: 'Line', text: { path: '/headline' } },
  ],
});

let tags = 0;
function mount() {
  // Ordinary construction: no `createSession`, no decoder.
  const App = createA2uiAppElement({ catalog, layout });
  const tag = `public-consumer-app-${++tags}`;
  customElements.define(tag, App);
  const element = document.createElement(tag) as InstanceType<typeof App>;
  document.body.append(element);
  return element;
}

const settle = async (element: { updateComplete: Promise<unknown> }) => {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 20));
};
function deepText(root: ParentNode): string | undefined {
  const own = root.querySelector('[data-testid="line"]');
  if (own) return own.textContent ?? undefined;
  for (const host of root.querySelectorAll('*')) {
    const inner = host.shadowRoot && deepText(host.shadowRoot);
    if (inner !== undefined && inner !== null) return inner;
  }
  return undefined;
}

afterEach(() => document.body.replaceChildren());

describe('an ordinary Lit application through the public entry', () => {
  it('builds an element from a catalog and a layout, with no session of its own', async () => {
    const element = mount();
    await settle(element);
    expect(deepText(element.shadowRoot!)).toBe('Opening');

    const result: A2uiUpdateResult = element.updateData({ headline: 'Done' });
    await settle(element);
    expect(result).toEqual({ ok: true });
    expect(deepText(element.shadowRoot!)).toBe('Done');
  });

  it('reports a rejected update as a structured failure and keeps what was shown', async () => {
    const element = mount();
    await settle(element);

    const result = element.updateData({ headline: 3 } as never);
    await settle(element);

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'invalid-data',
        message: expect.stringContaining('headline'),
      },
    });
    expect(deepText(element.shadowRoot!)).toBe('Opening');
  });

  it('fails an update after disconnect with the same structured shape', async () => {
    const element = mount();
    await settle(element);
    element.remove();

    expect(element.updateData({ headline: 'Late' })).toEqual({
      ok: false,
      failure: { kind: 'rejected', message: 'The app is not connected.' },
    });
  });

  it('keeps raw protocol ingestion out of the public element type', async () => {
    const element = mount();
    await settle(element);
    // @ts-expect-error `ingest` is protected: it is not part of the application contract
    expect(typeof element.ingest).toBe('function');
    // The element type offers data updates, and no other way to change the surface.
    expect(typeof element.updateData).toBe('function');
  });
});
