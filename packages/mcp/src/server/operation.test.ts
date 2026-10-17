import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
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

// The connector is exercised the way an application uses it: operations declared on an
// application-owned MCP server, served over real Streamable HTTP, called by a real MCP client.
// The domain here (notes) is deliberately unrelated to any SAGA application.

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
} as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const NoteInput = z.object({ noteId: z.string().min(1).max(16) });
const NoteOutput = z.strictObject({ noteId: z.string().min(1).max(16), text: z.string().max(40), owner: z.string().optional() });

interface NoteRecord {
  readonly id: string;
  readonly text: string;
  /** Present on the backend record; never published. */
  readonly internalNotes: string;
}

const notes: readonly NoteRecord[] = [
  { id: 'n1', text: 'first note', internalNotes: 'canary-internal-1' },
  { id: 'n2', text: 'second note', internalNotes: 'canary-internal-2' },
];

interface Calls {
  readonly inputs: unknown[];
  readonly identities: unknown[];
  readonly signals: AbortSignal[];
}

function publicNotes(overrides: Partial<PublicOperation<typeof NoteInput, typeof NoteOutput, NoteRecord>> = {}, calls?: Calls) {
  const operation: PublicOperation<typeof NoteInput, typeof NoteOutput, NoteRecord> = {
    name: 'get_note',
    title: 'Get note',
    description: 'Returns one public note.',
    annotations: READ_ONLY,
    input: NoteInput,
    output: NoteOutput,
    view: VIEW,
    failures: FAILURES,
    async handle(input, request) {
      calls?.inputs.push(input);
      calls?.signals.push(request.signal);
      const record = notes.find((note) => note.id === input.noteId);
      return record ? { kind: 'record', record } : { kind: 'absent' };
    },
    project: (record) => ({ text: `${record.id}: ${record.text}`, data: { noteId: record.id, text: record.text } }),
    ...overrides,
  };
  return (): McpServer => {
    const server = new McpServer({ name: 'connector-test', version: '0.0.0' });
    registerPublicOperation(server, operation);
    return server;
  };
}

interface Principal {
  readonly accountId: string;
}

const principals: Readonly<Record<string, AuthInfo>> = {
  alice: { token: 't-alice', clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId: 'acct-alice' } },
  bob: { token: 't-bob', clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId: 'acct-bob' } },
  service: { token: 't-svc', clientId: 'c', scopes: [], expiresAt: 9_999_999_999 },
};

function identityOf(authInfo: AuthInfo | undefined): Principal | undefined {
  const accountId = authInfo?.extra?.accountId;
  return typeof accountId === 'string' ? Object.freeze({ accountId }) : undefined;
}

function protectedNotes(overrides: Partial<ProtectedOperation<typeof NoteInput, typeof NoteOutput, NoteRecord, Principal>> = {}, calls?: Calls) {
  const operation: ProtectedOperation<typeof NoteInput, typeof NoteOutput, NoteRecord, Principal> = {
    name: 'get_my_note',
    title: 'Get my note',
    description: 'Returns one note for the signed-in user.',
    annotations: READ_ONLY,
    input: NoteInput,
    output: NoteOutput,
    view: VIEW,
    failures: { ...FAILURES, signInRequired: 'Sign in to see your notes.' },
    identity: identityOf,
    async handle(input, identity, request) {
      calls?.inputs.push(input);
      calls?.identities.push(identity);
      calls?.signals.push(request.signal);
      const record = notes.find((note) => note.id === input.noteId);
      return record ? { kind: 'record', record } : { kind: 'absent' };
    },
    project: (record, identity) => ({
      text: `${record.id} for ${identity.accountId}`,
      data: { noteId: record.id, text: record.text, owner: identity.accountId },
    }),
    ...overrides,
  };
  return (): McpServer => {
    const server = new McpServer({ name: 'connector-test', version: '0.0.0' });
    registerProtectedOperation(server, operation);
    return server;
  };
}

const open: { host?: TestHost } = {};

async function host(buildServer: () => McpServer, jsonResponse = true): Promise<TestHost> {
  const started = await startTestHost({
    buildServer,
    jsonResponse,
    authenticate: (credential) => (credential === undefined ? undefined : principals[credential]),
  });
  open.host = started;
  return started;
}

afterEach(async () => {
  await open.host?.close();
  open.host = undefined;
});

const newCalls = (): Calls => ({ inputs: [], identities: [], signals: [] });

