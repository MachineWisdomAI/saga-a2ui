import { describe, expect, it } from 'vitest';
import {
  EPISODE_VIEW_FILE,
  RECIPE_PACKAGES,
  candidateIdentity,
  episodeResourceIdentity,
  packageIdentities,
  policyFromArgs,
  sha256Hex,
  summarizeReceipt,
} from './candidate-identity.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONTENT_POLICY, createContentPolicy, type ContentPolicy } from '@saga-a2ui/components/faithful-card';
import { contentResource } from '../apps/lit-host/src/mcp/content-resource.js';
import { EPISODE_VIEW_URI } from '../apps/lit-host/src/mcp/episode.js';
import { SUBSCRIPTIONS_VIEW_URI } from '../apps/lit-host/src/mcp/subscriptions.js';
import { PLAYBACK_VIEW_URI } from '../apps/lit-host/src/playback/playback.js';
import { createEpisodeServer } from '../apps/lit-host/src/mcp/server.js';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('candidate identity', () => {
  it('fails closed when a recipe package is missing from the lockfile', () => {
    expect(() => packageIdentities({ packages: {} })).toThrow(/no complete entry for MCP Apps/);
  });

  it('fails closed when an entry has no integrity to pin', () => {
    const recipe = { Only: 'node_modules/only' };
    expect(() => packageIdentities({ packages: { 'node_modules/only': { version: '1.0.0' } } }, recipe)).toThrow(
      /no complete entry for Only/,
    );
  });

  it('hashes bytes the way a reviewer can reproduce with sha256sum', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('keeps only what ran, on which commit, and how each command ended from a verify receipt', () => {
    const summary = summarizeReceipt(
      JSON.stringify({
        commitAtStart: 'abc',
        validationLabel: 'pristine-head',
        exitCode: 0,
        cwd: '/private/path',
        commands: [{ name: 'typecheck', argv: ['npm', 'run', 'typecheck'], exitCode: 0 }],
      }),
    );
    expect(summary).toEqual({
      commit: 'abc',
      validationLabel: 'pristine-head',
      exitCode: 0,
      commands: [{ name: 'typecheck', exitCode: 0 }],
    });
  });

  // The installed recipe is the qualified one: this is what MAP1 will measure, so a lockfile that
  // drifts from it must fail here rather than in an actual host.
  it('pins the qualified MCP v2 recipe and keeps A2UI on its own Zod 3 copy', () => {
    const identity = candidateIdentity(repoRoot) as {
      packages: { role: string; version: string; license: string | null }[];
    };
    const version = (role: string) => identity.packages.find((entry) => entry.role === role)?.version;
    expect(version('MCP Apps')).toBe('2.0.3');
    expect(['MCP client', 'MCP core', 'MCP server'].map(version)).toEqual(['2.3.1', '2.3.1', '2.3.1']);
    expect(version('MCP Node integration')).toBe('2.1.1');
    expect(version('Zod (MCP seam, hoisted)')).toMatch(/^4\.(?:[2-9]|\d{2,})\./);
    expect(version('A2UI Lit')).toBe('0.13.0');
    expect(version('A2UI web core')).toBe('0.13.0');
    expect(version('Zod (A2UI boundary, web core copy)')).toMatch(/^3\./);
    expect(version('Zod (A2UI boundary, Lit copy)')).toMatch(/^3\./);
    expect(version('Zod 3 alias (A2UI schema authoring)')).toBe(version('Zod (A2UI boundary, web core copy)'));
    expect(version('zod-to-json-schema (A2UI boundary)')).toMatch(/^3\./);
    expect(identity.packages).toHaveLength(Object.keys(RECIPE_PACKAGES).length);
  });

  // MAP1 must identify the candidate the host sees. The episode view is transformed by the content
  // policy (embedded restrictions, and a different URI per image-origin set), so the report is
  // compared with what the server actually serves, not with the raw build.
  describe('the served episode resource', () => {
    const viewHtml = '<!doctype html><html><head><title>Episode</title></head><body><saga-app></saga-app></body></html>';

    function fixtureRoot(): string {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-identity-'));
      fs.mkdirSync(path.dirname(path.join(root, EPISODE_VIEW_FILE)), { recursive: true });
      fs.writeFileSync(path.join(root, EPISODE_VIEW_FILE), viewHtml);
      return root;
    }

    async function served(policy: ContentPolicy) {
      const { Client, InMemoryTransport } = await import('@modelcontextprotocol/client');
      const server = createEpisodeServer({ catalog: { find: () => undefined }, viewHtml, contentPolicy: policy });
      const client = new Client({ name: 'identity-test', version: '0.0.0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      await client.connect(clientSide);
      try {
        const listed = await client.listResources();
        const episode = listed.resources.find((resource) => resource.uri.startsWith('ui://saga-a2ui/episode-view'));
        if (episode === undefined) throw new Error('The server lists no episode view.');
        const read = await client.readResource({ uri: episode.uri });
        const content = read.contents[0];
        if (content === undefined || !('text' in content)) throw new Error('The episode view has no text.');
        return { uri: episode.uri, bytes: Buffer.from(content.text, 'utf8') };
      } finally {
        await client.close();
        await server.close();
      }
    }

    it('reports the URI, bytes and hash of the resource the server serves under the default policy', async () => {
      const root = fixtureRoot();
      try {
        const identity = episodeResourceIdentity(root) as { uri: string; bytes: number; sha256: string; rawBuild: { sha256: string } };
        const actual = await served(DEFAULT_CONTENT_POLICY);
        expect(identity.uri).toBe(actual.uri);
        expect(identity.bytes).toBe(actual.bytes.length);
        expect(identity.sha256).toBe(sha256Hex(actual.bytes));
        // The served document is not the raw build, and the raw build stays separately identified.
        expect(identity.sha256).not.toBe(identity.rawBuild.sha256);
        expect(identity.rawBuild.sha256).toBe(sha256Hex(viewHtml));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('reports the configured URI, bytes and hash for a policy with image hosts, and a different identity from the default', async () => {
      const root = fixtureRoot();
      try {
        const created = createContentPolicy({ imageHosts: ['images.example.com'] });
        if (!created.ok) throw new Error('The policy is valid.');
        const identity = episodeResourceIdentity(root, created.policy) as { uri: string; bytes: number; sha256: string };
        const actual = await served(created.policy);
        expect(actual.uri).not.toBe('ui://saga-a2ui/episode-view.html');
        expect(identity.uri).toBe(actual.uri);
        expect(identity.bytes).toBe(actual.bytes.length);
        expect(identity.sha256).toBe(sha256Hex(actual.bytes));
        expect(identity.sha256).not.toBe((episodeResourceIdentity(root) as { sha256: string }).sha256);
        expect(identity.uri).toBe(contentResource(viewHtml, created.policy).uri);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('lists the served episode resource first and the verbatim views unchanged in the full report', () => {
      const root = fixtureRoot();
      try {
        for (const file of ['apps/lit-host/dist/subscriptions-view/subscriptions.html', 'apps/lit-host/dist/playback-view/playback.html']) {
          fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
          fs.writeFileSync(path.join(root, file), `<p>${file}</p>`);
        }
        fs.copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(root, 'package-lock.json'));
        const resources = (candidateIdentity(root) as { resources: { uri: string; sha256: string }[] }).resources;
        expect(resources.map((resource) => resource.uri)).toEqual([
          EPISODE_VIEW_URI,
          SUBSCRIPTIONS_VIEW_URI,
          PLAYBACK_VIEW_URI,
        ]);
        expect(resources[1]?.sha256).toBe(sha256Hex('<p>apps/lit-host/dist/subscriptions-view/subscriptions.html</p>'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('builds the policy from --image-host and rejects an invalid host instead of falling back', () => {
      expect(policyFromArgs([]).resource.imageOrigins).toEqual([]);
      expect(policyFromArgs(['--image-host', 'images.example.com', '--out', 'x']).resource.imageOrigins).toEqual([
        'https://images.example.com',
      ]);
      expect(() => policyFromArgs(['--image-host', 'images.example.com;bogus'])).toThrow(/Invalid content policy/);
      expect(() => policyFromArgs(['--image-host'])).toThrow(/requires a value/);
    });

    it('builds a Strict policy from --level and --blocked-presentation, and rejects invalid values', () => {
      expect(policyFromArgs([]).level).toBe('standard');
      expect(policyFromArgs(['--level', 'strict']).level).toBe('strict');
      expect(policyFromArgs(['--level', 'strict']).blockedPresentation).toBe('placeholder');
      expect(
        policyFromArgs(['--level', 'strict', '--blocked-presentation', 'inert-text', '--image-host', 'images.example.com']),
      ).toMatchObject({ level: 'strict', blockedPresentation: 'inert-text', imageHosts: ['images.example.com'] });
      expect(() => policyFromArgs(['--level', 'permissive'])).toThrow(/Invalid content policy/);
      expect(() => policyFromArgs(['--blocked-presentation', 'inert-text'])).toThrow(/Invalid content policy/);
      expect(() => policyFromArgs(['--level'])).toThrow(/requires a value/);
    });

    it('reports a different served identity for Strict than for Standard with the same hosts', () => {
      const root = fixtureRoot();
      try {
        const hosts = ['--image-host', 'images.example.com'];
        const standard = episodeResourceIdentity(root, policyFromArgs(hosts)) as { uri: string; sha256: string };
        const strict = episodeResourceIdentity(root, policyFromArgs(['--level', 'strict', ...hosts])) as {
          uri: string;
          sha256: string;
        };
        expect(strict.uri).not.toBe(standard.uri);
        expect(strict.sha256).not.toBe(standard.sha256);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
