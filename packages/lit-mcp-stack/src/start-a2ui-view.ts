import type { LitComponentApi } from '@a2ui/lit/v0_9';
import type { Catalog } from '@a2ui/web_core/v0_9';
import type { ServerTransport } from '@saga-a2ui/core/actions';
import { type SurfaceLayout } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import {
  createA2uiAppElement,
  defineElements,
  type A2uiActions,
  type A2uiUpdateResult,
} from '@saga-a2ui/lit';
import type { Conversation } from '@saga-a2ui/core/conversation';
import type { HostLinks } from '@saga-a2ui/core/host-links';
import {
  conversationFromApp,
  hostLinksFromApp,
  type HostContext,
  type ToolInput,
  type ToolResult,
} from '@saga-a2ui/mcp/view';
import {
  applicationFailureOf,
  callApplication,
  failApplication,
} from './application-call.js';
import { claimContainer } from './container-claim.js';
import {
  connectToHost,
  type HostConnection,
  type HostIdentity,
  type ServerReply,
} from './host-connection.js';
import {
  runView,
  viewThatNeverStarted,
  type RunningView,
} from './running-view.js';
import type { ErrorPhase } from './start-failure.js';

/** What the application may use of the host while it states its actions. */
export interface ViewHost {
  /** The way an action reaches the application’s server, through the host. */
  readonly server: ServerTransport<ServerReply>;
  /** The one way to ask the host to open a link, for an optional card the application's catalog includes. Ends with the view. */
  readonly links: HostLinks;
  /** The one way to add a message to the conversation, optionally with context for the assistant. Ends with the view. */
  readonly conversation: Conversation;
}

/** The typed way to change what a running view shows. */
export interface BoundSurface<TData> {
  /**
   * Validates `data` against the layout and applies it in place: no remount, so the mounted
   * controls, their action bindings and focus survive. Never throws. A rejection (data the layout’s
   * schema refuses, or a view that has ended) returns the failure and changes nothing.
   */
  update(data: TData): A2uiUpdateResult;
}

export interface StartA2uiViewOptions<TData> {
  /** The element the view is rendered into. Must be attached to the document and free. */
  readonly container: Element;
  /** The one surface the view presents: its identity, its data type and how it opens. */
  readonly layout: SurfaceLayout<TData>;
  /**
   * The application's own catalog. The stack defines each component's custom element (repeating
   * that for a catalog that is already defined is harmless).
   */
  readonly catalog: Catalog<LitComponentApi>;
  /**
   * Optional. The application’s action setup (`createLitActions`), or a function that makes it
   * from the host when the setup needs the server (`host.server`).
   */
  readonly actions?:
    A2uiActions | ((host: ViewHost) => A2uiActions | undefined);
  /** Optional. Work the view needs before it shows anything; `signal` aborts when the view ends. */
  readonly readyWhen?: (signal: AbortSignal) => Promise<void>;
  /** `own`: the view tells the host its size. `host` (the default): the bridge reports it. */
  readonly sizing?: 'own' | 'host';
  /** Optional. The negotiated host context and the host’s name, before the first result and on change. */
  readonly hostContext?: (
    context: HostContext | undefined,
    hostName: string | undefined,
  ) => void;
  /**
   * Optional. The tool call that is starting, with its own arguments: the only place the host
   * announces them. Delivered once the view is ready, before the held result. It is not that
   * call's response and authenticates nothing.
   */
  readonly onToolInput?: (input: ToolInput) => void;
  /** Each delivered result, once the view is ready. Update the surface through `view.surface`. */
  readonly onToolResult: (
    result: ToolResult,
    view: RunningA2uiView<TData>,
  ) => void;
  /**
   * Optional. Called once, whichever way the view ends (host teardown request, `dispose()`,
   * `pagehide` or a startup failure), after the surface has been retired and before the connection
   * ends. For an application that holds something outside the page's own rendering. It must
   * tolerate being called on a view that never showed anything; a throw is reported and never
   * skips the connection's disposal.
   */
  readonly onTeardown?: () => void;
  /** Optional. Receives a throw from a callback after the view was ready. Defaults to `console.error`. */
  readonly onError?: (error: unknown, phase: ErrorPhase) => void;
  /** Optional. Who the host sees. Defaults to the layout’s surface id at version `0.0.0`. */
  readonly identity?: HostIdentity;
}

/** The running view of an own-catalog application, and the typed way to update what it shows. */
export interface RunningA2uiView<TData> extends RunningView {
  readonly surface: BoundSurface<TData>;
}

/** Each view is its own custom element, so each needs a tag of its own. */
let views = 0;

