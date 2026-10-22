import { describe, expect, it } from 'vitest';
import { readStructuredResult } from './structured-result.js';

const parse = (structured: unknown): string | undefined =>
  typeof structured === 'string' ? structured : undefined;

describe('readStructuredResult', () => {
  it('reads structuredContent with the supplied parse', () => {
    expect(
      readStructuredResult({ content: [], structuredContent: 'Yes.' }, parse),
    ).toBe('Yes.');
    expect(
      readStructuredResult({ content: [], structuredContent: { a: 1 } }, parse),
    ).toBeUndefined();
  });

  it('reads nothing from content: a text-only result has no structured reading', () => {
    expect(
      readStructuredResult(
        { content: [{ type: 'text', text: 'Only text.' }] },
        parse,
      ),
    ).toBeUndefined();
  });

  it('rejects an error result without reading it, even beside valid structured content', () => {
    let called = false;
    expect(
      readStructuredResult(
        { content: [], isError: true, structuredContent: 'Yes.' },
        (structured) => {
          called = true;
          return parse(structured);
        },
      ),
    ).toBeUndefined();
    expect(called).toBe(false);
  });

  it('lets a throw from the supplied parse reach the caller', () => {
    expect(() =>
      readStructuredResult({ content: [] }, () => {
        throw new Error('parse broke');
      }),
    ).toThrow('parse broke');
  });
});
