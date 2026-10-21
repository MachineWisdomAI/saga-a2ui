// Where each thing the tour explains lives in the source. Every entry names a file and quotes the
// lines the explanation is about. The quote is shown on the page, and the build finds those lines
// in the file to link them by number, so a quote that no longer matches its file fails the build and
// `scripts/tour.test.ts` instead of leaving a stale link. Nothing here runs in the browser except
// reading this list.

export interface SourceEntry {
  readonly id: SourceId;
  /** What the quoted lines are, as the page labels the link. */
  readonly label: string;
  /** Repository-relative path. */
  readonly path: string;
  /** Contiguous lines of that file, compared without indentation. */
  readonly quote: readonly string[];
}

export type SourceId =
  | 'layout'
  | 'definition'
  | 'prerequisite'
  | 'attachment-lit'
  | 'attachment-react'
  | 'ownership'
  | 'cleanup-success'
  | 'cleanup-canceled'
  | 'holds'
  | 'server-decision'
  | 'simulated-decision';

export const SOURCE_ENTRIES: readonly SourceEntry[] = [
  {
    id: 'layout',
    label: 'The layout names the control and no action',
    path: 'examples/pack1-consumer/src/notes-surface.ts',
    quote: [
      '{',
      "id: 'row-archive',",
      "component: 'ActionButton',",
      "child: 'row-archive-label',",
      '},',
      '{',
      "id: 'row-archive-label',",
      "component: 'Line',",
      "kind: 'body',",
      "text: 'Archive',",
      '},',
    ],
  },
  {
    id: 'definition',
    label: 'The Archive action, defined once with the fluent builder',
    path: 'examples/pack1-consumer/src/notes-actions.ts',
    quote: [
      'const archiveNote = Action.server<ActionButtonActivation, CallToolResult>(',
      "'archive-note',",
      'environment.transport,',
      ')',
      '.input((event) => ({',
      "noteId: requireNoteId(event.read('id')),",
      'at: event.dataPath,',
      '}))',
    ],
  },
  {
    id: 'prerequisite',
    label: 'The asynchronous session prerequisite',
    path: 'examples/pack1-consumer/src/notes-actions.ts',
    quote: [
      "return prerequisite('session', async ({ signal }) => {",
      'const reply = await transport.callServerTool(',
      '{ name: SESSION_TOOL, arguments: {} },',
      '{ signal },',
      ');',
      'return reply.isError === true',
      "? refuse('sign-in-required')",
      ': proceed({ signedIn: true as const });',
    ],
  },
  {
    id: 'ownership',
    label:
      'The press takes a hold the invocation owns, then the prerequisite runs',
    path: 'examples/pack1-consumer/src/notes-actions.ts',
    quote: [
      '.atActivation(({ scope, event }) =>',
      'scope.own(',
      "environment.holds.begin(requireNoteId(event.read('id'))),",
      '(token) => environment.holds.end(token),',
      '),',
      ')',
      '.before(requireSession)',
    ],
  },
  {
    id: 'attachment-lit',
    label: 'Direct attachment to each rendered row (Lit)',
    path: 'examples/pack1-consumer/src/notes-view.ts',
    quote: [
      'view.watchById(',
      "'row-archive',",
      'ActionButton,',
      '(handle) =>',
      "void handle.bindAction('activate', actions.archiveNote, {",
      "subject: () => handle.read('id'),",
      '}),',
    ],
  },
  {
    id: 'attachment-react',
    label: 'Direct attachment to each rendered row (React)',
    path: 'examples/pack1-consumer/src/notes-react-view.tsx',
    quote: [
      'view.watchById(',
      "'row-archive',",
      'ActionButton,',
      '(handle) =>',
      "void handle.bindAction('activate', actions.archiveNote, {",
      "subject: () => handle.read('id'),",
      '}),',
    ],
  },
  {
    id: 'cleanup-success',
    label:
      'Success hands the hold over; the row is written only while it is current',
    path: 'examples/pack1-consumer/src/notes-actions.ts',
    quote: [
      "// The server confirmed: the hold now belongs to the application's owner for good.",
      'activation.transfer((token) => environment.holds.confirm(token));',
      'if (current())',
      'environment.present(params.at, `Archived at ${result.archivedAt}`);',
    ],
  },
  {
    id: 'cleanup-canceled',
    label:
      'A canceled or obsolete press writes nothing on a row that shows another note',
    path: 'examples/pack1-consumer/src/notes-actions.ts',
    quote: [
      '.onCanceled((context) => {',
      'if (!context.current()) return;',
      'environment.present(',
      'context.params.at,',
      "context.stage === 'prerequisites'",
      "? 'Not archived: canceled'",
      ": 'Archive status unknown',",
    ],
  },
  {
    id: 'holds',
    label:
      'The application’s own owner of the holds: give back, or take over for good',
    path: 'examples/pack1-consumer/src/row-holds.ts',
    quote: [
      'confirm(token: number): void {',
      'const entry = this.#tokens.get(token);',
      "if (entry) entry.phase = 'confirmed';",
      'this.#publish();',
      '}',
    ],
  },
  {
    id: 'server-decision',
    label: 'The real server decides again for every protected request',
    path: 'examples/pack1-consumer/server/notes-server.ts',
    quote: [
      '// Authorization is decided here, for this request, from the verified context alone.',
      'const identity = identityOf(ctx.http?.authInfo);',
      'if (!identity) return refusal(TEXT.signInRequired);',
    ],
  },
  {
    id: 'simulated-decision',
    label: 'The tour’s simulated replacement for that decision',
    path: 'demo/tour/src/simulated-world.ts',
    quote: [
      '// Decided for this request, from who is asking alone: a session check that said yes authorizes nothing.',
      'if (accountId === undefined) return refusal(TEXT.signInRequired);',
    ],
  },
];

