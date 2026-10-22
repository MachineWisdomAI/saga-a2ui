import type { BlockNode } from './markdown.js';

// The FaithfulCard styling surface: the names an application may select, the custom properties it
// may set, and the one structural marker the card puts on its closing block. Both renderers emit
// exactly this surface, `docs/faithful-card-styling.md` documents it, and each renderer's tests
// read the names from here, so a name removed from a renderer fails against this one list.
//
// Nothing else about the card's markup is contract: `data-testid` attributes, the elements a
// renderer wraps around content and the stylesheet's own selectors may change.

export const FAITHFUL_CARD_STYLING = Object.freeze({
  /** Class names a consumer may select. `.saga-card` is the card's root and carries every token. */
  classes: Object.freeze([
    'saga-card',
    'saga-card-content',
    'saga-card-link',
    'saga-card-link-status',
    'saga-card-controls',
  ] as const),
  /** The semantic elements a consumer may select inside `.saga-card-content`. */
  elements: Object.freeze([
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
  ] as const),
  /** Custom properties the card reads, each with a neutral fallback. */
  tokens: Object.freeze([
    '--saga-card-font-family',
    '--saga-card-font-size',
    '--saga-card-line-height',
    '--saga-card-reading-width',
    '--saga-card-text-color',
    '--saga-card-accent-color',
    '--saga-card-muted-color',
    '--saga-card-border-color',
    '--saga-card-code-background',
  ] as const),
  /**
   * Put on the card's final top-level block, and only when that block is a paragraph. It says
   * where the content ends and nothing about its meaning: the application decides whether a
   * marked paragraph is, for example, an attribution.
   */
  closing: Object.freeze({
    attribute: 'data-saga-closing',
    value: 'paragraph',
  } as const),
});

/**
 * Whether the card's content closes with a paragraph: its final top-level block is one, whatever
 * its words. A trailing list, quote, table, code block or rule means no, and a paragraph nested in
 * a quote, a list item or a table is never a top-level block. Purely structural: no text is read.
 */
export function closesWithParagraph(blocks: readonly BlockNode[]): boolean {
  return blocks.at(-1)?.kind === 'paragraph';
}
