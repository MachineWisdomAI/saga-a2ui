import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import type { FetchLike } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startListener, type Listener } from '../../templates/lit-node/server/listener.js';
import { runCli, type Environment } from '../saga.js';
import type { ValidatorLoad } from './chatgpt.js';
import { publicationTool } from './publish.js';
import { ARCHIVE_FILE, RECORD_FILE, sha256, type PublicationRecord } from './record.js';
import { readZip } from './zip.js';

// `saga publish check|prepare` as a maintainer runs it: a complete fixture application (a release
// input, assets, a build and package manifest in scripts/publish/fixture/notes-app) whose view is
// served by the real qualified lit-node listener, read through the command line. The published URL
// is a public HTTPS name; the network seam routes it to that local listener and records every
// JSON-RPC method the command sent, so "no tool was called" is observed and not assumed.

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixture', 'notes-app');
const PUBLISHED = 'https://notes.example.com/status/mcp';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-publish-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let listener: Listener;
const viewHtml = fs.readFileSync(path.join(FIXTURE, 'build', 'view.html'), 'utf8');
beforeAll(async () => {
  listener = await startListener({ html: viewHtml, verifier: { verifyAccessToken: () => Promise.reject(new Error('this fixture is public')) }, authorize: async () => true, port: 0 });
});
afterAll(async () => listener.close());

/** A fresh copy of the fixture application that a case may damage. */
function copyFixture(): string {
  const directory = fs.mkdtempSync(path.join(root, 'app-'));
  fs.cpSync(FIXTURE, directory, { recursive: true });
  return directory;
}

const workspace = (): string => fs.mkdtempSync(path.join(root, 'cwd-'));
const editInput = (app: string, change: (input: Record<string, any>) => void): void => {
  const file = path.join(app, 'saga-publication.json');
  const input = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
  change(input);
  fs.writeFileSync(file, JSON.stringify(input, null, 2));
};

interface Wire {
  /** Every JSON-RPC method the command sent to the endpoint, in order. */
  readonly methods: string[];
  readonly fetch: FetchLike;
}

