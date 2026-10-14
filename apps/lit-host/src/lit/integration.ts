import { A2uiLitElement, A2uiSurface, type LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { html, nothing } from 'lit';
import { SAGA_CATALOG_ID, SagaPanelApi } from '../saga-panel/contract.js';

// Lit implementation of the panel contract. Values are rendered only through Lit text
// bindings, so supplied strings stay inert text (never parsed as markup or Markdown).
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

const SagaPanel: LitComponentApi = {
  ...SagaPanelApi,
  tagName: 'saga-panel',
  element: SagaPanelElement,
};

/** Application-owned catalog: one component, no functions. */
export const sagaCatalog = new Catalog<LitComponentApi>(SAGA_CATALOG_ID, 'v0.9', [SagaPanel]);

/**
 * Explicit Lit integration setup: defines the custom elements the upstream renderer needs.
 * Call once at startup; repeated calls are harmless. Nothing registers at import time.
 */
export function registerLitElements(): void {
  // `a2ui-surface` is defined as a side effect of importing upstream's A2uiSurface.
  void A2uiSurface;
  if (!customElements.get(SagaPanel.tagName)) customElements.define(SagaPanel.tagName, SagaPanelElement);
}
