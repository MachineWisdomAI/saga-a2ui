import { A2uiSurface, type LitComponentApi } from '@a2ui/lit/v0_9';
import type { Catalog, Subscription, SurfaceModel } from '@a2ui/web_core/v0_9';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  type IngestFailure,
  type IngestResult,
  type MessageSession,
  type SurfaceLayout,
  type SurfaceUpdateFailure,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { LitElement, html, nothing } from 'lit';
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

/** Why `updateData` changed nothing. `message` is plain text that is safe to display. */
export interface A2uiUpdateFailure {
  readonly kind: SurfaceUpdateFailure['kind'] | IngestFailure['kind'];
  readonly message: string;
}

export type A2uiUpdateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: A2uiUpdateFailure };

export interface A2uiAppDependencies<TData> {
  /**
   * The catalog the surface's components come from. The element builds a fresh session over it
   * on each connect, with the SDK's A2UI decoder, so an application never constructs one.
   */
  readonly catalog: Catalog<LitComponentApi>;
  /** The one surface this element presents: its identity, its data type and how it opens. */
  readonly layout: SurfaceLayout<TData>;
  /** Optional. Started per presented surface and ended with it, on every exit. */
  readonly actions?: A2uiActions;
  /**
   * Optional and advanced; an ordinary application leaves it out. Replaces the default session
   * on each connect, for an application that must observe or wrap the session it is given
   * `catalog`. The element owns and disposes what this returns.
   */
  readonly createSession?: (catalog: Catalog<LitComponentApi>) => A2uiSession;
}

// `a2ui-surface` is defined by importing upstream's A2uiSurface. This package renders it, so this
// is the one place that import is relied on.
void A2uiSurface;

/**
 * Builds a custom-element class that presents one A2UI surface from a core message session.
 * The application supplies the catalog and the layout and defines the tag; subclass
 * the result to add application chrome or wiring.
 *
 * Lifecycle: connecting creates a session, subscribes, and opens the layout. Disconnecting
 * unsubscribes and disposes the session, so a reconnected element starts fresh and nothing from
 * the retired session can reach the page. The element only presents results: decoding and
 * validation live in the layout and the session.
 *
 * Data: `updateData(data)` validates against the layout and applies it as an A2UI data update. It
 * changes what the mounted controls show without remounting them, so their action bindings and
 * focus survive. A rejected update (invalid data, an element that is not connected, a disposed
 * session) returns a failure and changes nothing: the surface, its data and its fallback state
 * stay as they were. The element has no notion of selection.
 *
 * Failure: a layout the session cannot open (for example a root component the catalog lacks)
 * shows a safe fallback instead of a blank surface.
 *
 * Actions: when `actions` is supplied it starts before each surface is first rendered and ends
 * when that surface is deleted, replaced, or the element disconnects (before the session is
 * disposed). If it cannot start, the surface is not rendered and a safe fallback shows until the
 * surface is created again.
 *
 * Catalog components are custom elements the application defines with `defineElements`.
 */
export function createA2uiAppElement<TData>(deps: A2uiAppDependencies<TData>) {
  class A2uiApp extends LitElement {
    // Reactive state is declared with `static properties` and `declare`, not with decorators: this
    // package ships TypeScript source that each application compiles with its own settings, and
    // decorator syntax is only valid under the settings the workspace happens to use.
    static override properties = {
      surface: { state: true },
      failure: { state: true },
      presentationFailure: { state: true },
    };
    declare private surface?: SurfaceModel<LitComponentApi>;
    declare private failure?: string;
    declare private presentationFailure?: string;

    private session?: A2uiSession;
    private subscriptions: Subscription[] = [];
    private endPresentation?: () => void;
    private readonly mount = createRef<Element>();

    /**
     * Replaces the surface's data. (Not named `update`: Lit's `ReactiveElement.update` is the
     * render lifecycle method of every element built on it.) Validated against the layout, then applied in place: no
     * remount, so the rendered controls, their action bindings and focus survive. Never throws;
     * a rejection returns a failure and leaves data, identity and any fallback unchanged.
     */
    updateData(data: TData): A2uiUpdateResult {
      const messages = deps.layout.update(data);
      if (!messages.ok) return { ok: false, failure: messages.failure };
      return (
        this.session?.ingest(messages.messages) ?? {
          ok: false,
          failure: {
            kind: 'rejected',
            message: 'The app is not connected.',
          },
        }
      );
    }

    /**
     * Applies unchecked protocol input to the current session, and shows the safe fallback when
     * the session rejects it. Not part of the application contract (use `updateData`): it is for a
     * subclass that relays protocol messages it did not author, such as a host that forwards
     * server-supplied A2UI. Never throws for bad input. Messages applied before a rejection stay
     * applied (there is no atomic rollback); the next input the session accepts clears the
     * fallback.
     */
    protected ingest(input: unknown): IngestResult {
      const result = this.session?.ingest(input) ?? {
        ok: false as const,
        failure: {
          kind: 'rejected' as const,
          message: 'The app is not connected.',
        },
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
          this.presentationFailure =
            'The actions for this content could not be attached.';
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
      const session =
        deps.createSession?.(deps.catalog) ??
        createMessageSession({
          catalogs: [deps.catalog],
          decoder: a2uiV0_9Decoder,
        });
      this.session = session;
      this.subscriptions = [
        session.onSurfaceCreated((surface) => {
          if (surface.id === deps.layout.surfaceId) this.present(surface);
        }),
        session.onSurfaceDeleted((id) => {
          if (id !== deps.layout.surfaceId) return;
          this.closePresentation();
          this.presentationFailure = undefined;
          this.surface = undefined;
        }),
      ];
      this.ingest(deps.layout.opening);
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
          Could not render this content:
          <span data-testid="failure-detail">${failure}</span>
        </div>`;
      }
      return this.surface
        ? html`<a2ui-surface
            ${ref(this.mount)}
            .surface=${this.surface}
          ></a2ui-surface>`
        : nothing;
    }
  }
  return A2uiApp;
}