/** The network seam: routes the published URL to the local listener and records the methods sent. */
function wire(rewrite?: (method: string, response: Response) => Promise<Response> | Response): Wire {
  const methods: string[] = [];
  return {
    methods,
    fetch: async (_url, init) => {
      let method = init?.method ?? 'GET';
      if (typeof init?.body === 'string') method = (JSON.parse(init.body) as { method?: string }).method ?? method;
      methods.push(method);
      const response = await fetch(listener.statusUrl, init);
      return rewrite === undefined ? response : rewrite(method, response);
    },
  };
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

interface Options {
  readonly cwd?: string;
  readonly wire?: Wire;
  readonly validators?: ValidatorLoad;
  readonly environment?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly onOutput?: (text: string) => void;
}

async function saga(args: readonly string[], options: Options = {}): Promise<Run> {
  let out = '';
  let err = '';
  const environment: Environment = {
    cwd: options.cwd ?? workspace(),
    sdkVersion: () => '0.0.0-candidate.g0123456789ab',
    stageDemo: () => Promise.reject(new Error('publish builds no demonstration')),
    publication: { load: async () => publicationTool, environment: options.environment ?? {}, fetch: (options.wire ?? wire()).fetch, validators: options.validators },
    stdout: (text) => {
      out += text;
      options.onOutput?.(text);
    },
    stderr: (text) => (err += text),
    signal: options.signal,
  };
  return { code: await runCli(args, environment), out, err };
}

const release = (app: string): string => path.join(app, 'saga-publication.json');
const check = (app: string, options?: Options, extra: string[] = []): Promise<Run> => saga(['publish', 'check', '--target', 'chatgpt', '--release', release(app), ...extra], options);
const prepare = (app: string, out: string, options?: Options, extra: string[] = []): Promise<Run> => saga(['publish', 'prepare', '--target', 'chatgpt', '--release', release(app), '--out', out, ...extra], options);

const recordOf = (directory: string): PublicationRecord => JSON.parse(fs.readFileSync(path.join(directory, RECORD_FILE), 'utf8')) as PublicationRecord;
const status = (record: PublicationRecord, id: string): string | undefined => record.findings.find((finding) => finding.id === id)?.status;
const listing = (directory: string): string[] => (fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []);

/** A square PNG of the given size, made without a library. */
function png(size: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x23)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

describe('a ready application', () => {
  it('check passes every check, reads the endpoint without calling a tool, and writes nothing', async () => {
    const app = copyFixture();
    const cwd = workspace();
    const seen = wire();
    const run = await check(app, { cwd, wire: seen });

    expect(run.err).toBe('');
    expect(run.out).toContain('saga publish check (chatgpt): ready');
    expect(run.code).toBe(0);
    expect(run.out).not.toMatch(/FAIL|unknown/);
    expect(seen.methods).toContain('tools/list');
    expect(seen.methods).toContain('resources/read');
    expect(seen.methods).not.toContain('tools/call');
    expect(listing(cwd)).toEqual([]);
    expect(run.out).toContain('Nothing was deployed, uploaded, submitted or published.');
    // The owner-only steps are listed as pending, and a prepared package is never called live.
    expect(run.out).toMatch(/Pending handoff/);
    expect(run.out).toMatch(/OpenAI organization has completed individual or business verification/);
  });

  it('prepare writes a valid package and a record bound to its digest, naming the publisher and not the operator', async () => {
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code, run.out + run.err).toBe(0);
    const out = path.join(cwd, 'publication');
    expect(listing(out)).toEqual([ARCHIVE_FILE, RECORD_FILE]);
    const record = recordOf(out);
    const archive = fs.readFileSync(path.join(out, ARCHIVE_FILE));
    expect(record.verdict).toBe('ready');
    expect(record.artifact?.sha256).toBe(sha256(archive));
    expect(record.artifact?.files.map((file) => file.path)).toEqual(['assets/icon.svg', 'assets/logo.svg', 'mcp.json', 'plugin.json']);
    expect(record.submission.state).toBe('not-submitted');
    expect(record.endpoint.toolCallsDuringDiscovery).toBe(0);
    expect(record.endpoint.deploymentIdentity.status).toBe('established');
    expect(record.endpoint.tools.map((tool) => tool.name)).toEqual(['get_status']);
    expect(record.endpoint.resources).toHaveLength(1);
    expect(record.inputs.views[0]?.sha256).toBe(sha256(viewHtml));
    expect(record.endpoint.resources[0]?.sha256).toBe(sha256(viewHtml));
    expect(record.application.sagaPackages).toEqual({ '@saga-a2ui/core': '0.0.0-candidate.g0123456789ab', '@saga-a2ui/mcp': '0.0.0-candidate.g0123456789ab' });
    expect(record.application.publisher.name).toBe('Notes Fixture Publisher');
    expect(record.application.contributors.map((one) => one.name)).toEqual(['Fixture Contributor']);

    const entries = readZip(archive);
    const plugin = JSON.parse(Buffer.from(entries.find((entry) => entry.path === 'plugin.json')!.data).toString('utf8')) as Record<string, any>;
    const mcp = JSON.parse(Buffer.from(entries.find((entry) => entry.path === 'mcp.json')!.data).toString('utf8')) as Record<string, any>;
    expect(plugin.author.name).toBe('Notes Fixture Publisher');
    expect(plugin.extensions['com.openai'].interface.developerName).toBe('Notes Fixture Publisher');
    expect(plugin.extensions['com.openai'].interface.logo).toBe('./assets/logo.svg');
    expect(mcp.mcpServers['notes-fixture']).toEqual({ type: 'streamable-http', url: PUBLISHED });
    // The contributor is credited in the record; the listing publisher is the application's.
    expect(JSON.stringify(plugin)).not.toContain('Fixture Contributor');
  });

  it('reproduces the package and record bytes from unchanged inputs', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'first', { cwd })).code).toBe(0);
    expect((await prepare(app, 'second', { cwd })).code).toBe(0);

    for (const file of [ARCHIVE_FILE, RECORD_FILE]) expect(fs.readFileSync(path.join(cwd, 'second', file)).equals(fs.readFileSync(path.join(cwd, 'first', file))), file).toBe(true);
  });

  it('accepts a PNG icon of the required size', async () => {
    const app = copyFixture();
    fs.writeFileSync(path.join(app, 'assets', 'logo.png'), png(64));
    editInput(app, (input) => (input.assets.logo = 'assets/logo.png'));
    const cwd = workspace();

    const run = await prepare(app, 'publication', { cwd });
    expect(run.code, run.out).toBe(0);
    expect(status(recordOf(path.join(cwd, 'publication')), 'package.assets')).toBe('pass');
  });
});

