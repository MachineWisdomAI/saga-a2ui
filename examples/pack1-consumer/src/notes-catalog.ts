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
import { LINE_KINDS } from './notes-line.js';
import { CATALOG_ID } from './notes-surface.js';

// The application-owned catalog of the Lit consumers. `Line` is the application's own component:
// its roles (notes-line.ts) are shared with the React catalog. Layout, rows and lists come from
// upstream's basic catalog; `ActionButton` is SAGA's opt-in control. Nothing else is in the
// catalog, and in particular no SAGA optional component: the second consumer adds one
// (main-card.ts) and this file stays as it is.

const LineApi = {
  name: 'Line',
  schema: z
    .object({ text: CommonSchemas.DynamicString, kind: z.enum(LINE_KINDS) })
    .strict(),
};

class LineElement extends A2uiLitElement<typeof LineApi> {
  protected readonly api = LineApi;
  render() {
    const props = this.controller?.props;
    if (props === undefined) return nothing;
    const text = String(props.text ?? '');
    switch (props.kind) {
      case 'title':
        return html`<h3 data-testid="line-title">${text}</h3>`;
      case 'body':
        return html`<p data-testid="line-body">${text}</p>`;
      case 'status':
        // Present before it speaks, so a screen reader announces the first message.
        return html`<p role="status" data-testid="line-status">${text}</p>`;
    }
  }
}

export const Line: LitComponentApi = {
  ...LineApi,
  tagName: 'notes-line',
  element: LineElement,
};

const upstream = (name: string): LitComponentApi => {
  const component = basicCatalog.components.get(name);
  if (!component) throw new Error(`the basic catalog has no ${name}`);
  return component;
};

/** What every consumer of this application has: layout, the application's own line, and the opt-in action control. */
export const ownEntries: readonly LitComponentApi[] = [
  upstream('Column'),
  upstream('Row'),
  upstream('List'),
  Line,
  actionButtonEntry,
];

/** One catalog entry: what a consumer may add to the catalog (the second consumer adds the card). */
export type CatalogEntry = LitComponentApi;

/** The catalog the stack presents the layout over: this application's entries and any a consumer adds. */
export const notesCatalog = (
  extra: readonly CatalogEntry[] = [],
): Catalog<LitComponentApi> =>
  new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [...ownEntries, ...extra]);
