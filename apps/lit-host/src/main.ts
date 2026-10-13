import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('saga-app')
export class SagaApp extends LitElement {
  render() {
    return html`<h1>SAGA A2UI</h1>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'saga-app': SagaApp;
  }
}