describe('deployment identity', () => {
  it('stays unknown, never ready, when the release input does not say what the deployment reports', async () => {
    const app = copyFixture();
    editInput(app, (input) => delete input.endpoint.expectedServer);
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code).toBe(1);
    expect(run.out).toContain('saga publish prepare (chatgpt): incomplete');
    expect(run.out).toMatch(/Deployment identity: unknown/);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('incomplete');
    expect(record.endpoint.deploymentIdentity.status).toBe('unknown');
    expect(status(record, 'endpoint.identity')).toBe('unknown');
    // Nothing failed, so the package is still prepared for the owner's handoff.
    expect(listing(path.join(cwd, 'publication'))).toEqual([ARCHIVE_FILE, RECORD_FILE]);
  });

  it('blocks when the deployment is not the one the release input declares', async () => {
    const app = copyFixture();
    editInput(app, (input) => (input.endpoint.expectedServer.version = '9.9.9'));
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd });

    expect(run.code).toBe(1);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('blocked');
    expect(record.endpoint.deploymentIdentity.status).toBe('mismatch');
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
  });
});

describe('inputs that must prevent a ready claim', () => {
  const blocked = async (damage: (app: string) => void, expectedFinding: string, options: Options = {}, extra: string[] = []): Promise<{ run: Run; record: PublicationRecord; out: string }> => {
    const app = copyFixture();
    damage(app);
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, ...options }, extra);
    const out = path.join(cwd, 'publication');
    expect(run.code).toBe(1);
    const record = recordOf(out);
    expect(record.verdict).toBe('blocked');
    expect(status(record, expectedFinding), `${expectedFinding}\n${run.out}`).toBe('fail');
    // A failed check leaves a record and no package that could be mistaken for a complete one.
    expect(listing(out)).toEqual([RECORD_FILE]);
    expect(record.artifact).toBeNull();
    return { run, record, out };
  };

  it('a missing asset', async () => {
    await blocked((app) => fs.rmSync(path.join(app, 'assets', 'icon.svg')), 'package.asset-files');
  });

  it('an icon that is not square', async () => {
    await blocked((app) => fs.writeFileSync(path.join(app, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64"></svg>'), 'package.assets');
  });

  it('an invalid manifest identity', async () => {
    const { record } = await blocked((app) => editInput(app, (input) => (input.name = 'Notes Fixture')), 'package.manifest');
    expect(status(record, 'package.listing')).toBe('fail');
  });

  it('listing text beyond the host limits', async () => {
    const { record } = await blocked((app) => editInput(app, (input) => (input.listing.displayName = 'A display name that is far too long to list')), 'package.listing');
    expect(record.findings.find((finding) => finding.id === 'package.listing')?.detail).toMatch(/displayName/);
  });

  it('a non-HTTPS privacy policy link', async () => {
    await blocked((app) => editInput(app, (input) => (input.listing.privacyPolicyURL = 'http://notes.example.com/privacy')), 'package.listing');
  });

  it('a secret in the listing text, without echoing the secret', async () => {
    const secret = 'Bearer abcdefghijklmnopqrstuvwxyz0123456789';
    const { run, out } = await blocked((app) => editInput(app, (input) => (input.listing.longDescription += ` ${secret}`)), 'package.secrets');
    expect(run.out).not.toContain(secret);
    expect(fs.readFileSync(path.join(out, RECORD_FILE), 'utf8')).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('the credential supplied for discovery appearing anywhere in the package', async () => {
    const token = 'discovery-credential-0123456789';
    const { run, out } = await blocked((app) => editInput(app, (input) => (input.listing.longDescription += ` ${token}`)), 'package.secrets', { environment: { NOTES_TOKEN: token } }, ['--bearer-env', 'NOTES_TOKEN']);
    expect(run.out).not.toContain(token);
    expect(fs.readFileSync(path.join(out, RECORD_FILE), 'utf8')).not.toContain(token);
  });

  it('reviewer credentials in the release input', async () => {
    const app = copyFixture();
    editInput(app, (input) => (input.review.test_credentials = 'user:pass'));
    const run = await check(app);
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/does not match saga-publication\/1/);
  });

  it('a local endpoint address', async () => {
    await blocked((app) => editInput(app, (input) => (input.endpoint.url = 'https://localhost:3000/status/mcp')), 'endpoint.url');
  });

  it('a built view that is not the one the endpoint serves (a stale or wrong deployment)', async () => {
    const { record } = await blocked((app) => fs.appendFileSync(path.join(app, 'build', 'view.html'), '<!-- rebuilt -->\n'), 'endpoint.views');
    expect(record.findings.find((finding) => finding.id === 'endpoint.views')?.detail).toMatch(/does not serve view\.html/);
  });

  it('a missing build', async () => {
    await blocked((app) => fs.rmSync(path.join(app, 'build'), { recursive: true }), 'build.directory');
  });

  it('a view listed in the release input that the build does not contain', async () => {
    await blocked((app) => editInput(app, (input) => input.build.views.push('other.html')), 'build.views');
  });

  it('a view or asset that leads outside the application', async () => {
    await blocked((app) => editInput(app, (input) => (input.build.views = ['../saga-publication.json'])), 'build.views');
    const outside = path.join(root, 'outside-secret.svg');
    fs.writeFileSync(outside, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>');
    const { record } = await blocked((app) => editInput(app, (input) => (input.assets.logo = path.relative(app, outside))), 'package.asset-files');
    expect(record.findings.find((finding) => finding.id === 'package.asset-files')?.detail).toMatch(/outside the directory of the release input/);
  });

  it('a symbolic link as a view', async () => {
    await blocked((app) => {
      fs.rmSync(path.join(app, 'build', 'view.html'));
      fs.symlinkSync(path.join(FIXTURE, 'build', 'view.html'), path.join(app, 'build', 'view.html'));
    }, 'build.views');
  });

  it('a tool whose annotations are not explicit', async () => {
    const stripped = wire(async (method, response) => {
      if (method !== 'tools/list') return response;
      const body = JSON.parse(await response.text()) as { result: { tools: { annotations?: unknown }[] } };
      delete body.result.tools[0]?.annotations;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await blocked(() => undefined, 'endpoint.tools', { wire: stripped });
  });
});

describe('what cannot be concluded is never a pass', () => {
  it('an unavailable validator leaves the manifests unknown and the verdict incomplete', async () => {
    const run = await check(copyFixture(), { validators: { ok: false, problem: 'the schema copy is missing' } });

    expect(run.code).toBe(1);
    expect(run.out).toContain('saga publish check (chatgpt): incomplete');
    expect(run.out).toMatch(/unknown\s+package\.manifest/);
    expect(run.out).toMatch(/unknown\s+package\.mcp-config/);
  });

  it('the official schemas reject what OpenAI\'s guide shows but the 1.0.0 mcp.json schema forbids: server-level extensions', async () => {
    const { loadOfficialValidators, MCP_SCHEMA_ID } = await import('./chatgpt.js');
    const loaded = loadOfficialValidators();
    if (!loaded.ok) throw new Error(loaded.problem);
    const server = { type: 'streamable-http', url: PUBLISHED };
    expect(loaded.validators.validateMcp({ $schema: MCP_SCHEMA_ID, mcpServers: { notes: server } })).toBeNull();
    expect(loaded.validators.validateMcp({ $schema: MCP_SCHEMA_ID, mcpServers: { notes: { ...server, extensions: { 'com.openai': { auth: { type: 'none' } } } } } })).not.toBeNull();
  });

  it('a schema copy that differs from the pinned official one is unavailable, not used', async () => {
    const { loadOfficialValidators } = await import('./chatgpt.js');
    const copy = fs.mkdtempSync(path.join(root, 'schemas-'));
    fs.cpSync(path.join(here, 'schemas', 'agent-plugins-1.0.0'), copy, { recursive: true });
    expect(loadOfficialValidators(copy).ok).toBe(true);
    fs.writeFileSync(path.join(copy, 'plugin.schema.json'), '{"type":"object"}');
    const altered = loadOfficialValidators(copy);
    expect(altered.ok).toBe(false);
    fs.rmSync(path.join(copy, 'mcp.schema.json'));
    expect(loadOfficialValidators(copy)).toMatchObject({ ok: false });
  });

  it('an endpoint that cannot be reached leaves its tools and views unchecked', async () => {
    const down: Wire = { methods: [], fetch: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, wire: down });

    expect(run.code).toBe(1);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.verdict).toBe('incomplete');
    expect(status(record, 'endpoint.discovery')).toBe('unknown');
    expect(record.endpoint.reached).toBe(false);
    expect(record.endpoint.deploymentIdentity.status).toBe('unknown');
  });

  it('an endpoint that asks for authentication says so and names the way to read it', async () => {
    const refusing: Wire = { methods: [], fetch: async () => new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer realm="x"' } }) };
    const run = await check(copyFixture(), { wire: refusing });

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/requires authentication/);
    expect(run.out).toMatch(/--bearer-env/);
  });

  it('sends the discovery credential and never writes it', async () => {
    const token = 'discovery-credential-0123456789';
    const authorizations: (string | null)[] = [];
    const seen = wire();
    const inner = seen.fetch;
    const capturing: Wire = { methods: seen.methods, fetch: (url, init) => (authorizations.push(new Headers(init?.headers).get('authorization')), inner(url, init)) };
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, wire: capturing, environment: { NOTES_TOKEN: token } }, ['--bearer-env', 'NOTES_TOKEN']);

    expect(run.code, run.out).toBe(0);
    expect(authorizations).toContain(`Bearer ${token}`);
    for (const file of [ARCHIVE_FILE, RECORD_FILE]) expect(fs.readFileSync(path.join(cwd, 'publication', file)).includes(token), file).toBe(false);
    expect(run.out).not.toContain(token);
  });

  it('does not send a credential to an endpoint that is not HTTPS', async () => {
    const authorizations: (string | null)[] = [];
    const seen = wire();
    const inner = seen.fetch;
    const capturing: Wire = { methods: seen.methods, fetch: (url, init) => (authorizations.push(new Headers(init?.headers).get('authorization')), inner(url, init)) };
    const app = copyFixture();
    editInput(app, (input) => (input.endpoint.url = 'http://notes.example.com/status/mcp'));
    const run = await check(app, { wire: capturing, environment: { NOTES_TOKEN: 'discovery-credential-0123456789' } }, ['--bearer-env', 'NOTES_TOKEN']);

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/credential was not sent/);
    expect(authorizations.filter((value) => value !== null)).toEqual([]);
  });

  it('refuses a --bearer-env that names an unset variable', async () => {
    const run = await check(copyFixture(), {}, ['--bearer-env', 'NOT_SET']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/NOT_SET/);
  });

  it('a missing or malformed release input prepares nothing', async () => {
    const cwd = workspace();
    const missing = await saga(['publish', 'prepare', '--target', 'chatgpt', '--release', 'nope.json', '--out', 'publication'], { cwd });
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/cannot be read/);
    fs.writeFileSync(path.join(cwd, 'bad.json'), '{ not json');
    const malformed = await saga(['publish', 'prepare', '--target', 'chatgpt', '--release', 'bad.json', '--out', 'publication'], { cwd });
    expect(malformed.code).toBe(1);
    expect(malformed.err).toMatch(/not valid JSON/);
    expect(listing(cwd)).toEqual(['bad.json']);
  });
});

