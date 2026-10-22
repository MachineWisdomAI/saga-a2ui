import { describe, expect, it } from 'vitest';
import { deliveredResultFromToolResult } from './delivered-result.js';
import type { ToolResult } from './run-tool-result-view.js';

// A tool result is unchecked input from the host's bridge, so some of these are deliberately not
// what the type promises.
const malformed = (value: unknown): ToolResult => value as ToolResult;

describe('deliveredResultFromToolResult', () => {
  it('keeps every block in delivered order, text blocks with their text and other blocks exactly as supplied', () => {
    const image = {
      type: 'image' as const,
      data: 'AAAA',
      mimeType: 'image/png',
    };
    const link = {
      type: 'resource_link' as const,
      uri: 'https://example.invalid/a',
      name: 'a',
      _meta: { kept: true },
    };
    const delivered = deliveredResultFromToolResult({
      content: [
        { type: 'text', text: '' },
        image,
        { type: 'text', text: 'later' },
        link,
      ],
    });
    expect(delivered.content.map((block) => block.type)).toEqual([
      'text',
      'image',
      'text',
      'resource_link',
    ]);
    expect(delivered.content[0]).toMatchObject({ type: 'text', text: '' });
    expect(delivered.content[2]).toMatchObject({ type: 'text', text: 'later' });
    expect(delivered.content[1]).toBe(image);
    expect(delivered.content[3]).toBe(link);
  });

  it('reports the error indication as a boolean: only a true isError is an error', () => {
    expect(deliveredResultFromToolResult({ content: [] }).isError).toBe(false);
    expect(
      deliveredResultFromToolResult({ content: [], isError: false }).isError,
    ).toBe(false);
    expect(
      deliveredResultFromToolResult({ content: [], isError: true }).isError,
    ).toBe(true);
    expect(
      deliveredResultFromToolResult(malformed({ content: [], isError: 'yes' }))
        .isError,
    ).toBe(false);
  });

  it('keeps absent, null and malformed structured content distinct and passes the value unchecked', () => {
    const absent = deliveredResultFromToolResult({ content: [] });
    expect('structuredContent' in absent).toBe(false);

    const nulled = deliveredResultFromToolResult(
      malformed({ content: [], structuredContent: null }),
    );
    expect('structuredContent' in nulled).toBe(true);
    expect(nulled.structuredContent).toBeNull();

    const value = { version: 1, answer: 7 };
    const odd = deliveredResultFromToolResult({
      content: [],
      structuredContent: value,
    });
    expect(odd.structuredContent).toBe(value);
    for (const other of ['text', 0, false, []]) {
      expect(
        deliveredResultFromToolResult(
          malformed({ content: [], structuredContent: other }),
        ).structuredContent,
      ).toBe(other);
    }
  });

  it('reads nothing into the result: an error beside valid structured content arrives whole', () => {
    const delivered = deliveredResultFromToolResult({
      content: [{ type: 'text', text: 'It failed.' }],
      structuredContent: { version: 1 },
      isError: true,
    });
    expect(delivered).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'It failed.' }],
      structuredContent: { version: 1 },
    });
  });

  it('does not share the delivered content array, so a reader cannot change the host’s result', () => {
    const result: ToolResult = { content: [{ type: 'text', text: 'a' }] };
    const delivered = deliveredResultFromToolResult(result);
    expect(delivered.content).not.toBe(result.content);
  });

  it.each([
    ['a missing content list', { isError: false }],
    ['a content list that is not an array', { content: 'text' }],
    ['a block that is not an object', { content: ['text'] }],
    ['a null block', { content: [null] }],
    ['a block without a string type', { content: [{ text: 'a' }] }],
    [
      'a text block without a string text',
      { content: [{ type: 'text', text: 1 }] },
    ],
    ['no result at all', null],
  ])('throws for %s, which cannot be mapped faithfully', (_what, value) => {
    expect(() => deliveredResultFromToolResult(malformed(value))).toThrow(
      TypeError,
    );
  });
});
