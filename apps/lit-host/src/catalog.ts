import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import { html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { z } from 'zod';

export const SAGA_CATALOG_ID = 'https://saga-a2ui.local/catalogs/lit-host/v1';

// Component API: a title and a plain-text description, both bindable to the data model.
export const SagaPanelApi = {
  name: 'SagaPanel',
  schema: z
    .object({
      title: CommonSchemas.DynamicString,
      description: CommonSchemas.DynamicString.optional(),
    })
    .strict(),
};

// Lit implementation. Values are rendered only through Lit text bindings, so supplied
// strings stay inert text (never parsed as markup or Markdown).
@customElement('saga-panel')
export class SagaPanelElement extends A2uiLitElement<typeof SagaPanelApi> {
  protected readonly api = SagaPanelApi;

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const title = String(props.title ?? '');
    const description = props.description === undefined ? '' : String(props.description);
    return html`<section data-testid="panel">
      <h2 data-testid="panel-title">${title}</h2>
      ${description ? html`<p data-testid="panel-description">${description}</p>` : nothing}
    </section>`;
  }
}

export const SagaPanel: LitComponentApi = {
  ...SagaPanelApi,
  tagName: 'saga-panel',
  element: SagaPanelElement,
};

// Small application-owned catalog: one component, no functions.
export const sagaCatalog = new Catalog<LitComponentApi>(SAGA_CATALOG_ID, 'v0.9', [SagaPanel]);
