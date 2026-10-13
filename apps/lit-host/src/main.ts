import { A2uiSurface, type LitComponentApi } from '@a2ui/lit/v0_9';
import { MessageProcessor, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sagaCatalog } from './catalog.js';
import { initialFixture, SURFACE_ID } from './fixture.js';

// Ensure the a2ui-surface custom element is defined (and not tree-shaken).
void A2uiSurface;

type Messages = Parameters<MessageProcessor['processMessages']>[0];

@customElement('saga-app')
export class SagaApp extends LitElement {
  // One processor for the lifetime of the app; later messages update the same surface.
  private readonly processor = new MessageProcessor([sagaCatalog]);

  @state() private surface?: SurfaceModel<LitComponentApi>;
  @state() private failure?: string;

  connectedCallback() {
    super.connectedCallback();
    this.processor.onSurfaceCreated((s) => {
      if (s.id === SURFACE_ID) this.surface = s as SurfaceModel<LitComponentApi>;
    });
    this.processor.onSurfaceDeleted((id) => {
      if (id === SURFACE_ID) this.surface = undefined;
    });
    this.send(initialFixture as unknown as Messages);
    // Hook for the browser test: delivers wire messages through this same processor.
    (window as unknown as { sagaSend?: (m: unknown) => string | undefined }).sagaSend = (m) =>
      this.send(m as Messages);
  }

  /** Feed A2UI messages to the processor. Returns the failure text, if any. */
  send(messages: Messages): string | undefined {
    try {
      // The processor accepts unknown component types and the renderer only logs a
      // warning, so reject them here, before anything is applied.
      for (const m of Array.isArray(messages) ? messages : [messages]) {
        const comps = (m as { updateComponents?: { components?: unknown } }).updateComponents?.components;
        if (!Array.isArray(comps)) continue;
        for (const c of comps) {
          const name = (c as { component?: unknown } | null)?.component;
          if (typeof name !== 'string' || !sagaCatalog.components.has(name)) {
            throw new Error(`Unsupported component type: ${JSON.stringify(name)}`);
          }
        }
      }
      this.processor.processMessages(messages);
      this.failure = undefined;
    } catch (e) {
      // Shown as text only; the supplied payload is never interpreted as markup.
      this.failure = e instanceof Error ? e.message : 'Unknown error';
    }
    return this.failure;
  }

  render() {
    return html`<h1>SAGA A2UI</h1>
      ${this.failure !== undefined
        ? html`<div role="alert" data-testid="failure">
            Could not render this content: <span data-testid="failure-detail">${this.failure}</span>
          </div>`
        : nothing}
      ${this.surface ? html`<a2ui-surface .surface=${this.surface}></a2ui-surface>` : nothing}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'saga-app': SagaApp;
  }
}
