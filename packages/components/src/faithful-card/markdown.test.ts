import { describe, expect, it } from 'vitest';
import {
  fragmentsOf,
  MAX_NESTING_LEVEL,
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ParsedMarkdown,
} from './markdown.js';

/** The episode consumer's settings: CommonMark and its 2,000 UTF-16-unit bound. */
const COMMONMARK = { dialect: 'commonmark', maxLength: 2000 } as const;

function parsed(source: string): ParsedMarkdown {
  const result = parseMarkdown(source, COMMONMARK);
  if (!result.ok) throw new Error(`unexpected failure: ${result.failure.kind}`);
  return result.parsed;
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
        case 'raw-html':
          return node.text;
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

  it('keeps raw HTML as source text in marked nodes, never as elements', () => {
    const description = parsed('Hello <b>bold</b> and <script>alert(1)</script>\n\n<div onclick="x()">block</div>');
    const [paragraph, block] = description.blocks as [BlockNode, BlockNode];
    // The reader's text is unchanged and in order; each tag is a node the renderer can recognise.
    expect(paragraph.kind === 'paragraph' && plain(paragraph.children)).toBe(
      'Hello <b>bold</b> and <script>alert(1)</script>',
    );
    expect(paragraph.kind === 'paragraph' && paragraph.children.filter((child) => child.kind === 'raw-html')).toEqual([
      { kind: 'raw-html', text: '<b>' },
      { kind: 'raw-html', text: '</b>' },
      { kind: 'raw-html', text: '<script>' },
      { kind: 'raw-html', text: '</script>' },
    ]);
    expect(block).toEqual({ kind: 'raw-html-block', text: '<div onclick="x()">block</div>' });
  });

  it('keeps a comment and an unclosed tag as raw HTML source too', () => {
    const [paragraph, comment] = parsed('a <span class="x"> b\n\n<!-- note -->').blocks as [BlockNode, BlockNode];
    expect(paragraph.kind === 'paragraph' && paragraph.children).toContainEqual({ kind: 'raw-html', text: '<span class="x">' });
    expect(comment).toEqual({ kind: 'raw-html-block', text: '<!-- note -->' });
  });

  it('keeps hostile markup following an HTML block start in the source text of that block', () => {
    const source = '<script>window.x = 1</script><img src="https://images.example.com/x.png" onerror="y()"> ~~s~~';
    const description = parsed(source);
    expect(description.blocks).toEqual([{ kind: 'raw-html-block', text: source }]);
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

describe('the fragments a description references', () => {
  it('counts links and raw markup and lists image sources in source order, through every nesting', () => {
    const description = parsed(
      [
        'Intro [one](https://a.example/) and ![first](https://images.example.com/1.png).',
        '',
        '> Quoted [two *emphasised* ![nested](https://images.example.com/2.png)](http://b.example/) <b>',
        '',
        '- item ![third](https://images.example.com/3.png)',
        '',
        '<div>block</div>',
      ].join('\n'),
    );
    expect(fragmentsOf(description)).toEqual({
      links: 2,
      images: [
        'https://images.example.com/1.png',
        'https://images.example.com/2.png',
        'https://images.example.com/3.png',
      ],
      rawHtml: 2,
    });
  });

  it('reports nothing for ordinary text', () => {
    expect(fragmentsOf(parsed('Just *words*.\n\n- and a list'))).toEqual({ links: 0, images: [], rawHtml: 0 });
  });
});

describe('the input bound', () => {
  it('accepts a description exactly at the limit', () => {
    expect(parseMarkdown('a'.repeat(COMMONMARK.maxLength), COMMONMARK).ok).toBe(true);
  });

  it('rejects a longer description explicitly, without truncating it', () => {
    const source = 'a'.repeat(COMMONMARK.maxLength + 1);
    const result = parseMarkdown(source, COMMONMARK);
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'too-long', limit: COMMONMARK.maxLength, length: COMMONMARK.maxLength + 1 },
    });
  });

  it('refuses pathologically nested blocks explicitly without throwing', () => {
    const nested = '>'.repeat(500) + ' deep\n\n' + '['.repeat(500) + 'x' + ']'.repeat(500);
    expect(parseMarkdown(nested.slice(0, COMMONMARK.maxLength), COMMONMARK)).toEqual({
      ok: false,
      failure: { kind: 'too-nested', limit: MAX_NESTING_LEVEL },
    });
  });

  it('parses pathologically nested inline brackets and emphasis without losing text', () => {
    for (const source of [
      '['.repeat(500) + 'visible-word' + ']'.repeat(500),
      '*a '.repeat(300) + 'visible-word',
      '*[a '.repeat(150) + 'visible-word' + ']*'.repeat(150),
    ]) {
      expect(visibleText(parsed(source.slice(0, COMMONMARK.maxLength)).blocks)).toContain('visible-word');
    }
  });
});

