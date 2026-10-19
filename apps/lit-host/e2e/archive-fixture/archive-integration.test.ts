import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import {
  Action,
  createInstanceHost,
  componentKind,
  proceed,
  prerequisite,
  type ActionBinding,
  type InstanceEvent,
  type Limits,
  type ServerTransport,
} from '@saga-a2ui/core/actions';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { archiveNoteWith, requireNoteId, type ArchiveEnvironment, type ArchiveMessage } from './archive.js';

// ACT6 against the real local stack, with no stand-in for the transport: the MCP Apps `App` is the
// action's transport, a real `AppBridge` plays the host over an in-memory pair, and the host
// forwards each proxied `tools/call` to a real `McpServer` through a real MCP `Client`. Only the
// renderer is absent (a small instance stands in for a rendered control), and the browser spec
// covers the real DOM. This is local integration. It says nothing about ChatGPT or Claude: whether
// an actual host forwards an abort, enforces a timeout or tolerates a stalled forward is unobserved.

// The real pinned types, not declarations written for the Blueprint: if the SDK's `App` stopped
// being usable as a transport, or its reply stopped being assignable, this file would not compile.
const appIsATransport = (app: App): ServerTransport<CallToolResult> => app;
void appIsATransport;

type Press = InstanceEvent<string>;
const Row = componentKind<{ readonly activate: Press }>('Row');

interface ServerSide {
  /** The server-owned truth: note ids it actually archived, and every request that reached its handler. */
  readonly archived: string[];
  readonly handled: string[];
}

function archiveServer(): { server: McpServer; side: ServerSide } {
  const side: ServerSide = { archived: [], handled: [] };
  const server = new McpServer({ name: 'notes', version: '0.0.0' });
  server.registerTool('archive_note', { inputSchema: z.object({ noteId: z.string() }) }, async ({ noteId }) => {
    side.handled.push(noteId);
    // The server authorizes on its own: a client-side session check changes nothing here.
    if (noteId === 'n-locked') return { content: [{ type: 'text', text: 'not yours' }], isError: true };
    side.archived.push(noteId);
    return { content: [{ type: 'text', text: 'archived' }], structuredContent: { archivedAt: 7 } };
  });
  return { server, side };
}

interface Stack {
  readonly app: App;
  readonly side: ServerSide;
  /** Every proxied call the host received, with whether the host's request was told to stop. */
  readonly forwarded: { readonly name: string; aborted: boolean }[];
  /** Holds the next proxied call at the host until released: a stalled forward. */
  holdNext(options?: { honorAbort?: boolean }): { release(): void };
}

const open: { close(): Promise<void> }[] = [];

