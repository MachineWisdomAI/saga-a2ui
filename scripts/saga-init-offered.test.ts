import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  candidateVersion,
  createWorkDirectory,
  installPackedTarballs,
  linkDeclaredDependencies,
  packSdkPackages,
  sourceRevision,
  buildConsumerFromConfig,
  type PackedPackage,
  type SdkPackage,
} from './packed-consumer.js';
import { SUPPORTED_PAIRS, runCli } from './saga.js';
import { readTemplateMetadata, templateDirectory } from './starter-template.js';

// The real `saga init` for each offered pair (#179), as a developer would run it, followed by the
// existing packed-candidate tooling: the created directory is the starter's own output (no
// qualification fixture, entry or verifier is added), it receives the packed candidate tarballs the
// command's pins name, and it is type-checked and built with its own scripts' configuration.
// The listener, security and host evidence of each pair stays with the starter qualification
// (starter*.test.ts, apps/lit-host/e2e/starter.spec.ts) and is not repeated here.

const work = createWorkDirectory('saga-init-offered-');
let version = '';

/** The SDK packages every offered pair's template names, packed once for all of them. */
const packedSet = (): SdkPackage[] =>
  [
    ...new Set(
      SUPPORTED_PAIRS.flatMap(
        (pair) =>
          readTemplateMetadata(templateDirectory(pair.template)).sdkPackages,
      ),
    ),
  ].sort();
const packedByName = new Map<string, PackedPackage>();

beforeAll(() => {
  const { commit, dirty } = sourceRevision();
  version = candidateVersion(commit, dirty);
  for (const one of packSdkPackages(
    work,
    packedSet(),
    path.join(work, 'tarballs'),
    version,
  ))
    packedByName.set(one.name, one);
}, 300_000);

afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

async function init(
  cwd: string,
  stack: string,
  server: string,
): Promise<string> {
  let err = '';
  const code = await runCli(
    ['init', '--a2ui-stack', stack, '--server', server, 'project'],
    {
      cwd,
      sdkVersion: () => version,
      stageDemo: () =>
        Promise.reject(new Error('init builds no demonstration')),
      stdout: () => undefined,
      stderr: (text) => (err += text),
    },
  );
  if (code !== 0)
    throw new Error(`saga init ${stack} on ${server} exited ${code}: ${err}`);
  return path.join(cwd, 'project');
}

describe.each(SUPPORTED_PAIRS)(
  'the project saga init creates for $stack on $server',
  (pair) => {
    it('installs the matching packed candidates, type-checks and builds with its own configuration', async () => {
      const cwd = fs.mkdtempSync(
        path.join(work, `${pair.stack}-${pair.server}-`),
      );
      const project = await init(cwd, pair.stack, pair.server);
      const metadata = readTemplateMetadata(templateDirectory(pair.template));
      // The packages this pair's template names, from the one packed set; no other is installed into it.
      const packed = metadata.sdkPackages.map(
        (name) => packedByName.get(name) as PackedPackage,
      );

      // The pins the command wrote are exactly the candidate that is installed.
      const manifest = JSON.parse(
        fs.readFileSync(path.join(project, 'package.json'), 'utf8'),
      ) as {
        dependencies: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(packed.map((one) => one.name).sort()).toEqual(
        [...metadata.sdkPackages].sort(),
      );
      for (const one of packed)
        expect(manifest.dependencies[`@saga-a2ui/${one.name}`], one.name).toBe(
          one.version,
        );
      expect(manifest.dependencies[metadata.serverAdapter.package]).toBe(
        metadata.serverAdapter.version,
      );

      const sdk = installPackedTarballs(project, packed);
      const third = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      }).filter((name) => !name.startsWith('@saga-a2ui/'));
      linkDeclaredDependencies(project, sdk, third);

      const tsc = path.join(
        project,
        'node_modules',
        'typescript',
        'bin',
        'tsc',
      );
      for (const config of ['tsconfig.json', 'tsconfig.server.json'])
        execFileSync(
          process.execPath,
          [tsc, '-p', path.join(project, config)],
          { cwd: project, stdio: 'pipe' },
        );
      await buildConsumerFromConfig(project, 'vite.config.ts');
      await buildConsumerFromConfig(project, 'vite.server.config.ts');
      for (const built of ['dist/index.html', 'dist/server.mjs'])
        expect(fs.existsSync(path.join(project, built)), built).toBe(true);

      // Nothing but the starter's own files and the installed dependencies: no harness entry or test identity.
      expect(fs.existsSync(path.join(project, 'qualification-entry.ts'))).toBe(
        false,
      );
    }, 600_000);
  },
);
