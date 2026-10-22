import {
  A2uiLitElement,
  actionButtonEntry,
  Catalog,
  CommonSchemas,
  defineSurface,
  startA2uiView,
  z,
  type LitComponentApi,
} from '@saga-a2ui/lit-mcp-stack';
import { html, nothing } from 'lit';
import { runProbe } from './probe.js';

// The Lit stack's probe: a one-button surface over an own catalog whose label the application updates.
const LineApi = {
  name: 'Line',
  schema: z.object({ text: CommonSchemas.DynamicString }).strict(),
};
class LineElement extends A2uiLitElement<typeof LineApi> {
  protected readonly api = LineApi;
  render() {
    const props = this.controller?.props;
    return props === undefined
      ? nothing
      : html`<span data-testid="line">${String(props.text ?? '')}</span>`;
  }
}
const Line: LitComponentApi = {
  ...LineApi,
  tagName: 'view-stack-probe-line',
  element: LineElement,
};

const CATALOG_ID = 'https://stack.example/catalogs/probe/v1';
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [
  Line,
  actionButtonEntry,
]);
const layout = defineSurface({
  surfaceId: 'probe',
  catalogId: CATALOG_ID,
  data: z.object({ label: z.string() }),
  initial: { label: 'Waiting' },
  root: { component: 'ActionButton', bind: {}, props: { child: 'label' } },
  components: [{ id: 'label', component: 'Line', text: { path: '/label' } }],
});

runProbe({
  start: (options) => startA2uiView({ ...options, layout, catalog }),
});
