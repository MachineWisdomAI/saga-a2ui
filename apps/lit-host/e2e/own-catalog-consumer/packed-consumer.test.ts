import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bundleConsumerEntry,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
  unexpectedPackageFiles,
  type PackedSdk,
} from '../../../../scripts/packed-consumer.js';

// An application with its own catalog installs the packed core and Lit packages. The tarballs are
// unpacked into a clean directory outside the repository, and only the dependencies each packed
// manifest declares (plus the consumer's own) are linked in. A missing declaration, a workspace
// alias or a file left out of the package therefore fails the build instead of passing here. The
// optional components package is deliberately absent: this consumer must neither need it nor load
// the FaithfulCard element or its Markdown parser.

const consumerSource = fileURLToPath(new URL('./consumer.ts', import.meta.url));
const actionsConsumerSource = fileURLToPath(
  new URL('./consumer-actions.ts', import.meta.url),
);
const OWN_DEPENDENCIES = ['@a2ui/lit', '@a2ui/web_core', 'lit'];

const work = createWorkDirectory('saga-packed-consumer-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const OPTIONAL_OR_DELIVERY =
  /components|markdown|modelcontextprotocol|@saga-a2ui\/mcp/;

describe('an own-catalog consumer built from the packed SDK packages', () => {
  const consumer = path.join(work, 'consumer');
  fs.mkdirSync(consumer);
  fs.copyFileSync(consumerSource, path.join(consumer, 'consumer.ts'));
  fs.copyFileSync(
    actionsConsumerSource,
    path.join(consumer, 'consumer-actions.ts'),
  );
  const installed: PackedSdk = installPackedSdk(work, consumer, [
    'core',
    'lit',
  ]);

  it('declares no optional component, Markdown parser or delivery dependency, except the optional peer the FaithfulCard export names', () => {
    const hard = Object.values(installed.manifests).flatMap((manifest) =>
      Object.keys(manifest.dependencies ?? {}),
    );
    expect(hard.filter((name) => OPTIONAL_OR_DELIVERY.test(name))).toEqual([]);
    // A peer declaration is the only way a package may name the optional components, and it must be optional,
    // so installing the Lit package does not install them.
    for (const [name, manifest] of Object.entries(installed.manifests)) {
      for (const peer of Object.keys(manifest.peerDependencies ?? {}).filter(
        (one) => OPTIONAL_OR_DELIVERY.test(one),
      )) {
        expect(peer, name).toBe('@saga-a2ui/components');
        expect(
          manifest.peerDependenciesMeta?.[peer]?.optional,
          `${name} ${peer}`,
        ).toBe(true);
      }
    }
    expect(
      fs.existsSync(
        path.join(consumer, 'node_modules', '@saga-a2ui', 'components'),
      ),
    ).toBe(false);
  });

  it('ships source only: no tests and nothing outside the public exports', () => {
    for (const [name, packed] of Object.entries(installed.files)) {
      expect(unexpectedPackageFiles(name, packed), name).toEqual([]);
      expect(
        packed.filter((file) => /\.test\.ts$/.test(file)),
        name,
      ).toEqual([]);
    }
  });

  /** Builds one consumer entry against the installed copies and reports the graph and code. */
  async function buildConsumer(
    entry: string,
  ): Promise<{ modules: string[]; code: string }> {
    linkDeclaredDependencies(consumer, installed, OWN_DEPENDENCIES);
    return bundleConsumerEntry(consumer, entry);
  }

  const noDeliveryOrOptionalCode = (modules: string[], code: string) => {
    // No delivery, server, Markdown or optional-component code.
    expect(
      modules.filter((id) =>
        /node_modules\/(@modelcontextprotocol|markdown-it|@a2ui\/markdown-it)\//.test(
          id,
        ),
      ),
    ).toEqual([]);
    expect(
      modules.filter((id) =>
        /\/@saga-a2ui\/(components|mcp)\/|\/faithful-card\//.test(id),
      ),
    ).toEqual([]);
    for (const marker of [
      'FaithfulCard',
      'saga-faithful-card',
      'StreamableHTTP',
      'node:http',
      'process.env',
      'html_block',
    ]) {
      expect(code, marker).not.toContain(marker);
    }
  };

  it('builds a browser artifact from the installed packages alone, without server code or optional components', async () => {
    const { modules, code } = await buildConsumer('consumer.ts');

    // The installed copies were used, not the workspace sources.
    expect(
      modules.some((id) =>
        id.includes('/consumer/node_modules/@saga-a2ui/lit/src/'),
      ),
    ).toBe(true);
    expect(
      modules.some((id) =>
        id.includes('/consumer/node_modules/@saga-a2ui/core/src/'),
      ),
    ).toBe(true);
    expect(
      modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages'))),
    ).toEqual([]);

    noDeliveryOrOptionalCode(modules, code);
    // An application that does not opt in to direct action attachment carries none of it.
    expect(
      modules.filter((id) =>
        /\/@saga-a2ui\/(core|lit)\/src\/actions\//.test(id),
      ),
    ).toEqual([]);
    for (const marker of [
      'saga-action-button',
      'ActionButton',
      'createInstanceHost',
    ]) {
      expect(code, marker).not.toContain(marker);
    }
  }, 120_000);

  it('builds an application that opts in to direct action attachment from the installed packages alone', async () => {
    const { modules, code } = await buildConsumer('consumer-actions.ts');

    expect(
      modules.some((id) =>
        id.includes('/consumer/node_modules/@saga-a2ui/lit/src/actions/'),
      ),
    ).toBe(true);
    expect(
      modules.some((id) =>
        id.includes('/consumer/node_modules/@saga-a2ui/core/src/actions/'),
      ),
    ).toBe(true);
    expect(
      modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages'))),
    ).toEqual([]);

    noDeliveryOrOptionalCode(modules, code);
    expect(code).toContain('saga-action-button');
  }, 120_000);
});
