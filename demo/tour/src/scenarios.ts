import type { ControlName, Person } from './simulated-world.js';
import type { GUIDES, SourceId } from './source-map.js';

// Tour data, not behavior. A scenario names a situation of the SIMULATED backend (who is asking and
// which named changes were made to it), what to press, what the real view and runtime will show, and
// the limit of that particular simulation. Choosing an outcome here is local data: it is not an
// authorization rule, and nothing in this file decides whether a real request is allowed.

/** The first thing on the page, in reading order. */
export const SYNTHETIC_BANNER = 'Synthetic example — server checks simulated';

export type RendererId = 'lit' | 'react';

export interface RendererChoice {
  readonly id: RendererId;
  readonly label: string;
  /** What has been shown for this renderer, and what has not. */
  readonly evidence: string;
}

/**
 * Only renderers whose preview works in this tour. Each has a built view that the tour specification
 * opens and presses. A renderer joins this list when its preview works, and not before; nothing else
 * is offered or promised, and Lynx delivery was retired on 2026-10-19.
 */
export const RENDERERS: readonly RendererChoice[] = [
  {
    id: 'lit',
    label: 'Lit',
    evidence: 'The full renderer. The notes application, its action definitions and its view run here as qualified for the demonstration.',
  },
  {
    id: 'react',
    label: 'React (bounded evidence)',
    evidence:
      'The same actions and server contract through a React consumer of @saga-a2ui/react in a local fixture host. There is no React starter, template or CLI pair, and this preview is not renderer parity with Lit.',
  },
];

