import {
  A2uiLitElement,
  Action,
  ActionButton,
  actionButtonEntry,
  basicCatalog,
  Catalog,
  CommonSchemas,
  createLitActions,
  defineSurface,
  readingProfile,
  startA2uiView,
  StartError,
  StartFailure,
  z,
  type ActionBinding,
  type ActionButtonActivation,
  type AppendResult,
  type BoundSurface,
  type Conversation,
  type ErrorPhase,
  type HostLinks,
  type LitComponentApi,
  type RunningA2uiView,
  type RunningView,
  type StartMisuse,
  type ViewHost,
} from '@saga-a2ui/lit-mcp-stack';
import {
  FaithfulCardApp,
  startFaithfulCardApp,
  type CardChromeParts,
  type CardResultOutcome,
  type CardResultReader,
  type DeliveredResult,
} from '@saga-a2ui/lit-mcp-stack/faithful-card';
import {
  createContentPolicy,
  embedContentPolicy,
} from '@saga-a2ui/lit-mcp-stack/content-policy';
import {
  attachRequestLifetime,
  createServerBudgets,
  operationViewFromHtml,
  registerProtectedOperation,
  registerPublicOperation,
  viewUriForHtml,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/lit-mcp-stack/server';
import { html, nothing } from 'lit';

// The one-stack install, as a Lit application writes it: this file imports the Lit stack (every
// entry), `lit` itself (the framework peer) and nothing else. The stack's own dependencies
// (renderer adapter, upstream renderer and schemas, MCP and core packages, components, ext-apps)
// are installed beneath the stack, never named by the application. Real types only: no casts,
// aliases or skipLibCheck.

// The own-catalog entry: a component authored against upstream's component API, layout from
// upstream's basic catalog and the stack's action control.
const CATALOG_ID = 'urn:test:lit-stack-own';
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
      : html`<span>${String(props.text ?? '')}</span>`;
  }
}
const Line: LitComponentApi = {
  ...LineApi,
  tagName: 'stack-consumer-line',
  element: LineElement,
};
const Column = basicCatalog.components.get('Column');
if (!Column) throw new Error('the basic catalog has no Column');
const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [
  Column,
  Line,
  actionButtonEntry,
]);
const layout = defineSurface({
  surfaceId: 'own',
  catalogId: CATALOG_ID,
  data: z.object({ label: z.string() }),
  initial: { label: 'Waiting' },
  root: {
    component: 'Column',
    bind: {},
    props: { children: ['label', 'go'] },
  },
  components: [
    { id: 'label', component: 'Line', text: { path: '/label' } },
    { id: 'go', component: 'ActionButton', child: 'label' },
  ],
});

// The actions an application writes: defined once from the stack's `Action`, reaching the server
// through the transport the view hands it, bound to the control the setup finds.
export function createActions(transport: ViewHost['server']) {
  const clear = Action.local<ActionButtonActivation>('clear')
    .run(() => {})
    .build();
  const archive = Action.server<ActionButtonActivation>('archive', transport)
    .run(async ({ call }) => call('archive_note', {}))
    .build();
  return { archive, clear };
}

export function startOwn(
  container: Element,
  links: (hostLinks: HostLinks) => void,
  onError: (error: unknown, phase: ErrorPhase) => void,
): RunningA2uiView<{ label: string }> | StartMisuse {
  const bindings: ActionBinding[] = [];
  try {
    return startA2uiView({
      container,
      layout,
      catalog,
      actions: (host: ViewHost) => {
        links(host.links);
        const actions = createActions(host.server);
        return createLitActions({
          attach: (view) => {
            view.watchById('go', ActionButton, (handle) => {
              bindings.push(handle.bindAction('activate', actions.clear));
            });
          },
          onSetupError: () => undefined,
        });
      },
      onToolResult: (result, running) => {
        const shown = z
          .object({ label: z.string() })
          .safeParse(result.structuredContent);
        if (shown.success) void running.surface.update(shown.data);
      },
      onError,
      onTeardown: () => {
        for (const binding of bindings.splice(0)) binding.dispose();
      },
    });
  } catch (failure) {
    if (failure instanceof StartError) return failure.code;
    throw failure;
  }
}
export const labelOf = (surface: BoundSurface<{ label: string }>) =>
  surface.update({ label: 'Done' });

// The card entry.
const defineCard = (read: CardResultReader) =>
  FaithfulCardApp.define({ name: 'stack-card', version: '1.0.0' })
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
const readWhole = (result: DeliveredResult): CardResultOutcome => {
  const text = result.content.find((block) => block.type === 'text');
  return text?.type === 'text' &&
    typeof text.text === 'string' &&
    result.structuredContent == null
    ? { kind: 'content', content: { markdown: text.text, heading: '' } }
    : { kind: 'rejected', text: 'Unsupported' };
};
const chrome = ({ card, state }: CardChromeParts) =>
  html`<main>
    <p role="status">${state.kind === 'answer' ? 'Answer' : state.text}</p>
    ${card}
  </main>`;
export async function startCard(container: Element): Promise<RunningView> {
  const view = startFaithfulCardApp(defineCard(readWhole), {
    container,
    sizing: 'host',
    chrome,
    hostContext: (context, hostName) => {
      document.documentElement.dataset.readingProfile = readingProfile(
        context,
        hostName,
      );
    },
  });
  try {
    await view.ready;
  } catch (failure) {
    if (failure instanceof StartFailure && failure.kind === 'application')
      throw failure.cause;
  }
  return view;
}

// The composition entries a server uses, all from the stack: budgets and a content-addressed view
// around a policy created and embedded through the content-policy entry. The MCP server object an
// application registers operations on is the application's own dependency and is not needed to
// compose these.
export function composeServerSide(page: string): {
  readonly view: OperationView;
  readonly operationMs: number;
  readonly uri: string;
} {
  const created = createContentPolicy({ level: 'standard', imageHosts: [] });
  if (!created.ok) throw new Error(created.failure.message);
  const served = embedContentPolicy(page, created.policy);
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
export {
  attachRequestLifetime,
  registerProtectedOperation,
  registerPublicOperation,
};
export type { RequestLifetime };

// What an action does to add a message to the conversation, from the stack alone: the context
// travels with the message and is best effort, and an application reads the result, never
// treating `appended` as the assistant having acted. Real types, no casts.
export function handOver(
  conversation: ViewHost['conversation'],
): Promise<AppendResult> {
  return conversation.appendMessage('Your move', {
    role: 'user',
    context: {
      text: 'The board',
      data: { game: { gameId: 'g1' } },
      bestEffort: true,
    },
  });
}
export function whatToTellThePerson(result: AppendResult): string | undefined {
  if (result.outcome === 'appended')
    return result.context === undefined
      ? undefined
      : `The assistant has no board (${result.context}).`;
  return `Nothing was added (${result.outcome} at ${result.stage}).`;
}
export const conversationOf = (host: ViewHost): Conversation =>
  host.conversation;