/**
 * Starts an own-catalog view in `options.container` and returns it at once. The view connects to
 * the MCP Apps host, holds results that arrive before it is ready, presents the layout over the
 * catalog and gives each result to `onToolResult` with the bound surface to update. Throws
 * `StartError` (`container-missing`, `container-busy`) before connecting to anything.
 * An application callback that throws while the view is being set up (the `actions` factory) does not
 * throw out of `start`: the stack takes back what it made, frees the container and returns a
 * view whose `ready` rejects with `StartFailure` of kind `application`. Imports
 * nothing from `@saga-a2ui/components`.
 */
export function startA2uiView<TData>(
  options: StartA2uiViewOptions<TData>,
): RunningA2uiView<TData> {
  return startA2uiViewOn(
    () =>
      connectToHost(
        options.identity ?? {
          name: options.layout.surfaceId,
          version: '0.0.0',
        },
        options.sizing ?? 'host',
      ),
    options,
  );
}

/** {@link startA2uiView} over a connection the caller supplies: the seam the stack’s own tests use. */
export function startA2uiViewOn<TData>(
  connect: () => HostConnection,
  options: StartA2uiViewOptions<TData>,
): RunningA2uiView<TData> {
  const claim = claimContainer(options.container);
  let element: Element | undefined;
  try {
    const connection = connect();
    const { app } = connection;
    const lifetime = new AbortController();
    const { actions: makeActions } = options;
    const actions =
      typeof makeActions === 'function'
        ? callApplication(() =>
            makeActions({
              server: {
                callServerTool: (request, requestOptions) =>
                  app.callServerTool(request, requestOptions),
              },
              links: hostLinksFromApp(app, lifetime.signal),
              conversation: conversationFromApp(app, lifetime.signal),
            }),
          )
        : makeActions;

    // The app element presents the surface, and so starts the actions, as it connects. A setup
    // that throws there is swallowed into the element's safe fallback after the application's sink
    // heard it; the stack notes it here, so the start fails as `application` instead of reporting
    // a view that shows nothing. Only the first presentation, made as the element connects, counts.
    let connecting = true;
    let setupFailure: { readonly cause: unknown } | undefined;
    const watched: A2uiActions | undefined =
      actions === undefined
        ? undefined
        : {
            begin(mount) {
              try {
                return actions.begin(mount);
              } catch (error) {
                if (connecting) setupFailure ??= { cause: error };
                throw error;
              }
            },
          };

    defineElements([...options.catalog.components.values()]);
    const AppElement = createA2uiAppElement({
      catalog: options.catalog,
      layout: options.layout,
      ...(watched === undefined ? {} : { actions: watched }),
    });
    views += 1;
    customElements.define(`saga-a2ui-view-${views}`, AppElement);
    const shown = new AppElement();
    element = shown;
    try {
      claim.container.append(shown);
    } finally {
      connecting = false;
    }
    if (setupFailure !== undefined) failApplication(setupFailure.cause);

    const surface: BoundSurface<TData> = {
      update: (data) => shown.updateData(data),
    };
    const remove = (): void => shown.remove();

    const running = runView({
      connection,
      lifetime,
      releaseContainer: claim.release,
      sizing: options.sizing ?? 'host',
      ...(options.readyWhen === undefined
        ? {}
        : { readyWhen: options.readyWhen }),
      ...(options.hostContext === undefined
        ? {}
        : { hostContext: options.hostContext }),
      onToolResult: (result) => options.onToolResult(result, view),
      ...(options.onToolInput === undefined
        ? {}
        : { onToolInput: options.onToolInput }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      retire() {
        try {
          remove();
        } finally {
          options.onTeardown?.();
        }
      },
      unmount: remove,
    });
    const view: RunningA2uiView<TData> = { ...running, surface };
    return view;
  } catch (error) {
    element?.remove();
    claim.release();
    const failed = applicationFailureOf(error);
    if (failed === undefined) throw error;
    // The application's own callback threw before a view existed: nothing connected, so what was
    // made is gone and the view ends as it would for any other startup failure, with `onTeardown`
    // told once. `ready` carries the failure; the container is free for another start.
    try {
      options.onTeardown?.();
    } catch (teardownError) {
      try {
        (options.onError ?? ((e) => console.error(e)))(
          teardownError,
          'teardown',
        );
      } catch {
        // A reporter that throws must not turn a typed startup failure into a throw.
      }
    }
    return {
      ...viewThatNeverStarted(failed.cause),
      surface: {
        update: () => ({
          ok: false,
          failure: { kind: 'rejected', message: 'The app is not connected.' },
        }),
      },
    };
  }
}