describe('tool calls', () => {
  it('discovery calls no tool even when the release input declares fixture calls', async () => {
    const seen = wire();
    expect((await check(copyFixture(), { wire: seen })).code).toBe(0);
    expect(seen.methods.filter((method) => method === 'tools/call')).toEqual([]);
  });

  it('--invoke-fixture calls exactly the declared read-only tool, records only a digest of its result, and labels it fixture evidence', async () => {
    const seen = wire();
    const cwd = workspace();
    const run = await prepare(copyFixture(), 'publication', { cwd, wire: seen }, ['--invoke-fixture']);

    expect(run.code, run.out).toBe(0);
    expect(seen.methods.filter((method) => method === 'tools/call')).toHaveLength(1);
    expect(run.out).toMatch(/fixture evidence, not a real-host observation/);
    const record = recordOf(path.join(cwd, 'publication'));
    expect(record.fixture.invoked).toBe(true);
    expect(record.fixture.invocations).toEqual([{ tool: 'get_status', outcome: 'ok', resultSha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    // Discovery itself still made no call.
    expect(record.endpoint.toolCallsDuringDiscovery).toBe(0);
  });

  it('refuses to call a declared tool the endpoint does not advertise', async () => {
    const seen = wire();
    const app = copyFixture();
    editInput(app, (input) => (input.fixture.calls = [{ tool: 'delete_everything', arguments: {} }]));
    const run = await check(app, { wire: seen }, ['--invoke-fixture']);

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/delete_everything: refused/);
    expect(seen.methods).not.toContain('tools/call');
  });

  it('--invoke-fixture without declared calls fails instead of silently doing nothing', async () => {
    const app = copyFixture();
    editInput(app, (input) => delete input.fixture);
    const run = await check(app, {}, ['--invoke-fixture']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/declares no fixture\.calls/);
  });
});

describe('stale evidence', () => {
  it('--against passes when nothing changed and names what changed otherwise', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);

    const same = await check(app, { cwd }, ['--against', 'publication']);
    expect(same.code, same.out).toBe(0);

    editInput(app, (input) => (input.listing.longDescription += ' It now also reports the version.'));
    const changed = await check(app, { cwd }, ['--against', 'publication']);
    expect(changed.code).toBe(1);
    expect(changed.out).toMatch(/Changed since then: the release input changed; the package content changed/);
  });

  it('--against detects a package altered after it was prepared', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    fs.appendFileSync(path.join(cwd, 'publication', ARCHIVE_FILE), 'x');

    const run = await check(app, { cwd }, ['--against', 'publication']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/FAIL\s+record\.integrity/);
  });

  it('--against reports a changed tool definition', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const renamed = wire(async (method, response) => {
      if (method !== 'tools/list') return response;
      const body = JSON.parse(await response.text()) as { result: { tools: { description: string }[] } };
      body.result.tools[0]!.description += ' (changed)';
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const run = await check(app, { cwd, wire: renamed }, ['--against', 'publication']);
    expect(run.out).toMatch(/the tool definitions changed/);
    expect(run.code).toBe(1);
  });
});

