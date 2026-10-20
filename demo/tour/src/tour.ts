import type { CallToolResult } from '@modelcontextprotocol/client';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import build from 'virtual:tour-build';
import '../../../apps/lit-host/e2e/host-fixture/host.js';
import { LIST_TOOL, declaresNoEffect } from '../../../examples/pack1-consumer/src/notes-contract.js';
import { RENDERERS, SCENARIOS, type RendererId, type Scenario } from './scenarios.js';
import { CONTROL_NAMES, PEOPLE, createTourWorld, type ControlName, type Person, type TourState, type TourWorld } from './simulated-world.js';
import { GUIDES, headingSlug, type GuideLink } from './source-map.js';

// The tour page. It is a small stand-in for an assistant host, built on the repository's local host
// fixture exactly as the demonstration's host page is (demo/lit-node/host/host.ts): it mounts the
// notes example's real built view in a sandboxed frame, delivers a tool result to it, and answers
// the view's own server calls. The answers come from the simulated world (simulated-world.ts), not
// from any server. All business meaning, the actions and the renderer are the notes example's.

const REPOSITORY = 'https://github.com/MachineWisdomAI/saga-a2ui';
const SLOT = 'notes';

const CONTROL_LABELS: Readonly<Record<ControlName, string>> = {
  'end-notes-session': 'End Alice’s session',
  'restore-notes-session': 'Restore Alice’s session',
  'revoke-archive-permission': 'Withdraw Alice’s archive permission',
  'restore-archive-permission': 'Restore Alice’s archive permission',
  'hold-archives': 'Hold archives at the backend',
  'release-archives': 'Release held archives',
  'fail-after-write': 'Make the backend fail after it applies an archive',
  'stop-failing-after-write': 'Stop failing after writes',
  'reverse-list-order': 'List the notes in the opposite order',
  'restore-list-order': 'List the notes in stored order',
};

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`the tour page has no ${selector}`);
  return found;
}
const byTestId = <T extends Element>(id: string): T => element<T>(`[data-testid="${id}"]`);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value);
  created.append(...children);
  return created;
}

const sourceUrl = (path: string, fragment = ''): string => `${REPOSITORY}/blob/${build.commit}/${path}${fragment}`;
const guideUrl = (guide: GuideLink): string => sourceUrl(guide.path, guide.heading === undefined ? '' : `#${headingSlug(guide.heading)}`);
const link = (label: string, href: string): HTMLAnchorElement => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);

// --- log, notice, state -------------------------------------------------------------------------

const logList = byTestId<HTMLOListElement>('tour-log');
const notice = byTestId<HTMLElement>('tour-notice');
function log(text: string): void {
  logList.append(h('li', {}, text));
  logList.scrollTop = logList.scrollHeight; // the log box only: scrolling the page would carry the visitor away from where they are
}

let world: TourWorld = createTourWorld();
const personLabel = (person: Person): string => PEOPLE.find((one) => one.id === person)?.label ?? person;

function renderState(): void {
  const state: TourState = world.state();
  const rows: readonly (readonly [string, string])[] = [
    ['Asking as', personLabel(state.person)],
    ['Alice’s session', state.notesSession],
    ['Alice’s archive permission', state.archivePermission],
    ['Archives at the backend', state.archives === 'held' ? `held (${state.waiting} waiting)` : 'answered immediately'],
    ['After a write', state.afterWrite === 'fails' ? 'the backend fails to answer after it applied the write' : 'the backend answers'],
    ['List order', state.listOrder === 'reversed' ? 'opposite to stored order' : 'stored order'],
    ['Archived notes', state.archived.length === 0 ? 'none' : state.archived.join(', ')],
    ['Backend calls', `${state.backendCalls.sessionChecks} session check(s) · ${state.backendCalls.archives} archive request(s)`],
  ];
  byTestId('server-state').replaceChildren(...rows.flatMap(([name, value]) => [h('dt', {}, name), h('dd', {}, value)]));
  byTestId('person-effect').textContent = PEOPLE.find((one) => one.id === state.person)?.effect ?? '';
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="person"]')) input.checked = input.value === state.person;
}