async function stack(): Promise<Stack> {
  const { server, side } = archiveServer();
  const client = new Client({ name: 'host-client', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const forwarded: Stack['forwarded'] = [];
  let hold: { gate: Promise<void>; honorAbort: boolean } | undefined;
  const app = new App({ name: 'view', version: '0.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'host', version: '0.0.0' }, { serverTools: {} });
  bridge.oncalltool = async (params, extra) => {
    const entry = { name: params.name, aborted: false };
    forwarded.push(entry);
    extra.mcpReq.signal.addEventListener('abort', () => (entry.aborted = true), { once: true });
    if (hold !== undefined) {
      const waiting = hold;
      hold = undefined;
      // A host that does not honor the abort keeps going: it forwards the call when released.
      await waiting.gate;
      if (waiting.honorAbort && extra.mcpReq.signal.aborted) throw new Error('the host stopped');
    }
    return client.callTool(params);
  };
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  await app.connect(viewSide);
  open.push({
    close: async () => {
      await app.close().catch(() => undefined);
      await bridge.close().catch(() => undefined);
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  });
  return {
    app,
    side,
    forwarded,
    holdNext(options) {
      let release!: () => void;
      hold = { gate: new Promise<void>((resolve) => void (release = resolve)), honorAbort: options?.honorAbort ?? false };
      return { release };
    },
  };
}

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
});

interface Screen {
  readonly shown: { noteId: string | undefined; message: ArchiveMessage }[];
  readonly checks: { sessions: number; confirms: number; audits: number; records: string[] };
}

function environmentFor(transport: ServerTransport<CallToolResult>, overrides: Partial<ArchiveEnvironment> = {}): { environment: ArchiveEnvironment; screen: Screen } {
  const screen: Screen = { shown: [], checks: { sessions: 0, confirms: 0, audits: 0, records: [] } };
  const environment: ArchiveEnvironment = {
    transport,
    session: async () => {
      screen.checks.sessions += 1;
      return { userKey: 'u-1' };
    },
    confirm: async () => {
      screen.checks.confirms += 1;
      return true;
    },
    audit: async () => {
      screen.checks.audits += 1;
      return true;
    },
    recordArchived: async (noteId) => void screen.checks.records.push(noteId),
    refreshList: async () => undefined,
    show: (noteId, message) => void screen.shown.push({ noteId, message }),
    ...overrides,
  };
  return { environment, screen };
}

/** A rendered Archive control for one note. Several can share one component id, as repeated rows do. */
function renderRow(
  definition: ReturnType<typeof archiveNoteWith<Press>>,
  noteId: string,
  options: { subject?: () => unknown; limits?: Limits } = {},
): { press(): void; binding: ActionBinding; retire(): void; showNote(next: string): void } {
  const host = createInstanceHost({ onSetupError: (error) => { throw error; }, ...(options.limits === undefined ? {} : { limits: options.limits }) });
  let shows = noteId;
  let live = true;
  const instance = host.open({
    kind: Row,
    componentId: 'row-archive', // the same id for every row
    dataPath: `/notes/${noteId}`,
    events: ['activate'],
    isLive: () => live,
    read: (path) => (path === 'id' ? shows : undefined),
  });
  let binding: ActionBinding | undefined;
  host.register((view) => {
    view.watchById('row-archive', Row, (handle) => {
      binding = handle.bindAction('activate', definition, options.subject === undefined ? { subject: () => handle.read('id') } : { subject: options.subject });
    });
  });
  if (binding === undefined) throw new Error('nothing was bound');
  return {
    press: () => void instance.activate('activate', 'click'),
    binding,
    retire: () => {
      live = false;
      instance.retire();
    },
    showNote: (next) => void (shows = next),
  };
}

const noteOf = (event: Press): string => requireNoteId(event.read('id'));
const settleLong = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('Archive through the real App, AppBridge and MCP server', () => {
  it('archives the note each of two repeated rows shows, once each, and the server agrees', async () => {
    const { app, side, forwarded } = await stack();
    const { environment, screen } = environmentFor(app);
    const archive = archiveNoteWith(noteOf, environment);
    const first = renderRow(archive, 'n-1');
    const second = renderRow(archive, 'n-2');

    second.press();
    await expect.poll(() => screen.shown.length).toBe(1);
    first.press();
    await expect.poll(() => screen.shown.length).toBe(2);

    expect(screen.shown.map((entry) => [entry.noteId, entry.message.kind])).toEqual([
      ['n-2', 'archived'],
      ['n-1', 'archived'],
    ]);
    expect(side.archived).toEqual(['n-2', 'n-1']);
    expect(forwarded.map((entry) => entry.name)).toEqual(['archive_note', 'archive_note']);
    // Each activation ran each prerequisite once: they are accounted for apart from the archive request.
    expect(screen.checks).toMatchObject({ sessions: 2, confirms: 2, audits: 2 });
    expect(screen.checks.records.sort()).toEqual(['n-1', 'n-2']);
  });

  it('lets the server refuse what every local prerequisite allowed, and reports a returned tool-level failure as declined', async () => {
    const { app, side } = await stack();
    const { environment, screen } = environmentFor(app);
    renderRow(archiveNoteWith(noteOf, environment), 'n-locked').press();

    await expect.poll(() => screen.shown.length).toBe(1);
    expect(screen.shown[0]).toEqual({ noteId: 'n-locked', message: { kind: 'declined', retry: true } });
    expect(screen.checks).toMatchObject({ sessions: 1, confirms: 1, audits: 1 });
    expect(side.handled).toEqual(['n-locked']); // the server was asked and decided on its own
    expect(side.archived).toEqual([]);
  });

  it('sends no archive request when the session prerequisite refuses, and the host sees nothing', async () => {
    const { app, side, forwarded } = await stack();
    const { environment, screen } = environmentFor(app, { session: async () => undefined });
    renderRow(archiveNoteWith(noteOf, environment), 'n-1').press();

    await expect.poll(() => screen.shown.length).toBe(1);
    expect(screen.shown[0]?.message).toEqual({ kind: 'not-sent', why: 'session: sign-in-required', retry: true });
    expect(forwarded).toEqual([]);
    expect(side.handled).toEqual([]);
  });

  it('keeps the effect unknown, and offers no retry, when the host rejects the forwarded call', async () => {
    const { app, side } = await stack();
    const rejecting = {
      callServerTool: () => Promise.reject(new Error('the host refused the call')),
    } satisfies ServerTransport<CallToolResult>;
    const { environment, screen } = environmentFor(rejecting);
    renderRow(archiveNoteWith(noteOf, environment), 'n-1').press();
    await expect.poll(() => screen.shown.length).toBe(1);
    expect(screen.shown[0]?.message).toEqual({ kind: 'status-unknown', retry: false });
    expect(side.handled).toEqual([]);
    void app;
  });

  it('keeps the archived result when the required client work fails, and sends no second request', async () => {
    const { app, side, forwarded } = await stack();
    const { environment, screen } = environmentFor(app, {
      recordArchived: async () => {
        throw new Error('the view could not record it');
      },
    });
    renderRow(archiveNoteWith(noteOf, environment), 'n-1').press();

    await expect.poll(() => screen.shown.length).toBe(1);
    expect(screen.shown[0]?.message).toEqual({ kind: 'archived-view-failed', archivedAt: 7 });
    expect(side.archived).toEqual(['n-1']);
    expect(forwarded).toHaveLength(1);
  });

  it('reports a status-unknown timeout at the work deadline, though the stalled host later archives the note: an abort is not a rollback', async () => {
    const { app, side, forwarded, holdNext } = await stack();
    const { environment, screen } = environmentFor(app);
    const stalled = holdNext({ honorAbort: false });
    // The application's SDK-instance configuration, not the action: the definition declares no limits.
    const row = renderRow(archiveNoteWith(noteOf, environment), 'n-1', { limits: { deadlineMs: 60, hookMs: 40 } });

    row.press();
    await expect.poll(() => screen.shown.length).toBe(1);
    expect(screen.shown[0]?.message).toEqual({ kind: 'status-unknown', retry: false });
    // Local only: this AppBridge was told to stop. Whether an actual host would be is unobserved.
    expect(forwarded[0]?.aborted).toBe(true);
    expect(side.archived).toEqual([]);

    stalled.release(); // the host did not honor the abort and forwards the call anyway
    await expect.poll(() => side.archived).toEqual(['n-1']);
    await settleLong();
    expect(screen.shown).toHaveLength(1); // the late reply presents nothing and changes nothing
    expect(forwarded).toHaveLength(1);
    void app;
  });

  it('reports a canceled, effect-unknown outcome when the row retires during the request', async () => {
    const { app, side, forwarded, holdNext } = await stack();
    const { environment, screen } = environmentFor(app);
    const stalled = holdNext({ honorAbort: false });
    const row = renderRow(archiveNoteWith(noteOf, environment), 'n-1');

    row.press();
    await expect.poll(() => forwarded.length).toBe(1);
    row.retire();
    await expect.poll(() => forwarded[0]?.aborted).toBe(true);

    stalled.release();
    await expect.poll(() => side.archived).toEqual(['n-1']); // the server applied it all the same
    await settleLong();
    // The retired instance presents nothing: its hooks are obsolete, so the user is told nothing false.
    expect(screen.shown.filter((entry) => entry.message.kind === 'archived')).toEqual([]);
    expect(row.binding.state.phase).toBe('disposed');
    void app;
  });

  it('narrows the SDK timeout to the handler’s request, and a transport timeout leaves the effect unknown', async () => {
    const { app, side, holdNext } = await stack();
    const outcomes: string[] = [];
    const stalled = holdNext({ honorAbort: true });
    const short = Action.server<Press, CallToolResult>('short', app)
      .before(prerequisite('session', () => proceed()))
      .run(({ call }) => call('archive_note', { noteId: 'n-1' }, { timeoutMs: 40 }))
      .onFailure(({ stage, failure }) => void outcomes.push(`${stage}:${failure.kind}`))
      .build();
    const host = createInstanceHost({ onSetupError: (error) => { throw error; } });
    const instance = host.open({ kind: Row, componentId: 'r', dataPath: '/', events: ['activate'], isLive: () => true, read: () => undefined });
    host.register((view) => view.watchById('r', Row, (handle) => void handle.bindAction('activate', short)));

    instance.activate('activate', 'click');
    await expect.poll(() => outcomes).toEqual(['running:handler-error']);
    stalled.release();
    await settleLong();
    expect(side.archived).toEqual([]);
  });
});
