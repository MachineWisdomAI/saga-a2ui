import { A2uiLitElement, basicCatalog, type LitComponentApi } from '@a2ui/lit/v0_9';
import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { actionButtonEntry } from '@saga-a2ui/lit/actions';
import { html, nothing } from 'lit';

// The application-owned catalog. `Line` is the application's own component: it shows supplied text
// as text, never as markup, in one of three roles. Layout, rows and lists come from upstream's
// basic catalog; `ActionButton` is SAGA's opt-in control. Nothing else is in the catalog, and in
// particular no SAGA optional component: the second consumer adds one (main-card.ts) and this file
// stays as it is.

const LineApi = {
  name: 'Line',
  schema: z.object({ text: CommonSchemas.DynamicString, kind: z.enum(['title', 'body', 'status']) }).strict(),
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

export const Line: LitComponentApi = { ...LineApi, tagName: 'notes-line', element: LineElement };

const upstream = (name: string): LitComponentApi => {
  const component = basicCatalog.components.get(name);
  if (!component) throw new Error(`the basic catalog has no ${name}`);
  return component;
};

/** What every consumer of this application has: layout, the application's own line, and the opt-in action control. */
export const ownEntries: readonly LitComponentApi[] = [upstream('Column'), upstream('Row'), upstream('List'), Line, actionButtonEntry];
