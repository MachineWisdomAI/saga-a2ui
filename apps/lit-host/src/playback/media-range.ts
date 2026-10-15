/**
 * What a `Range` request header asks of one stored body, decided after the caller was authorized.
 * Pure: it reads no store and checks no credential, so it cannot grant anything.
 */
export type RangeDecision =
  | { readonly kind: 'whole' }
  | { readonly kind: 'partial'; readonly first: number; readonly last: number };

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** Resolves `bytes=a-b`, `bytes=a-` and `bytes=-n` against a body of `length` bytes. */
export function resolveRange(header: string | undefined, length: number): RangeDecision {
  const match = header === undefined ? null : SINGLE_BYTE_RANGE.exec(header.trim());
  if (!match) return { kind: 'whole' };
  const [, start = '', end = ''] = match;
  if (start === '') {
    const suffix = Number(end);
    return { kind: 'partial', first: Math.max(length - suffix, 0), last: length - 1 };
  }
  return { kind: 'partial', first: Number(start), last: Math.min(end === '' ? length - 1 : Number(end), length - 1) };
}
