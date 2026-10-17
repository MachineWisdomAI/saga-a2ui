import { A2uiSurface, type LitComponentApi } from '@a2ui/lit/v0_9';
import type { Subscription, SurfaceModel } from '@a2ui/web_core/v0_9';
import type { IngestResult, MessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { LitElement, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';

export type A2uiSession = MessageSession<LitComponentApi>;

export interface A2uiAppDependencies {
  /** Creates a fresh session on each connect. The element owns and disposes what it creates. */
  readonly createSession: () => A2uiSession;
  /** Unchecked input applied to each new session (the initial surface). */
  readonly initialInput: unknown;
  /** The one surface this element presents. */
  readonly surfaceId: string;
}

// `a2ui-surface` is defined by importing upstream's A2uiSurface. This package renders it, so this
// is the one place that import is relied on.
void A2uiSurface;

/**
 * Builds a custom-element class that presents one A2UI surface from a core message session.
 * The application chooses the session (its catalog and decoder) and defines the tag; subclass
 * the result to add application chrome or wiring.
 *
 * Lifecycle: connecting creates a session, subscribes, and applies the initial input.
 * Disconnecting unsubscribes and disposes the session, so a reconnected element starts fresh
 * and nothing from the retired session can reach the page. The element only presents results:
 * decoding and validation live in the session.
 *
 * Failure: input the session rejects clears the surface and shows a safe fallback. Messages
 * applied before the rejection stay applied in the session (there is no atomic rollback); the
 * next input the session accepts clears the fallback and shows the surface again.
 *
 * Catalog components are custom elements the application defines with `defineElements`.
 */
export function createA2uiAppElement(deps: A2uiAppDependencies) {
  class A2uiApp extends LitElement {
    @state() private surface?: SurfaceModel<LitComponentApi>;
    @state() private failure?: string;

    private session?: A2uiSession;
    private subscriptions: Subscription[] = [];

    /** Applies unchecked input to the current session. Never throws for bad input. */
    ingest(input: unknown): IngestResult {
      const result = this.session?.ingest(input) ?? {
        ok: false as const,
        failure: { kind: 'rejected' as const, message: 'The app is not connected.' },
      };
      this.failure = result.ok ? undefined : result.failure.message;
      return result;
    }

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
      this.ingest(deps.initialInput);
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      for (const subscription of this.subscriptions) subscription.unsubscribe();
      this.subscriptions = [];
      this.session?.dispose();
      this.session = undefined;
      this.surface = undefined;
      this.failure = undefined;
    }

    render() {
      // Failure text is only ever a Lit text binding, so it stays inert.
      if (this.failure !== undefined) {
        return html`<div role="alert" data-testid="failure">
          Could not render this content: <span data-testid="failure-detail">${this.failure}</span>
        </div>`;
      }
      return this.surface ? html`<a2ui-surface .surface=${this.surface}></a2ui-surface>` : nothing;
    }
  }
  return A2uiApp;
}
