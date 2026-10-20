import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
import {
  buildConsumerApplication,
  bundleConsumerServer,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
  type PackedSdk,
} from './packed-consumer.js';

// Builds examples/react-card-consumer the way an application outside this repository would receive
// SAGA: the core, components, mcp and react packages are packed, unpacked into a clean directory as
// installed dependencies, and the consumer is built against those copies alone (see
// packed-consumer.ts) into one self-contained HTML document per brand. The browser tests then serve
// those documents through the consumer's own MCP server (apps/lit-host/e2e/react-card-consumer.spec.ts).
//
//   npx tsx scripts/build-react-card-consumer.ts   # writes apps/lit-host/dist/react-card-consumer (ignored)

export const reactCardConsumerSource = path.join(repoRoot, 'examples', 'react-card-consumer');
export const reactCardConsumerDist = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'react-card-consumer');
/** The consumer's MCP server, outside the served pages: it is code for the test's Node process, not a page. */
export const reactCardConsumerServerDist = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'react-card-consumer-server');

/** The two resources the consumer builds from one implementation. */
export const REACT_CARD_BRANDS = ['neutral', 'harbor'] as const;

/** The SDK packages the consumer installs. */
export const REACT_CARD_SDK_PACKAGES = ['core', 'components', 'mcp', 'react'] as const;

/** The packages the consumer imports itself, besides the SDK packages. */
export const REACT_CARD_OWN_DEPENDENCIES = [
  '@modelcontextprotocol/ext-apps',
  '@modelcontextprotocol/server',
  'react',
  'react-dom',
  'zod',
];

export interface PreparedConsumer {
  readonly consumer: string;
  readonly sdk: PackedSdk;
}

/** Copies the consumer source into `work` and installs the packed SDK packages beside it. */
export function prepareReactCardConsumer(work: string): PreparedConsumer {
  const consumer = path.join(work, 'consumer');
  fs.cpSync(reactCardConsumerSource, consumer, { recursive: true, filter: (from) => !from.includes('node_modules') });
  const sdk = installPackedSdk(work, consumer, [...REACT_CARD_SDK_PACKAGES]);
  linkDeclaredDependencies(consumer, sdk, REACT_CARD_OWN_DEPENDENCIES);
  return { consumer, sdk };
}

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The installed version of a third-party package the consumer was built with. */
function installedVersion(name: string): string {
  return (JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;
}

/**
 * Builds each brand into `outDir` as one self-contained page and the consumer's MCP server into
 * `serverOutDir/server.mjs`. Returns the identities a review needs: the source commit, the runtime,
 * the tarball and installed third-party versions, and each artifact's digest.
 */
export async function buildReactCardConsumer(outDir: string, serverOutDir: string): Promise<Record<string, unknown>> {
  const work = createWorkDirectory('saga-react-card-consumer-');
  try {
    const { consumer, sdk } = prepareReactCardConsumer(work);
    for (const [index, brand] of REACT_CARD_BRANDS.entries()) {
      await buildConsumerApplication(consumer, outDir, [viteSingleFile()], { page: `${brand}.html`, emptyOutDir: index === 0 });
    }
    // Beside the repository's own node_modules, so the server's external dependencies resolve.
    const server = await bundleConsumerServer(consumer, 'server/card-server.ts');
    fs.mkdirSync(serverOutDir, { recursive: true });
    fs.copyFileSync(server.file, path.join(serverOutDir, 'server.mjs'));
    const artifact = (file: string) => ({ path: path.relative(repoRoot, file), sha256: sha256(file) });
    return {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      sourceDirty: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '',
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      packedTarballSha256: sdk.tarballSha256,
      installedVersions: Object.fromEntries(
        ['@a2ui/react', '@a2ui/web_core', '@modelcontextprotocol/ext-apps', 'react', 'react-dom', 'vite', 'vite-plugin-singlefile'].map((name) => [name, installedVersion(name)]),
      ),
      builtPages: Object.fromEntries(REACT_CARD_BRANDS.map((brand) => [brand, artifact(path.join(outDir, `${brand}.html`))])),
      builtServer: artifact(path.join(serverOutDir, 'server.mjs')),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const identity = await buildReactCardConsumer(reactCardConsumerDist, reactCardConsumerServerDist);
  fs.writeFileSync(path.join(reactCardConsumerDist, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  console.log(JSON.stringify(identity, null, 2));
}