describe('a damaged earlier record', () => {
  it('is reported, not trusted', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const file = path.join(cwd, 'publication', RECORD_FILE);
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete record.inputs;
    fs.writeFileSync(file, JSON.stringify(record));

    const run = await check(app, { cwd }, ['--against', 'publication']);
    expect(run.code).toBe(1);
    expect(run.out).toMatch(/FAIL\s+record\.previous/);
  });
});

describe('the output directory', () => {
  it('refuses a directory that is not one this command generated, changing nothing', async () => {
    const app = copyFixture();
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'mine'));
    fs.writeFileSync(path.join(cwd, 'mine', 'notes.txt'), 'keep');
    const run = await prepare(app, 'mine', { cwd });

    expect(run.code).toBe(1);
    expect(run.err).toMatch(/not a directory this command generated/);
    expect(listing(path.join(cwd, 'mine'))).toEqual(['notes.txt']);
  });

  it('replaces its own earlier output, and a failed rerun leaves no earlier package beside the new record', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    expect(listing(path.join(cwd, 'publication'))).toEqual([ARCHIVE_FILE, RECORD_FILE]);

    fs.rmSync(path.join(app, 'assets', 'icon.svg'));
    expect((await prepare(app, 'publication', { cwd })).code).toBe(1);
    expect(listing(path.join(cwd, 'publication'))).toEqual([RECORD_FILE]);
    expect(listing(cwd)).toEqual(['publication']);
  });

  it('does not create missing parent directories', async () => {
    const run = await prepare(copyFixture(), 'missing/parent/publication');
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/parent directory .* does not exist/);
  });

  it('an interrupt before anything is written leaves nothing behind', async () => {
    const controller = new AbortController();
    const app = copyFixture();
    const cwd = workspace();
    const run = await prepare(app, 'publication', { cwd, signal: controller.signal, onOutput: () => controller.abort() });

    expect(run.code).toBe(130);
    expect(listing(cwd)).toEqual([]);
  });

  it('an interrupt while replacing keeps the earlier output exactly as it was and removes the partial one', async () => {
    const app = copyFixture();
    const cwd = workspace();
    expect((await prepare(app, 'publication', { cwd })).code).toBe(0);
    const before = Object.fromEntries(listing(path.join(cwd, 'publication')).map((file) => [file, fs.readFileSync(path.join(cwd, 'publication', file)).toString('base64')]));

    const controller = new AbortController();
    const run = await prepare(app, 'publication', { cwd, signal: controller.signal, onOutput: (text) => text.startsWith('saga publish prepare') && controller.abort() });

    expect(run.code).toBe(130);
    expect(listing(cwd)).toEqual(['publication']);
    expect(Object.fromEntries(listing(path.join(cwd, 'publication')).map((file) => [file, fs.readFileSync(path.join(cwd, 'publication', file)).toString('base64')]))).toEqual(before);
  });
});

