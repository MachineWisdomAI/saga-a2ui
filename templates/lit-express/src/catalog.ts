import {
  A2uiLitElement,
  actionButtonEntry,
  basicCatalog,
  Catalog,
  CommonSchemas,
  z,
  type LitComponentApi,
} from '@saga-a2ui/lit-mcp-stack';
import { html, nothing } from 'lit';
import { CATALOG_ID } from './surface.js';

// The application-owned catalog: the components its layout may name, and nothing else. `Line` is
// this application's own component; it shows supplied text as text, never as markup. Layout comes
// from upstream's basic catalog, and `ActionButton` is saga a2ui's opt-in control. Choosing a component
// is the application's decision: nothing here is registered globally by the SDK.

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
    const text = String(props.text ?? '');
    return props.kind === 'title'
      ? html`<h3>${text}</h3>`
      : html`<span>${text}</span>`;
  }
}

export const Line: LitComponentApi = {
  ...LineApi,
  tagName: 'starter-line',
  element: LineElement,
};

const upstream = (name: string): LitComponentApi => {
  const component = basicCatalog.components.get(name);
  if (!component) throw new Error(`the basic catalog has no ${name}`);
  return component;
};

export const starterEntries: readonly LitComponentApi[] = [
  upstream('Column'),
  Line,
  actionButtonEntry,
];

/** What the stack presents the layout over; it defines each entry's element when the view starts. */
export const starterCatalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [
  ...starterEntries,
]);
