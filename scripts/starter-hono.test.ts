import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './packed-consumer.js';
import { qualifyStarter } from './starter-qualification.js';
import {
  readTemplateMetadata,
  templateDirectory,
  templateFiles,
} from './starter-template.js';

// The `lit-mcp` starter on Hono (templates/lit-hono, STARTER-HONO #63): the server on the official
// `@modelcontextprotocol/hono` 2.0.2 adapter and `@hono/node-server`. The shared cases of
// starter-qualification.ts run against its built listener: allowed, denied, public and
// missing-auth behavior, concurrent per-request identity (including a verifier that reuses and
// rewrites the object it returned), the request and operation clocks, and the HTTP body and
// delivery boundary, which Hono hands to the application differently from the other targets. The
// cases below are the ones only this pair adds: the adapter's Host and Origin validation, and the
// tested version recipe. The browser behavior of the built view is qualified for every pair by
// apps/lit-host/e2e/starter.spec.ts.

const STARTER = 'lit-hono';

qualifyStarter(STARTER, ({ built, start, allowedToken }) => {
  describe("the official adapter's Host and Origin validation", () => {
    /** A raw request, so the Host and Origin headers can be chosen; the answer is read as the HTTP answer it is. */
    function rawRequest(
      url: string,
      headers: Record<string, string>,
    ): Promise<{ status: number | undefined; text: string }> {
      return new Promise((resolve, reject) => {
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_status', arguments: {} },
        });
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

    it('answers a request for the local host name the starter lists, with or without a local Origin', async () => {
      const { listener } = await start();
      const { port } = new URL(listener.statusUrl);
      expect(
        (await rawRequest(listener.statusUrl, { host: `localhost:${port}` }))
          .status,
      ).toBe(200);
      expect(
        (
          await rawRequest(listener.statusUrl, {
            origin: `http://localhost:${port}`,
          })
        ).status,
      ).toBe(200);
    });

    it.each([
      [
        'a Host header for another name (DNS rebinding)',
        { host: 'rebound.example' },
      ],
      ['an Origin from another site', { origin: 'https://other-site.example' }],
    ] as const)(
      'refuses %s with 403 on both endpoints, and no credential or protected work is reached',
      async (_label, headers) => {
        const { listener, calls } = await start();
        for (const url of [listener.statusUrl, listener.accountUrl]) {
          const answered = await rawRequest(url, {
            ...headers,
            authorization: `Bearer ${allowedToken}`,
          });
          expect(answered.status, url).toBe(403);
          expect(answered.text, url).toContain('"jsonrpc":"2.0"');
        }
        expect(calls).toEqual({ verifier: 0, authorize: 0 });
      },
    );
  });

  describe('the tested recipe', () => {
    const read = (file: string): Record<string, unknown> =>
      JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    const installed = (
      name: string,
    ): { version?: string; peerDependencies?: Record<string, string> } =>
      read(path.join(repoRoot, 'node_modules', name, 'package.json'));

    it('pins the adapter, its host and its peers to the exact versions this suite ran against', () => {
      const metadata = readTemplateMetadata(templateDirectory(STARTER));
      const manifest = read(
        path.join(built().exported.directory, 'package.json'),
      ) as { dependencies: Record<string, string>; engines: { node: string } };

      // The exported manifest names what was installed here, not a range that may resolve to something else.
      for (const name of [
        '@modelcontextprotocol/hono',
        '@hono/node-server',
        'hono',
        '@modelcontextprotocol/server',
        '@modelcontextprotocol/client',
      ]) {
        expect(manifest.dependencies[name], name).toBe(installed(name).version);
      }
      expect(manifest.dependencies[metadata.serverAdapter.package]).toBe(
        metadata.serverAdapter.version,
      );
      // The adapter's own peer ranges are what the starter's pins were chosen to satisfy; a new adapter that changes them must be looked at.
      expect(installed('@modelcontextprotocol/hono').peerDependencies).toEqual({
        '@modelcontextprotocol/server': '^2.3.0',
        hono: '^4.11.4',
      });
      expect(manifest.engines.node).toBe('>=22.12.0');
    });

    it('is the Node starter with only the server adapter replaced: its view, operations and policy files are the same files', () => {
      const node = templateDirectory('lit-node');
      const hono = templateDirectory(STARTER);
      const adapterFiles = [
        'README.md',
        'package.json',
        'server/authenticate.ts',
        'server/listener.ts',
      ];
      expect(templateFiles(hono)).toEqual(templateFiles(node));
      for (const file of templateFiles(hono).filter(
        (one) => !adapterFiles.includes(one),
      )) {
        expect(fs.readFileSync(path.join(hono, file), 'utf8'), file).toBe(
          fs.readFileSync(path.join(node, file), 'utf8'),
        );
      }
    });
  });
});
