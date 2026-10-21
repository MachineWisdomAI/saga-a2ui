import type { CallToolResult } from '@modelcontextprotocol/client';
import '../../../apps/lit-host/e2e/host-fixture/host.js';
import type { HostedResource } from '../../../apps/lit-host/e2e/host-fixture/host.js';

// The demonstration's stand-in for an assistant host. It does what a host does for an MCP App: read
// the resource a tool links to, mount it in a sandboxed frame under the policy the resource declares,
// deliver the tool's result, and forward the view's own server calls (with their `_meta`) using the
// credential the person chose. It is built on the same local host fixture as the repository's browser
// specifications, so it is not evidence about ChatGPT, Claude, Alexa+ or any other actual host.

interface SignInChoice {
  readonly id: string;
  readonly label: string;
  readonly token: string | null;
  readonly effect: string;
}
interface Config {
  readonly signIns: readonly SignInChoice[];
  readonly episodes: readonly { readonly id: string; readonly title: string }[];
  readonly controls: readonly string[];
  readonly imageHost: string | null;
  readonly state: Record<string, string>;
}
interface Forwarded {
  readonly status: number;
  readonly challenge: string | null;
  readonly body: { readonly result?: unknown } | null;
}
type EndpointId =
  | 'subscriptions'
  | 'playback'
  | 'episode-standard'
  | 'episode-strict'
  | 'notes';
type AppKey = 'subscriptions' | 'episode' | 'player' | 'notes';

/** The server refused the credential at HTTP, before any tool ran. */
class CredentialRefused extends Error {}

const REFUSED_NOTICE =
  'The server refused this credential, so nothing was opened. Choose another sign-in; the host log has the details.';
const FAILED_NOTICE = 'This could not be opened. The host log says why.';

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`the host page has no ${selector}`);
  return found;
}

const logList = element<HTMLOListElement>('[data-testid="host-log"]');
const notice = element<HTMLElement>('[data-testid="host-notice"]');

function log(text: string): void {
  const item = document.createElement('li');
  item.textContent = text;
  logList.append(item);
  item.scrollIntoView({ block: 'nearest' });
}

const config = (await (await fetch('/host/config')).json()) as Config;

// --- sign-in -----------------------------------------------------------------------------------

let signIn: SignInChoice = config.signIns[0] as SignInChoice;
const signInFieldset = element<HTMLFieldSetElement>('[data-testid="sign-ins"]');
const effectText = element<HTMLElement>('[data-testid="sign-in-effect"]');
const showEffect = (): void =>
  void (effectText.textContent = `${signIn.label}: ${signIn.effect}`);
for (const choice of config.signIns) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'sign-in';
  input.value = choice.id;
  input.checked = choice === signIn;
  input.addEventListener('change', () => {
    signIn = choice;
    showEffect();
    log(
      `Sign-in changed to ${choice.label}. A view that is already open keeps running; its next call carries this credential.`,
    );
  });
  label.append(input, ` ${choice.label}`);
  signInFieldset.append(label);
}
showEffect();

// --- calling the servers ---------------------------------------------------------------------------

async function forward(
  endpoint: EndpointId,
  method: string,
  params: Record<string, unknown>,
): Promise<Forwarded> {
  const response = await fetch('/host/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint,
      method,
      params,
      ...(signIn.token === null ? {} : { token: signIn.token }),
    }),
  });
  return (await response.json()) as Forwarded;
}

/** A call refused at HTTP is an error here; a tool failure is a result that the view reads. */
async function call(
  endpoint: EndpointId,
  method: string,
  params: Record<string, unknown>,
  what: string,
): Promise<unknown> {
  const reply = await forward(endpoint, method, params);
  if (reply.status === 401 || reply.status === 403) {
    log(
      `${what} as ${signIn.label}: refused with HTTP ${reply.status}${reply.challenge === null ? '' : ` (${reply.challenge})`}`,
    );
    throw new CredentialRefused(
      `the server refused the credential (HTTP ${reply.status})`,
    );
  }
  if (reply.status !== 200 || reply.body?.result === undefined) {
    log(`${what} as ${signIn.label}: failed (HTTP ${reply.status})`);
    throw new Error(`the call failed (HTTP ${reply.status})`);
  }
  log(`${what} as ${signIn.label}: HTTP 200`);
  return reply.body.result;
}

// A view's own `tools/call` names no endpoint, so the host routes it by the tool names it learned
// when it opened that app.
const routes = new Map<string, EndpointId>();

window.handleToolCall = async (params) => {
  const endpoint = routes.get(params.name);
  if (endpoint === undefined)
    throw new Error(`the host does not know the tool ${params.name}`);
  return (await call(
    endpoint,
    'tools/call',
    params as Record<string, unknown>,
    `view called ${params.name}`,
  )) as CallToolResult;
};

window.handleOpenLink = async ({ url }) => {
  log(
    `A view asked the host to open ${url}. The demonstration host records the request and navigates nowhere.`,
  );
  return {};
};

// --- opening an app ------------------------------------------------------------------------------

