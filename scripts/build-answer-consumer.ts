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

// Builds examples/answer-consumer the way an application outside this repository would receive
// SAGA: the core, Lit and optional components packages are packed, unpacked into a clean directory
// as installed dependencies, and the consumer is built against those copies alone (see
// packed-consumer.ts). The browser tests then load the built page (apps/lit-host/e2e/answer-consumer.spec.ts).
//
//   npx tsx scripts/build-answer-consumer.ts            # writes apps/lit-host/dist/answer-consumer (ignored)

export const answerConsumerSource = path.join(
  repoRoot,
  'examples',
  'answer-consumer',
);
export const answerConsumerDist = path.join(
  repoRoot,
  'apps',
  'lit-host',
  'dist',
  'answer-consumer',
);
/** The consumer's MCP server, outside the served pages: it is code for the test's Node process, not a page. */
export const answerConsumerServerDist = path.join(
  repoRoot,
  'apps',
  'lit-host',
  'dist',
  'answer-consumer-server',
);

/** The packages the consumer imports itself, besides the SDK packages. */
export const ANSWER_CONSUMER_OWN_DEPENDENCIES = [
  '@a2ui/lit',
  '@a2ui/web_core',
  '@modelcontextprotocol/server',
  'lit',
  'zod',
];

export interface PreparedConsumer {
  readonly consumer: string;
  readonly sdk: PackedSdk;
}

/** Copies the consumer source into `work` and installs the packed SDK packages beside it. */
export function prepareAnswerConsumer(work: string): PreparedConsumer {
  const consumer = path.join(work, 'consumer');
  fs.cpSync(answerConsumerSource, consumer, {
    recursive: true,
    filter: (from) => !from.includes('node_modules'),
  });
  const sdk = installPackedSdk(work, consumer, [
    'core',
    'lit',
    'components',
    'mcp',
    'lit-mcp-stack',
  ]);
  linkDeclaredDependencies(consumer, sdk, ANSWER_CONSUMER_OWN_DEPENDENCIES);
  return { consumer, sdk };
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Builds the consumer into `outDir` as two self-contained pages, the standalone `index.html` and
 * the `mcp.html` an MCP host mounts, and its MCP server into `serverOutDir/server.mjs` (the server
 * the browser tests connect to, which serves exactly that `mcp.html`). Returns the identities a
 * review needs: the source commit, the runtime and each artifact's digest.
 */
export async function buildAnswerConsumer(
  outDir: string,
  serverOutDir: string,
): Promise<Record<string, unknown>> {
  const work = createWorkDirectory('saga-answer-consumer-');
  try {
    const { consumer, sdk } = prepareAnswerConsumer(work);
    await buildConsumerApplication(consumer, outDir, [viteSingleFile()]);
    await buildConsumerApplication(consumer, outDir, [viteSingleFile()], {
      page: 'mcp.html',
      emptyOutDir: false,
    });
    // Beside the repository's own node_modules, so the server's external dependencies resolve.
    const server = await bundleConsumerServer(
      consumer,
      'server/answer-server.ts',
    );
    fs.mkdirSync(serverOutDir, { recursive: true });
    fs.copyFileSync(server.file, path.join(serverOutDir, 'server.mjs'));
    return {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim(),
      sourceDirty:
        execFileSync(
          'git',
          ['status', '--porcelain=v1', '--untracked-files=no'],
          { cwd: repoRoot, encoding: 'utf8' },
        ).trim() !== '',
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      packedTarballSha256: sdk.tarballSha256,
      builtPage: {
        path: path.relative(repoRoot, path.join(outDir, 'index.html')),
        sha256: sha256(path.join(outDir, 'index.html')),
      },
      builtMcpPage: {
        path: path.relative(repoRoot, path.join(outDir, 'mcp.html')),
        sha256: sha256(path.join(outDir, 'mcp.html')),
      },
      builtServer: {
        path: path.relative(repoRoot, path.join(serverOutDir, 'server.mjs')),
        sha256: sha256(path.join(serverOutDir, 'server.mjs')),
      },
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const identity = await buildAnswerConsumer(
    answerConsumerDist,
    answerConsumerServerDist,
  );
  fs.writeFileSync(
    path.join(answerConsumerDist, 'identity.json'),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
  console.log(JSON.stringify(identity, null, 2));
}
