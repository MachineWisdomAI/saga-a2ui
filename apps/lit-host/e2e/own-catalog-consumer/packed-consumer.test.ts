import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

// An application with its own catalog installs the packed core and Lit packages. The tarballs are
// unpacked into a clean directory outside the repository, and only the dependencies each packed
// manifest declares (plus the consumer's own) are linked in. A missing declaration, a workspace
// alias or a file left out of the package therefore fails the build instead of passing here.

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const consumerSource = fileURLToPath(new URL('./consumer.ts', import.meta.url));
const OWN_DEPENDENCIES = ['@a2ui/lit', '@a2ui/web_core', 'lit'];
const SDK_PACKAGES = ['core', 'lit'] as const;

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-packed-consumer-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

interface PackedTarball {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

function link(name: string, into: string): void {
  const target = path.join(into, 'node_modules', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, 'node_modules', name), target, 'dir');
}

/** Packs each SDK package and unpacks it as an installed dependency of the consumer. */
function installPacked(consumer: string): { manifests: Record<string, Manifest>; files: Record<string, string[]> } {
  const manifests: Record<string, Manifest> = {};
  const files: Record<string, string[]> = {};
  for (const name of SDK_PACKAGES) {
    // The packages are private and unversioned (see docs/version-policy.md), and `npm pack` refuses a
    // manifest without a version. Pack a copy that carries a throwaway version; the copy's `files`
    // list and dependencies are the package's own, and nothing in the repository is changed.
    const staged = path.join(work, 'staged', name);
    fs.cpSync(path.join(repoRoot, 'packages', name), staged, { recursive: true, filter: (from) => !from.includes('node_modules') });
    const manifestPath = path.join(staged, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '0.0.0-packed-test' }));
    // npm 12 reports the result keyed by package name; older releases report an array.
    const report = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--silent', '--pack-destination', work], { cwd: staged, encoding: 'utf8' }),
    ) as Record<string, PackedTarball> | PackedTarball[];
    const packed = Object.values(report)[0]!;
    const target = path.join(consumer, 'node_modules', '@saga-a2ui', name);
    fs.mkdirSync(target, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(work, packed.filename), '-C', target, '--strip-components=1']);
    manifests[name] = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')) as Manifest;
    files[name] = packed.files.map((file) => file.path);
  }
  return { manifests, files };
}

describe('an own-catalog consumer built from the packed SDK packages', () => {
  const consumer = path.join(work, 'consumer');
  fs.mkdirSync(consumer);
  fs.copyFileSync(consumerSource, path.join(consumer, 'consumer.ts'));
  const installed = installPacked(consumer);

  it('declares no optional component, Markdown parser or delivery dependency', () => {
    const declared = Object.values(installed.manifests).flatMap((manifest) => [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    expect(declared.filter((name) => /components|markdown|modelcontextprotocol|@saga-a2ui\/mcp/.test(name))).toEqual([]);
  });

  it('ships source only: no tests and nothing outside the public exports', () => {
    for (const [name, packed] of Object.entries(installed.files)) {
      expect(packed.filter((file) => file !== 'package.json' && !file.startsWith('src/')), name).toEqual([]);
      expect(packed.filter((file) => /\.test\.ts$/.test(file)), name).toEqual([]);
    }
  });

  it('builds a browser artifact from the installed packages alone, without server code or optional components', async () => {
    const declared = new Set<string>(OWN_DEPENDENCIES);
    for (const manifest of Object.values(installed.manifests)) {
      for (const name of Object.keys(manifest.dependencies ?? {})) if (!name.startsWith('@saga-a2ui/')) declared.add(name);
    }
    for (const name of declared) link(name, consumer);

    const result = await build({
      configFile: false,
      root: consumer,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        lib: { entry: path.join(consumer, 'consumer.ts'), formats: ['es'], fileName: 'consumer' },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => ('output' in one ? one.output : []));
    const chunks = outputs.flatMap((output) => (output.type === 'chunk' ? [output] : []));
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules));
    const code = chunks.map((chunk) => chunk.code).join('\n');

    // The installed copies were used, not the workspace sources.
    expect(modules.some((id) => id.includes('/consumer/node_modules/@saga-a2ui/lit/src/'))).toBe(true);
    expect(modules.some((id) => id.includes('/consumer/node_modules/@saga-a2ui/core/src/'))).toBe(true);
    expect(modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages')))).toEqual([]);

    // No delivery, server, Markdown or optional-component code.
    expect(modules.filter((id) => /node_modules\/(@modelcontextprotocol|markdown-it|@a2ui\/markdown-it)\//.test(id))).toEqual([]);
    for (const marker of ['FaithfulCard', 'StreamableHTTP', 'node:http', 'process.env', 'html_block']) {
      expect(code, marker).not.toContain(marker);
    }
  }, 120_000);
});
