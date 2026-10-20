import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Client } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { ActionBinding, InstanceEvent, ServerTransport } from '@saga-a2ui/core/actions';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type * as NotesActions from '../examples/pack1-consumer/src/notes-actions.js';
import type * as NotesContract from '../examples/pack1-consumer/src/notes-contract.js';
import type * as RowHoldsModule from '../examples/pack1-consumer/src/row-holds.js';
import type * as Pack1Server from '../examples/pack1-consumer/server/index.js';
import type * as Guarded from './guide-actions/guarded-archive.js';
import { startTestHost, type TestHost } from '../packages/mcp/src/server/http-host.test-support.js';
import { preparePack1Consumer } from './build-pack1-consumers.js';
import { bundleConsumerServer, createWorkDirectory } from './packed-consumer.js';

// GUIDE2 (docs/actions.md): the allowed, denied and missing-authentication calls and the action
// outcomes the guide traces, run against the notes application installed from packed candidate
// tarballs (the same copy PACK1 qualifies), through a real MCP client and the real action runtime.
// Nothing here re-implements the runtime: the application's own actions and server are bundled
// against the installed `@saga-a2ui/*` copies, and the test only supplies what a renderer adapter and
// an application listener supply (an instance host, a transport and a verified request context).
// The guide's quoted source and commands are checked by scripts/guide-actions-document.test.ts.

type Core = typeof import('@saga-a2ui/core/actions');
interface Entry extends Core {
  readonly server: typeof Pack1Server;
  readonly actions: typeof NotesActions;
  readonly holds: typeof RowHoldsModule;
  readonly contract: typeof NotesContract;
  readonly guarded: typeof Guarded;
}

