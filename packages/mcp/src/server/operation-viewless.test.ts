import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CLOSED_VIEW_CSP } from '../policy/index.js';
import {
  OperationConfigurationError,
  registerProtectedOperation,
  registerPublicOperation,
  type OperationView,
  type ProtectedOperation,
  type PublicOperation,
} from './index.js';
import { startTestHost, type TestHost } from './http-host.test-support.js';

// An operation's execution guarantees do not depend on whether it presents a view. Each case
// registers the same declaration twice, once with `view` and once without, calls both over real
// Streamable HTTP and compares what a caller sees. The only difference allowed is the UI
// association, and its absence is checked separately: no `_meta` on the tool definition or on any
// result, and no resource listed.

const VIEW: OperationView = {
  uri: 'ui://test/notes.html',
  title: 'Notes view',
  html: '<!doctype html><title>notes</title>',
  csp: CLOSED_VIEW_CSP,
};

const FAILURES = {
  absent: 'No such note.',
  unavailable: 'Notes are unavailable.',
  invalidOutput: 'The note could not be shown.',
  signInRequired: 'Sign in to see your notes.',
} as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const NoteInput = z.object({ noteId: z.string().min(1).max(16) });
const NoteOutput = z.strictObject({
  noteId: z.string().min(1).max(16),
  text: z.string().max(40),
});

interface NoteRecord {
  readonly id: string;
  readonly text: string;
}
const notes: readonly NoteRecord[] = [{ id: 'n1', text: 'first note' }];

type Pub = PublicOperation<typeof NoteInput, typeof NoteOutput, NoteRecord>;
type Prot = ProtectedOperation<
  typeof NoteInput,
  typeof NoteOutput,
  NoteRecord,
  { readonly accountId: string }
>;

const publicOperation = (overrides: Partial<Pub> = {}): Pub => ({
  name: 'get_note',
  title: 'Get note',
  description: 'Returns one public note.',
  annotations: READ_ONLY,
  input: NoteInput,
  output: NoteOutput,
  failures: FAILURES,
  handle(input) {
    const record = notes.find((note) => note.id === input.noteId);
    return record ? { kind: 'record', record } : { kind: 'absent' };
  },
  project: (record) => ({
    text: `${record.id}: ${record.text}`,
    data: { noteId: record.id, text: record.text },
  }),
  ...overrides,
});

const protectedOperation = (overrides: Partial<Prot> = {}): Prot => ({
  name: 'get_my_note',
  title: 'Get my note',
  description: 'Returns one note for the signed-in user.',
  annotations: READ_ONLY,
  input: NoteInput,
  output: NoteOutput,
  failures: FAILURES,
  identity(authInfo: AuthInfo | undefined) {
    const accountId = authInfo?.extra?.accountId;
    return typeof accountId === 'string' ? { accountId } : undefined;
  },
  handle(input) {
    const record = notes.find((note) => note.id === input.noteId);
    return record ? { kind: 'record', record } : { kind: 'absent' };
  },
  project: (record, identity) => ({
    text: `${record.id} for ${identity.accountId}`,
    data: { noteId: record.id, text: record.text },
  }),
  ...overrides,
});

const alice: AuthInfo = {
  token: 't-alice',
  clientId: 'c',
  scopes: [],
  expiresAt: 9_999_999_999,
  extra: { accountId: 'acct-alice' },
};

const hosts: TestHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((one) => one.close()));
});

async function connect(buildServer: () => McpServer, credential?: string) {
  const started = await startTestHost({
    buildServer,
    jsonResponse: true,
    authenticate: (given) => (given === 'alice' ? alice : undefined),
  });
  hosts.push(started);
  return started.connect(credential);
}

const publicServer = (operation: Pub, withView: boolean) => (): McpServer => {
  const server = new McpServer({ name: 'viewless-test', version: '0.0.0' });
  registerPublicOperation(
    server,
    withView ? { ...operation, view: VIEW } : operation,
  );
  return server;
};

const protectedServer =
  (operation: Prot, withView: boolean) => (): McpServer => {
    const server = new McpServer({ name: 'viewless-test', version: '0.0.0' });
    registerProtectedOperation(
      server,
      withView ? { ...operation, view: VIEW } : operation,
    );
    return server;
  };

