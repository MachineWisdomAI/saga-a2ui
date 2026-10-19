import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { TextApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { a2uiV0_9Decoder, createMessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { ActionButtonEntry, InstanceHostProvider } from '@saga-a2ui/react/actions';
import { createRoot } from 'react-dom/client';

// An application with its own catalog and the opt-in action control, and nothing else from SAGA. It is
// copied out of the repository and built against the packed SDK artifacts (see
// scripts/react-card-consumer.test.ts), so it must use only the public exports. It lists no
// FaithfulCard: the built graph must hold no card, no components package and no Markdown parser.

const Note = createComponentImplementation(TextApi, ({ props }) => <p data-testid="note">{String(props.text ?? '')}</p>);
const catalog = new Catalog<ReactCatalogComponent>('https://consumer.test/catalogs/react-notes/v1', 'v0.9', [Note, ActionButtonEntry]);

const session = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
let surface: SurfaceModel<ReactCatalogComponent> | undefined;
session.onSurfaceCreated((created) => {
  surface = created;
});
session.ingest([
  { version: 'v0.9', createSurface: { surfaceId: 'notes', catalogId: catalog.id } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'notes',
      components: [
        { id: 'root', component: 'ActionButton', child: 'label' },
        { id: 'label', component: 'Text', text: 'Open' },
      ],
    },
  },
]);

const container = document.getElementById('root');
if (container === null || surface === undefined) throw new Error('the consumer has nothing to render');
createRoot(container).render(
  <InstanceHostProvider onSetupError={(error) => console.error(error)}>
    <A2uiSurface surface={surface} />
  </InstanceHostProvider>,
);