const work = createWorkDirectory('saga-guide-actions-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const ENTRY = `export * from '@saga-a2ui/core/actions';
export * as server from './server/index.js';
export * as actions from './src/notes-actions.js';
export * as holds from './src/row-holds.js';
export * as contract from './src/notes-contract.js';
export * as guarded from './guarded-archive.js';
`;

let entry: Entry;
beforeAll(async () => {
  const { consumer } = preparePack1Consumer(work, 'own');
  fs.copyFileSync(fileURLToPath(new URL('./guide-actions/guarded-archive.ts', import.meta.url)), path.join(consumer, 'guarded-archive.ts'));
  fs.writeFileSync(path.join(consumer, 'guide-entry.ts'), ENTRY);
  const { file } = await bundleConsumerServer(consumer, 'guide-entry.ts');
  entry = (await import(pathToFileURL(file).href)) as Entry;
}, 180_000);

const auth = (accountId: string) => ({ token: 't', clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId } });
const AUTH: Record<string, ReturnType<typeof auth>> = { alice: auth('acct-alice'), bob: auth('acct-bob') };

type Call = 'isSignedIn' | 'archive';

interface Running {
  readonly host: TestHost;
  readonly backend: Pack1Server.FixtureBackend;
  readonly alice: Client;
  readonly anonymous: Client;
  /** Holds the next backend call of this kind open until `release` is called. */
  hold(call: Call): void;
  release(call: Call): void;
}

let running: Running | undefined;
afterEach(async () => {
  if (running) {
    running.release('isSignedIn');
    running.release('archive');
    await running.host.close();
  }
  running = undefined;
});

async function start(): Promise<Running> {
  const holding: Record<Call, boolean> = { isSignedIn: false, archive: false };
  const held: Record<Call, (() => void)[]> = { isSignedIn: [], archive: [] };
  const backend = entry.server.createFixtureBackend({
    before: async (call) => {
      if (call === 'notesFor' || !holding[call]) return;
      await new Promise<void>((resolve) => held[call].push(resolve));
    },
  });
  // The view artifact only has to carry the marker the server requires: this test never renders it.
  const html = '<!doctype html><title>notes</title><p data-testid="view-status"></p>';
  const host = await startTestHost({
    jsonResponse: true,
    buildServer: () => entry.server.createNotesServer({ html, backend }),
    authenticate: (credential) => (credential === undefined ? undefined : AUTH[credential]),
  });
  running = {
    host,
    backend,
    alice: await host.connect('alice'),
    anonymous: await host.connect(),
    hold: (call) => void (holding[call] = true),
    release: (call) => {
      holding[call] = false;
      for (const resolve of held[call].splice(0)) resolve();
    },
  };
  return running;
}

const archive = (client: Client, args: Record<string, unknown>) => client.callTool({ name: 'archive_note', arguments: args });
const textOf = (result: { content?: unknown }) => JSON.stringify(result.content);

describe('the server operations the guide traces: allowed, denied and missing authentication', () => {
  it('archives the signed-in account\u2019s own note: verified identity, then the application\u2019s own check, then one write', async () => {
    const { alice, backend } = await start();
    const result = await archive(alice, { noteId: 'n-1' });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ noteId: 'n-1', archivedAt: 1_001 });
    expect(backend.archived).toEqual(['n-1']);
  });

  it('refuses someone else\u2019s note with one sentence that discloses nothing, and declares that nothing changed', async () => {
    const { alice, backend } = await start();
    const someoneElses = await archive(alice, { noteId: 'n-3' });
    const nonexistent = await archive(alice, { noteId: 'n-404' });
    for (const refused of [someoneElses, nonexistent]) {
      expect(refused.isError).toBe(true);
      expect(refused.content).toEqual([{ type: 'text', text: entry.contract.TEXT.cannotArchive }]);
      expect(entry.contract.declaresNoEffect(refused as CallToolResult)).toBe(true);
      expect(refused.structuredContent).toBeUndefined();
    }
    expect(backend.archived).toEqual([]);
    expect(backend.calls.archive).toBe(2); // the server asked its backend; the backend said no
  });

  it('refuses a request with no verified identity before the backend is asked, and says so as a known non-effect', async () => {
    const { anonymous, backend } = await start();
    const refused = await archive(anonymous, { noteId: 'n-1' });
    expect(refused.isError).toBe(true);
    expect(refused.content).toEqual([{ type: 'text', text: entry.contract.TEXT.signInRequired }]);
    expect(entry.contract.declaresNoEffect(refused as CallToolResult)).toBe(true);
    expect(backend.calls).toEqual({ notesFor: 0, isSignedIn: 0, archive: 0 });
  });

  it('withdrawn permission is the server\u2019s decision for every request: a signed-in session does not carry it', async () => {
    const { alice, backend } = await start();
    backend.revoked.add('acct-alice');
    const session = await alice.callTool({ name: 'check_session', arguments: {} });
    expect(session.structuredContent).toEqual({ signedIn: true }); // the prerequisite's question still says yes
    const refused = await archive(alice, { noteId: 'n-1' });
    expect(refused.isError).toBe(true); // the protected request is decided again
    expect(backend.archived).toEqual([]);
  });

  it('checks runtime input, not types: a forged account or a wrong type is rejected before any handler runs', async () => {
    const { alice, backend } = await start();
    const forged = await archive(alice, { noteId: 'n-1', accountId: 'acct-bob' }).catch(() => ({ isError: true }));
    const wrongType = await archive(alice, { noteId: 42 }).catch(() => ({ isError: true }));
    const empty = await archive(alice, { noteId: '' }).catch(() => ({ isError: true }));
    for (const rejected of [forged, wrongType, empty]) expect(rejected.isError).toBe(true);
    expect(backend.calls.archive).toBe(0);
    expect(backend.archived).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The actions: the application's own definitions, bound to rendered rows on a real instance host.
// ---------------------------------------------------------------------------------------------

type RowEvents = { readonly activate: InstanceEvent<Event> };

interface Mounted {
  /** Presses the row at `dataPath` and settles when its binding is idle again. */
  press(dataPath: string): Promise<void>;
  /** Presses without waiting. */
  start(dataPath: string): void;
  bindingAt(dataPath: string): ActionBinding;
  /** What each row's status line shows. */
  readonly lines: Map<string, string>;
  /** The rows' data: which note each data scope shows now. A test changes it to recycle a row. */
  readonly rows: Map<string, string>;
  readonly holds: { pending: string[]; confirmed: string[] };
  readonly errors: unknown[];
  close(): void;
}

interface MountOptions {
  readonly limits?: { deadlineMs?: number; hookMs?: number };
  /** Binds the guide's guarded archive (confirmation and audit after the session check) instead of the example's. */
  readonly guard?: Guarded.GuardEnvironment;
}

function mount(client: Client, paths: readonly string[], options: MountOptions = {}): Mounted {
  const lines = new Map<string, string>();
  const rows = new Map<string, string>(paths.map((dataPath, index) => [dataPath, `n-${index + 1}`]));
  const published = { pending: [] as string[], confirmed: [] as string[] };
  const errors: unknown[] = [];
  const holds = new entry.holds.RowHolds((pending, confirmed) => {
    published.pending = [...pending];
    published.confirmed = [...confirmed];
  });
  const transport: ServerTransport<CallToolResult> = {
    callServerTool: async (request, requestOptions) =>
      (await client.callTool({ name: request.name, arguments: { ...request.arguments } }, requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal })) as CallToolResult,
  };
  const actions = entry.actions.createNotesActions({
    transport,
    holds,
    present: (dataPath, text) => void lines.set(dataPath, text),
    recordRead: () => undefined,
  });

  const archiveAction =
    options.guard === undefined ? actions.archiveNote : entry.guarded.createGuardedArchive({ transport, requireSession: entry.actions.createSessionPrerequisite(transport), environment: options.guard });
  const Archive = entry.componentKind<RowEvents>('ActionButton');
  const host = entry.createInstanceHost({ onSetupError: (error) => void errors.push(error), ...(options.limits === undefined ? {} : { limits: options.limits }) });
  const bindings = new Map<string, ActionBinding>();
  const instances = new Map<string, ReturnType<typeof host.open<RowEvents>>>();
  host.register((view) => {
    view.watchById('row-archive', Archive, (handle) => {
      // The same definition on every row, each attachment with its own state and its own subject reader.
      bindings.set(handle.dataPath, handle.bindAction('activate', archiveAction, { subject: () => handle.read('id') }));
    });
  });
  for (const dataPath of paths) {
    instances.set(
      dataPath,
      host.open<RowEvents>({ kind: Archive, componentId: 'row-archive', dataPath, events: ['activate'], isLive: () => true, read: (field) => (field === 'id' ? rows.get(dataPath) : undefined) }),
    );
  }

  const bindingAt = (dataPath: string): ActionBinding => {
    const binding = bindings.get(dataPath);
    if (!binding) throw new Error(`no binding at ${dataPath}`);
    return binding;
  };
  const idle = (binding: ActionBinding): Promise<void> =>
    new Promise((resolve) => {
      if (binding.state.phase === 'idle') return resolve();
      const stop = binding.subscribe(() => {
        if (binding.state.phase !== 'idle') return;
        stop();
        resolve();
      });
    });
  const startPress = (dataPath: string): void => void instances.get(dataPath)?.activate('activate', new Event('click'));
  return {
    lines,
    rows,
    holds: published,
    errors,
    bindingAt,
    start: startPress,
    async press(dataPath) {
      startPress(dataPath);
      await idle(bindingAt(dataPath));
    },
    close: () => host.close(),
  };
}

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

describe('the notes actions the guide traces, on a real instance host', () => {
  it('success: the prerequisite asks once, the handler sends one protected request, and the hold is handed to its owner', async () => {
    const { alice, backend } = await start();
    const rows = mount(alice, ['/notes/0']);
    await rows.press('/notes/0');
    expect(backend.calls).toMatchObject({ isSignedIn: 1, archive: 1 }); // the prerequisite's own request is counted apart
    expect(backend.archived).toEqual(['n-1']);
    expect(rows.lines.get('/notes/0')).toBe('Archived at 1001');
    expect(rows.holds).toEqual({ pending: [], confirmed: ['n-1'] }); // transferred on success: the application owns it now
    rows.close();
  });

  it('refusal by the prerequisite: no protected request is sent, and the hold is given back', async () => {
    const { alice, backend } = await start();
    backend.signedOut.add('acct-alice');
    const rows = mount(alice, ['/notes/0']);
    await rows.press('/notes/0');
    expect(backend.calls).toMatchObject({ isSignedIn: 1, archive: 0 });
    expect(rows.lines.get('/notes/0')).toBe('Not archived: sign-in-required');
    expect(rows.holds).toEqual({ pending: [], confirmed: [] });
    rows.close();
  });

  it('refusal by the server: the request was sent, the server declared no effect, and the hold is given back', async () => {
    const { alice, backend } = await start();
    const rows = mount(alice, ['/notes/0']);
    rows.rows.set('/notes/0', 'n-3'); // someone else\u2019s note: the server decides again
    await rows.press('/notes/0');
    expect(backend.calls).toMatchObject({ isSignedIn: 1, archive: 1 });
    expect(backend.archived).toEqual([]);
    expect(rows.lines.get('/notes/0')).toBe('The server declined; nothing changed');
    expect(rows.holds).toEqual({ pending: [], confirmed: [] });
    rows.close();
  });

  it('permission withdrawn after a valid session: the prerequisite proceeds and the server, deciding again, declares no effect', async () => {
    const { alice, backend } = await start();
    backend.revoked.add('acct-alice');
    const rows = mount(alice, ['/notes/0']);
    await rows.press('/notes/0');
    expect(backend.calls).toMatchObject({ isSignedIn: 1, archive: 1 });
    expect(backend.archived).toEqual([]);
    expect(rows.lines.get('/notes/0')).toBe('The server declined; nothing changed');
    expect(rows.holds).toEqual({ pending: [], confirmed: [] });
    rows.close();
  });

  it('missing authentication: the prerequisite is refused by the server\u2019s own check, so nothing protected is sent', async () => {
    const { anonymous, backend } = await start();
    const rows = mount(anonymous, ['/notes/0']);
    await rows.press('/notes/0');
    expect(backend.calls).toEqual({ notesFor: 0, isSignedIn: 0, archive: 0 });
    expect(rows.lines.get('/notes/0')).toBe('Not archived: sign-in-required');
    rows.close();
  });

  it('one definition on two rows keeps independent pending state', async () => {
    const { alice, backend, hold, release } = await start();
    const rows = mount(alice, ['/notes/0', '/notes/1']);
    hold('archive');
    rows.start('/notes/0');
    await eventually(() => backend.calls.archive === 1);
    expect(rows.bindingAt('/notes/0').state.phase).toBe('running');
    expect(rows.bindingAt('/notes/1').state.phase).toBe('idle'); // the other row is not pending
    expect(rows.holds.pending).toEqual(['n-1']);

    const second = rows.press('/notes/1'); // the second row presses while the first is still pending
    await eventually(() => backend.calls.archive === 2);
    expect(rows.holds.pending.sort()).toEqual(['n-1', 'n-2']);
    release('archive');
    await second;
    await eventually(() => rows.bindingAt('/notes/0').state.phase === 'idle');
    expect(backend.archived.sort()).toEqual(['n-1', 'n-2']);
    expect(rows.holds).toEqual({ pending: [], confirmed: ['n-1', 'n-2'] });
    rows.close();
  });

  it('a recycled row: the subject reader cancels the old press, and the old row\u2019s hooks write nothing for the new note', async () => {
    const { alice, backend, hold, release } = await start();
    const rows = mount(alice, ['/notes/0']);
    hold('archive');
    rows.start('/notes/0');
    await eventually(() => backend.calls.archive === 1);
    rows.rows.set('/notes/0', 'n-2'); // the same rendered row now shows another note; its component ID did not change
    release('archive');
    await eventually(() => rows.bindingAt('/notes/0').state.phase === 'idle');
    expect(backend.archived).toEqual(['n-1']); // cancellation did not stop the server: the first note was archived
    expect(rows.lines.get('/notes/0')).toBeUndefined(); // and its outcome was not written on the row that now shows n-2
    expect(rows.holds.pending).toEqual([]); // the hold the press took was given back, not handed over
    rows.close();
  });

  it('disposing the binding cancels an undecided press, gives back its hold and writes nothing', async () => {
    const { alice, backend, hold, release } = await start();
    const rows = mount(alice, ['/notes/0']);
    hold('archive');
    rows.start('/notes/0');
    await eventually(() => backend.calls.archive === 1);
    rows.bindingAt('/notes/0').dispose();
    expect(rows.bindingAt('/notes/0').state.phase).toBe('disposed');
    await eventually(() => rows.holds.pending.length === 0);
    release('archive');
    await eventually(() => backend.archived.length === 1);
    expect(rows.lines.get('/notes/0')).toBeUndefined();
    expect(rows.holds).toEqual({ pending: [], confirmed: [] }); // stale cleanup did not confirm anything
    rows.close();
  });

  it('a work deadline that expires reports an unknown outcome, and the late write still happens: a timeout is not a rollback', async () => {
    const { alice, backend, hold, release } = await start();
    const rows = mount(alice, ['/notes/0'], { limits: { deadlineMs: 150 } });
    hold('archive');
    await rows.press('/notes/0');
    expect(rows.lines.get('/notes/0')).toBe('Archive status unknown');
    expect(rows.holds).toEqual({ pending: [], confirmed: [] });
    release('archive');
    await eventually(() => backend.archived.length === 1); // the server went on and applied it
    expect(backend.archived).toEqual(['n-1']);
    rows.close();
  });

  it('a layout ID that no longer matches the setup finds nothing: the control is unbound, no error is raised and nothing is sent', async () => {
    const { backend } = await start();
    const errors: unknown[] = [];
    const Archive = entry.componentKind<RowEvents>('ActionButton');
    const host = entry.createInstanceHost({ onSetupError: (error) => void errors.push(error) });
    const found: string[] = [];
    host.register((view) => view.watchById('row-archive', Archive, (handle) => void found.push(handle.id)));
    // The layout renamed the control; the setup still watches for the old ID.
    const renamed = host.open<RowEvents>({ kind: Archive, componentId: 'row-archive-renamed', dataPath: '/notes/0', events: ['activate'], isLive: () => true, read: () => undefined });
    expect(renamed.activate('activate', new Event('click'))).toBe('unbound');
    expect(found).toEqual([]);
    expect(errors).toEqual([]);
    expect(backend.calls).toEqual({ notesFor: 0, isSignedIn: 0, archive: 0 });
    host.close();
  });

  it('refuses invalid explicit limits instead of replacing them with defaults', () => {
    expect(() => entry.createInstanceHost({ onSetupError: () => undefined, limits: { deadlineMs: 0 } })).toThrow(TypeError);
    expect(() => entry.createInstanceHost({ onSetupError: () => undefined, limits: { hookMs: Number.NaN } })).toThrow(TypeError);
    expect(() => entry.Action.local('x').run(() => undefined).limits({ deadlineMs: -1 })).toThrow(TypeError);
  });
});

describe('the guide\u2019s second and third prerequisites: confirmation and a durable audit entry, after the session check', () => {
  interface Trace {
    readonly asked: string[];
    readonly audit: Map<string, { noteId: string; result: string }>;
    declineWith?: 'no' | 'audit-down';
    readonly environment: Guarded.GuardEnvironment;
  }

  function trace(options: { decline?: boolean; auditDown?: boolean } = {}): Trace {
    const asked: string[] = [];
    const audit = new Map<string, { noteId: string; result: string }>();
    return {
      asked,
      audit,
      environment: {
        confirm: async (noteId) => {
          asked.push(noteId);
          return options.decline !== true;
        },
        record: async ({ noteId }) => {
          if (options.auditDown === true) throw new Error('the audit store is down');
          const id = `audit-${audit.size + 1}`;
          audit.set(id, { noteId, result: 'pending' });
          return id;
        },
        settle: (auditId, result) => void audit.set(auditId, { noteId: audit.get(auditId)?.noteId ?? '', result }),
      },
    };
  }

  it('runs in the order written, and the allowed press sends one protected request after one audit entry', async () => {
    const { alice, backend } = await start();
    const guard = trace();
    const rows = mount(alice, ['/notes/0'], { guard: guard.environment });
    await rows.press('/notes/0');
    expect(guard.asked).toEqual(['n-1']);
    expect([...guard.audit.values()]).toEqual([{ noteId: 'n-1', result: 'archived' }]);
    expect(backend.calls).toMatchObject({ isSignedIn: 1, archive: 1 });
    expect(backend.archived).toEqual(['n-1']);
    rows.close();
  });

  it('a declined confirmation prevents the protected request and writes no audit entry', async () => {
    const { alice, backend } = await start();
    const guard = trace({ decline: true });
    const rows = mount(alice, ['/notes/0'], { guard: guard.environment });
    await rows.press('/notes/0');
    expect(guard.asked).toEqual(['n-1']);
    expect(guard.audit.size).toBe(0);
    expect(backend.calls).toMatchObject({ isSignedIn: 1, archive: 0 }); // only the session prerequisite\u2019s own request
    rows.close();
  });

  it('an audit store that is down refuses before the protected request is sent', async () => {
    const { alice, backend } = await start();
    const guard = trace({ auditDown: true });
    const rows = mount(alice, ['/notes/0'], { guard: guard.environment });
    await rows.press('/notes/0');
    expect(guard.audit.size).toBe(0);
    expect(backend.calls.archive).toBe(0);
    rows.close();
  });

  it('an invalid session stops the sequence at the first prerequisite: the person is not asked and nothing is audited', async () => {
    const { alice, backend } = await start();
    backend.signedOut.add('acct-alice');
    const guard = trace();
    const rows = mount(alice, ['/notes/0'], { guard: guard.environment });
    await rows.press('/notes/0');
    expect(guard.asked).toEqual([]);
    expect(guard.audit.size).toBe(0);
    expect(backend.calls).toMatchObject({ isSignedIn: 1, archive: 0 });
    rows.close();
  });

  it('server authorization still runs: every prerequisite proceeded, the server refused, and the audit entry stays unknown', async () => {
    const { alice, backend } = await start();
    backend.revoked.add('acct-alice'); // the session is valid, the permission was withdrawn
    const guard = trace();
    const rows = mount(alice, ['/notes/0'], { guard: guard.environment });
    await rows.press('/notes/0');
    expect(backend.calls.archive).toBe(1);
    expect(backend.archived).toEqual([]);
    expect([...guard.audit.values()]).toEqual([{ noteId: 'n-1', result: 'unknown' }]);
    rows.close();
  });
});
