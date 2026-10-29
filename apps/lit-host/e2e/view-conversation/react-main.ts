import {
  ActionButtonEntry,
  Catalog,
  CommonSchemas,
  createComponentImplementation,
  defineSurface,
  startA2uiView,
  z,
  type ReactCatalogComponent,
} from '@saga-a2ui/react-mcp-stack';
import { createElement } from 'react';
import { runConversationProbe } from './probe.js';

// The React stack's probe: the same one-line surface over an own catalog.
const LineApi = {
  name: 'Line',
  schema: z.object({ text: CommonSchemas.DynamicString }).strict(),
};
const Line = createComponentImplementation(LineApi, ({ props }) =>
  createElement('span', { 'data-testid': 'line' }, String(props.text ?? '')),
);

const CATALOG_ID = 'https://stack.example/catalogs/conversation-probe/v1';
const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', [
  Line,
  ActionButtonEntry,
]);
const layout = defineSurface({
  surfaceId: 'conversation-probe',
  catalogId: CATALOG_ID,
  data: z.object({ label: z.string() }),
  initial: { label: 'Waiting' },
  root: { component: 'ActionButton', bind: {}, props: { child: 'label' } },
  components: [{ id: 'label', component: 'Line', text: { path: '/label' } }],
});

runConversationProbe({
  start: (options) =>
    startA2uiView({
      ...options,
      layout,
      catalog,
      onToolResult: () => undefined,
    }),
});
