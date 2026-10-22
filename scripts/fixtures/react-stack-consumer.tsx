import {
  createComponentImplementation,
  type ReactCatalogComponent,
} from '@a2ui/react/v0_9';
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
import {
  ActionButton,
  ActionButtonEntry,
  createReactActions,
  defineSurface,
  startA2uiView,
  StartFailure,
  z,
  type RunningA2uiView,
  type RunningView,
} from '@saga-a2ui/react-mcp-stack';
import {
  FaithfulCardApp,
  startFaithfulCardApp,
  type CardChromeProps,
  type CardContent,
} from '@saga-a2ui/react-mcp-stack/faithful-card';

// The one-stack install, as an application writes it: this file imports the React stack (both
// entries) and the application's own catalog authoring, and nothing else from the SDK. The
// stack's own dependencies (renderer adapter, MCP and core packages, components, ext-apps) and the
// React peers are installed beneath the stack, never named by the application. Real types only:
// no casts, aliases or skipLibCheck.

// The own-catalog entry.
const CATALOG_ID = 'urn:test:stack-own';
const LineApi = {
  name: 'Line',
  schema: z.object({ text: CommonSchemas.DynamicString }).strict(),
};
const Line: ReactCatalogComponent = createComponentImplementation(
  LineApi,
  ({ props }) => <span>{String(props.text ?? '')}</span>,
);
const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', [
  Line,
  ActionButtonEntry,
]);
const layout = defineSurface({
  surfaceId: 'own',
  catalogId: CATALOG_ID,
  data: z.object({ label: z.string() }),
  initial: { label: 'Waiting' },
  root: { component: 'ActionButton', bind: {}, props: { child: 'label' } },
  components: [{ id: 'label', component: 'Line', text: { path: '/label' } }],
});
export function startOwn(container: Element): RunningA2uiView<{
  label: string;
}> {
  const view = startA2uiView({
    container,
    layout,
    catalog,
    actions: () =>
      createReactActions({
        attach: (view) => {
          view.watchById(
            'row',
            ActionButton,
            (handle) => void handle.read('id'),
          );
        },
        onSetupError: () => undefined,
      }),
    onToolResult: (result, running) => {
      const label = (result.structuredContent as { label?: string } | undefined)
        ?.label;
      if (label !== undefined) void running.surface.update({ label });
    },
  });
  return view;
}

// The card entry.
const definition = FaithfulCardApp.define({
  name: 'stack-card',
  version: '1.0.0',
})
  .reader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 })
  .policy('document')
  .result((value): CardContent | undefined =>
    typeof value === 'string' ? { markdown: value } : undefined,
  )
  .texts({
    waiting: 'Waiting',
    problem: 'Problem',
    connectFailure: 'No host',
    readyFailure: 'Not ready',
    policyFailure: 'Bad policy',
  })
  .build();
const Chrome = ({ card, state }: CardChromeProps) => (
  <main>
    <p role="status">{state.kind === 'answer' ? 'Answer' : state.text}</p>
    {card}
  </main>
);
export async function startCard(container: Element): Promise<RunningView> {
  const view = startFaithfulCardApp(definition, {
    container,
    sizing: 'own',
    chrome: Chrome,
  });
  try {
    await view.ready;
  } catch (failure) {
    if (failure instanceof StartFailure && failure.kind === 'application')
      throw failure.cause;
  }
  return view;
}