// --- the host: mounting the view and answering its calls ------------------------------------------

function describe(result: CallToolResult): string {
  const text = result.content.map((part) => ('text' in part ? part.text : '')).join(' ');
  if (result.isError !== true) return text === '' ? 'ok' : `ok — ${text}`;
  return `${text} (${declaresNoEffect(result) ? 'declared: nothing changed' : 'failed; says nothing about whether it was applied'})`;
}

window.handleToolCall = async (params) => {
  const caller = personLabel(world.state().person);
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    const answering = world.callTool(params.name, args);
    renderState(); // a held call is already waiting at the backend
    const result = await answering;
    log(`view called ${params.name} as ${caller}: ${describe(result)}`);
    return result;
  } catch (error) {
    log(`view called ${params.name} as ${caller}: rejected — ${error instanceof Error ? error.message : 'unknown failure'}`);
    throw error;
  } finally {
    renderState();
  }
};

window.handleOpenLink = async ({ url }) => {
  log(`A view asked the host to open ${url}. This tour records the request and navigates nowhere.`);
  return {};
};

let renderer: RendererId = 'lit';
let scenario: Scenario = SCENARIOS[0] as Scenario;
let viewOpen = false;

async function listNotes(): Promise<CallToolResult> {
  const result = await world.callTool(LIST_TOOL, {});
  log(`host called ${LIST_TOOL} as ${personLabel(world.state().person)}: ${describe(result)}`);
  renderState();
  return result;
}

async function closeView(): Promise<void> {
  if (!viewOpen) return;
  await window.teardownView?.(SLOT).catch(() => undefined);
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('[data-view-area] iframe')) if (frame.dataset.slot === SLOT) frame.remove();
  viewOpen = false;
  log('Closed the view: the host asked it to tear down and removed its frame. The simulated backend was not told anything.');
}

async function openView(): Promise<void> {
  await closeView();
  notice.textContent = '';
  try {
    await window.mountView?.({ html: build.views[renderer], csp: CLOSED_VIEW_CSP }, { slot: SLOT });
    viewOpen = true;
    log(`Mounted the notes view (${renderer === 'lit' ? 'Lit' : 'React'}) in a sandboxed frame.`);
    const result = await listNotes();
    await window.deliverToolInput?.({ arguments: {} }, SLOT);
    await window.deliverToolResult?.(result, SLOT);
  } catch (error) {
    notice.textContent = 'The view could not be opened. The request log says why.';
    log(`Could not open the view: ${error instanceof Error ? error.message : 'unknown failure'}`);
  }
}

async function refreshView(): Promise<void> {
  if (!viewOpen) {
    notice.textContent = 'No view is open. Open the view first.';
    return;
  }
  notice.textContent = '';
  const result = await listNotes();
  await window.deliverToolResult?.(result, SLOT);
  log('Delivered the new result to the view that is already open.');
}

// --- scenarios ----------------------------------------------------------------------------------

function renderScenario(): void {
  byTestId('scenario-title').textContent = scenario.title;
  byTestId('scenario-summary').textContent = scenario.summary;
  byTestId('scenario-steps').replaceChildren(...scenario.steps.map((step) => h('li', {}, step)));
  byTestId('scenario-expect').textContent = scenario.expect;
  byTestId('scenario-limit').replaceChildren(h('strong', {}, 'Simulation limit: '), scenario.limit);
  const sources = build.sources.filter((one) => scenario.sources.includes(one.id));
  byTestId('scenario-links').replaceChildren(
    'Matching source: ',
    ...sources.flatMap((one, index) => [index === 0 ? '' : ' · ', link(one.label, sourceUrl(one.path, `#L${one.start}-L${one.end}`))]),
    '. Guides: ',
    link(GUIDES.setup.label, guideUrl(GUIDES.setup)),
    ' · ',
    link(GUIDES[scenario.guide].label, guideUrl(GUIDES[scenario.guide])),
    '.',
  );
  byTestId('renderer-evidence').textContent = RENDERERS.find((one) => one.id === renderer)?.evidence ?? '';
}

