import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { App } from '@modelcontextprotocol/ext-apps';
import type { InstanceView } from '@saga-a2ui/core/actions';
import {
  a2uiV0_9Decoder,
  createMessageSession,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import {
  ActionButton,
  InstanceHostProvider,
  useActionSetup,
} from '@saga-a2ui/react/actions';
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createNotesController } from './notes-controller.js';
import { VIEW_TEXT } from './notes-contract.js';
import { notesReactEntries } from './notes-react-catalog.js';
import {
  CATALOG_ID,
  SURFACE_ID,
  notesSurface,
  ownBody,
} from './notes-surface.js';

// The React composition of the notes view: the same application, contract, actions, controller and
// server as the Lit consumers, with a React root over the published `@a2ui/react` surface. The
// application owns one provider per rendered surface; unmounting that root is the explicit
// teardown of every instance and binding beneath it. The page it builds is served by
// server/notes-server.ts as the MCP App view of `list_notes`.

/** Renders nothing and runs the application's setup under the provider. */
function Setup(props: { readonly setup: (view: InstanceView) => void }): null {
  useActionSetup(props.setup);
  return null;
}

/**
 * A setup that throws is reported to the provider's sink and then propagates; this boundary is the
 * React counterpart of the Lit app element's safe fallback. The status line already says why, so
 * nothing is rendered in its place and nothing stays bound.
 */
class SetupFailure extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export async function startNotesReactView(): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('The page has no #root element.');

  const app = new App({ name: 'pack1-notes-react-view', version: '0.0.0' });
  const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', [
    ...notesReactEntries,
  ]);
  const session = createMessageSession({
    catalogs: [catalog],
    decoder: a2uiV0_9Decoder,
  });
  let surface: SurfaceModel<ReactCatalogComponent> | undefined;
  session.onSurfaceCreated((created) => {
    surface = created;
  });
  const opened = session.ingest(notesSurface(ownBody));
  if (!opened.ok || surface === undefined)
    throw new Error('The notes surface was not accepted.');

  const root = createRoot(container);
  let live = true;
  const controller = createNotesController(app, {
    ingest: (messages) => {
      if (live) session.ingest(messages);
    },
    remove: () => {
      if (!live) return;
      live = false;
      // Unmounting retires every instance and disposes its bindings synchronously; the session is
      // released afterwards, so nothing can be delivered to a surface that is gone.
      root.unmount();
      session.dispose();
    },
  });
  const { actions } = controller;

  // The same two definitions are bound to every rendered row, directly, through each instance's
  // own handle. `setup` has a stable identity: a new function would end the registration and start another.
  const setup = (view: InstanceView): void => {
    view.watchById(
      'row-archive',
      ActionButton,
      (handle) =>
        void handle.bindAction('activate', actions.archiveNote, {
          subject: () => handle.read('id'),
        }),
    );
    view.watchById(
      'row-read',
      ActionButton,
      (handle) => void handle.bindAction('activate', actions.markRead),
    );
  };

  root.render(
    <StrictMode>
      <InstanceHostProvider
        onSetupError={() => controller.say(VIEW_TEXT.problem)}
      >
        <SetupFailure>
          <Setup setup={setup} />
          <A2uiSurface surface={surface} />
        </SetupFailure>
      </InstanceHostProvider>
    </StrictMode>,
  );

  await controller.connect();
}