describe('the command line', () => {
  it('needs the publication tooling, and says nothing was checked without it', async () => {
    let err = '';
    const code = await runCli(['publish', 'check', '--target', 'chatgpt', '--release', 'x.json'], { cwd: workspace(), sdkVersion: () => '', stageDemo: () => Promise.reject(new Error('no')), stdout: () => undefined, stderr: (text) => (err += text) });
    expect(code).toBe(1);
    expect(err).toMatch(/not available here, so nothing was checked/);
  });

  it('reports tooling that fails to load as unavailable', async () => {
    let err = '';
    const code = await runCli(['publish', 'check', '--target', 'chatgpt', '--release', 'x.json'], {
      cwd: workspace(),
      sdkVersion: () => '',
      stageDemo: () => Promise.reject(new Error('no')),
      publication: { load: () => Promise.reject(new Error('Cannot find module')), environment: {} },
      stdout: () => undefined,
      stderr: (text) => (err += text),
    });
    expect(code).toBe(1);
    expect(err).toMatch(/could not be loaded \(Cannot find module\), so nothing was checked/);
  });

  it.each([
    [['publish'], /Say what to publish/],
    [['publish', 'check', '--release', 'x.json'], /--target is required/],
    [['publish', 'check', '--target', 'chatgpt'], /--release is required/],
    [['publish', 'prepare', '--target', 'chatgpt', '--release', 'x.json'], /prepare needs --out/],
    [['publish', 'check', '--target', 'chatgpt', '--release', 'x.json', '--out', 'd'], /check writes nothing/],
    [['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'd', '--release', 'x.json'], /--release belongs to saga publish/],
  ])('does not understand %j', async (args, message) => {
    const run = await saga(args);
    expect(run.code).toBe(2);
    expect(run.err).toMatch(message);
  });

  it('refuses a target other than chatgpt without checking anything', async () => {
    const run = await saga(['publish', 'check', '--target', 'claude', '--release', release(copyFixture())]);
    expect(run.code).toBe(2);
    expect(run.err).toMatch(/claude target is not supported/);
  });
});
