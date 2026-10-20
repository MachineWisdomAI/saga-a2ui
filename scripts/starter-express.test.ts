import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { qualifyStarter } from './starter-qualification.js';

// The `lit-mcp` starter on Express (templates/lit-express, STARTER-EXPRESS #62). The shared cases of
// starter-qualification.ts run against its built listener: allowed, denied, public and missing-auth
// behavior, concurrent per-request identity, the request and operation clocks and the body and
// delivery boundary. The cases below are the ones only Express adds: what its adapter checks before
// the application authenticates, what its routing answers, and the tested version recipe.

interface Manifest {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly engines?: { readonly node?: string };
}

const readManifest = (file: string): Manifest => JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;

/** True when `version` is within `range`, a `||` list of caret ranges as the adapter declares its peers. */
function withinCaretRanges(version: string, range: string): boolean {
  const parse = (text: string): number[] => text.split('.').map(Number);
  const [major = 0, minor = 0, patch = 0] = parse(version);
  return range.split('||').some((alternative) => {
    const floor = /^\^(\d+(?:\.\d+){0,2})$/.exec(alternative.trim())?.[1];
    if (floor === undefined) throw new Error(`"${alternative.trim()}" is not a caret range; extend this check before relying on it.`);
    const [floorMajor = 0, floorMinor = 0, floorPatch = 0] = parse(floor);
    if (major !== floorMajor) return false;
    return minor > floorMinor || (minor === floorMinor && patch >= floorPatch);
  });
}

interface Answer {
  readonly status: number | undefined;
  readonly body: string;
  readonly headers: http.IncomingHttpHeaders;
}

/** A raw POST with headers a client library would not choose, so the adapter's own checks can be read. */
function post(url: string, headers: Record<string, string>): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_account', arguments: {} } });
    const request = http.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': String(Buffer.byteLength(body)), ...headers },
    });
    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

qualifyStarter('lit-express', ({ built, start, rawCall, allowedToken }) => {
  describe('the Express adapter and routing', () => {
    it.each([
      ['a Host header that names another host', { host: 'rebinding.example' }],
      ['an Origin header that names another site', { origin: 'https://rebinding.example' }],
    ] as const)('refuses %s before it authenticates anyone or builds anything', async (_label, headers) => {
      const { listener, calls } = await start();
      const answer = await post(listener.accountUrl, { authorization: `Bearer ${allowedToken}`, ...headers });
      expect(answer.status).toBe(403);
      expect(JSON.parse(answer.body)).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } });
      expect(calls).toEqual({ verifier: 0, authorize: 0 });
    });

    it('serves a request for this listener, however the loopback host is spelled', async () => {
      const { listener } = await start();
      const port = new URL(listener.statusUrl).port;
      for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
        const answer = await post(listener.statusUrl, { host });
        expect(answer.status, host).not.toBe(403);
      }
    });

    it('answers an unknown path, or a known path spelled differently, with a bare 404 that names no framework', async () => {
      const { listener } = await start();
      const base = new URL(listener.statusUrl).origin;
      for (const route of ['/nothing-here', '/STATUS/MCP', '/account/mcp/']) {
        const response = await fetch(`${base}${route}`, { method: 'POST' });
        expect(response.status, route).toBe(404);
        expect(await response.text(), route).toBe('');
        expect(response.headers.get('x-powered-by'), route).toBeNull();
      }
    });

    it('authenticates a protected request of any method before the transport sees it', async () => {
      const { listener, calls } = await start();
      const response = await fetch(listener.accountUrl, { method: 'GET', headers: { accept: 'text/event-stream' } });
      expect(response.status).toBe(401);
      expect((await rawCall(listener.accountUrl)).status).toBe(401);
      expect(calls).toEqual({ verifier: 0, authorize: 0 });
    });

    it('is the tested recipe: exact pins, with the adapter peers and engine satisfied by the installed versions', () => {
      const { consumer, exported, metadata } = built();
      const starter = readManifest(path.join(exported.directory, 'package.json'));
      const installed = (name: string): Manifest => readManifest(path.join(consumer, 'node_modules', name, 'package.json'));
      const adapter = installed(metadata.serverAdapter.package);

      // The template declares the adapter and its peers at exact versions, and those are what is installed.
      expect(adapter.version).toBe(metadata.serverAdapter.version);
      for (const name of [metadata.serverAdapter.package, 'express', '@modelcontextprotocol/node', '@modelcontextprotocol/server']) {
        expect(starter.dependencies?.[name], name).toMatch(/^\d+\.\d+\.\d+$/);
        expect(installed(name).version, name).toBe(starter.dependencies?.[name]);
      }
      // The adapter declares which peers it works with; the installed ones are inside those ranges.
      for (const [name, range] of Object.entries(adapter.peerDependencies ?? {})) {
        expect(withinCaretRanges(installed(name).version ?? '', range), `${name} ${range}`).toBe(true);
      }
      // The starter does not promise an older Node than the adapter supports.
      const adapterNode = Number(/(\d+)/.exec(adapter.engines?.node ?? '')?.[1]);
      const starterNode = Number(/(\d+)/.exec(starter.engines?.node ?? '')?.[1]);
      expect(starterNode).toBeGreaterThanOrEqual(adapterNode);
    });
  });
});
