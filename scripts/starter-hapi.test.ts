import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as prettier from 'prettier';
import { repoRoot } from './packed-consumer.js';
import { qualifyStarter } from './starter-qualification.js';
import {
  readTemplateMetadata,
  templateDirectory,
  templateFiles,
} from './starter-template.js';

// SAGA owns this Hapi integration. Shared installed-artifact cases exercise the real listener,
// authentication, immutable request identity, budgets and built Lit view. These additional cases
// preserve the reused bridge's pre-auth Host/Origin guards and pin its complete recipe.

const STARTER = 'lit-hapi';

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
        '@hapi/hapi',
        '@modelcontextprotocol/node',
        '@modelcontextprotocol/server',
        '@modelcontextprotocol/client',
      ]) {
        expect(manifest.dependencies[name], name).toBe(installed(name).version);
      }
      expect(manifest.dependencies[metadata.serverAdapter.package]).toBe(
        metadata.serverAdapter.version,
      );
      // The adapter's own peer ranges are what the starter's pins were chosen to satisfy; a new adapter that changes them must be looked at.
      expect(metadata.server).toBe('hapi');
      expect(installed('@modelcontextprotocol/node').peerDependencies).toEqual({
        '@modelcontextprotocol/server': '^2.3.0',
      });
      expect(manifest.engines.node).toBe('>=22.12.0');
    });

    it('reuses the Node view, operations and policy source apart from formatting', async () => {
      const node = templateDirectory('lit-node');
      const hapi = templateDirectory(STARTER);
      const adapterFiles = [
        'README.md',
        'package.json',
        'server/authenticate.ts',
        'server/listener.ts',
        'server/bridge.ts',
      ];
      expect(
        templateFiles(hapi).filter((file) => file !== 'server/bridge.ts'),
      ).toEqual(
        templateFiles(node).filter((file) => file !== 'server/endpoint.ts'),
      );
      for (const file of templateFiles(hapi).filter(
        (one) => !adapterFiles.includes(one),
      )) {
        const options = {
          ...(await prettier.resolveConfig(path.join(hapi, file))),
          filepath: file,
        };
        const source = (root: string) =>
          prettier.format(
            fs.readFileSync(path.join(root, file), 'utf8'),
            options,
          );
        expect(await source(hapi), file).toBe(await source(node));
      }
    });
  });
});
