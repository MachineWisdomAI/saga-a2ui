import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  createServerBudgets,
  type BudgetSettings,
} from '@saga-a2ui/mcp/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveNotes } from '../demo/lit-node/server/notes-endpoint.js';
import { createDemoVerifier } from '../demo/lit-node/fixtures/sign-ins.js';
import { createFixtureBackend } from '../examples/pack1-consumer/server/index.js';
import { DEV_TOKENS } from '../apps/lit-host/src/mcp/dev-auth.js';
import {
  STARTER_GLUE,
  buildDemo,
  prepareDemo,
  startDownload,
  writeDownload,
  type RunningDemoProcess,
} from './build-demo.js';
import { createWorkDirectory, repoRoot } from './packed-consumer.js';
import { DEMO_TEMPLATE } from './qualified-starters.js';
import { templateDirectory } from './starter-template.js';

// DEMO1: the standalone demonstration, qualified as a download. It is built from the packed candidate
// tarballs in a clean directory outside the repository, copied out as the files a person would be
// given, and run as its own Node process whose only inputs are those files and its third-party
// packages. Everything here goes through the process's HTTP surface (the host page's own forwarding
// endpoints), the way the host page does. The browser flow is apps/lit-host/e2e/demo.spec.ts.

const sha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let work: string;
let download: string;
let manifest: Record<string, any>;
let running: RunningDemoProcess;

beforeAll(async () => {
  work = createWorkDirectory('saga-demo-test-');
  const buildDirectory = path.join(work, 'build');
  fs.mkdirSync(buildDirectory);
  const built = await buildDemo(prepareDemo(buildDirectory));
  download = path.join(work, 'download');
  manifest = writeDownload(built, download) as Record<string, any>;
  running = await startDownload(download);
}, 300_000);

afterAll(async () => {
  await running?.stop();
  if (work !== undefined) fs.rmSync(work, { recursive: true, force: true });
});

interface Forwarded {
  readonly status: number;
  readonly challenge: string | null;
  readonly body: {
    result?: {
      isError?: boolean;
      structuredContent?: any;
      content?: { text: string }[];
      _meta?: Record<string, unknown>;
      tools?: { name: string }[];
    };
  } | null;
}

