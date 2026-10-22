import { describe, expect, it } from 'vitest';
import { createFaithfulCardReader } from './reader.js';
import { closesWithParagraph, FAITHFUL_CARD_STYLING } from './styling.js';

// The closing marker is structural: it says only that the card's final top-level block is a
// paragraph. The cases read real Markdown through the reader, so the answer is the one a renderer
// gets.

function blocksOf(markdown: string) {
  const reader = createFaithfulCardReader({
    dialect: 'commonmark-tables-strikethrough',
    maxLength: 5000,
  });
  if (!reader.ok) throw new Error(reader.failure.message);
  const read = reader.reader.read({ contractVersion: 1, markdown });
  if (!read.ok) throw new Error(`unreadable: ${read.failure.kind}`);
  return read.card.blocks;
}

describe('the closing paragraph of a card', () => {
  it('is the final top-level block when that block is a paragraph, whatever its words', () => {
    expect(closesWithParagraph(blocksOf('Body.\n\nThe end.'))).toBe(true);
    expect(closesWithParagraph(blocksOf('# Title\n\nOnly this.'))).toBe(true);
    // A paragraph that reads like an attribution is still just a paragraph: the SDK recognises no attribution.
    expect(
      closesWithParagraph(
        blocksOf('Body.\n\nThis information came from example.test.'),
      ),
    ).toBe(true);
  });

  it('is absent when the final top-level block is a list, a quote, a table or code', () => {
    expect(closesWithParagraph(blocksOf('Intro.\n\n- one\n- two'))).toBe(false);
    expect(closesWithParagraph(blocksOf('Intro.\n\n1. one\n2. two'))).toBe(
      false,
    );
    expect(closesWithParagraph(blocksOf('Intro.\n\n> quoted'))).toBe(false);
    expect(closesWithParagraph(blocksOf('Intro.\n\n| a |\n| - |\n| 1 |'))).toBe(
      false,
    );
    expect(closesWithParagraph(blocksOf('Intro.\n\n```\ncode\n```'))).toBe(
      false,
    );
    expect(closesWithParagraph(blocksOf('Intro.\n\n---'))).toBe(false);
  });

  it('is absent when the only paragraphs are nested in a quote, a list or a table', () => {
    expect(closesWithParagraph(blocksOf('> Quoted closing.'))).toBe(false);
    expect(
      closesWithParagraph(blocksOf('- an item\n\n  with a second paragraph')),
    ).toBe(false);
    expect(closesWithParagraph(blocksOf('Intro.\n\n> a\n>\n> b'))).toBe(false);
  });

  it('is absent for a card with no blocks', () => {
    expect(closesWithParagraph([])).toBe(false);
  });
});

describe('the committed styling surface', () => {
  it('names the classes, the nine tokens and the marker a consumer may rely on', () => {
    expect(FAITHFUL_CARD_STYLING.classes).toEqual([
      'saga-card',
      'saga-card-content',
      'saga-card-link',
      'saga-card-link-status',
      'saga-card-controls',
    ]);
    expect(FAITHFUL_CARD_STYLING.tokens).toEqual([
      '--saga-card-font-family',
      '--saga-card-font-size',
      '--saga-card-line-height',
      '--saga-card-reading-width',
      '--saga-card-text-color',
      '--saga-card-accent-color',
      '--saga-card-muted-color',
      '--saga-card-border-color',
      '--saga-card-code-background',
    ]);
    expect(FAITHFUL_CARD_STYLING.closing).toEqual({
      attribute: 'data-saga-closing',
      value: 'paragraph',
    });
    expect(FAITHFUL_CARD_STYLING.elements).toEqual([
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'ol',
      'ul',
      'li',
      'blockquote',
      'pre',
      'code',
      'table',
    ]);
  });
});