interface AppDefinition {
  readonly endpoint: () => EndpointId;
  readonly opener: string;
  readonly arguments: () => Record<string, unknown>;
  /** The host's name for the frame that shows this app. */
  readonly slot: string;
}
const levelInput = (): string =>
  element<HTMLInputElement>('input[name="level"]:checked').value;
const episodeSelect = element<HTMLSelectElement>('[data-testid="episode"]');
for (const episode of config.episodes)
  episodeSelect.append(
    new Option(`${episode.id}: ${episode.title}`, episode.id),
  );

const apps: Record<AppKey, AppDefinition> = {
  subscriptions: {
    endpoint: () => 'subscriptions',
    opener: 'list_subscriptions',
    arguments: () => ({}),
    slot: 'subscriptions',
  },
  episode: {
    endpoint: () =>
      levelInput() === 'strict' ? 'episode-strict' : 'episode-standard',
    opener: 'get_episode',
    arguments: () => ({ episodeId: episodeSelect.value }),
    slot: 'episode',
  },
  player: {
    endpoint: () => 'playback',
    opener: 'get_playable_episode',
    arguments: () => ({ episodeId: episodeSelect.value }),
    slot: 'player',
  },
  notes: {
    endpoint: () => 'notes',
    opener: 'list_notes',
    arguments: () => ({}),
    slot: 'notes',
  },
};
const mounted = new Set<string>();
const reuse = element<HTMLInputElement>('[data-testid="reuse"]');

interface ToolListing {
  readonly tools: readonly {
    readonly name: string;
    readonly _meta?: { readonly ui?: { readonly resourceUri?: string } };
  }[];
}
interface ResourceReading {
  readonly contents: readonly {
    readonly text: string;
    readonly _meta: { readonly ui: { readonly csp: HostedResource['csp'] } };
  }[];
}

async function open(key: AppKey): Promise<void> {
  const app = apps[key];
  const endpoint = app.endpoint();
  notice.textContent = '';
  try {
    const listing = (await call(
      endpoint,
      'tools/list',
      {},
      `${endpoint} tools/list`,
    )) as ToolListing;
    for (const tool of listing.tools) routes.set(tool.name, endpoint);
    const resourceUri = listing.tools.find((tool) => tool.name === app.opener)
      ?._meta?.ui?.resourceUri;
    if (resourceUri === undefined)
      throw new Error(`${app.opener} is not linked to a view`);

    if (reuse.checked && mounted.has(app.slot)) {
      log(`Delivering to the ${key} view that is already open.`);
    } else {
      const reading = (await call(
        endpoint,
        'resources/read',
        { uri: resourceUri },
        `${endpoint} resources/read`,
      )) as ResourceReading;
      const content = reading.contents[0];
      if (content === undefined)
        throw new Error('resources/read returned no contents');
      await window.mountView?.(
        { html: content.text, csp: content._meta.ui.csp },
        { slot: app.slot },
      );
      mounted.add(app.slot);
      log(`Mounted the ${key} view in a sandboxed frame.`);
    }
    const result = (await call(
      endpoint,
      'tools/call',
      { name: app.opener, arguments: app.arguments() },
      app.opener,
    )) as CallToolResult;
    await window.deliverToolInput?.({ arguments: app.arguments() }, app.slot);
    await window.deliverToolResult?.(result, app.slot);
  } catch (error) {
    notice.textContent =
      error instanceof CredentialRefused ? REFUSED_NOTICE : FAILED_NOTICE;
    if (!(error instanceof CredentialRefused))
      log(
        `Could not open ${key}: ${error instanceof Error ? error.message : 'unknown failure'}`,
      );
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-open]',
)) {
  button.addEventListener(
    'click',
    () => void open(button.dataset.open as AppKey),
  );
}

async function closeAll(): Promise<void> {
  for (const slot of [...mounted]) {
    await window.teardownView?.(slot).catch(() => undefined);
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      '[data-view-area] iframe',
    ))
      if (frame.dataset.slot === slot) frame.remove();
    mounted.delete(slot);
  }
  log(
    'Closed every view: the host asked each to tear down and removed its frame.',
  );
}
element<HTMLButtonElement>('[data-testid="close-all"]').addEventListener(
  'click',
  () => void closeAll(),
);

// --- demonstration controls ---------------------------------------------------------------------

const controlRow = element<HTMLElement>('[data-testid="controls"]');
const controlState = element<HTMLElement>('[data-testid="control-state"]');
const showState = (state: Record<string, string>): void =>
  void (controlState.textContent = Object.entries(state)
    .map(([name, value]) => `${name}: ${value}`)
    .join(' · '));
showState(config.state);
for (const name of config.controls) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.control = name;
  button.textContent = name.replaceAll('-', ' ');
  button.addEventListener('click', async () => {
    const response = await fetch('/host/controls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    showState((await response.json()) as Record<string, string>);
    log(`Demonstration control: ${button.textContent}.`);
  });
  controlRow.append(button);
}

if (config.imageHost !== null)
  log(`Descriptions may show images from ${config.imageHost}.`);
