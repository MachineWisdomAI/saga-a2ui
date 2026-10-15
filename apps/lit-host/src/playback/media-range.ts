/**
 * What a `Range` request header asks of one stored body, decided after the caller was authorized.
 * Pure: it reads no store and checks no credential, so it cannot grant anything.
 *
 * Supported: one `bytes=` range (`a-b`, `a-`, `-n`). A `bytes=` range the service cannot honour as
 * one slice (past the end, reversed, a zero suffix, several ranges, not numeric) is `unsatisfiable`.
 * A range in another unit is not interpreted: RFC 9110 lets a server ignore it and send the whole body.
 */
export type RangeDecision =
  | { readonly kind: 'whole' }
  | { readonly kind: 'partial'; readonly first: number; readonly last: number }
  | { readonly kind: 'unsatisfiable' };

const BYTES_UNIT = 'bytes=';
const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;
const UNSATISFIABLE: RangeDecision = { kind: 'unsatisfiable' };

/** Resolves `bytes=a-b`, `bytes=a-` and `bytes=-n` against a body of `length` bytes. */
export function resolveRange(header: string | undefined, length: number): RangeDecision {
  const value = header?.trim();
  if (value === undefined || !value.startsWith(BYTES_UNIT)) return { kind: 'whole' };
  const match = SINGLE_BYTE_RANGE.exec(value);
  if (!match || length === 0) return UNSATISFIABLE;
  const [, start = '', end = ''] = match;
  if (start === '') {
    const suffix = Number(end);
    return end === '' || suffix === 0 ? UNSATISFIABLE : { kind: 'partial', first: Math.max(length - suffix, 0), last: length - 1 };
  }
  const first = Number(start);
  if (first >= length || (end !== '' && Number(end) < first)) return UNSATISFIABLE;
  return { kind: 'partial', first, last: Math.min(end === '' ? length - 1 : Number(end), length - 1) };
}