export type ScenarioKind = 'allowed' | 'refused' | 'denied' | 'missing-credential' | 'unknown' | 'independent' | 'obsolete' | 'canceled';

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly kind: ScenarioKind;
  readonly person: Person;
  /** Changes applied to the simulated backend before the view opens. */
  readonly controls: readonly ControlName[];
  readonly summary: string;
  readonly steps: readonly string[];
  readonly expect: string;
  /** What this simulation does not establish, shown beside the interaction it limits. */
  readonly limit: string;
  readonly guide: keyof typeof GUIDES;
  readonly sources: readonly SourceId[];
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'allowed',
    title: 'Allowed: Alice archives her own note',
    kind: 'allowed',
    person: 'alice',
    controls: [],
    summary: 'The whole path of one press: the session check, the protected archive request, the server’s own decision and the application’s hand-over of the hold.',
    steps: ['Press Archive under Alpha.'],
    expect:
      'The row says “Archived at 1001”. The simulated backend shows n-1 archived after 1 session check and 1 archive request, and the hold on n-1 is confirmed: the invocation handed it to the application for good.',
    limit: 'The session check is a simulated answer. It does not authenticate anyone, and a simulated allow shows nothing about a real server.',
    guide: 'trace',
    sources: ['layout', 'definition', 'prerequisite', 'attachment-lit', 'cleanup-success'],
  },
  {
    id: 'session-ended',
    title: 'Refused before anything is sent: the session check says signed out',
    kind: 'refused',
    person: 'alice',
    controls: ['end-notes-session'],
    summary: 'A prerequisite that refuses ends the press before the protected request exists.',
    steps: ['Press Archive under Alpha.'],
    expect: 'The row says “Not archived: sign-in-required”. The simulated backend shows 1 session check and 0 archive requests: the archive request was never sent. The hold was given back.',
    limit: 'A prerequisite stops a press on the client as a convenience. It authorizes nothing: a real server decides again for every protected request.',
    guide: 'prerequisites',
    sources: ['prerequisite', 'ownership'],
  },
  {
    id: 'permission-withdrawn',
    title: 'Denied by the server after a valid session check',
    kind: 'denied',
    person: 'alice',
    controls: ['revoke-archive-permission'],
    summary: 'The session check still says yes, and the protected request is refused anyway, because the server decides again.',
    steps: ['Press Archive under Alpha.'],
    expect: 'The row says “The server declined; nothing changed”. The simulated backend shows 1 session check and 1 archive request, and nothing archived. The reply declared that nothing changed, so the view could say so.',
    limit: 'This denial is a simulated outcome you chose. It does not prove that any real server enforces permission; the linked server source is exercised by the repository’s own tests, not by this page.',
    guide: 'trace',
    sources: ['server-decision', 'simulated-decision', 'cleanup-success'],
  },
  {
    id: 'bob',
    title: 'Browse as Bob: only his own note',
    kind: 'allowed',
    person: 'bob',
    controls: [],
    summary: 'The list shows only the notes of the person the request names, and only three fields of each note.',
    steps: ['Look at the list: only Delta is there.', 'Press Archive under Delta.'],
    expect: 'The row says “Archived at 1001”. Alice’s notes were never listed for Bob.',
    limit: 'Choosing Bob changes who the next simulated call names. There is no sign-in, token or account on this page.',
    guide: 'trace',
    sources: ['server-decision', 'simulated-decision'],
  },
  {
    id: 'no-credential',
    title: 'Refused: the request names nobody',
    kind: 'missing-credential',
    person: 'nobody',
    controls: [],
    summary: 'A request with no verified identity is refused before any backend is asked.',
    steps: ['Open the view and read its status line.', 'Choose Alice under “Who is asking”, then open the view again to see her notes.'],
    expect: 'The status line says “Your notes could not be shown.” and no note appears. The simulated backend shows 0 session checks and 0 archive requests.',
    limit: '“No credential” is a simulated choice. A real application refuses a missing credential at its HTTP listener, which this tour does not run.',
    guide: 'trace',
    sources: ['server-decision', 'simulated-decision'],
  },
  {
    id: 'unknown-outcome',
    title: 'Unknown outcome: the backend fails after it applied the archive',
    kind: 'unknown',
    person: 'alice',
    controls: ['fail-after-write'],
    summary: 'A failed answer to a write says nothing about whether the write happened, so the view must not claim it did not.',
    steps: ['Press Archive under Alpha.', 'Read the row and the simulated backend.'],
    expect: 'The row says “Archive status unknown”, and the simulated backend shows n-1 archived. Nothing retried the request: the archive request count stays at 1.',
    limit: 'The page cannot show a real timeout. The 30 s work deadline, 5 s hooks, 3 s server operation and 10 s server request are not exercised here; see the guide’s four clocks.',
    guide: 'clocks',
    sources: ['definition', 'cleanup-success'],
  },
  {
    id: 'independent',
    title: 'Two rows, one definition, independent state',
    kind: 'independent',
    person: 'alice',
    controls: ['hold-archives'],
    summary: 'The same action definition is attached directly to each rendered row. Each attachment keeps its own state.',
    steps: ['Press Archive under Alpha, then under Beta. Both archive requests wait at the simulated backend.', 'Press “Release held archives”.'],
    expect: 'While held, the page lists both holds as pending (n-1,n-2). After the release both rows say “Archived at …” and both holds are confirmed. A pending press on one row never disables or cancels the other.',
    limit: '“Held” is a simulated slow backend that waits until you release it.',
    guide: 'rows',
    sources: ['attachment-lit', 'attachment-react', 'ownership', 'holds'],
  },
  {
    id: 'obsolete',
    title: 'Obsolete completion: the row shows another note when the answer arrives',
    kind: 'obsolete',
    person: 'alice',
    controls: ['hold-archives'],
    summary: 'A row may be reused for another note while a press is undecided. The late answer must not be written onto it.',
    steps: [
      'Press Archive under Alpha. The request waits at the simulated backend.',
      'Press “List the notes in the opposite order”, then “Refresh the open view”. The first row now shows Gamma.',
      'Press “Release held archives”.',
    ],
    expect:
      'Gamma’s row stays empty. The press ended as canceled when its row changed, so the hold was given back rather than confirmed. The simulated backend nevertheless archived n-1: cancellation did not stop it.',
    limit: 'Cancelling ends the client’s wait. It does not prove the server’s effect was undone or stopped. The opposite order is the simulated server listing the same notes differently.',
    guide: 'outcomes',
    sources: ['attachment-lit', 'cleanup-canceled', 'holds'],
  },
  {
    id: 'closed-view',
    title: 'Closing the view is not undoing the archive',
    kind: 'canceled',
    person: 'alice',
    controls: ['hold-archives'],
    summary: 'The application ends its bindings when the view ends. That stops the control from reacting; it does not reach the server.',
    steps: ['Press Archive under Alpha.', 'Press “Close the view”, then “Release held archives”.', 'Press “Open the view” again.'],
    expect: 'Alpha is missing from the list: the simulated backend archived it although the view had been closed. Nothing was shown on the closed view.',
    limit: 'Local cancellation does not prove a remote effect was undone, and nothing in this tour can show a real host forwarding a cancellation.',
    guide: 'ownership',
    sources: ['cleanup-canceled', 'holds'],
  },
];
