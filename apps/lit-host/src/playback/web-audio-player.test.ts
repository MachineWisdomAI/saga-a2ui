import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebAudioPlayer } from './web-audio-player.js';

// The decoded-size limit of the real Web Audio player, against a stand-in for the browser's
// AudioContext. The stand-in decodes any bytes into a buffer of the size the test names; real
// decoding is the browser's and is checked by the browser specs.

interface FakeBuffer {
  readonly length: number;
  readonly numberOfChannels: number;
}

let created = 0;
let sources = 0;

function stubAudioContext(decoded: FakeBuffer) {
  created = 0;
  sources = 0;
  class FakeContext {
    currentTime = 0;
    destination = {};
    constructor() {
      created += 1;
    }
    resume() {
      // Advance the clock so `start` can confirm the audio is running.
      setTimeout(() => (this.currentTime += 1), 5);
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    decodeAudioData() {
      return Promise.resolve(decoded);
    }
    createBufferSource() {
      sources += 1;
      return {
        buffer: undefined as unknown,
        onended: null as (() => void) | null,
        connect: () => undefined,
        disconnect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      };
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Web Audio player’s decoded-size limit', () => {
  it('starts audio whose decoded samples are exactly at the limit', async () => {
    // 100 frames × 2 channels × 4 bytes = 800 bytes.
    stubAudioContext({ length: 100, numberOfChannels: 2 });
    const player = createWebAudioPlayer({ maxDecodedBytes: 800 });
    player.prepare();

    await expect(player.start(new ArrayBuffer(8))).resolves.toBe('started');

    expect(sources).toBe(1);
    player.stop();
  });

  it('rejects audio that decodes past the limit, without creating a source or playing it', async () => {
    stubAudioContext({ length: 100, numberOfChannels: 2 });
    const player = createWebAudioPlayer({ maxDecodedBytes: 799 });
    player.prepare();

    await expect(player.start(new ArrayBuffer(8))).rejects.toThrow(
      'The decoded audio exceeds the 799-byte limit',
    );

    expect(sources).toBe(0);
    player.stop();
  });

  it('counts every channel: a small body that decodes to many channels is refused', async () => {
    stubAudioContext({ length: 10, numberOfChannels: 64 });
    const player = createWebAudioPlayer({ maxDecodedBytes: 2_000 });
    player.prepare();

    await expect(player.start(new ArrayBuffer(8))).rejects.toThrow(
      /exceeds the 2000-byte limit/,
    );
    player.stop();
  });

  it('applies the shipped limit when the application sets none', async () => {
    // 2^27 frames × 1 channel × 4 bytes = 512 MiB, exactly the limit; one frame more is refused.
    stubAudioContext({ length: 2 ** 27 + 1, numberOfChannels: 1 });
    const player = createWebAudioPlayer();
    player.prepare();

    await expect(player.start(new ArrayBuffer(8))).rejects.toThrow(
      /decoded audio exceeds the 536870912-byte limit/,
    );
    expect(created).toBe(1);
    player.stop();
  });

  it('refuses a limit that is not a positive integer', () => {
    expect(() => createWebAudioPlayer({ maxDecodedBytes: 0 })).toThrow(
      RangeError,
    );
  });
});
