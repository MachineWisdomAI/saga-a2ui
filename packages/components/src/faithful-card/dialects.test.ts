import { describe, expect, it } from 'vitest';
import {
  fragmentsOf,
  parseMarkdown,
  type BlockNode,
  type InlineNode,
  type ParsedMarkdown,
} from './markdown.js';

// The two trusted dialects through the one parser: `commonmark` (the episode consumer) and
// `commonmark-tables-strikethrough` (the answer consumer). The expected nodes come from the
// documented dialects, not from the implementation's own output.

const COMMONMARK = { dialect: 'commonmark', maxLength: 2000 } as const;
const ANSWER = {
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 50_000,
} as const;

function parsed(
  source: string,
  settings: Parameters<typeof parseMarkdown>[1] = ANSWER,
): ParsedMarkdown {
  const result = parseMarkdown(source, settings);
  if (!result.ok) throw new Error(`unexpected failure: ${result.failure.kind}`);
  return result.parsed;
}

const text = (value: string): InlineNode => ({ kind: 'text', text: value });
const cell = (value: string, align?: 'left' | 'center' | 'right') => ({
  ...(align === undefined ? {} : { align }),
  children: [text(value)],
});

describe('the answer dialect: tables', () => {
  it('reads a header, column alignment and body rows in source order', () => {
    const [table] = parsed(
      '| Name | Qty | Note |\n|:-----|----:|:----:|\n| Dates | 3 | fresh |\n| Figs | 12 | dried |',
    ).blocks;
    expect(table).toEqual({
      kind: 'table',
      header: [
        cell('Name', 'left'),
        cell('Qty', 'right'),
        cell('Note', 'center'),
      ],
      rows: [
        [cell('Dates', 'left'), cell('3', 'right'), cell('fresh', 'center')],
        [cell('Figs', 'left'), cell('12', 'right'), cell('dried', 'center')],
      ],
    });
  });

  it('reads inline formatting inside cells and a table between other blocks', () => {
    const { blocks } = parsed(
      'Before.\n\n| a | b |\n|---|---|\n| **x** | ~~y~~ |\n\nAfter.',
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'table',
      'paragraph',
    ]);
    const table = blocks[1];
    expect(
      table?.kind === 'table' &&
        table.rows[0]?.map((one) => one.children.map((node) => node.kind)),
    ).toEqual([['strong'], ['strikethrough']]);
  });

  it('finds tables inside quotes and list items', () => {
    const quoted = parsed('> | a |\n> |---|\n> | b |').blocks[0];
    expect(
      quoted?.kind === 'quote' && quoted.children.map((child) => child.kind),
    ).toEqual(['table']);
    const listed = parsed('- | a |\n  |---|\n  | b |').blocks[0];
    expect(
      listed?.kind === 'list' && listed.items[0]?.map((child) => child.kind),
    ).toEqual(['table']);
  });

  it('keeps every cell of a row that has more cells than the header', () => {
    const [table] = parsed(
      '| a | b |\n|---|---|\n| 1 | 2 | 3 | 4 |\n| only |',
    ).blocks;
    expect(
      table?.kind === 'table' &&
        table.rows.map((row) => row.map((one) => one.children)),
    ).toEqual([
      [[text('1')], [text('2')], [text('3')], [text('4')]],
      [[text('only')], []],
    ]);
  });

  it('resolves a reference link or image in an extra cell against the document, as in a normal cell', () => {
    const definitions =
      '\n\n[ref]: https://example.com/source\n[pic]: https://images.example.com/p.png';
    const [table] = parsed(
      `| A |\n|---|\n| one | [source][ref] ![chart][pic] |${definitions}`,
    ).blocks;
    const extra = table?.kind === 'table' ? table.rows[0]?.[1] : undefined;
    expect(extra?.children).toEqual([
      {
        kind: 'link',
        destination: 'https://example.com/source',
        children: [text('source')],
      },
      text(' '),
      {
        kind: 'image',
        source: 'https://images.example.com/p.png',
        alt: 'chart',
      },
    ]);
    expect(
      fragmentsOf(
        parsed(
          `| A |\n|---|\n| one | [source][ref] ![chart][pic] |${definitions}`,
        ),
      ),
    ).toEqual({
      links: 1,
      images: ['https://images.example.com/p.png'],
      rawHtml: 0,
    });
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['a lone CR', '\r'],
  ])(
    'keeps the extra cells of a row whatever the line ending (%s), and the supplied source unchanged',
    (_name, eol) => {
      const source = [
        '| A |',
        '|---|',
        '| one | EXTRA | [s][ref] |',
        '',
        '[ref]: https://example.com/s',
      ].join(eol);
      const document = parsed(source);
      const table = document.blocks[0];
      expect(
        table?.kind === 'table' && table.rows[0]?.map((one) => one.children),
      ).toEqual([
        [text('one')],
        [text('EXTRA')],
        [
          {
            kind: 'link',
            destination: 'https://example.com/s',
            children: [text('s')],
          },
        ],
      ]);
      expect(document.source).toBe(source);
    },
  );

  it('keeps the extra cells of a row inside a quote and reads an escaped pipe as part of its cell', () => {
    const quoted = parsed('> | a |\n> |---|\n> | x \\| y | z |').blocks[0];
    const table = quoted?.kind === 'quote' ? quoted.children[0] : undefined;
    expect(
      table?.kind === 'table' && table.rows[0]?.map((one) => one.children),
    ).toEqual([[text('x | y')], [text('z')]]);
  });
});

