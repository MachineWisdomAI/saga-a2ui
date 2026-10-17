import { A2uiLitElement, A2uiSurface, type LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { html, nothing } from 'lit';
import { SAGA_CATALOG_ID, SagaPanelApi } from '../saga-panel/contract.js';
import { SagaDescriptionElement } from './description.js';

// Lit implementation of the panel contract. The title is a Lit text binding. The description is
// handed to `saga-description`, which interprets it as restricted Markdown under the enclosing
// view's trusted content policy; supplied strings are never parsed as markup.
export class SagaPanelElement extends A2uiLitElement<typeof SagaPanelApi> {
  protected readonly api = SagaPanelApi;

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const title = String(props.title ?? '');
    const description = props.description === undefined ? '' : String(props.description);
    return html`<section data-testid="panel">
      <h2 data-testid="panel-title">${title}</h2>
      ${description
        ? html`<div data-testid="panel-description"><saga-description .source=${description}></saga-description></div>`
        : nothing}
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
  if (!customElements.get('saga-description')) customElements.define('saga-description', SagaDescriptionElement);
  if (!customElements.get(SagaPanel.tagName)) customElements.define(SagaPanel.tagName, SagaPanelElement);
}
