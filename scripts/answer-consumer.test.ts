import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { answerConsumerSource, prepareAnswerConsumer } from './build-answer-consumer.js';
import { bundleConsumerEntry, createWorkDirectory, repoRoot } from './packed-consumer.js';

// An application outside this repository installs the packed core, Lit and optional components
// packages and renders a FaithfulCard. This checks what that installation consists of; the built
// page itself is exercised in a browser by apps/lit-host/e2e/answer-consumer.spec.ts.

const work = createWorkDirectory('saga-answer-consumer-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('the answer consumer built from the packed SDK packages', () => {
  const { consumer, sdk } = prepareAnswerConsumer(work);

  it('imports only public package exports and its own files: no source path, alias or copied SDK module', () => {
    const sources = fs.readdirSync(path.join(answerConsumerSource, 'src')).filter((name) => name.endsWith('.ts'));
    expect(sources.length).toBeGreaterThan(0);
    const specifiers = sources.flatMap((name) =>
      [...fs.readFileSync(path.join(answerConsumerSource, 'src', name), 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1] as string),
    );
    const own = specifiers.filter((specifier) => specifier.startsWith('./'));
    const packages = [...new Set(specifiers.filter((specifier) => !specifier.startsWith('./')))].sort();
    expect(own.every((specifier) => /^\.\/[a-z-]+\.js$/.test(specifier))).toBe(true); // siblings only, never ../
    expect(packages).toEqual([
      '@a2ui/lit/v0_9',
      '@a2ui/web_core/v0_9',
      '@saga-a2ui/components/faithful-card',
      '@saga-a2ui/core/protocols/a2ui/v0_9',
      '@saga-a2ui/lit',
      '@saga-a2ui/lit/faithful-card',
      'lit',
    ]);
    expect(fs.existsSync(path.join(answerConsumerSource, 'node_modules'))).toBe(false);
  });

  it('installs each package as a tarball with source and its manifest only', () => {
    expect(Object.keys(sdk.files).sort()).toEqual(['components', 'core', 'lit']);
    for (const [name, packed] of Object.entries(sdk.files)) {
      expect(packed.filter((file) => file !== 'package.json' && !file.startsWith('src/')), name).toEqual([]);
      expect(packed.filter((file) => /\.test(-support)?\.ts$/.test(file)), name).toEqual([]);
    }
    expect(sdk.files.components).toContain('src/faithful-card/index.ts');
    expect(sdk.files.lit).toContain('src/faithful-card/index.ts');
    for (const hash of Object.values(sdk.tarballSha256)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the components package independent of renderers and delivery, and Lit dependent on it only optionally', () => {
    const components = sdk.manifests.components!;
    expect(Object.keys(components.dependencies ?? {}).sort()).toEqual(['@a2ui/web_core', '@saga-a2ui/core', 'markdown-it', 'zod']);
    expect(components.peerDependencies ?? {}).toEqual({});
    const lit = sdk.manifests.lit!;
    expect(Object.keys(lit.dependencies ?? {})).not.toContain('@saga-a2ui/components');
    expect(lit.peerDependencies).toEqual({ '@saga-a2ui/components': '*' });
    expect(lit.peerDependenciesMeta?.['@saga-a2ui/components']).toEqual({ optional: true });
  });

  it('builds a browser artifact from the installed copies alone, with the FaithfulCard and its parser but no delivery code', async () => {
    const { modules, code } = await bundleConsumerEntry(consumer, 'src/main.ts');
    for (const name of ['core', 'lit', 'components']) {
      expect(modules.some((id) => id.includes(`/consumer/node_modules/@saga-a2ui/${name}/src/`)), name).toBe(true);
    }
    expect(modules.some((id) => id.includes('/consumer/node_modules/@saga-a2ui/components/src/faithful-card/reader.ts'))).toBe(true);
    expect(modules.some((id) => id.includes('/consumer/node_modules/@saga-a2ui/lit/src/faithful-card/faithful-card-element.ts'))).toBe(true);
    // Nothing came from the workspace, the example's own source, or a server or delivery package.
    expect(modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages')) || id.startsWith(path.join(repoRoot, 'apps')))).toEqual([]);
    expect(modules.filter((id) => /node_modules\/(@modelcontextprotocol|react|react-dom)\//.test(id))).toEqual([]);
    expect(modules.filter((id) => /\/@saga-a2ui\/(mcp|react)\//.test(id))).toEqual([]);
    // The application's own composition used the packed card.
    expect(modules.some((id) => id.endsWith('/consumer/src/answer-app.ts'))).toBe(true);
    expect(code).toContain('saga-faithful-card');
    for (const marker of ['StreamableHTTP', 'node:http', 'process.env']) expect(code, marker).not.toContain(marker);
  }, 120_000);
});
