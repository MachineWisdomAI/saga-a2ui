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
  readingProfile,
  startFaithfulCardApp,
  useHostLink,
  type CardChromeProps,
  type CardResultOutcome,
  type CardResultReader,
  type DeliveredResult,
} from '@saga-a2ui/react-mcp-stack/faithful-card';
import {
  createContentPolicy,
  embedContentPolicy,
} from '@saga-a2ui/react-mcp-stack/content-policy';
import {
  attachRequestLifetime,
  createServerBudgets,
  operationViewFromHtml,
  registerPublicOperation,
  viewUriForHtml,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/react-mcp-stack/server';

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
const defineCard = (read: CardResultReader) =>
  FaithfulCardApp.define({
    name: 'stack-card',
    version: '1.0.0',
  })
    .reader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 })
    .policy('document')
    .result(read)
    .texts({
      waiting: 'Waiting',
      problem: 'Problem',
      connectFailure: 'No host',
      readyFailure: 'Not ready',
      policyFailure: 'Bad policy',
    })
    .build();
const readString = (result: DeliveredResult): CardResultOutcome =>
  !result.isError && typeof result.structuredContent === 'string'
    ? { kind: 'content', content: { markdown: result.structuredContent } }
    : { kind: 'rejected' };
const definition = defineCard(readString);
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

// The composition entries, as an application's chrome and server use them, all from the stack. A
// card application reads its own whole result, content blocks and error flag included, and words
// its own rejection; the reading profile
// maps the application's tokens without a host name; the application renders a link of its own
// under the card's rules; the server composes budgets and a content-addressed view around a
// policy created and embedded through the stack's content-policy entry. Real types, no casts. The
// MCP server object an application registers operations on is the application's own dependency
// and is not needed to compose these.
const readWhole = (result: DeliveredResult): CardResultOutcome => {
  const text = result.content.find((block) => block.type === 'text');
  return text?.type === 'text' &&
    typeof text.text === 'string' &&
    result.structuredContent == null
    ? { kind: 'content', content: { markdown: text.text, heading: '' } }
    : { kind: 'rejected', text: 'Unsupported' };
};
const wholeResultDefinition = defineCard(readWhole);
const LinkedChrome = ({ card }: CardChromeProps) => {
  const link = useHostLink('https://docs.example.com/guide');
  return (
    <main>
      {card}
      <button disabled={!link.allowed} onClick={() => void link.open()}>
        {link.outcome?.message ?? 'Open the guide'}
      </button>
    </main>
  );
};
export async function startClassifiedCard(
  container: Element,
): Promise<RunningView> {
  const view = startFaithfulCardApp(wholeResultDefinition, {
    container,
    sizing: 'host',
    chrome: LinkedChrome,
    hostContext: (context, hostName) => {
      document.documentElement.dataset.readingProfile = readingProfile(
        context,
        hostName,
      );
    },
  });
  await view.ready.catch(() => undefined);
  return view;
}
export function composeServerSide(html: string): {
  readonly view: OperationView;
  readonly operationMs: number;
  readonly uri: string;
} {
  const created = createContentPolicy({ level: 'standard', imageHosts: [] });
  if (!created.ok) throw new Error(created.failure.message);
  const served = embedContentPolicy(html, created.policy);
  return {
    view: operationViewFromHtml({
      html: served,
      filename: 'answer.html',
      title: 'Answer',
      csp: { resourceDomains: [...created.policy.resource.resourceDomains] },
    }),
    operationMs: createServerBudgets({ operationMs: 2_000 }).forRoute()
      .operationMs,
    uri: viewUriForHtml(served, 'answer.html'),
  };
}
// The remaining server entry names an application's MCP server composes with its own server object.
export { attachRequestLifetime, registerPublicOperation };
export type { RequestLifetime };
