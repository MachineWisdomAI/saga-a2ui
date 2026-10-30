import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
export const tutorialGameSource = path.join(
  root,
  '.wise-agents',
  'tutorial-game',
);
export interface ExamplePin {
  readonly repository: string;
  readonly revision: string;
  readonly tarSha256: string;
  readonly gamePath: string;
}
export const examplePin: ExamplePin = JSON.parse(
  fs.readFileSync(
    path.join(root, 'scripts', 'tic-tac-toe-source.json'),
    'utf8',
  ),
);

export function verifyExampleArchive(bytes: Uint8Array, digest: string): void {
  if (createHash('sha256').update(gunzipSync(bytes)).digest('hex') !== digest)
    throw new Error(
      'Examples archive digest mismatch; no tutorial source was staged.',
    );
}

/** Stage only the recorded external application. No fallback to local or moving source. */
export async function stageTutorialGame(): Promise<void> {
  if (
    examplePin.repository !== 'MachineWisdomAI/saga-a2ui-examples' ||
    examplePin.gamePath !== 'apps/tic-tac-toe/game' ||
    !/^[a-f0-9]{40}$/.test(examplePin.revision) ||
    !/^[a-f0-9]{64}$/.test(examplePin.tarSha256)
  )
    throw new Error('Invalid tutorial examples pin.');
  const base = path.join(root, '.wise-agents');
  fs.mkdirSync(base, { recursive: true });
  const cache = path.join(base, `examples-${examplePin.revision}.tar.gz`);
  let bytes: Buffer;
  if (fs.existsSync(cache)) bytes = fs.readFileSync(cache);
  else {
    const url = `https://github.com/${examplePin.repository}/archive/${examplePin.revision}.tar.gz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok)
      throw new Error(`Examples archive download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  verifyExampleArchive(bytes, examplePin.tarSha256);
  const work = fs.mkdtempSync(path.join(base, 'tutorial-extract-'));
  try {
    const archive = path.join(work, 'source.tar.gz');
    fs.writeFileSync(archive, bytes);
    const game = path.join(work, 'game');
    fs.mkdirSync(game);
    execFileSync('tar', [
      '-xzf',
      archive,
      '-C',
      game,
      '--strip-components=4',
      `saga-a2ui-examples-${examplePin.revision}/${examplePin.gamePath}`,
    ]);
    if (!fs.existsSync(path.join(game, 'server', 'operations.ts')))
      throw new Error('Examples archive contains no game operations.');
    fs.writeFileSync(cache, bytes);
    fs.rmSync(tutorialGameSource, { recursive: true, force: true });
    fs.renameSync(game, tutorialGameSource);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(
    `Tutorial source: ${examplePin.repository}@${examplePin.revision}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await stageTutorialGame();
