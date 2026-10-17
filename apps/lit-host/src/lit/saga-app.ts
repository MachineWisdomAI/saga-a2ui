import { createA2uiAppElement, type A2uiAppDependencies } from '@saga-a2ui/lit';
import type { IngestResult } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { html } from 'lit';
import { CONTENT_VIEW_REQUEST, ContentViewRequest, type ContentView } from './content-view.js';

declare global {
  interface Window {
    /**
     * Demo and browser-test entry point: feeds unchecked input to the mounted app's session.
     * Present only while a `saga-app` is connected; removed on disconnect.
     */
    sagaSend?: (input: unknown) => IngestResult;
  }
}

export interface SagaAppDependencies extends A2uiAppDependencies {
  /** This view's immutable content policy, host link callback and enforcement result. */
  readonly content: ContentView;
}

/**
 * The application's `saga-app` element: `@saga-a2ui/lit` presents the surface; this adds what
 * belongs to the application. That is the heading, this view's content policy for the
 * descriptions inside it, and the demo `window.sagaSend` hook. The composition root (main.ts)
 * chooses the session, fixture and surface.
 */
export function createSagaAppElement(deps: SagaAppDependencies) {
  class SagaApp extends createA2uiAppElement(deps) {
    private readonly send = (input: unknown): IngestResult => this.ingest(input);

    // Answers descriptions inside this view with this view's own content settings.
    private readonly answerContentRequest = (event: Event) => {
      if (event instanceof ContentViewRequest) event.provide(deps.content);
    };

    connectedCallback() {
      this.addEventListener(CONTENT_VIEW_REQUEST, this.answerContentRequest);
      super.connectedCallback();
      window.sagaSend = this.send;
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener(CONTENT_VIEW_REQUEST, this.answerContentRequest);
      if (window.sagaSend === this.send) delete window.sagaSend;
    }

    render() {
      return html`<h1>SAGA A2UI</h1>
        ${super.render()}`;
    }
  }
  return SagaApp;
}
