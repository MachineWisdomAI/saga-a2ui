import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { honoAdapterCases } from './starter-hono-cases.js';
import { qualifyStarter } from './starter-qualification.js';
import { templateDirectory, templateFiles } from './starter-template.js';

// The `lit-mcp` starter on Hono (templates/lit-hono, STARTER-HONO #63): the server on the official
// `@modelcontextprotocol/hono` 2.0.2 adapter and `@hono/node-server`. The shared cases of
// starter-qualification.ts run against its built listener: allowed, denied, public and
// missing-auth behavior, concurrent per-request identity (including a verifier that reuses and
// rewrites the object it returned), the request and operation clocks, and the HTTP body and
// delivery boundary, which Hono hands to the application differently from the other targets. The
// cases below are the ones only the Hono pairs add (starter-hono-cases.ts, which the React copy
// runs too), and the byte-identity rules that keep the two Hono templates' server text one text. The browser behavior of the built view is qualified for every pair by
// apps/lit-host/e2e/starter.spec.ts.

const STARTER = 'lit-hono';
/** The React starter on Hono: its `server/` is this template's text, so a server fix lands in both. */
const REACT_COPY = 'react-hono';
/** Outside `server/`, the files that build and check the server: the same in both Hono templates. */
const SERVER_SIDE_FILES = ['tsconfig.server.json', 'vite.server.config.ts'];
const HONO_PINS = [
  '@modelcontextprotocol/hono',
  '@hono/node-server',
  'hono',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/client',
  'zod',
];

qualifyStarter(STARTER, (harness) => {
  honoAdapterCases(harness);

  describe('the tested recipe', () => {
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

    it('is the same server in the React copy: its server files, server build and policy are byte-identical, and its Hono pins are the same', () => {
      const lit = templateDirectory(STARTER);
      const react = templateDirectory(REACT_COPY);
      const own = (directory: string): string[] =>
        templateFiles(directory).filter(
          (file) =>
            file.startsWith('server/') || SERVER_SIDE_FILES.includes(file),
        );
      expect(own(react)).toEqual(own(lit));
      for (const file of own(lit))
        expect(fs.readFileSync(path.join(react, file), 'utf8'), file).toBe(
          fs.readFileSync(path.join(lit, file), 'utf8'),
        );

      // The wire contract is shared by the server and the view; only the element the view renders into differs.
      const withoutMarker = (directory: string): string =>
        fs
          .readFileSync(path.join(directory, 'src/contract.ts'), 'utf8')
          .replace(/export const VIEW_MARKER = .*;\n/, '');
      expect(withoutMarker(react)).toBe(withoutMarker(lit));

      const pins = (directory: string): Record<string, string> => {
        const { dependencies } = JSON.parse(
          fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
        ) as { dependencies: Record<string, string> };
        return Object.fromEntries(
          HONO_PINS.map((name) => [name, dependencies[name] as string]),
        );
      };
      expect(pins(react)).toEqual(pins(lit));
      expect(Object.values(pins(lit)).every((one) => /^\d/.test(one))).toBe(
        true,
      );
      const metadata = (directory: string) =>
        JSON.parse(
          fs.readFileSync(path.join(directory, 'template.json'), 'utf8'),
        ) as { server: string; serverAdapter: unknown };
      expect(metadata(react).server).toBe(metadata(lit).server);
      expect(metadata(react).serverAdapter).toEqual(
        metadata(lit).serverAdapter,
      );
    });
  });
});
