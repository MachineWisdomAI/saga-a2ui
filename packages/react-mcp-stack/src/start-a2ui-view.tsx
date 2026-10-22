import {
  openSurface,
  Surface,
  type BoundSurface,
  type Catalog,
  type ReactCatalogComponent,
} from '@saga-a2ui/react/a2ui';
import { ActionsScope, type ReactActions } from '@saga-a2ui/react/actions';
import type { ServerTransport } from '@saga-a2ui/core/actions';
import type { SurfaceLayout } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import type { HostContext, ToolResult } from '@saga-a2ui/mcp/view';
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { claimContainer } from './container-claim.js';
import {
  connectToHost,
  type HostConnection,
  type HostIdentity,
  type ServerReply,
} from './host-connection.js';
import { runView, type RunningView } from './running-view.js';
import type { ErrorPhase } from './start-failure.js';

/** What the application may use of the host while it states its actions. */
export interface ViewHost {
  /** The way an action reaches the application’s server, through the host. */
  readonly server: ServerTransport<ServerReply>;
}

export interface StartA2uiViewOptions<TData> {
  /** The element the view is rendered into. Must be attached to the document and free. */
  readonly container: Element;
  /** The one surface the view presents: its identity, its data type and how it opens. */
  readonly layout: SurfaceLayout<TData>;
  /** The application's own catalog, which must hold every component the layout names. */
  readonly catalog: Catalog<ReactCatalogComponent>;
  /**
   * Optional. The application’s action setup (`createReactActions`), or a function that makes it
   * from the host when the setup needs the server (`host.server`).
   */
  readonly actions?: ReactActions | ((host: ViewHost) => ReactActions);
  /** Optional. Work the view needs before it shows anything; `signal` aborts when the view ends. */
  readonly readyWhen?: (signal: AbortSignal) => Promise<void>;
  /** `own`: the view tells the host its size. `host` (the default): the bridge reports it. */
  readonly sizing?: 'own' | 'host';
  /** Optional. The negotiated host context and the host’s name, before the first result and on change. */
  readonly hostContext?: (
    context: HostContext | undefined,
    hostName: string | undefined,
  ) => void;
  /** Each delivered result, once the view is ready. Update the surface through `view.surface`. */
  readonly onToolResult: (
    result: ToolResult,
    view: RunningA2uiView<TData>,
  ) => void;
  /** Optional. Receives a throw from a callback after the view was ready. Defaults to `console.error`. */
  readonly onError?: (error: unknown, phase: ErrorPhase) => void;
  /** Optional. Who the host sees. Defaults to the layout’s surface id at version `0.0.0`. */
  readonly identity?: HostIdentity;
}

/** The running view of an own-catalog application, and the typed way to update what it shows. */
export interface RunningA2uiView<TData> extends RunningView {
  readonly surface: BoundSurface<TData>;
}

/**
 * Starts an own-catalog view in `options.container` and returns it at once. The view connects to
 * the MCP Apps host, holds results that arrive before it is ready, renders the layout over the
 * catalog and gives each result to `onToolResult` with the bound surface to update. Throws
 * `StartError` (`container-missing`, `container-busy`) before connecting to anything. Imports
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
  let surface: BoundSurface<TData> | undefined;
  let root: Root | undefined;
  try {
    // The layout is checked against the catalog before anything connects.
    surface = openSurface(options.layout, options.catalog);
    const opened = surface;
    const connection = connect();
    const { app } = connection;
    const actions =
      typeof options.actions === 'function'
        ? options.actions({
            server: {
              callServerTool: (request, requestOptions) =>
                app.callServerTool(request, requestOptions),
            },
          })
        : options.actions;

    const mounted: Root = (root = createRoot(claim.container));
    const shown: ReactNode = createElement(Surface, { of: opened.handle });
    mounted.render(
      actions === undefined
        ? shown
        : createElement(ActionsScope, { actions, children: shown }),
    );

    const running = runView({
      connection,
      lifetime: new AbortController(),
      releaseContainer: claim.release,
      sizing: options.sizing ?? 'host',
      ...(options.readyWhen === undefined
        ? {}
        : { readyWhen: options.readyWhen }),
      ...(options.hostContext === undefined
        ? {}
        : { hostContext: options.hostContext }),
      onToolResult: (result) => options.onToolResult(result, view),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      retire: () => opened.dispose(),
      unmount: () => mounted.unmount(),
    });
    const view: RunningA2uiView<TData> = { ...running, surface: opened };
    return view;
  } catch (error) {
    root?.unmount();
    surface?.dispose();
    claim.release();
    throw error;
  }
}
