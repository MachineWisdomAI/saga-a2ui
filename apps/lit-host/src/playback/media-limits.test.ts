import { describe, expect, it } from 'vitest';
import {
  assertByteLimit,
  MAX_DECODED_MEDIA_BYTES,
  MAX_MEDIA_BODY_BYTES,
  MediaTooLargeError,
  readBoundedBody,
} from './media-limits.js';

// The bounded read, exercised on streams that count what the reader pulls from them. A stream that
// never ends models a response with no honest length: the read must stop it, not wait for it.

interface CountedStream {
  readonly response: Response;
  readonly pulled: () => number;
  readonly cancelled: () => boolean;
}

function counted(
  chunks: number,
  chunkBytes: number,
  headers: Record<string, string> = {},
): CountedStream {
  let pulled = 0;
  let cancelled = false;
  const chunk = new Uint8Array(chunkBytes).fill(7);
  // A zero high-water mark: the stream is asked for a chunk only when the reader reads.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= chunks) return controller.close();
        pulled += 1;
        controller.enqueue(chunk.slice());
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(body, { headers }),
    pulled: () => pulled,
    cancelled: () => cancelled,
  };
}

describe('the shipped limits', () => {
  it('are 64 MiB for a body and 512 MiB decoded', () => {
    expect(MAX_MEDIA_BODY_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_DECODED_MEDIA_BYTES).toBe(512 * 1024 * 1024);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'refuse %s as a limit',
    (value) => {
      expect(() => assertByteLimit('limit', value)).toThrow(RangeError);
    },
  );
});

describe('readBoundedBody: a body within the limit', () => {
  it('returns every byte of a body below the limit, in order', async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4, 5]));
    const bytes = await readBoundedBody(response, 10);
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns a body exactly at the limit, however it is split into chunks', async () => {
    const stream = counted(4, 25);
    const bytes = await readBoundedBody(stream.response, 100);
    expect(bytes.byteLength).toBe(100);
    expect(stream.cancelled()).toBe(false);
  });

  it('returns an empty buffer for a response with no body', async () => {
    const bytes = await readBoundedBody(new Response(null), 10);
    expect(bytes.byteLength).toBe(0);
  });

  it('reads a body whose declared length is absent, malformed or honest', async () => {
    for (const declared of [undefined, 'abc', '-5', '1e3', '', '8']) {
      const response = new Response(new Uint8Array(8), {
        headers: declared === undefined ? {} : { 'content-length': declared },
      });
      expect((await readBoundedBody(response, 8)).byteLength).toBe(8);
    }
  });
});

describe('readBoundedBody: a body past the limit', () => {
  it('refuses a declared length past the limit without reading any of the body', async () => {
    const stream = counted(10, 100, { 'content-length': '1000' });

    await expect(readBoundedBody(stream.response, 999)).rejects.toBeInstanceOf(
      MediaTooLargeError,
    );

    expect(stream.pulled()).toBe(0);
    expect(stream.cancelled()).toBe(true);
  });

  it('stops an endless body with no declared length at the first chunk past the limit', async () => {
    const stream = counted(Number.MAX_SAFE_INTEGER, 1_000);

    await expect(
      readBoundedBody(stream.response, 5_500),
    ).rejects.toBeInstanceOf(MediaTooLargeError);

    // Six chunks reach 6,000 bytes; the stream is not asked for a seventh and is cancelled.
    expect(stream.pulled()).toBeLessThanOrEqual(7);
    expect(stream.cancelled()).toBe(true);
  });

  it('counts the aggregate: many small chunks that each fit still stop at the limit', async () => {
    const stream = counted(1_000, 10);

    await expect(readBoundedBody(stream.response, 95)).rejects.toBeInstanceOf(
      MediaTooLargeError,
    );

    expect(stream.pulled()).toBeLessThanOrEqual(11);
    expect(stream.cancelled()).toBe(true);
  });

  it('is not fooled by a small declared length on a body that delivers more (an encoded body)', async () => {
    // For an encoded response the header counts the compressed bytes; the stream the reader sees
    // is already decoded. The decoded count is what is limited.
    const stream = counted(Number.MAX_SAFE_INTEGER, 1_000, {
      'content-length': '12',
      'content-encoding': 'gzip',
    });

    await expect(
      readBoundedBody(stream.response, 5_000),
    ).rejects.toBeInstanceOf(MediaTooLargeError);

    expect(stream.pulled()).toBeLessThanOrEqual(6);
    expect(stream.cancelled()).toBe(true);
  });

  it('carries sizes only in its message, never the bytes', async () => {
    const stream = counted(10, 100);
    const error = await readBoundedBody(stream.response, 50).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MediaTooLargeError);
    expect((error as Error).message).toBe(
      'The media body exceeds the 50-byte limit',
    );
  });
});
