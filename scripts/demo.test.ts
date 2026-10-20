import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_TOKENS } from '../apps/lit-host/src/mcp/dev-auth.js';
import { DEMO_TEMPLATE, STARTER_GLUE, buildDemo, prepareDemo, startDownload, writeDownload, type RunningDemoProcess } from './build-demo.js';
import { createWorkDirectory, repoRoot } from './packed-consumer.js';
import { templateDirectory } from './starter-template.js';

// DEMO1: the standalone demonstration, qualified as a download. It is built from the packed candidate
// tarballs in a clean directory outside the repository, copied out as the files a person would be
// given, and run as its own Node process whose only inputs are those files and its third-party
// packages. Everything here goes through the process's HTTP surface (the host page's own forwarding
// endpoints), the way the host page does. The browser flow is apps/lit-host/e2e/demo.spec.ts.

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

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
  readonly body: { result?: { isError?: boolean; structuredContent?: any; content?: { text: string }[]; _meta?: Record<string, unknown>; tools?: { name: string }[] } } | null;
}

/** What the host page does: one JSON-RPC call to a known endpoint with the chosen credential. */
async function rpc(endpoint: string, method: string, params: Record<string, unknown>, token?: string): Promise<Forwarded> {
  const response = await fetch(new URL('/host/rpc', running.hostUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, method, params, ...(token === undefined ? {} : { token }) }),
  });
  return (await response.json()) as Forwarded;
}
const control = (name: string) =>
  fetch(new URL('/host/controls', running.hostUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
const listNotes = (token?: string) => rpc('notes', 'tools/call', { name: 'list_notes', arguments: {} }, token);
const archive = (noteId: string, token: string) => rpc('notes', 'tools/call', { name: 'archive_note', arguments: { noteId } }, token);

/** A request with an arbitrary Host and Origin, which fetch will not send. */
function rawRequest(pathName: string, headers: Record<string, string>, method = 'GET'): Promise<number> {
  const target = new URL(running.hostUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: target.hostname, port: target.port, path: pathName, method, headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('error', reject);
    request.end();
  });
}

describe('the download', () => {
  it('is the bundled server, the five pages and the notices, tied to the candidate build and the qualified pair', () => {
    // `node_modules` is what installing the download's dependencies adds; it is not part of the download.
    const listing = fs.readdirSync(download).filter((name) => name !== 'node_modules').sort();
    expect(listing).toEqual(['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'release.json', 'server.mjs', 'views']);
    expect(fs.readdirSync(path.join(download, 'views')).sort()).toEqual(['episode.html', 'host.html', 'notes.html', 'playback.html', 'subscriptions.html']);
    expect(manifest.pair).toMatchObject({ template: 'templates/lit-node', stack: 'lit-mcp', server: 'node', serverAdapter: { package: '@modelcontextprotocol/node', version: '2.1.1' } });
    expect(manifest.candidate.version).toMatch(/^0\.0\.0-candidate\.g[0-9a-f]{12}(\.dirty)?$/);
    expect(Object.keys(manifest.candidate.packedTarballSha256).sort()).toEqual(['components', 'core', 'lit', 'mcp']);
    // The recorded digests are those of the files in the download.
    for (const [file, digest] of Object.entries<string>(manifest.files)) expect(sha256(path.join(download, file))).toBe(digest);
  });

  it('uses the starter’s own glue unchanged', () => {
    for (const file of STARTER_GLUE) {
      expect(manifest.starterGlue[file]).toBe(sha256(path.join(templateDirectory(DEMO_TEMPLATE), file)));
    }
  });

  it('carries the SDK itself and declares only registry packages, so it installs outside the monorepo', () => {
    const { dependencies } = JSON.parse(fs.readFileSync(path.join(download, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(dependencies)).not.toContain(expect.stringMatching(/^@saga-a2ui\//));
    for (const range of Object.values(dependencies)) expect(range).not.toMatch(/^(file|link|workspace|git|https?):|^[./~]/);
    expect(fs.readFileSync(path.join(download, 'server.mjs'), 'utf8')).not.toMatch(/from ['"]@saga-a2ui\//);
    expect(manifest.serverModules.installedSdkFiles).toBeGreaterThan(0);
  });

  it('keeps the demonstration’s identities and media out of the clean starter', () => {
    const starter = templateDirectory(DEMO_TEMPLATE);
    const files = fs.readdirSync(starter, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    for (const entry of files) {
      const text = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
      expect(text, `${entry.name} must not carry a demonstration credential`).not.toContain(DEV_TOKENS.alice);
      expect(text, `${entry.name} must not carry demonstration data`).not.toContain('Synthetic Creator');
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
    const result = spawnSync(process.execPath, ['server.mjs'], { cwd: download, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', PORT: '0' }, encoding: 'utf8', timeout: 30_000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refuses to start in a production environment');
  });

  it('answers the host surface only to this origin, with JSON, for known endpoints and methods', async () => {
    const { host } = new URL(running.hostUrl);
    expect(await rawRequest('/host/config', { host: 'evil.example' })).toBe(403);
    expect(await rawRequest('/host/config', { host, origin: 'http://evil.example' })).toBe(403);
    expect(await rawRequest('/host/rpc', { host, 'content-type': 'text/plain' }, 'POST')).toBe(415);
    expect((await fetch(new URL('/host/rpc', running.hostUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://evil.example/', method: 'tools/list' }) })).status).toBe(400);
    expect((await fetch(new URL('/host/rpc', running.hostUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'notes', method: 'initialize' }) })).status).toBe(400);
    expect((await control('rm -rf')).status).toBe(400);
  });

  describe('browse', () => {
    it('shows each signed-in user only their own subscriptions', async () => {
      const alice = await rpc('subscriptions', 'tools/call', { name: 'list_subscriptions', arguments: {} }, DEV_TOKENS.alice);
      const bob = await rpc('subscriptions', 'tools/call', { name: 'list_subscriptions', arguments: { accountId: 'acct-synthetic-alice' } }, DEV_TOKENS.bob);
      expect(JSON.stringify(alice.body?.result?.structuredContent)).toContain('Synthetic Creator One');
      expect(JSON.stringify(bob.body?.result?.structuredContent)).not.toContain('Creator One');
      expect(JSON.stringify(bob.body?.result?.structuredContent)).toContain('Synthetic Creator Three');
    });

    it.each([
      ['no credential', undefined, 401],
      ['an expired credential', DEV_TOKENS.expired, 401],
      ['an unknown credential', 'not-a-demo-credential', 401],
      ['the service credential', DEV_TOKENS.service, 403],
    ])('refuses %s at HTTP, before any tool runs', async (_name, token, status) => {
      const reply = await rpc('subscriptions', 'tools/call', { name: 'list_subscriptions', arguments: {} }, token);
      expect(reply.status).toBe(status);
      expect(reply.challenge).toMatch(/^Bearer /);
      // The refusal is the listener's own answer: no tool ran, so there is no tool result.
      expect(reply.body?.result).toBeUndefined();
    });
  });

  describe('the notes example behind the starter’s authentication', () => {
    it('lists each account’s own notes and never a private field', async () => {
      const alice = JSON.stringify((await listNotes(DEV_TOKENS.alice)).body?.result?.structuredContent);
      const bob = JSON.stringify((await listNotes(DEV_TOKENS.bob)).body?.result?.structuredContent);
      expect(alice).toContain('Alpha');
      expect(alice).not.toContain('Delta');
      expect(bob).toContain('Delta');
      expect(bob).not.toContain('Alpha');
      expect(alice + bob).not.toContain('DEMO-PRIVATE-FIELD-CANARY');
    });

    it.each([
      ['no credential', undefined, 401],
      ['an expired credential', DEV_TOKENS.expired, 401],
      ['the service credential, which names no account', DEV_TOKENS.service, 403],
    ])('refuses %s before the notes server is built', async (_name, token, status) => {
      expect((await listNotes(token)).status).toBe(status);
    });

    it('lets the server decide every archive on its own: the session check only informs the view, and a withdrawn permission changes nothing', async () => {
      try {
        // The session check is the view's prerequisite. It reports the ended session; it is not what protects the archive.
        await control('end-notes-session');
        const session = await rpc('notes', 'tools/call', { name: 'check_session', arguments: {} }, DEV_TOKENS.alice);
        expect(session.body?.result?.isError).toBe(true);
        await control('restore-notes-session');
        expect((await rpc('notes', 'tools/call', { name: 'check_session', arguments: {} }, DEV_TOKENS.alice)).body?.result?.isError).toBeUndefined();

        await control('revoke-archive-permission');
        const revoked = await archive('n-1', DEV_TOKENS.alice);
        expect(revoked.body?.result?.isError).toBe(true);
        expect(revoked.body?.result?._meta).toMatchObject({ 'pack1/no-effect': true });
        // The note is still there: the refusal changed nothing.
        expect(JSON.stringify((await listNotes(DEV_TOKENS.alice)).body?.result?.structuredContent)).toContain('Alpha');
        await control('restore-archive-permission');

        // Someone else's note gets the same sentence as an absent one, and archiving a note once is final.
        const others = await archive('n-4', DEV_TOKENS.alice);
        const absent = await archive('n-99', DEV_TOKENS.alice);
        expect(others.body?.result?.content).toEqual(absent.body?.result?.content);
        expect((await archive('n-3', DEV_TOKENS.alice)).body?.result?.isError).toBeUndefined();
        expect((await archive('n-3', DEV_TOKENS.alice)).body?.result?.isError).toBe(true);
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
      expect(JSON.stringify((await listNotes(DEV_TOKENS.alice)).body?.result?.structuredContent)).not.toContain('Beta');
    });
  });
});
