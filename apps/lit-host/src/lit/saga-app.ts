import { createA2uiAppElement, type A2uiAppDependencies } from '@saga-a2ui/lit';
import type { IngestResult } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { html } from 'lit';
import {
  provideContentView,
  type ContentView,
} from '@saga-a2ui/lit/faithful-card';

declare global {
  interface Window {
    /**
     * Demo and browser-test entry point: feeds unchecked input to the mounted app's session.
     * Present only while a `saga-app` is connected; removed on disconnect.
     */
    sagaSend?: (input: unknown) => IngestResult;
  }
}

export interface SagaAppDependencies<TData> extends A2uiAppDependencies<TData> {
  /** This view's immutable content policy, host link callback and enforcement result. */
  readonly content: ContentView;
}

/**
 * The application's `saga-app` element: `@saga-a2ui/lit` presents the surface; this adds what
 * belongs to the application. That is the heading, this view's content policy for the
 * descriptions inside it, and the demo `window.sagaSend` hook, which relays protocol messages the
 * host and its browser tests author (the element's protected `ingest`). The composition root
 * (main.ts) chooses the session, layout and content policy.
 */
export function createSagaAppElement<TData>(deps: SagaAppDependencies<TData>) {
  class SagaApp extends createA2uiAppElement(deps) {
    private readonly send = (input: unknown): IngestResult =>
      this.ingest(input);

    // Answers cards inside this view with this view's own content settings.
    private endContentView?: () => void;

    connectedCallback() {
      this.endContentView = provideContentView(this, deps.content);
      super.connectedCallback();
      window.sagaSend = this.send;
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.endContentView?.();
      this.endContentView = undefined;
      if (window.sagaSend === this.send) delete window.sagaSend;
    }

    render() {
      return html`<h1>SAGA A2UI</h1>
        ${super.render()}`;
    }
  }
  return SagaApp;
}
