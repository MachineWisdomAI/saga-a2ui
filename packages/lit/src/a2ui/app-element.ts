import { A2uiSurface, type LitComponentApi } from '@a2ui/lit/v0_9';
import type { Subscription, SurfaceModel } from '@a2ui/web_core/v0_9';
import type { IngestResult, MessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { LitElement, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';

export type A2uiSession = MessageSession<LitComponentApi>;

/** One presentation of a surface by an app element: what an optional integration needs to know. */
export interface A2uiSurfaceMount {
  /** The app element presenting the surface. */
  readonly owner: Element;
  readonly surface: SurfaceModel<LitComponentApi>;
  /** The one `<a2ui-surface>` the owner rendered for this presentation, once it has rendered. */
  readonly mount: () => Element | undefined;
}

/**
 * An optional integration that owns per-presentation state, such as the action host of
 * `@saga-a2ui/lit/actions`. The app element starts it for each surface it presents and ends it when
 * that presentation ends. This package defines only the seam, so an application that supplies
 * none carries none of the integration's code.
 */
export interface A2uiActions {
  /**
   * Starts the integration for one presentation, before the surface renders, and returns the
   * function that ends it. Throwing means the integration could not start: the element then
   * shows its safe fallback and does not render the surface.
   */
  begin(mount: A2uiSurfaceMount): () => void;
}

export interface A2uiAppDependencies {
  /** Creates a fresh session on each connect. The element owns and disposes what it creates. */
  readonly createSession: () => A2uiSession;
  /** Unchecked input applied to each new session (the initial surface). */
  readonly initialInput: unknown;
  /** The one surface this element presents. */
  readonly surfaceId: string;
  /** Optional. Started per presented surface and ended with it, on every exit. */
  readonly actions?: A2uiActions;
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
 * Actions: when `actions` is supplied it starts before each surface is first rendered and ends
 * when that surface is deleted, replaced, or the element disconnects (before the session is
 * disposed). If it cannot start, the surface is not rendered and a safe fallback shows until the
 * surface is created again.
 *
 * Catalog components are custom elements the application defines with `defineElements`.
 */
export function createA2uiAppElement(deps: A2uiAppDependencies) {
  class A2uiApp extends LitElement {
    @state() private surface?: SurfaceModel<LitComponentApi>;
    @state() private failure?: string;
    @state() private presentationFailure?: string;

    private session?: A2uiSession;
    private subscriptions: Subscription[] = [];
    private endPresentation?: () => void;
    private readonly mount = createRef<Element>();

    /** Applies unchecked input to the current session. Never throws for bad input. */
    ingest(input: unknown): IngestResult {
      const result = this.session?.ingest(input) ?? {
        ok: false as const,
        failure: { kind: 'rejected' as const, message: 'The app is not connected.' },
      };
      this.failure = result.ok ? undefined : result.failure.message;
      return result;
    }

    private present(surface: SurfaceModel<LitComponentApi>) {
      this.closePresentation();
      this.presentationFailure = undefined;
      if (deps.actions) {
        try {
          this.endPresentation = deps.actions.begin({
            owner: this,
            surface,
            mount: () => this.mount.value,
          });
        } catch {
          this.presentationFailure = 'The actions for this content could not be attached.';
          return;
        }
      }
      // Lit renders the surface later, so any setup the integration ran is in place by then.
      this.surface = surface;
    }

    private closePresentation() {
      const end = this.endPresentation;
      this.endPresentation = undefined;
      end?.();
    }

    connectedCallback() {
      super.connectedCallback();
      const session = deps.createSession();
      this.session = session;
      this.subscriptions = [
        session.onSurfaceCreated((surface) => {
          if (surface.id === deps.surfaceId) this.present(surface);
        }),
        session.onSurfaceDeleted((id) => {
          if (id !== deps.surfaceId) return;
          this.closePresentation();
          this.presentationFailure = undefined;
          this.surface = undefined;
        }),
      ];
      this.ingest(deps.initialInput);
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      for (const subscription of this.subscriptions) subscription.unsubscribe();
      this.subscriptions = [];
      // The presentation ends before the session it depends on is disposed.
      this.closePresentation();
      this.session?.dispose();
      this.session = undefined;
      this.surface = undefined;
      this.failure = undefined;
      this.presentationFailure = undefined;
    }

    render() {
      // Failure text is only ever a Lit text binding, so it stays inert.
      const failure = this.failure ?? this.presentationFailure;
      if (failure !== undefined) {
        return html`<div role="alert" data-testid="failure">
          Could not render this content: <span data-testid="failure-detail">${failure}</span>
        </div>`;
      }
      return this.surface
        ? html`<a2ui-surface ${ref(this.mount)} .surface=${this.surface}></a2ui-surface>`
        : nothing;
    }
  }
  return A2uiApp;
}