/** All text a reader would see in a block tree, in order. */
function visibleText(blocks: readonly BlockNode[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'paragraph':
        case 'heading':
          return plain(block.children);
        case 'quote':
          return visibleText(block.children);
        case 'list':
          return block.items.map(visibleText).join(' ');
        case 'code-block':
        case 'raw-html-block':
          return block.text;
        case 'rule':
          return '';
      }
    })
    .join(' ');
}

describe('the nesting limit', () => {
  const containers: readonly (readonly [string, string])[] = [
    ['block quotes', '> '],
    ['bullet lists', '- '],
    ['ordered lists', '1. '],
    ['quotes holding lists', '> - '],
    ['lists holding quotes', '- > '],
  ];

  it.each(containers)('never silently drops text below the length bound: %s', (_name, prefix) => {
    let refused = 0;
    let preserved = 0;
    for (let depth = 1; depth <= 60; depth += 1) {
      const source = prefix.repeat(depth) + 'visible-word';
      expect(source.length).toBeLessThanOrEqual(COMMONMARK.maxLength);
      const result = parseMarkdown(source, COMMONMARK);
      if (result.ok) {
        // Success must mean the text is still there to be rendered.
        expect(visibleText(result.parsed.blocks)).toContain('visible-word');
        preserved += 1;
      } else {
        expect(result.failure).toEqual({ kind: 'too-nested', limit: MAX_NESTING_LEVEL });
        refused += 1;
      }
    }
    // Both outcomes occur, and once the limit is reached every deeper document is refused.
    expect(preserved).toBeGreaterThan(5);
    expect(refused).toBeGreaterThan(0);
    for (let depth = 60; depth <= 120; depth += 7) {
      expect(parseMarkdown(prefix.repeat(depth) + 'visible-word', COMMONMARK).ok).toBe(false);
    }
  });

  it('reproduces the reported case: twenty quotes around one word are refused, not emptied', () => {
    const source = '> '.repeat(20) + 'visible-word';
    expect(source.length).toBe(52);
    expect(parseMarkdown(source, COMMONMARK)).toEqual({ ok: false, failure: { kind: 'too-nested', limit: MAX_NESTING_LEVEL } });
  });

  it('keeps the text of quotes nested just inside the limit', () => {
    const result = parsed('> '.repeat(19) + 'visible-word');
    expect(visibleText(result.blocks)).toBe('visible-word');
  });

  it('keeps the text of lists nested just inside the limit', () => {
    expect(visibleText(parsed('- '.repeat(9) + 'visible-word').blocks)).toBe('visible-word');
    expect(parseMarkdown('- '.repeat(10) + 'visible-word', COMMONMARK).ok).toBe(false);
  });

  it('does not refuse a long flat document or many sibling containers', () => {
    const siblings = Array.from({ length: 100 }, (_unused, index) => `> quote ${index}\n\n- item ${index}`).join('\n\n');
    expect(parseMarkdown(siblings.slice(0, COMMONMARK.maxLength), COMMONMARK).ok).toBe(true);
  });
});
