import { A2uiLitElement, basicCatalog, type LitComponentApi } from '@a2ui/lit/v0_9';
import { actionButtonEntry } from '@saga-a2ui/lit/actions';
import { html, nothing } from 'lit';
import { LineApi } from './notes-line.js';

// The application-owned catalog of the Lit consumers. `Line` is the application's own component:
// its contract (notes-line.ts) is shared with the React catalog. Layout, rows and lists come from
// upstream's basic catalog; `ActionButton` is SAGA's opt-in control. Nothing else is in the
// catalog, and in particular no SAGA optional component: the second consumer adds one
// (main-card.ts) and this file stays as it is.

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

export const Line: LitComponentApi = { ...LineApi, tagName: 'notes-line', element: LineElement };

const upstream = (name: string): LitComponentApi => {
  const component = basicCatalog.components.get(name);
  if (!component) throw new Error(`the basic catalog has no ${name}`);
  return component;
};

/** What every consumer of this application has: layout, the application's own line, and the opt-in action control. */
export const ownEntries: readonly LitComponentApi[] = [upstream('Column'), upstream('Row'), upstream('List'), Line, actionButtonEntry];