async function startScenario(next: Scenario): Promise<void> {
  scenario = next;
  await closeView(); // the old view's calls end before the world they asked is replaced
  world = createTourWorld();
  world.choose(next.person);
  for (const name of next.controls) world.control(name);
  logList.replaceChildren();
  log(`Started “${next.title}” with the ${renderer === 'lit' ? 'Lit' : 'React'} preview. Every answer below is simulated.`);
  renderScenario();
  renderState();
  await openView();
  notice.textContent = 'The scenario started and its view is open below.';
}

// --- page setup -----------------------------------------------------------------------------------

function radios<T extends string>(testId: string, name: string, choices: readonly { id: T; label: string; detail?: string }[], selected: T, onChange: (id: T) => void): void {
  byTestId(testId).append(
    ...choices.map((choice) => {
      const input = h('input', { type: 'radio', name, value: choice.id });
      input.checked = choice.id === selected;
      input.addEventListener('change', () => {
        if (input.checked) onChange(choice.id);
      });
      return h('label', {}, input, h('span', {}, choice.label, ...(choice.detail === undefined ? [] : [h('span', { class: 'hint' }, ` — ${choice.detail}`)])));
    }),
  );
}

radios(
  'scenarios',
  'scenario',
  SCENARIOS.map((one) => ({ id: one.id, label: one.title })),
  scenario.id,
  (id) => void startScenario(SCENARIOS.find((one) => one.id === id) as Scenario),
);
radios(
  'renderers',
  'renderer',
  RENDERERS.map((one) => ({ id: one.id, label: one.label })),
  renderer,
  (id) => {
    renderer = id;
    void startScenario(scenario);
  },
);
radios(
  'people',
  'person',
  PEOPLE.map((one) => ({ id: one.id, label: one.label })),
  'alice',
  (person) => {
    world.choose(person);
    renderState();
    log(`Now asking as ${personLabel(person)}. A view that is already open keeps running; its next call names this person. Open the view again to list their notes.`);
  },
);

for (const name of CONTROL_NAMES) {
  const button = h('button', { type: 'button', 'data-control': name }, CONTROL_LABELS[name]);
  button.addEventListener('click', () => {
    world.control(name);
    renderState();
    log(`Simulated backend change: ${CONTROL_LABELS[name]}.`);
  });
  byTestId('controls').append(button);
}

byTestId('open-view').addEventListener('click', () => void openView());
byTestId('close-view').addEventListener('click', () => void closeView());
byTestId('refresh-view').addEventListener('click', () => void refreshView());
byTestId('restart').addEventListener('click', () => void startScenario(scenario));

// Source and guides, linked at the commit this page was built from.
byTestId('sources').replaceChildren(
  ...build.sources.map((one) =>
    h(
      'div',
      { id: `source-${one.id}` },
      h('p', {}, link(one.label, sourceUrl(one.path, `#L${one.start}-L${one.end}`)), ` (${one.path}, lines ${one.start}–${one.end})`),
      h('pre', { tabindex: '0', 'aria-label': `Quoted source: ${one.label}` }, h('code', {}, one.quote.join('\n'))),
    ),
  ),
);
byTestId('guides').replaceChildren(...Object.values(GUIDES).map((guide) => h('li', {}, link(guide.label, guideUrl(guide)))));
for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[data-guide]')) {
  const guide = GUIDES[anchor.dataset.guide as keyof typeof GUIDES];
  anchor.href = guideUrl(guide);
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
}
byTestId('source-identity').textContent =
  `Built from candidate ${build.candidateVersion}, source commit ${build.commit.slice(0, 12)}${build.dirty ? ' (the build had uncommitted changes, so these links may not match it)' : ''}. ` +
  'The repository is private, so the links open for people who have access to it. The candidate is a local build of the unpublished packages; nothing here says they are on a public registry.';

// Theme: the system's preference unless the reader chooses.
radios(
  'theme',
  'theme',
  [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ] as const,
  'system',
  (choice) => {
    if (choice === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
  },
);

renderScenario();
renderState();
await startScenario(scenario);
