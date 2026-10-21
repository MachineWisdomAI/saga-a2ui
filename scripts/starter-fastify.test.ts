import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { qualifyStarter } from './starter-qualification.js';

// The `lit-mcp` starter on Fastify (templates/lit-fastify, STARTER-FASTIFY #64). The shared cases of
// starter-qualification.ts run against its built listener: allowed, denied, public and missing-auth
// behavior, concurrent per-request identity, the request and operation clocks and the body and
// delivery boundary. The cases below are the ones only Fastify adds: what its adapter checks before
// the application authenticates, what its routing answers, a content type Fastify's own parsers
// would have refused, and the tested version recipe.

interface Manifest {
  readonly version?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly engines?: { readonly node?: string };
}

const readManifest = (file: string): Manifest =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;

/** The account the shared suite's allowed credential belongs to; it is a test identity, never the starter's. */
const ALLOWED_ACCOUNT = 'qualification-account-a';

/** A raw POST with headers `fetch` will not let a page set (Host, Origin), so the adapter's own checks can be read. */
function rawPost(
  url: string,
  headers: Record<string, string>,
  tool = 'get_status',
): Promise<{ status: number | undefined; text: string }> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: {} },
  });
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'content-length': String(Buffer.byteLength(body)),
        ...headers,
      },
    });
    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    request.on('error', reject);
    request.end(body);
  });
}

qualifyStarter('lit-fastify', ({ built, start, rawCall, allowedToken }) => {
  describe('the Fastify adapter and routing', () => {
    it('refuses a Host header the application did not allow, before any credential is read (DNS rebinding)', async () => {
      const { listener, calls } = await start();
      const port = new URL(listener.accountUrl).port;

      const rebound = await rawPost(
        listener.accountUrl,
        {
          host: `attacker.example:${port}`,
          authorization: `Bearer ${allowedToken}`,
        },
        'get_account',
      );
      expect(rebound.status).toBe(403);
      expect(calls).toEqual({ verifier: 0, authorize: 0 });
      expect(
        (
          await rawPost(listener.statusUrl, {
            host: `attacker.example:${port}`,
          })
        ).status,
      ).toBe(403);

      // The names it does allow work, on either route.
      expect(
        (await rawPost(listener.statusUrl, { host: `localhost:${port}` }))
          .status,
      ).toBe(200);
      const named = await rawPost(
        listener.accountUrl,
        { host: `localhost:${port}`, authorization: `Bearer ${allowedToken}` },
        'get_account',
      );
      expect(named.status).toBe(200);
      expect(named.text).toContain(ALLOWED_ACCOUNT);
    });

    it('refuses a browser Origin that is not the loopback host, and serves a request that has none', async () => {
      const { listener, calls } = await start();
      const foreign = await rawPost(listener.accountUrl, {
        origin: 'https://attacker.example',
        authorization: `Bearer ${allowedToken}`,
      });
      expect(foreign.status).toBe(403);
      expect(calls).toEqual({ verifier: 0, authorize: 0 });
      expect((await rawPost(listener.statusUrl, {})).status).toBe(200);
    });

    it('answers a path it does not serve with 404 and asks no one', async () => {
      const { listener, calls } = await start();
      const url = new URL(listener.accountUrl);
      const response = await fetch(`${url.origin}/account/other`, {
        method: 'POST',
        headers: { authorization: `Bearer ${allowedToken}` },
        body: '{}',
      });
      expect(response.status).toBe(404);
      expect(calls).toEqual({ verifier: 0, authorize: 0 });
    });

    it('still requires a credential for the protected route whatever the method', async () => {
      const { listener, calls } = await start();
      const unauthenticated = await fetch(listener.accountUrl, {
        method: 'DELETE',
      });
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.headers.get('www-authenticate')).toMatch(
        /^Bearer realm="saga-starter"/,
      );
      expect((await rawCall(listener.accountUrl)).status).toBe(401);
      expect(calls.verifier).toBe(0);
    });

    it('leaves the content type to the MCP transport: Fastify refuses none of it, and the listener keeps serving', async () => {
      const { listener } = await start();
      const asText = await fetch(listener.statusUrl, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_status', arguments: {} },
        }),
      });
      expect(asText.status).toBe(415); // the transport's answer, not a Fastify parser error
      expect(await asText.text()).toContain('jsonrpc');
      const client = new Client({
        name: 'starter-fastify-qualification',
        version: '0.0.0',
      });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(listener.statusUrl)),
        );
        const result = await client.callTool({
          name: 'get_status',
          arguments: {},
        });
        expect(result.structuredContent).toEqual({ status: 'running' });
      } finally {
        await client.close().catch(() => undefined);
      }
    });

    it('pins the supported adapter and its peers exactly, as the template declares and the metadata names', () => {
      const { consumer, exported, metadata } = built();
      const starter = readManifest(
        path.join(exported.directory, 'package.json'),
      );
      expect(metadata.server).toBe('fastify');
      expect(metadata.serverAdapter).toEqual({
        package: '@modelcontextprotocol/fastify',
        version: '2.0.1',
      });
      expect(starter.dependencies?.['@modelcontextprotocol/fastify']).toBe(
        '2.0.1',
      );
      expect(starter.dependencies?.['fastify']).toBe('5.12.7');
      expect(starter.dependencies?.['@modelcontextprotocol/node']).toBe(
        '2.1.1',
      );
      expect(starter.dependencies?.['@modelcontextprotocol/server']).toBe(
        '2.3.1',
      );
      // The installed copies are the declared ones, and satisfy the peer ranges the adapter declares.
      const adapter = readManifest(
        path.join(
          consumer,
          'node_modules',
          '@modelcontextprotocol',
          'fastify',
          'package.json',
        ),
      );
      expect(adapter.version).toBe('2.0.1');
      expect(adapter.peerDependencies).toEqual({
        fastify: '^5.2.0',
        '@modelcontextprotocol/server': '^2.3.0',
      });
      for (const name of [
        'fastify',
        '@modelcontextprotocol/node',
        '@modelcontextprotocol/server',
      ]) {
        expect(
          readManifest(
            path.join(consumer, 'node_modules', name, 'package.json'),
          ).version,
          name,
        ).toBe(starter.dependencies?.[name]);
      }
      // The starter does not promise an older Node than the adapter supports.
      const adapterNode = Number(
        /(\d+)/.exec(adapter.engines?.node ?? '')?.[1],
      );
      const starterNode = Number(
        /(\d+)/.exec(starter.engines?.node ?? '')?.[1],
      );
      expect(starterNode).toBeGreaterThanOrEqual(adapterNode);
    });
  });
});
