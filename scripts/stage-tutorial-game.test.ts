import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  archiveLimits,
  stageTutorialGame,
  verifyExampleArchive,
  type ExamplePin,
} from './stage-tutorial-game.js';

const revision = '0123456789abcdef0123456789abcdef01234567';
const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
const small = { compressedBytes: 1024, expandedBytes: 4096 };

let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-tutorial-'));
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

/** A real archive laid out as GitHub serves one, plus the pin that names it. */
function legitimateArchive(): { gz: Buffer; pin: ExamplePin } {
  const tree = path.join(work, 'tree');
  const game = path.join(
    tree,
    `saga-a2ui-examples-${revision}`,
    'apps/tic-tac-toe/game/server',
  );
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, 'operations.ts'), 'export const ok = 1;\n');
  const file = path.join(work, 'fixture.tar.gz');
  execFileSync('tar', [
    '-czf',
    file,
    '-C',
    tree,
    `saga-a2ui-examples-${revision}`,
  ]);
  const gz = fs.readFileSync(file);
  // The pin records the digest of the decompressed archive.
  const tar = execFileSync('gzip', ['-dc', file], { maxBuffer: 1 << 20 });
  return {
    gz,
    pin: {
      repository: 'MachineWisdomAI/saga-a2ui-examples',
      revision,
      tarSha256: sha256(tar),
      gamePath: 'apps/tic-tac-toe/game',
    },
  };
}

const respond = (body: Uint8Array, headers?: HeadersInit): typeof fetch =>
  (async () => new Response(Buffer.from(body), { headers })) as typeof fetch;

it('accepts the pinned decompressed archive and rejects changed bytes', async () => {
  const original = Buffer.from('fixed archive bytes');
  const digest = sha256(original);
  await expect(
    verifyExampleArchive(gzipSync(original), digest),
  ).resolves.toBeUndefined();
  await expect(
    verifyExampleArchive(gzipSync(Buffer.from('changed')), digest),
  ).rejects.toThrow('digest mismatch');
  await expect(
    verifyExampleArchive(Buffer.from('not gzip'), digest),
  ).rejects.toThrow();
});

it('applies the default expanded ceiling to an archive one byte over it', async () => {
  // One byte over the default ceiling, a few tens of KiB compressed: it fits
  // the default compressed ceiling, so only the expanded ceiling can refuse it.
  const over = gzipSync(Buffer.alloc(archiveLimits.expandedBytes + 1));
  expect(over.length).toBeLessThan(archiveLimits.compressedBytes);
  await expect(verifyExampleArchive(over, '0'.repeat(64))).rejects.toThrow(
    'expanded limit',
  );
});

it('accepts an archive exactly at the expanded ceiling and rejects one byte over', async () => {
  const exact = Buffer.alloc(small.expandedBytes, 7);
  await expect(
    verifyExampleArchive(gzipSync(exact), sha256(exact), small),
  ).resolves.toBeUndefined();
  const over = Buffer.alloc(small.expandedBytes + 1, 7);
  await expect(
    verifyExampleArchive(gzipSync(over), sha256(over), small),
  ).rejects.toThrow('expanded limit');
});

it('rejects a compressed archive over the ceiling before inflating it', async () => {
  const noise = Buffer.alloc(small.compressedBytes + 1, 1);
  await expect(
    verifyExampleArchive(noise, '0'.repeat(64), small),
  ).rejects.toThrow('compressed limit');
});

it('stages the application from a download within the ceilings', async () => {
  const { gz, pin } = legitimateArchive();
  const base = path.join(work, 'base');
  await stageTutorialGame({ pin, base, fetch: respond(gz) });
  const operations = path.join(
    base,
    'tutorial-game',
    'server',
    'operations.ts',
  );
  expect(fs.readFileSync(operations, 'utf8')).toBe('export const ok = 1;\n');
  // The next run reads the verified cache and needs no network.
  fs.rmSync(path.join(base, 'tutorial-game'), { recursive: true });
  await stageTutorialGame({
    pin,
    base,
    fetch: (async () => {
      throw new Error('network used');
    }) as typeof fetch,
  });
  expect(fs.existsSync(operations)).toBe(true);
});

it('refuses a download whose declared length exceeds the ceiling and stages nothing', async () => {
  const { gz, pin } = legitimateArchive();
  const base = path.join(work, 'base');
  await expect(
    stageTutorialGame({
      pin,
      base,
      fetch: respond(gz, { 'content-length': '9999999999' }),
      limits: small,
    }),
  ).rejects.toThrow('compressed limit');
  expect(fs.existsSync(path.join(base, 'tutorial-game'))).toBe(false);
});

it('stops reading a download that exceeds the ceiling without declaring its length', async () => {
  const { pin } = legitimateArchive();
  const base = path.join(work, 'base');
  let sent = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 512;
      controller.enqueue(new Uint8Array(512));
    },
  });
  await expect(
    stageTutorialGame({
      pin,
      base,
      fetch: (async () => new Response(endless)) as typeof fetch,
      limits: small,
    }),
  ).rejects.toThrow('compressed limit');
  expect(sent).toBeLessThan(small.compressedBytes * 64);
  expect(fs.existsSync(path.join(base, 'tutorial-game'))).toBe(false);
});

it('refuses an oversized cache entry without reading it and stages nothing', async () => {
  const { pin } = legitimateArchive();
  const base = path.join(work, 'base');
  fs.mkdirSync(base);
  fs.writeFileSync(
    path.join(base, `examples-${revision}.tar.gz`),
    Buffer.alloc(small.compressedBytes + 1),
  );
  await expect(
    stageTutorialGame({
      pin,
      base,
      fetch: respond(Buffer.alloc(0)),
      limits: small,
    }),
  ).rejects.toThrow('compressed limit');
  expect(fs.existsSync(path.join(base, 'tutorial-game'))).toBe(false);
});

it('refuses a cached compression bomb before extracting anything', async () => {
  const { pin } = legitimateArchive();
  const base = path.join(work, 'base');
  fs.mkdirSync(base);
  fs.writeFileSync(
    path.join(base, `examples-${revision}.tar.gz`),
    gzipSync(Buffer.alloc(small.expandedBytes * 64)),
  );
  await expect(
    stageTutorialGame({
      pin,
      base,
      fetch: respond(Buffer.alloc(0)),
      limits: {
        compressedBytes: 1024 * 1024,
        expandedBytes: small.expandedBytes,
      },
    }),
  ).rejects.toThrow('expanded limit');
  expect(fs.readdirSync(base)).toEqual([`examples-${revision}.tar.gz`]);
});
