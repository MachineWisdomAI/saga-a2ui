import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { verifyExampleArchive } from './stage-tutorial-game.js';

it('accepts the pinned decompressed archive and rejects changed bytes', () => {
  const original = Buffer.from('fixed archive bytes');
  const digest = createHash('sha256').update(original).digest('hex');
  expect(() => verifyExampleArchive(gzipSync(original), digest)).not.toThrow();
  expect(() =>
    verifyExampleArchive(gzipSync(Buffer.from('changed')), digest),
  ).toThrow('digest mismatch');
  expect(() => verifyExampleArchive(Buffer.from('not gzip'), digest)).toThrow();
});