/** What the host page does: one JSON-RPC call to a known endpoint with the chosen credential. */
async function rpc(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  token?: string,
): Promise<Forwarded> {
  const response = await fetch(new URL('/host/rpc', running.hostUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      endpoint,
      method,
      params,
      ...(token === undefined ? {} : { token }),
    }),
  });
  return (await response.json()) as Forwarded;
}
const control = (name: string) =>
  fetch(new URL('/host/controls', running.hostUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
const listNotes = (token?: string) =>
  rpc('notes', 'tools/call', { name: 'list_notes', arguments: {} }, token);
const archive = (noteId: string, token: string) =>
  rpc(
    'notes',
    'tools/call',
    { name: 'archive_note', arguments: { noteId } },
    token,
  );

/** A request with an arbitrary Host and Origin, which fetch will not send. */
function rawRequest(
  pathName: string,
  headers: Record<string, string>,
  method = 'GET',
): Promise<number> {
  const target = new URL(running.hostUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: pathName,
        method,
        headers,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.end();
  });
}

describe('the download', () => {
  it('ships the runnable command the setup guide documents', () => {
    const { scripts } = JSON.parse(
      fs.readFileSync(path.join(download, 'package.json'), 'utf8'),
    );
    expect(scripts).toEqual({ start: 'node server.mjs' });
  });

  it('is the bundled server, the five pages and the notices, tied to the candidate build and the qualified pair', () => {
    // `node_modules` is what installing the download's dependencies adds; it is not part of the download.
    const listing = fs
      .readdirSync(download)
      .filter((name) => name !== 'node_modules')
      .sort();
    expect(listing).toEqual([
      'LICENSE',
      'README.md',
      'THIRD_PARTY_NOTICES.md',
      'package.json',
      'release.json',
      'server.mjs',
      'views',
    ]);
    expect(fs.readdirSync(path.join(download, 'views')).sort()).toEqual([
      'episode.html',
      'host.html',
      'notes.html',
      'playback.html',
      'subscriptions.html',
    ]);
    expect(manifest.pair).toMatchObject({
      template: 'templates/lit-node',
      stack: 'lit-mcp',
      server: 'node',
      serverAdapter: {
        package: '@modelcontextprotocol/node',
        version: '2.1.1',
      },
    });
    expect(manifest.candidate.version).toMatch(
      /^0\.0\.0-candidate\.g[0-9a-f]{12}(\.dirty)?$/,
    );
    expect(Object.keys(manifest.candidate.packedTarballSha256).sort()).toEqual([
      'components',
      'core',
      'lit',
      'lit-mcp-stack',
      'mcp',
    ]);
    // The recorded digests are those of the files in the download.
    for (const [file, digest] of Object.entries<string>(manifest.files))
      expect(sha256(path.join(download, file))).toBe(digest);
  });

  it('uses the starter’s own glue unchanged', () => {
    for (const file of STARTER_GLUE) {
      expect(manifest.starterGlue[file]).toBe(
        sha256(path.join(templateDirectory(DEMO_TEMPLATE), file)),
      );
    }
  });

  it('carries the SDK itself and declares only registry packages, so it installs outside the monorepo', () => {
    const { dependencies } = JSON.parse(
      fs.readFileSync(path.join(download, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(dependencies)).not.toContain(
      expect.stringMatching(/^@saga-a2ui\//),
    );
    for (const range of Object.values(dependencies))
      expect(range).not.toMatch(/^(file|link|workspace|git|https?):|^[./~]/);
    expect(
      fs.readFileSync(path.join(download, 'server.mjs'), 'utf8'),
    ).not.toMatch(/from ['"]@saga-a2ui\//);
    expect(manifest.serverModules.installedSdkFiles).toBeGreaterThan(0);
  });

  it('keeps the demonstration’s identities and media out of the clean starter', () => {
    const starter = templateDirectory(DEMO_TEMPLATE);
    const files = fs
      .readdirSync(starter, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile());
    for (const entry of files) {
      const text = fs.readFileSync(
        path.join(entry.parentPath, entry.name),
        'utf8',
      );
      expect(
        text,
        `${entry.name} must not carry a demonstration credential`,
      ).not.toContain(DEV_TOKENS.alice);
      expect(
        text,
        `${entry.name} must not carry demonstration data`,
      ).not.toContain('Synthetic Creator');
    }
  });
});

describe('the running demonstration', () => {
  it('announces on every start that it is local-only, and serves a host page that says so', async () => {
    expect(running.output()).toContain('LOCAL DEMONSTRATION ONLY');
    const page = await (await fetch(running.hostUrl)).text();
    expect(page).toContain('LOCAL DEMONSTRATION ONLY');
    expect(page).toContain('no OAuth flow');
  });

  it('refuses to start in a production environment', () => {
    const result = spawnSync(process.execPath, ['server.mjs'], {
      cwd: download,
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', PORT: '0' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'refuses to start in a production environment',
    );
  });

  it('answers the host surface only to this origin, with JSON, for known endpoints and methods', async () => {
    const { host } = new URL(running.hostUrl);
    expect(await rawRequest('/host/config', { host: 'evil.example' })).toBe(
      403,
    );
    expect(
      await rawRequest('/host/config', { host, origin: 'http://evil.example' }),
    ).toBe(403);
    expect(
      await rawRequest(
        '/host/rpc',
        { host, 'content-type': 'text/plain' },
        'POST',
      ),
    ).toBe(415);
    expect(
      (
        await fetch(new URL('/host/rpc', running.hostUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'http://evil.example/',
            method: 'tools/list',
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(new URL('/host/rpc', running.hostUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: 'notes', method: 'initialize' }),
        })
      ).status,
    ).toBe(400);
    expect((await control('rm -rf')).status).toBe(400);
  });

  describe('browse', () => {
    it('shows each signed-in user only their own subscriptions', async () => {
      const alice = await rpc(
        'subscriptions',
        'tools/call',
        { name: 'list_subscriptions', arguments: {} },
        DEV_TOKENS.alice,
      );
      const bob = await rpc(
        'subscriptions',
        'tools/call',
        {
          name: 'list_subscriptions',
          arguments: { accountId: 'acct-synthetic-alice' },
        },
        DEV_TOKENS.bob,
      );
      expect(JSON.stringify(alice.body?.result?.structuredContent)).toContain(
        'Synthetic Creator One',
      );
      expect(JSON.stringify(bob.body?.result?.structuredContent)).not.toContain(
        'Creator One',
      );
      expect(JSON.stringify(bob.body?.result?.structuredContent)).toContain(
        'Synthetic Creator Three',
      );
    });

    it.each([
      ['no credential', undefined, 401],
      ['an expired credential', DEV_TOKENS.expired, 401],
      ['an unknown credential', 'not-a-demo-credential', 401],
      ['the service credential', DEV_TOKENS.service, 403],
    ])(
      'refuses %s at HTTP, before any tool runs',
      async (_name, token, status) => {
        const reply = await rpc(
          'subscriptions',
          'tools/call',
          { name: 'list_subscriptions', arguments: {} },
          token,
        );
        expect(reply.status).toBe(status);
        expect(reply.challenge).toMatch(/^Bearer /);
        // The refusal is the listener's own answer: no tool ran, so there is no tool result.
        expect(reply.body?.result).toBeUndefined();
      },
    );
  });

  describe('the notes example behind the starter’s authentication', () => {
    it('lists each account’s own notes and never a private field', async () => {
      const alice = JSON.stringify(
        (await listNotes(DEV_TOKENS.alice)).body?.result?.structuredContent,
      );
      const bob = JSON.stringify(
        (await listNotes(DEV_TOKENS.bob)).body?.result?.structuredContent,
      );
      expect(alice).toContain('Alpha');
      expect(alice).not.toContain('Delta');
      expect(bob).toContain('Delta');
      expect(bob).not.toContain('Alpha');
      expect(alice + bob).not.toContain('DEMO-PRIVATE-FIELD-CANARY');
    });

    it.each([
      ['no credential', undefined, 401],
      ['an expired credential', DEV_TOKENS.expired, 401],
      [
        'the service credential, which names no account',
        DEV_TOKENS.service,
        403,
      ],
    ])(
      'refuses %s before the notes server is built',
      async (_name, token, status) => {
        expect((await listNotes(token)).status).toBe(status);
      },
    );

    it('lets the server decide every archive on its own: the session check only informs the view, and a withdrawn permission changes nothing', async () => {
      try {
        // The session check is the view's prerequisite. It reports the ended session; it is not what protects the archive.
        await control('end-notes-session');
        const session = await rpc(
          'notes',
          'tools/call',
          { name: 'check_session', arguments: {} },
          DEV_TOKENS.alice,
        );
        expect(session.body?.result?.isError).toBe(true);
        await control('restore-notes-session');
        expect(
          (
            await rpc(
              'notes',
              'tools/call',
              { name: 'check_session', arguments: {} },
              DEV_TOKENS.alice,
            )
          ).body?.result?.isError,
        ).toBeUndefined();

        await control('revoke-archive-permission');
        const revoked = await archive('n-1', DEV_TOKENS.alice);
        expect(revoked.body?.result?.isError).toBe(true);
        expect(revoked.body?.result?._meta).toMatchObject({
          'pack1/no-effect': true,
        });
        // The note is still there: the refusal changed nothing.
        expect(
          JSON.stringify(
            (await listNotes(DEV_TOKENS.alice)).body?.result?.structuredContent,
          ),
        ).toContain('Alpha');
        await control('restore-archive-permission');

        // Someone else's note gets the same sentence as an absent one, and archiving a note once is final.
        const others = await archive('n-4', DEV_TOKENS.alice);
        const absent = await archive('n-99', DEV_TOKENS.alice);
        expect(others.body?.result?.content).toEqual(
          absent.body?.result?.content,
        );
        expect(
          (await archive('n-3', DEV_TOKENS.alice)).body?.result?.isError,
        ).toBeUndefined();
        expect(
          (await archive('n-3', DEV_TOKENS.alice)).body?.result?.isError,
        ).toBe(true);
      } finally {
        await control('restore-notes-session');
        await control('restore-archive-permission');
      }
    });

    it('applies an archive that was waiting on the backend even though nobody is waiting for it any more', async () => {
      await control('hold-archives');
      const pending = archive('n-2', DEV_TOKENS.alice);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await control('release-archives');
      expect((await pending).body?.result?.isError).toBeUndefined();
      expect(
        JSON.stringify(
          (await listNotes(DEV_TOKENS.alice)).body?.result?.structuredContent,
        ),
      ).not.toContain('Beta');
    });
  });
});

// The notes endpoint is an SDK request like the application's own: its clock starts at admission, and
// the body and the notes operations are stages of that one request. These are raw HTTP calls, so they
// show what a caller sees, not what a stage reports.
const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
} as const;

interface Seen {
  /** Undefined when the connection ended before any response arrived. */
  readonly status: number | undefined;
  readonly body: string;
  readonly closed: boolean;
  readonly elapsedMs: number;
}

/** Sends `sent` of a body that declares `declared` bytes and then nothing, or the whole body when they match. */
function post(
  url: string,
  headers: Record<string, string>,
  sent: string,
  declared: number,
  windowMs: number,
): Promise<Seen> {
  const began = Date.now();
  return new Promise<Seen>((resolve) => {
    let status: number | undefined;
    let body = '';
    let closed = false;
    const request = http.request(url, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'content-length': String(declared),
        ...headers,
      },
    });
    const done = (): void => {
      clearTimeout(timer);
      request.destroy();
      resolve({ status, body, closed, elapsedMs: Date.now() - began });
    };
    const timer = setTimeout(done, windowMs);
    request.on('response', (response) => {
      status = response.statusCode;
      response
        .setEncoding('utf8')
        .on('data', (chunk: string) => void (body += chunk));
    });
    request.on('error', () => undefined);
    request.on('close', () => {
      closed = true;
      done();
    });
    request.write(sent);
    if (declared === Buffer.byteLength(sent)) request.end();
  });
}

const callTool = (name: string, args: Record<string, unknown>): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
const BEARER = (token: string): Record<string, string> => ({
  authorization: ['Bearer', token].join(' '),
});

describe('the notes endpoint bounds its body and its operations (default budgets, the downloaded process)', () => {
  const notesUrl = (): string => new URL('/notes/mcp', running.hostUrl).href;

  it('answers a body that stalls once with 408 at the operation limit and releases the connection', async () => {
    const seen = await post(
      notesUrl(),
      BEARER(DEV_TOKENS.alice),
      '{"jsonrpc"',
      1_000,
      8_000,
    );
    expect(seen.status).toBe(408);
    expect(seen.closed).toBe(true);
    expect(seen.elapsedMs).toBeGreaterThanOrEqual(2_800);
    expect(seen.elapsedMs).toBeLessThan(4_500);
    // Nothing is left half-served: the endpoint answers the next caller normally.
    expect((await listNotes(DEV_TOKENS.alice)).status).toBe(200);
  }, 20_000);

  it('answers an archive the backend is still holding at the operation limit as unavailable, never as a refusal, and keeps the late effect', async () => {
    try {
      await control('hold-archives');
      const began = Date.now();
      const waited = await archive('n-1', DEV_TOKENS.alice);
      const elapsedMs = Date.now() - began;
      expect(elapsedMs).toBeGreaterThanOrEqual(2_800);
      expect(elapsedMs).toBeLessThan(4_500);
      expect(waited.status).toBe(200);
      expect(waited.body?.result?.isError).toBe(true);
      expect(waited.body?.result?.content?.[0]?.text).toBe(
        'Your notes are unavailable.',
      );
      // Ending the wait says nothing about the archive: it is not reported as one the server knows changed nothing.
      expect(waited.body?.result?._meta ?? {}).not.toHaveProperty(
        'pack1/no-effect',
      );
    } finally {
      await control('release-archives');
    }
    // The archive that had already reached the backend still happened, once; nobody retried it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      JSON.stringify(
        (await listNotes(DEV_TOKENS.alice)).body?.result?.structuredContent,
      ),
    ).not.toContain('Alpha');
    const again = await archive('n-1', DEV_TOKENS.alice);
    expect(again.body?.result?.isError).toBe(true);
  }, 30_000);
});

describe('the notes endpoint shares one request deadline across authentication, body and operation', () => {
  const servers: http.Server[] = [];
  afterAll(async () => {
    for (const server of servers)
      await new Promise<void>(
        (resolve) => (
          server.close(() => resolve()),
          server.closeAllConnections()
        ),
      );
  });

  /** The endpoint on its own loopback port, with these budgets and a verifier that answers after `verifyMs`. */
  async function start(
    budgets: BudgetSettings,
    verifyMs: number,
    hooks: Parameters<typeof createFixtureBackend>[0] = {},
  ): Promise<string> {
    const real = createDemoVerifier();
    const verifier = {
      verifyAccessToken: async (token: string) => (
        await new Promise((resolve) => setTimeout(resolve, verifyMs)),
        real.verifyAccessToken(token)
      ),
    };
    const backend = createFixtureBackend(hooks);
    const server = http.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    const allowedHosts = [`127.0.0.1:${port}`];
    const created = createServerBudgets(budgets);
    server.on(
      'request',
      (req, res) =>
        void serveNotes(
          {
            html: '<p data-testid="view-status"></p><notes-app></notes-app>',
            backend,
            verifier,
            allowedHosts,
          },
          req,
          res,
          created.startRequest(),
        ).catch(() => res.destroy()),
    );
    return `http://127.0.0.1:${port}/`;
  }

  it('gives a body only what authentication left of the request, not a fresh operation limit', async () => {
    const url = await start({ operationMs: 3_000, requestMs: 1_500 }, 700);
    const seen = await post(
      url,
      BEARER(DEV_TOKENS.alice),
      '{"jsonrpc"',
      1_000,
      6_000,
    );
    expect(seen.status).toBe(408);
    expect(seen.closed).toBe(true);
    // Authentication (700 ms) and the body together stay inside the request's 1,500 ms; a reset clock would take 3,700 ms.
    expect(seen.elapsedMs).toBeGreaterThanOrEqual(1_300);
    expect(seen.elapsedMs).toBeLessThan(2_300);
  }, 15_000);

  it('gives an operation only what authentication and the body left of the request, and starts nothing afterwards', async () => {
    let reached = 0;
    let released = false;
    const url = await start({ operationMs: 3_000, requestMs: 1_500 }, 700, {
      before: async (call) => {
        if (call !== 'archive') return;
        reached += 1;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 5_000).unref(),
        );
        released = true;
      },
    });
    const body = callTool('archive_note', { noteId: 'n-1' });
    const seen = await post(
      url,
      BEARER(DEV_TOKENS.alice),
      body,
      Buffer.byteLength(body),
      6_000,
    );
    // The request deadline passed while the archive was held. The one answer is "unavailable": not a
    // success, and not a refusal that claims nothing changed (the archive may still happen).
    expect(seen.status).toBe(200);
    expect(seen.body).toContain('Your notes are unavailable.');
    expect(seen.body).not.toContain('pack1/no-effect');
    expect(seen.body).not.toContain('archivedAt');
    expect(seen.elapsedMs).toBeGreaterThanOrEqual(1_300);
    expect(seen.elapsedMs).toBeLessThan(2_300);
    expect(reached).toBe(1);
    expect(released).toBe(false);
  }, 15_000);

  it('bounds a list operation the backend never answers by the operation limit and answers unavailable', async () => {
    const url = await start({ operationMs: 500, requestMs: 5_000 }, 0, {
      before: (call) =>
        call === 'notesFor' ? new Promise<void>(() => undefined) : undefined,
    });
    const body = callTool('list_notes', {});
    const seen = await post(
      url,
      BEARER(DEV_TOKENS.alice),
      body,
      Buffer.byteLength(body),
      6_000,
    );
    expect(seen.status).toBe(200);
    expect(seen.body).toContain('Your notes are unavailable.');
    expect(seen.elapsedMs).toBeLessThan(1_800);
  }, 15_000);
});