describe('the answer dialect: strikethrough', () => {
  it('reads struck text, including formatting inside it, in place', () => {
    const [paragraph] = parsed('keep ~~drop **this**~~ keep').blocks;
    expect(paragraph).toEqual({
      kind: 'paragraph',
      children: [
        text('keep '),
        {
          kind: 'strikethrough',
          children: [
            text('drop '),
            { kind: 'strong', children: [text('this')] },
          ],
        },
        text(' keep'),
      ],
    });
  });

  it('leaves a single tilde as text', () => {
    expect(parsed('a ~b~ c').blocks).toEqual([
      { kind: 'paragraph', children: [text('a ~b~ c')] },
    ]);
  });

  it('reports links and images inside a table cell or struck text among the blockable fragments', () => {
    const document = parsed(
      '| a |\n|---|\n| [l](https://x.example/) ![i](https://i.example/p.png) |\n\n~~[m](https://y.example/)~~',
    );
    expect(fragmentsOf(document)).toEqual({
      links: 2,
      images: ['https://i.example/p.png'],
      rawHtml: 0,
    });
  });
});

describe('the CommonMark dialect keeps table and strikethrough syntax as readable source', () => {
  it('reads a pipe table as one paragraph of text that still holds every character', () => {
    const source = '| a | b |\n|---|---|\n| 1 | 2 |';
    const { blocks } = parsed(source, COMMONMARK);
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph']);
    const [paragraph] = blocks;
    const readable =
      paragraph?.kind === 'paragraph'
        ? paragraph.children
            .map((node) => (node.kind === 'text' ? node.text : '\n'))
            .join('')
        : '';
    expect(readable).toBe(source);
  });

  it('reads tildes as text', () => {
    expect(parsed('keep ~~this~~', COMMONMARK).blocks).toEqual([
      { kind: 'paragraph', children: [text('keep ~~this~~')] },
    ]);
  });
});

describe('the answer dialect keeps ordinary answer content, in order', () => {
  const visible = (blocks: readonly BlockNode[]): string[] =>
    blocks.flatMap((block): string[] => {
      switch (block.kind) {
        case 'paragraph':
        case 'heading':
          return [inlineText(block.children)];
        case 'quote':
          return visible(block.children);
        case 'list':
          return block.items.flatMap(visible);
        case 'table':
          return [...block.header, ...block.rows.flat()].map((one) =>
            inlineText(one.children),
          );
        case 'code-block':
        case 'raw-html-block':
          return [block.text];
        case 'rule':
          return [];
      }
    });
  const inlineText = (nodes: readonly InlineNode[]): string =>
    nodes
      .map((node) => {
        switch (node.kind) {
          case 'text':
          case 'code':
          case 'raw-html':
            return node.text;
          case 'emphasis':
          case 'strong':
          case 'strikethrough':
          case 'link':
            return inlineText(node.children);
          case 'image':
            return node.alt;
          case 'softbreak':
            return ' ';
          case 'hardbreak':
            return '\n';
        }
      })
      .join('');

  it('keeps numbered headings, attribution-like lines and a footer exactly where and as they are written', () => {
    const source = [
      '## 1. The first point',
      '',
      'Body of the first point.',
      '',
      '## 2. The second point',
      '',
      '> A quoted sentence.',
      '',
      '— Source: Example Reference, vol. 2, p. 14',
      '',
      '[1] Footer note: see "Example Reference".',
    ].join('\n');
    const document = parsed(source);
    expect(document.source).toBe(source);
    expect(visible(document.blocks)).toEqual([
      '1. The first point',
      'Body of the first point.',
      '2. The second point',
      'A quoted sentence.',
      '— Source: Example Reference, vol. 2, p. 14',
      '[1] Footer note: see "Example Reference".',
    ]);
    expect(document.blocks[0]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('keeps Unicode and Arabic text unchanged and in order', () => {
    const source =
      '# مرحبا بالعالم\n\nالسلام عليكم ورحمة الله — café ☕ 日本語\n\n- بند أول\n- بند ثان';
    expect(visible(parsed(source).blocks)).toEqual([
      'مرحبا بالعالم',
      'السلام عليكم ورحمة الله — café ☕ 日本語',
      'بند أول',
      'بند ثان',
    ]);
  });

  it('keeps a long answer whole under a larger trusted bound', () => {
    const paragraphs = Array.from(
      { length: 400 },
      (_unused, index) => `Paragraph ${index}: ${'word '.repeat(20).trim()}`,
    );
    const source = paragraphs.join('\n\n');
    expect(source.length).toBeGreaterThan(2000);
    expect(visible(parsed(source).blocks)).toEqual(paragraphs);
  });

  it('keeps raw HTML as source text and unsupported syntax as readable text', () => {
    const document = parsed(
      '<b>x</b> and [^note] and - [ ] task\n\n<div>block</div>',
    );
    expect(visible(document.blocks)).toEqual([
      '<b>x</b> and [^note] and - [ ] task',
      '<div>block</div>',
    ]);
  });
});
