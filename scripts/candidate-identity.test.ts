import { describe, expect, it } from 'vitest';
import { RECIPE_PACKAGES, candidateIdentity, packageIdentities, sha256Hex, summarizeReceipt } from './candidate-identity.js';
import path from 'node:path';
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
});
