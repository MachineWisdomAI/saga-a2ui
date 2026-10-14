import type { LitComponentApi } from '@a2ui/lit/v0_9';
import type { SurfaceModel, Subscription } from '@a2ui/web_core/v0_9';
import { LitElement, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import type { IngestResult, MessageSession } from '../protocols/a2ui/v0_9/session.js';

type Session = MessageSession<LitComponentApi>;

declare global {
  interface Window {
    /**
     * Demo and browser-test entry point: feeds unchecked input to the mounted app's session.
     * Present only while a `saga-app` is connected; removed on disconnect.
     */
    sagaSend?: (input: unknown) => IngestResult;
  }
}

export interface SagaAppDependencies {
  /** Creates a fresh session on each connect. The element owns and disposes what it creates. */
  readonly createSession: () => Session;
  /** Unchecked input applied to each new session (the fixture). */
  readonly initialInput: unknown;
  readonly surfaceId: string;
}

/**
 * Builds the `saga-app` element class around explicit dependencies, so the application
 * composition root (main.ts) chooses the session, fixture and surface.
 *
 * Lifecycle: connecting creates a session, subscribes, applies the initial input and
 * publishes `window.sagaSend`. Disconnecting unsubscribes, disposes the session and removes
 * the hook (if still ours). Reconnecting starts a fresh session; nothing is carried over.
 * The view only presents results; parsing and validation live in the session.
 */
export function createSagaAppElement(deps: SagaAppDependencies): typeof LitElement {
  class SagaApp extends LitElement {
    @state() private surface?: SurfaceModel<LitComponentApi>;
    @state() private failure?: string;

    private session?: Session;
    private subscriptions: Subscription[] = [];
    private readonly send = (input: unknown): IngestResult => {
      const result = this.session?.ingest(input) ?? {
        ok: false as const,
        failure: { kind: 'rejected' as const, message: 'The app is not connected.' },
      };
      this.failure = result.ok ? undefined : result.failure.message;
      return result;
    };

    connectedCallback() {
      super.connectedCallback();
      const session = deps.createSession();
      this.session = session;
      this.subscriptions = [
        session.onSurfaceCreated((surface) => {
          if (surface.id === deps.surfaceId) this.surface = surface;
        }),
        session.onSurfaceDeleted((id) => {
          if (id === deps.surfaceId) this.surface = undefined;
        }),
      ];
      this.send(deps.initialInput);
      window.sagaSend = this.send;
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      if (window.sagaSend === this.send) delete window.sagaSend;
      for (const subscription of this.subscriptions) subscription.unsubscribe();
      this.subscriptions = [];
      this.session?.dispose();
      this.session = undefined;
      this.surface = undefined;
      this.failure = undefined;
    }

    render() {
      // Failure text is only ever a Lit text binding, so it stays inert.
      return html`<h1>SAGA A2UI</h1>
        ${this.failure !== undefined
          ? html`<div role="alert" data-testid="failure">
              Could not render this content: <span data-testid="failure-detail">${this.failure}</span>
            </div>`
          : nothing}
        ${this.surface ? html`<a2ui-surface .surface=${this.surface}></a2ui-surface>` : nothing}`;
    }
  }
  return SagaApp;
}
