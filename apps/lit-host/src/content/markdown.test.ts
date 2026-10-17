import { describe, expect, it } from 'vitest';
import {
  MAX_DESCRIPTION_LENGTH,
  parseDescription,
  type BlockNode,
  type InlineNode,
  type ParsedDescription,
} from './markdown.js';

function parsed(source: string): ParsedDescription {
  const result = parseDescription(source);
  if (!result.ok) throw new Error(`unexpected failure: ${result.failure.kind}`);
  return result.description;
}

/** The text a reader would see for inline content, in order, with no formatting. */
function plain(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'code':
          return node.text;
        case 'emphasis':
        case 'strong':
        case 'link':
          return plain(node.children);
        case 'image':
          return `[image ${node.alt}]`;
        case 'softbreak':
          return ' ';
        case 'hardbreak':
          return '\n';
      }
    })
    .join('');
}

describe('parsing a description', () => {
  it('keeps the original string unchanged', () => {
    const source = '  Leading space\n\n**bold** and <b>html</b>\n';
    expect(parsed(source).source).toBe(source);
  });

  it('keeps paragraphs, a quotation, a link and an image in their original order', () => {
    const description = parsed(
      [
        'First paragraph.',
        '',
        '> A quotation.',
        '',
        'See [the guide](https://docs.example.com/guide) now.',
        '',
        '![A chart](https://images.example.com/chart.png)',
      ].join('\n'),
    );
    expect(description.blocks.map((block) => block.kind)).toEqual(['paragraph', 'quote', 'paragraph', 'paragraph']);
    const [first, quote, withLink, withImage] = description.blocks as [BlockNode, BlockNode, BlockNode, BlockNode];
    expect(first).toEqual({ kind: 'paragraph', children: [{ kind: 'text', text: 'First paragraph.' }] });
    expect(quote.kind === 'quote' && quote.children.map((child) => child.kind)).toEqual(['paragraph']);
    expect(withLink.kind === 'paragraph' && withLink.children).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', destination: 'https://docs.example.com/guide', children: [{ kind: 'text', text: 'the guide' }] },
      { kind: 'text', text: ' now.' },
    ]);
    expect(withImage.kind === 'paragraph' && withImage.children).toEqual([
      { kind: 'image', source: 'https://images.example.com/chart.png', alt: 'A chart' },
    ]);
  });

  it('supports emphasis, strong text, inline code, breaks, headings, lists, code blocks and rules', () => {
    const description = parsed(
      ['# Title', '', '*one* **two** `three`  ', 'four', '', '- a', '- b', '', '3. c', '', '```', 'code', '```', '', '---'].join(
        '\n',
      ),
    );
    expect(description.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'code-block',
      'rule',
    ]);
    const [heading, paragraph, bullets, ordered, code] = description.blocks as [
      BlockNode,
      BlockNode,
      BlockNode,
      BlockNode,
      BlockNode,
    ];
    expect(heading).toMatchObject({ kind: 'heading', level: 1 });
    expect(paragraph.kind === 'paragraph' && paragraph.children.map((child) => child.kind)).toEqual([
      'emphasis',
      'text',
      'strong',
      'text',
      'code',
      'hardbreak',
      'text',
    ]);
    expect(bullets).toMatchObject({ kind: 'list', ordered: false });
    expect(ordered).toMatchObject({ kind: 'list', ordered: true, start: 3 });
    expect(bullets.kind === 'list' && bullets.items.map((item) => item.map((block) => block.kind))).toEqual([
      ['paragraph'],
      ['paragraph'],
    ]);
    expect(code).toEqual({ kind: 'code-block', text: 'code\n' });
  });

  it('turns raw HTML into visible text rather than elements', () => {
    const description = parsed('Hello <b>bold</b> and <script>alert(1)</script>\n\n<div onclick="x()">block</div>');
    const text = description.blocks.map((block) => (block.kind === 'paragraph' ? plain(block.children) : '')).join('|');
    expect(text).toContain('<b>bold</b>');
    expect(text).toContain('<script>alert(1)</script>');
    expect(text).toContain('<div onclick="x()">block</div>');
    expect(JSON.stringify(description.blocks)).not.toContain('"html');
  });

  it('keeps unsupported syntax such as tables and strikethrough as source text', () => {
    const description = parsed('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~');
    const [table, strike] = description.blocks as [BlockNode, BlockNode];
    expect(table.kind === 'paragraph' && plain(table.children)).toContain('| a | b |');
    expect(strike.kind === 'paragraph' && plain(strike.children)).toBe('~~gone~~');
  });

  it('does not turn a bare URL into a link', () => {
    const description = parsed('Visit https://example.com today');
    const [paragraph] = description.blocks as [BlockNode];
    expect(paragraph.kind === 'paragraph' && paragraph.children.some((child) => child.kind === 'link')).toBe(false);
  });

  it('keeps a link whose destination the policy must judge, instead of dropping it', () => {
    const description = parsed('[click](http://example.com/a) and [auto](<https://example.com/b>)');
    const [paragraph] = description.blocks as [BlockNode];
    const links = paragraph.kind === 'paragraph' ? paragraph.children.filter((child) => child.kind === 'link') : [];
    expect(links.map((link) => link.kind === 'link' && link.destination)).toEqual([
      'http://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('keeps a script-scheme link as text, because the parser refuses to link it', () => {
    const description = parsed('[x](javascript:alert(1))');
    const [paragraph] = description.blocks as [BlockNode];
    expect(paragraph.kind === 'paragraph' && paragraph.children.some((child) => child.kind === 'link')).toBe(false);
    expect(paragraph.kind === 'paragraph' && plain(paragraph.children)).toBe('[x](javascript:alert(1))');
  });

  it('returns no blocks for an empty description', () => {
    expect(parsed('').blocks).toEqual([]);
  });
});

describe('the input bound', () => {
  it('accepts a description exactly at the limit', () => {
    expect(parseDescription('a'.repeat(MAX_DESCRIPTION_LENGTH)).ok).toBe(true);
  });

  it('rejects a longer description explicitly, without truncating it', () => {
    const source = 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1);
    const result = parseDescription(source);
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'too-long', limit: MAX_DESCRIPTION_LENGTH, length: MAX_DESCRIPTION_LENGTH + 1 },
    });
  });

  it('parses pathologically nested input within the bound without throwing', () => {
    const nested = '>'.repeat(500) + ' deep\n\n' + '['.repeat(500) + 'x' + ']'.repeat(500);
    const result = parseDescription(nested.slice(0, MAX_DESCRIPTION_LENGTH));
    expect(result.ok).toBe(true);
  });
});