describe('public operation', () => {
  it('returns the explicit projection and nothing else from the record', async () => {
    const calls = newCalls();
    const client = await (await host(publicNotes({}, calls))).connect();
    const result = await client.callTool({ name: 'get_note', arguments: { noteId: 'n1' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ noteId: 'n1', text: 'first note' });
    expect(result.content).toEqual([{ type: 'text', text: 'n1: first note' }]);
    expect(JSON.stringify(result)).not.toContain('canary-internal');
    expect(calls.inputs).toEqual([{ noteId: 'n1' }]);
  });

  it('runs without a credential and gives its handler no identity to trust', async () => {
    const calls = newCalls();
    // A credential the test host would accept is simply not consulted by a public operation.
    const client = await (await host(publicNotes({}, calls))).connect('alice');
    const result = await client.callTool({ name: 'get_note', arguments: { noteId: 'n2', accountId: 'acct-bob' } });
    expect(result.isError).toBeFalsy();
    expect(calls.inputs).toEqual([{ noteId: 'n2' }]); // the undeclared field never reaches the handler
    expect(calls.identities).toEqual([]);
  });

  it('declares a read-only tool linked to a view resource that carries the declared CSP', async () => {
    const client = await (await host(publicNotes())).connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['get_note']);
    expect(tools[0]?.annotations).toMatchObject(READ_ONLY);
    expect(tools[0]?._meta).toMatchObject({ ui: { resourceUri: VIEW.uri } });
    const { contents } = await client.readResource({ uri: VIEW.uri });
    expect(contents[0]).toMatchObject({ uri: VIEW.uri, mimeType: RESOURCE_MIME_TYPE, text: VIEW.html });
    expect(contents[0]?._meta).toEqual({ ui: { csp: CLOSED_VIEW_CSP } });
  });

  it.each([
    ['a missing field', {}],
    ['a wrongly typed field', { noteId: 7 }],
    ['an over-long field', { noteId: 'x'.repeat(17) }],
  ])('refuses %s before its handler runs', async (_name, args) => {
    const calls = newCalls();
    const client = await (await host(publicNotes({}, calls))).connect();
    const result = await client.callTool({ name: 'get_note', arguments: args }).catch((error: unknown) => error);
    const failed = result instanceof Error || (result as { isError?: boolean }).isError === true;
    expect(failed).toBe(true);
    expect(calls.inputs).toEqual([]);
  });

  it('answers an absent record with the declared text and no data', async () => {
    const client = await (await host(publicNotes())).connect();
    const result = await client.callTool({ name: 'get_note', arguments: { noteId: 'nope' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.absent }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it.each([
    ['rejects', async () => Promise.reject(new Error('backend exploded: canary-secret'))],
    [
      'throws',
      () => {
        throw new Error('backend exploded: canary-secret');
      },
    ],
  ])('turns a handler that %s into the declared unavailable text without its message', async (_name, handle) => {
    const client = await (await host(publicNotes({ handle }))).connect();
    const result = await client.callTool({ name: 'get_note', arguments: { noteId: 'n1' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.unavailable }]);
    expect(JSON.stringify(result)).not.toContain('canary-secret');
  });

  it('does not publish a projection that breaks the output contract, nor the validator message', async () => {
    const project: PublicOperation<typeof NoteInput, typeof NoteOutput, NoteRecord>['project'] = (record) => ({
      text: record.text,
      // Over the declared 40-character bound, plus a field the strict contract does not declare.
      data: { noteId: record.id, text: 'z'.repeat(41), extra: record.internalNotes } as never,
    });
    const client = await (await host(publicNotes({ project }))).connect();
    const result = await client.callTool({ name: 'get_note', arguments: { noteId: 'n1' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.invalidOutput }]);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('canary-internal');
    expect(JSON.stringify(result)).not.toMatch(/too_big|Unrecognized|expected/i);
  });
});

describe('waiting for a handler', () => {
  it('returns the unavailable text when the handler outlasts its bound, and a late record is not returned', async () => {
    let release: (outcome: { kind: 'record'; record: NoteRecord }) => void = () => undefined;
    const late = new Promise<{ kind: 'record'; record: NoteRecord }>((resolve) => (release = resolve));
    const client = await (await host(publicNotes({ boundMs: 40, handle: () => late }))).connect();
    const result = await client.callTool({ name: 'get_note', arguments: { noteId: 'n1' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.unavailable }]);
    release({ kind: 'record', record: notes[0] as NoteRecord }); // resolves after the answer was sent
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.structuredContent).toBeUndefined();
  });

  it('aborts the handler’s signal when the caller disconnects, and its late record has nowhere to go', async () => {
    const signals: AbortSignal[] = [];
    let release: (outcome: { kind: 'record'; record: NoteRecord }) => void = () => undefined;
    const pending = new Promise<{ kind: 'record'; record: NoteRecord }>((resolve) => (release = resolve));
    const started = await host(
      publicNotes({
        handle: (_input, request) => {
          signals.push(request.signal);
          return pending;
        },
      }),
    );
    const controller = new AbortController();
    const call = fetch(started.url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_note', arguments: { noteId: 'n1' } } }),
    }).catch((error: unknown) => error);
    await expect.poll(() => signals.length).toBe(1);
    controller.abort();
    await call;
    await expect.poll(() => signals[0]?.aborted).toBe(true);
    release({ kind: 'record', record: notes[0] as NoteRecord });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The handler ran once; a fresh call is served normally by a fresh handler invocation.
    const client = await started.connect();
    release({ kind: 'record', record: notes[0] as NoteRecord });
    const next = await client.callTool({ name: 'get_note', arguments: { noteId: 'n1' } });
    expect(next.structuredContent).toEqual({ noteId: 'n1', text: 'first note' });
    expect(signals).toHaveLength(2);
  });
});

describe('progress and delayed completion', () => {
  const slowHandle: PublicOperation<typeof NoteInput, typeof NoteOutput, NoteRecord>['handle'] = async (_input, request) => {
    await request.reportProgress({ progress: 1, total: 2, message: 'looking' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await request.reportProgress({ progress: 2, total: 2, message: 'found' });
    return { kind: 'record', record: notes[0] as NoteRecord };
  };

  it('streams progress before the result when the host answers with server-sent events', async () => {
    const client = await (await host(publicNotes({ handle: slowHandle }), false)).connect();
    const seen: string[] = [];
    const result = await client.callTool(
      { name: 'get_note', arguments: { noteId: 'n1' } },
      { onprogress: (progress) => void seen.push(`${progress.progress}/${progress.total}:${progress.message}`) },
    );
    expect(seen).toEqual(['1/2:looking', '2/2:found']);
    expect(result.structuredContent).toEqual({ noteId: 'n1', text: 'first note' });
  });

  it('completes the delayed result over a single JSON body without failing the call', async () => {
    const client = await (await host(publicNotes({ handle: slowHandle }), true)).connect();
    const result = await client.callTool(
      { name: 'get_note', arguments: { noteId: 'n1' } },
      { onprogress: () => undefined },
    );
    expect(result.structuredContent).toEqual({ noteId: 'n1', text: 'first note' });
  });

  it('drops progress reported after the operation has finished', async () => {
    const lateReports: Promise<void>[] = [];
    const handle: PublicOperation<typeof NoteInput, typeof NoteOutput, NoteRecord>['handle'] = async (_input, request) => {
      setTimeout(() => lateReports.push(request.reportProgress({ progress: 9, total: 9, message: 'late' })), 50);
      return { kind: 'record', record: notes[0] as NoteRecord };
    };
    const client = await (await host(publicNotes({ handle }), false)).connect();
    const seen: string[] = [];
    await client.callTool(
      { name: 'get_note', arguments: { noteId: 'n1' } },
      { onprogress: (progress) => void seen.push(String(progress.message)) },
    );
    await expect.poll(() => lateReports.length).toBe(1);
    await expect(lateReports[0]).resolves.toBeUndefined(); // a quiet no-op, not an error
    expect(seen).toEqual([]);
  });
});

describe('protected operation', () => {
  it('gives the handler only the identity the transport verified for that request', async () => {
    const calls = newCalls();
    const client = await (await host(protectedNotes({}, calls))).connect('alice');
    const result = await client.callTool({ name: 'get_my_note', arguments: { noteId: 'n1' } });
    expect(result.structuredContent).toEqual({ noteId: 'n1', text: 'first note', owner: 'acct-alice' });
    expect(calls.identities).toEqual([{ accountId: 'acct-alice' }]);
  });

  it('keeps concurrent principals apart', async () => {
    const calls = newCalls();
    const started = await host(protectedNotes({}, calls));
    const [alice, bob] = await Promise.all([started.connect('alice'), started.connect('bob')]);
    const results = await Promise.all(
      Array.from({ length: 24 }, (_unused, index) =>
        (index % 2 === 0 ? alice : bob).callTool({ name: 'get_my_note', arguments: { noteId: 'n1' } }),
      ),
    );
    results.forEach((result, index) => {
      expect(result.structuredContent).toMatchObject({ owner: index % 2 === 0 ? 'acct-alice' : 'acct-bob' });
    });
    expect(calls.identities).toHaveLength(24);
  });

  it('ignores an account forged in the arguments', async () => {
    const calls = newCalls();
    const client = await (await host(protectedNotes({}, calls))).connect('alice');
    const result = await client.callTool({
      name: 'get_my_note',
      arguments: { noteId: 'n1', accountId: 'acct-bob', owner: 'acct-bob' },
    });
    expect(result.structuredContent).toMatchObject({ owner: 'acct-alice' });
    expect(calls.inputs).toEqual([{ noteId: 'n1' }]);
    expect(calls.identities).toEqual([{ accountId: 'acct-alice' }]);
  });

  it.each([
    ['no credential', undefined],
    ['a credential naming no account', 'service'],
  ])('refuses %s with the declared sign-in text and never runs the handler', async (_name, credential) => {
    const calls = newCalls();
    const client = await (await host(protectedNotes({}, calls))).connect(credential);
    const result = await client.callTool({ name: 'get_my_note', arguments: { noteId: 'n1' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Sign in to see your notes.' }]);
    expect(calls.inputs).toEqual([]);
  });

  it('says only the declared unavailable text when the identity resolver throws, and never runs the handler', async () => {
    const calls = newCalls();
    const identity = () => {
      throw new Error('canary-private-identity-diagnostic');
    };
    const client = await (await host(protectedNotes({ identity }, calls))).connect('alice');
    const result = await client.callTool({ name: 'get_my_note', arguments: { noteId: 'n1' } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: FAILURES.unavailable }]);
    expect(JSON.stringify(result)).not.toContain('canary-private-identity-diagnostic');
    expect(calls.inputs).toEqual([]);
  });

  it('applies the same output validation and absent text as a public operation', async () => {
    const client = await (await host(protectedNotes())).connect('bob');
    const absent = await client.callTool({ name: 'get_my_note', arguments: { noteId: 'nope' } });
    expect(absent.content).toEqual([{ type: 'text', text: FAILURES.absent }]);
  });
});

describe('registration', () => {
  const server = () => new McpServer({ name: 'connector-test', version: '0.0.0' });

  it.each([
    ['an identity resolver', { identity: undefined }, /identity/],
    ['a sign-in failure text', { failures: FAILURES }, /signInRequired/],
    ['a projection', { project: undefined }, /project/],
    ['a view', { view: undefined }, /view/],
    ['an output contract', { output: undefined }, /output/],
  ])('refuses a protected operation without %s, before registering anything', (_name, change, missing) => {
    const target = server();
    const complete = {
      name: 'get_my_note',
      title: 'Get my note',
      description: 'Returns one note for the signed-in user.',
      annotations: READ_ONLY,
      input: NoteInput,
      output: NoteOutput,
      view: VIEW,
      failures: { ...FAILURES, signInRequired: 'Sign in.' },
      identity: identityOf,
      handle: async () => ({ kind: 'absent' as const }),
      project: () => ({ text: '', data: { noteId: 'n1', text: '' } }),
    };
    const incomplete = { ...complete, ...change } as unknown as ProtectedOperation<typeof NoteInput, typeof NoteOutput, NoteRecord, Principal>;
    expect(() => registerProtectedOperation(target, incomplete)).toThrow(OperationConfigurationError);
    expect(() => registerProtectedOperation(target, incomplete)).toThrow(missing);
    expect(() => registerProtectedOperation(target, incomplete)).not.toThrow(/Bearer|token|secret/i);
    // Nothing was served: the same name registers cleanly afterwards.
    expect(() => registerProtectedOperation(target, complete)).not.toThrow();
  });

  it('refuses a public operation without a handler', () => {
    const incomplete = {
      name: 'get_note',
      title: 'Get note',
      description: 'x',
      annotations: READ_ONLY,
      input: NoteInput,
      output: NoteOutput,
      view: VIEW,
      failures: FAILURES,
      project: () => ({ text: '', data: { noteId: 'n1', text: '' } }),
    } as unknown as PublicOperation<typeof NoteInput, typeof NoteOutput, NoteRecord>;
    expect(() => registerPublicOperation(server(), incomplete)).toThrow(/handle/);
  });

  it('refuses a bound that is not finite and positive', () => {
    const operation = publicNotes({ boundMs: Number.POSITIVE_INFINITY });
    expect(() => operation()).toThrow(OperationConfigurationError);
  });
});