/** What a caller sees of a call, without the UI association, which is the one allowed difference. */
interface Seen {
  readonly threw?: string;
  readonly isError?: boolean;
  readonly content?: unknown;
  readonly structuredContent?: unknown;
  readonly meta?: unknown;
}

async function observe(
  build: () => McpServer,
  name: string,
  args: Record<string, unknown>,
  credential?: string,
): Promise<Seen> {
  const client = await connect(build, credential);
  try {
    const result = await client.callTool({ name, arguments: args });
    return {
      isError: result.isError === true,
      content: result.content,
      structuredContent: result.structuredContent,
      meta: result._meta,
    };
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

const withoutMeta = ({ meta: _meta, ...rest }: Seen): Omit<Seen, 'meta'> =>
  rest;

describe('a public operation without a view', () => {
  const cases: ReadonlyArray<
    readonly [string, Partial<Pub>, Record<string, unknown>]
  > = [
    ['a success', {}, { noteId: 'n1' }],
    ['a missing field', {}, {}],
    ['a wrongly typed field', {}, { noteId: 7 }],
    ['an over-long field', {}, { noteId: 'x'.repeat(17) }],
    [
      'a refusal',
      { handle: () => ({ kind: 'refused', text: 'Not today.' }) },
      { noteId: 'n1' },
    ],
    ['an absent record', {}, { noteId: 'nope' }],
    [
      'an over-budget handler',
      { boundMs: 40, handle: () => new Promise(() => undefined) },
      { noteId: 'n1' },
    ],
    [
      'a handler that throws',
      {
        handle: () => {
          throw new Error('backend exploded: canary-secret');
        },
      },
      { noteId: 'n1' },
    ],
    [
      'an asynchronous projection',
      {
        project: ((record: NoteRecord) =>
          Promise.resolve({
            text: record.text,
            data: { noteId: record.id, text: record.text },
          })) as unknown as Pub['project'],
      },
      { noteId: 'n1' },
    ],
    [
      'a malformed projection',
      { project: (() => 'not a projection') as unknown as Pub['project'] },
      { noteId: 'n1' },
    ],
    [
      'invalid output',
      {
        project: (record: NoteRecord) => ({
          text: record.text,
          data: { noteId: record.id, text: 'z'.repeat(41) },
        }),
      },
      { noteId: 'n1' },
    ],
  ];

  it.each(cases)(
    'gives the same result as with a view for %s, with no UI association',
    async (_name, overrides, args) => {
      const operation = publicOperation(overrides);
      const viewed = await observe(
        publicServer(operation, true),
        'get_note',
        args,
      );
      const viewless = await observe(
        publicServer(operation, false),
        'get_note',
        args,
      );
      expect(withoutMeta(viewless)).toEqual(withoutMeta(viewed));
      expect(viewless.meta).toBeUndefined();
      expect(JSON.stringify(viewless)).not.toContain('resourceUri');
      expect(JSON.stringify(viewless)).not.toContain('canary-secret');
    },
  );

  it('fails exactly as with a view where the failure is the point', async () => {
    // Guard against comparing two equally wrong answers.
    const operation = publicOperation({
      project: (() => 'nope') as unknown as Pub['project'],
    });
    const viewless = await observe(publicServer(operation, false), 'get_note', {
      noteId: 'n1',
    });
    expect(viewless).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: FAILURES.invalidOutput }],
    });
    const timedOut = await observe(
      publicServer(
        publicOperation({
          boundMs: 40,
          handle: () => new Promise(() => undefined),
        }),
        false,
      ),
      'get_note',
      { noteId: 'n1' },
    );
    expect(timedOut).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: FAILURES.unavailable }],
    });
  });

  it('cancels the handler when the caller disconnects, as with a view', async () => {
    const outcomes: Record<string, boolean> = {};
    for (const withView of [true, false]) {
      const signals: AbortSignal[] = [];
      const operation = publicOperation({
        handle: (_input, request) => {
          signals.push(request.signal);
          return new Promise(() => undefined);
        },
      });
      const started = await startTestHost({
        buildServer: publicServer(operation, withView),
        jsonResponse: true,
      });
      hosts.push(started);
      const controller = new AbortController();
      const call = fetch(started.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_note', arguments: { noteId: 'n1' } },
        }),
      }).catch((error: unknown) => error);
      await expect.poll(() => signals.length).toBe(1);
      controller.abort();
      await call;
      await expect.poll(() => signals[0]?.aborted).toBe(true);
      outcomes[withView ? 'view' : 'viewless'] = true;
    }
    expect(outcomes).toEqual({ view: true, viewless: true });
  });

  it('declares the tool with the same contracts and annotations, but no UI metadata and no resource', async () => {
    const operation = publicOperation();
    const viewed = await (
      await connect(publicServer(operation, true))
    ).listTools();
    const viewlessClient = await connect(publicServer(operation, false));
    const viewless = await viewlessClient.listTools();
    expect(viewless.tools).toHaveLength(1);
    const [one] = viewless.tools;
    const [other] = viewed.tools;
    expect(one?._meta).toBeUndefined();
    expect(other?._meta).toMatchObject({ ui: { resourceUri: VIEW.uri } });
    const { _meta: _ignored, ...viewlessRest } = one ?? {};
    const { _meta: _also, ...viewedRest } = other ?? {};
    expect(viewlessRest).toEqual(viewedRest);
    expect(viewlessRest).toMatchObject({
      name: 'get_note',
      annotations: READ_ONLY,
    });
    expect((await viewlessClient.listResources()).resources).toEqual([]);
    await expect(
      viewlessClient.readResource({ uri: VIEW.uri }),
    ).rejects.toThrow();
  });

  it('treats an explicitly undefined view as no view', async () => {
    const client = await connect(() => {
      const server = new McpServer({ name: 'viewless-test', version: '0.0.0' });
      registerPublicOperation(server, {
        ...publicOperation(),
        view: undefined,
      } as Pub);
      return server;
    });
    const { tools } = await client.listTools();
    expect(tools[0]?._meta).toBeUndefined();
  });

  it('still refuses a view that is declared but incomplete', () => {
    const server = new McpServer({ name: 'viewless-test', version: '0.0.0' });
    const incomplete = {
      ...publicOperation(),
      view: { uri: 'ui://test/notes.html' },
    } as unknown as Pub;
    expect(() => registerPublicOperation(server, incomplete)).toThrow(
      OperationConfigurationError,
    );
    expect(() => registerPublicOperation(server, incomplete)).toThrow(/view/);
  });
});

