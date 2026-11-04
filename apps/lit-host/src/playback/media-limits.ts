/**
 * Byte limits for one protected episode, shared by the media service (which serves the bytes) and
 * the player view (which buffers and decodes them). The module imports nothing, so the browser
 * bundle can use it without any server code.
 *
 * Two numbers, because a body and its decoded audio are different quantities: a compressed or
 * heavily packed body can decode to many times its size. Neither is a promise about what a
 * deployment can afford; an application with longer episodes or tighter devices passes its own.
 */

/** The most bytes one episode body may be, as stored, as sent and as received (64 MiB). */
export const MAX_MEDIA_BODY_BYTES = 64 * 1024 * 1024;

/** The most memory one decoded episode may take as 32-bit float samples (512 MiB). */
export const MAX_DECODED_MEDIA_BYTES = 512 * 1024 * 1024;

/** A body or a decoded buffer past its limit. Carries sizes only, never the bytes. */
export class MediaTooLargeError extends Error {
  constructor(what: string, limit: number) {
    super(`${what} exceeds the ${limit}-byte limit`);
    this.name = 'MediaTooLargeError';
  }
}

/** A limit must be a positive safe integer; anything else is a configuration error. */
export function assertByteLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive integer number of bytes`);
  return value;
}

/** The size a response declares, if it declares one that is a plain non-negative integer. */
function declaredLength(headers: Headers): number | undefined {
  const value = headers.get('content-length');
  if (value === null || !/^\d{1,16}$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

/**
 * Reads a response body into one buffer without ever holding more than `maxBytes`.
 *
 * Three checks, in order, each before the next costs anything:
 *
 * 1. The declared length. When the response states a length past the limit the body is cancelled
 *    unread. For an encoded body (`Content-Encoding`) the header counts the compressed bytes.
 * 2. The running total of the bytes actually delivered, which the platform has already decoded
 *    when the response was encoded. The read stops, and the rest of the body is cancelled, at the
 *    first chunk that carries the total past the limit, whatever the headers said or omitted.
 * 3. The aggregate: the total across every chunk is what is compared, never one chunk.
 *
 * Rejects with `MediaTooLargeError` past the limit. Any other failure of the stream is the
 * stream's own rejection.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  assertByteLimit('maxBytes', maxBytes);
  const declared = declaredLength(response.headers);
  if (declared !== undefined && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new MediaTooLargeError('The media body', maxBytes);
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new MediaTooLargeError('The media body', maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const whole = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return whole.buffer;
}