/** A guide the tour links to, optionally at one of its headings. */
export interface GuideLink {
  readonly label: string;
  readonly path: string;
  readonly heading?: string;
}

export const GUIDES = {
  setup: {
    label: 'Setup guide',
    path: 'docs/getting-started.md',
    heading: 'Component, definition, template and instance',
  },
  actions: {
    label: 'Action guide: change a component and trace requests',
    path: 'docs/actions.md',
  },
  trace: {
    label: 'Action guide: trace one press, allowed and denied',
    path: 'docs/actions.md',
    heading: 'Trace one press, allowed and denied',
  },
  prerequisites: {
    label: 'Action guide: prerequisites',
    path: 'docs/actions.md',
    heading: 'Prerequisites: session validity, confirmation and an audit entry',
  },
  outcomes: {
    label: 'Action guide: outcomes, hooks and cleanup',
    path: 'docs/actions.md',
    heading: 'Outcomes, hooks and cleanup',
  },
  clocks: {
    label: 'Action guide: four clocks, kept apart',
    path: 'docs/actions.md',
    heading: 'Four clocks, kept apart',
  },
  rows: {
    label: 'Action guide: two rows, one definition',
    path: 'docs/actions.md',
    heading: 'Two rows, one definition',
  },
  ownership: {
    label: 'Action guide: disposal, ownership and hand-off',
    path: 'docs/actions.md',
    heading: 'Disposal, ownership and hand-off',
  },
  renderers: {
    label: 'Action guide: what each renderer and server has shown',
    path: 'docs/actions.md',
    heading: 'What each renderer and server has shown',
  },
  demo: {
    label: 'Local demonstration: the notes example',
    path: 'demo/lit-node/README.md',
    heading: 'The notes example',
  },
  hosts: {
    label: 'Host compatibility observations',
    path: 'docs/2026-10-19_host-compatibility-observations_v1.md',
  },
} as const satisfies Record<string, GuideLink>;

/** The anchor GitHub gives a Markdown heading. */
export function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** The 1-based first and last line of `quote` in `text`, or `undefined` when the file does not contain it contiguously. Blank lines are ignored on both sides. */
export function locate(
  text: string,
  quote: readonly string[],
): { readonly start: number; readonly end: number } | undefined {
  const lines = text
    .split('\n')
    .map((line, index) => ({ text: line.trim(), number: index + 1 }))
    .filter((line) => line.text !== '');
  const wanted = quote.map((line) => line.trim()).filter((line) => line !== '');
  if (wanted.length === 0) return undefined;
  for (let first = 0; first + wanted.length <= lines.length; first += 1) {
    if (wanted.every((line, offset) => lines[first + offset]?.text === line)) {
      return {
        start: (lines[first] as { number: number }).number,
        end: (lines[first + wanted.length - 1] as { number: number }).number,
      };
    }
  }
  return undefined;
}

/** A source entry with the lines it was found at, as the built page carries it. */
export interface LocatedSource extends SourceEntry {
  readonly start: number;
  readonly end: number;
}

export function locateAll(
  read: (path: string) => string,
  entries: readonly SourceEntry[] = SOURCE_ENTRIES,
): LocatedSource[] {
  return entries.map((entry) => {
    const range = locate(read(entry.path), entry.quote);
    if (range === undefined)
      throw new Error(
        `the tour quotes "${entry.label}" from ${entry.path}, but those lines are not in that file`,
      );
    return { ...entry, ...range };
  });
}