describe('a protected operation without a view', () => {
  it('gives the same results as with a view for a signed-in caller, with no UI association', async () => {
    for (const args of [{ noteId: 'n1' }, { noteId: 'nope' }, {}]) {
      const operation = protectedOperation();
      const viewed = await observe(
        protectedServer(operation, true),
        'get_my_note',
        args,
        'alice',
      );
      const viewless = await observe(
        protectedServer(operation, false),
        'get_my_note',
        args,
        'alice',
      );
      expect(withoutMeta(viewless)).toEqual(withoutMeta(viewed));
      expect(viewless.meta).toBeUndefined();
    }
  });

  it('still refuses a missing identity with the sign-in text, without running the handler, and with no UI association', async () => {
    let ran = false;
    const operation = protectedOperation({
      handle: () => {
        ran = true;
        return { kind: 'absent' };
      },
    });
    const seen = await observe(
      protectedServer(operation, false),
      'get_my_note',
      { noteId: 'n1' },
    );
    expect(seen).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: FAILURES.signInRequired }],
    });
    expect(seen.meta).toBeUndefined();
    expect(ran).toBe(false);
    const viewed = await observe(
      protectedServer(operation, true),
      'get_my_note',
      { noteId: 'n1' },
    );
    expect(withoutMeta(seen)).toEqual(withoutMeta(viewed));
  });

  it('still requires its identity resolver and sign-in text at registration', () => {
    const server = new McpServer({ name: 'viewless-test', version: '0.0.0' });
    for (const [change, missing] of [
      [{ identity: undefined }, /identity/],
      [
        { failures: { ...FAILURES, signInRequired: undefined } },
        /signInRequired/,
      ],
    ] as const) {
      expect(() =>
        registerProtectedOperation(server, {
          ...protectedOperation(),
          ...change,
        } as unknown as Prot),
      ).toThrow(missing);
    }
  });

  it('declares no UI metadata and no resource', async () => {
    const client = await connect(
      protectedServer(protectedOperation(), false),
      'alice',
    );
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool._meta)).toEqual([undefined]);
    expect((await client.listResources()).resources).toEqual([]);
  });
});
