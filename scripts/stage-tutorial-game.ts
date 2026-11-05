import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

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

/**
 * Byte ceilings for the pinned examples archive, applied while it is read, never after it has been
 * buffered or inflated. The pinned archive is under 100 KiB compressed and 400 KiB expanded; the
 * ceilings leave generous room for the application to grow and stay far below what a corrupted
 * cache entry or a replaced download could use to exhaust memory or disk.
 */
export interface ArchiveLimits {
  /** Bytes read from the cache file or the network. */
  readonly compressedBytes: number;
  /** Bytes produced by decompressing the archive. */
  readonly expandedBytes: number;
}
export const archiveLimits: ArchiveLimits = {
  compressedBytes: 8 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
};

const mebibytes = (bytes: number): string =>
  `${Math.round((bytes / (1024 * 1024)) * 100) / 100} MiB`;

/** Collect chunks, stopping with an error as soon as the running total passes the ceiling. */
async function readBounded(
  chunks: AsyncIterable<Uint8Array>,
  limit: number,
  source: string,
): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > limit)
      throw new Error(
        `Examples archive from ${source} exceeds the ${mebibytes(limit)} compressed limit; no tutorial source was staged.`,
      );
    parts.push(chunk);
  }
  return Buffer.concat(parts, total);
}

/**
 * Check the pinned digest of the decompressed archive. The archive is inflated as a stream that is
 * hashed and discarded, so nothing larger than one chunk is held, and inflation stops with an error
 * at the expanded ceiling. Nothing is extracted by this function.
 */
export async function verifyExampleArchive(
  bytes: Uint8Array,
  digest: string,
  limits: ArchiveLimits = archiveLimits,
): Promise<void> {
  if (bytes.length > limits.compressedBytes)
    throw new Error(
      `Examples archive exceeds the ${mebibytes(limits.compressedBytes)} compressed limit; no tutorial source was staged.`,
    );
  const hash = createHash('sha256');
  const gunzip = createGunzip();
  gunzip.end(bytes);
  let expanded = 0;
  for await (const chunk of gunzip) {
    expanded += (chunk as Buffer).length;
    if (expanded > limits.expandedBytes) {
      gunzip.destroy();
      throw new Error(
        `Examples archive exceeds the ${mebibytes(limits.expandedBytes)} expanded limit; no tutorial source was staged.`,
      );
    }
    hash.update(chunk as Buffer);
  }
  if (hash.digest('hex') !== digest)
    throw new Error(
      'Examples archive digest mismatch; no tutorial source was staged.',
    );
}

export interface StageOptions {
  readonly pin?: ExamplePin;
  /** Directory that holds the archive cache and the staged game; defaults to `.wise-agents`. */
  readonly base?: string;
  readonly fetch?: typeof fetch;
  readonly limits?: ArchiveLimits;
}

async function readCache(file: string, limit: number): Promise<Buffer> {
  const size = fs.statSync(file).size;
  if (size > limit)
    throw new Error(
      `Cached examples archive exceeds the ${mebibytes(limit)} compressed limit; remove ${file} and run the command again. No tutorial source was staged.`,
    );
  return readBounded(fs.createReadStream(file), limit, 'the cache');
}

async function download(
  url: string,
  fetchImpl: typeof fetch,
  limit: number,
): Promise<Buffer> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`Examples archive download failed: ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new Error(
      `Examples archive from the download exceeds the ${mebibytes(limit)} compressed limit; no tutorial source was staged.`,
    );
  }
  if (!response.body) throw new Error('Examples archive download was empty.');
  return readBounded(response.body, limit, 'the download');
}

/** Stage only the recorded external application. No fallback to local or moving source. */
export async function stageTutorialGame(
  options: StageOptions = {},
): Promise<void> {
  const pin = options.pin ?? examplePin;
  const limits = options.limits ?? archiveLimits;
  if (
    pin.repository !== 'MachineWisdomAI/saga-a2ui-examples' ||
    pin.gamePath !== 'apps/tic-tac-toe/game' ||
    !/^[a-f0-9]{40}$/.test(pin.revision) ||
    !/^[a-f0-9]{64}$/.test(pin.tarSha256)
  )
    throw new Error('Invalid tutorial examples pin.');
  const base = options.base ?? path.join(root, '.wise-agents');
  const destination = path.join(base, 'tutorial-game');
  fs.mkdirSync(base, { recursive: true });
  const cache = path.join(base, `examples-${pin.revision}.tar.gz`);
  const bytes = fs.existsSync(cache)
    ? await readCache(cache, limits.compressedBytes)
    : await download(
        `https://github.com/${pin.repository}/archive/${pin.revision}.tar.gz`,
        options.fetch ?? fetch,
        limits.compressedBytes,
      );
  await verifyExampleArchive(bytes, pin.tarSha256, limits);
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
      `saga-a2ui-examples-${pin.revision}/${pin.gamePath}`,
    ]);
    if (!fs.existsSync(path.join(game, 'server', 'operations.ts')))
      throw new Error('Examples archive contains no game operations.');
    fs.writeFileSync(cache, bytes);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(game, destination);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`Tutorial source: ${pin.repository}@${pin.revision}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await stageTutorialGame();
