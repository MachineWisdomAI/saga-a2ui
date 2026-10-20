import { type ReactCatalogComponent } from '@saga-a2ui/react/a2ui';
import { Catalog, type SurfaceModel } from '@saga-a2ui/react/a2ui';
import { a2uiV0_9Decoder, createMessageSession, type IngestResult, type MessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { faithfulCardEntry } from '@saga-a2ui/react/faithful-card';

// The one A2UI path the application shows an answer through: its own catalog (the one optional SAGA
// component), a surface that binds the card to a data model, and the data updates that replace the
// answer. The surface starts neutral: an empty answer, no canned text. Every result thereafter
// replaces the whole data model, so no state survives from an earlier answer.

const CATALOG_ID = 'https://answers.example/catalogs/react-card/v1';
const SURFACE_ID = 'answer';

const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', [faithfulCardEntry]);

const surfaceMessages = [
  { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [{ id: 'root', component: 'FaithfulCard', contractVersion: { path: '/contractVersion' }, markdown: { path: '/markdown' } }],
    },
  },
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, value: { contractVersion: 1, markdown: '' } } },
];

/** The messages that replace the card's whole content with `markdown` (empty clears it). */
const answerData = (markdown: string) => [
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, value: { contractVersion: 1, markdown } } },
];

export interface AnswerSurface {
  readonly surface: SurfaceModel<ReactCatalogComponent>;
  /** Replaces the answer shown; the empty string clears it. */
  show(markdown: string): IngestResult;
}

/** Opens the answer surface from its neutral initial state. Throws if the application's own layout is not accepted. */
export function openAnswerSurface(): AnswerSurface {
  const session: MessageSession<ReactCatalogComponent> = createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });
  let surface: SurfaceModel<ReactCatalogComponent> | undefined;
  session.onSurfaceCreated((created) => {
    surface = created;
  });
  const opened = session.ingest(surfaceMessages);
  if (!opened.ok || surface === undefined) throw new Error('The answer surface was not accepted.');
  return { surface, show: (markdown) => session.ingest(answerData(markdown)) };
}
