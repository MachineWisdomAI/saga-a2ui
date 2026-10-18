import MarkdownIt, { type Token } from 'markdown-it';

// Markdown interpretation for FaithfulCard. A maintained parser (markdown-it) reads the string;
// this module converts its token stream into a small closed set of restricted nodes, in source
// order, so a renderer can use fixed templates and text bindings only. No HTML is ever produced
// here, and nothing here decides whether a link or image may be used: that is the content
// policy's job.
//
// Two trusted dialects exist, chosen by the application and never by the content:
//
// - `commonmark`: markdown-it's "commonmark" preset with no linkify, typographer, tables or
//   strikethrough. Pipe tables and tildes stay readable text.
// - `commonmark-tables-strikethrough`: the same preset with the parser's own maintained `table`
//   and `strikethrough` rules enabled.
//
// Raw HTML is recognised only so it can be kept as source: the parser's html tokens become
// `raw-html` and `raw-html-block` nodes carrying their characters, which a renderer shows as text
// (or a placeholder) and never as elements, so `<b>x</b>` stays the characters `<b>x</b>`. Every
// other unsupported construct is plain text. Link reference definitions are CommonMark syntax,
// not markup this module drops: a definition is consumed to resolve the links that use it.

export type MarkdownDialect = 'commonmark' | 'commonmark-tables-strikethrough';

/** The trusted settings a read uses. The bound counts UTF-16 code units of the supplied string. */
export interface MarkdownSettings {
  readonly dialect: MarkdownDialect;
  readonly maxLength: number;
}

export type InlineNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'emphasis' | 'strong' | 'strikethrough'; readonly children: readonly InlineNode[] }
  | { readonly kind: 'link'; readonly destination: string; readonly children: readonly InlineNode[] }
  | { readonly kind: 'image'; readonly source: string; readonly alt: string }
  /** An HTML tag or comment inside a line, exactly as written. Never rendered as markup. */
  | { readonly kind: 'raw-html'; readonly text: string }
  | { readonly kind: 'softbreak' }
  | { readonly kind: 'hardbreak' };

export type TableAlignment = 'left' | 'center' | 'right';

export interface TableCell {
  /** Present only where the delimiter row aligned the column. */
  readonly align?: TableAlignment;
  readonly children: readonly InlineNode[];
}

export type BlockNode =
  | { readonly kind: 'paragraph'; readonly children: readonly InlineNode[] }
  | { readonly kind: 'heading'; readonly level: number; readonly children: readonly InlineNode[] }
  | { readonly kind: 'quote'; readonly children: readonly BlockNode[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly BlockNode[])[] }
  /** A body row can hold more cells than the header: every cell written stays. */
  | { readonly kind: 'table'; readonly header: readonly TableCell[]; readonly rows: readonly (readonly TableCell[])[] }
  | { readonly kind: 'code-block'; readonly text: string }
  /** A block of raw HTML, exactly as written (without its final line ending). Never rendered as markup. */
  | { readonly kind: 'raw-html-block'; readonly text: string }
  | { readonly kind: 'rule' };

export interface ParsedMarkdown {
  /** The supplied string, exactly as given. */
  readonly source: string;
  readonly blocks: readonly BlockNode[];
}

/**
 * The parser's block nesting ceiling. markdown-it silently stops reading a document once open
 * block containers (block quotes, lists and list items each count one) reach this depth, which
 * would drop the remaining text without any signal. It is fixed here so the limit is explicit and
 * a document that reaches it is refused instead (see {@link parseMarkdown}).
 */
export const MAX_NESTING_LEVEL = 20;

export type ParseFailure =
  | { readonly kind: 'too-long'; readonly limit: number; readonly length: number }
  | { readonly kind: 'too-nested'; readonly limit: number };

export type ParseResult =
  | { readonly ok: true; readonly parsed: ParsedMarkdown }
  | { readonly ok: false; readonly failure: ParseFailure };

/** The markdown-it parser type; the package's default export is a value, so the type is derived from it. */
type Parser = InstanceType<typeof MarkdownIt>;

function createParser(dialect: MarkdownDialect): Parser {
  const parser = new MarkdownIt('commonmark', {
    html: true, // recognised so it can be kept as source; no renderer is ever asked for HTML output
    linkify: false,
    typographer: false,
    maxNesting: MAX_NESTING_LEVEL,
  });
  if (dialect === 'commonmark-tables-strikethrough') parser.enable(['table', 'strikethrough']);
  return parser;
}

// Parsers hold no per-document state, so one per dialect serves every read.
const parsers: Record<MarkdownDialect, Parser> = {
  commonmark: createParser('commonmark'),
  'commonmark-tables-strikethrough': createParser('commonmark-tables-strikethrough'),
};

/**
 * True when a block container's content would be read at or beyond the parser's ceiling. An open
 * token's `level` is the depth of its enclosing containers, so its content starts one deeper; the
 * parser reads nothing at or past {@link MAX_NESTING_LEVEL}. Empty containers at the ceiling are
 * refused too: the token stream cannot show whether anything was dropped, so the check is exact
 * about the ceiling and conservative about content.
 */
function reachesNestingCeiling(tokens: readonly Token[]): boolean {
  return tokens.some(
    (token) => (token.type === 'blockquote_open' || token.type === 'list_item_open') && token.level + 1 >= MAX_NESTING_LEVEL,
  );
}

/** Reads tokens left to right; the parser guarantees open/close tokens are balanced. */
class TokenReader {
  private position = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  next(): Token | undefined {
    return this.tokens[this.position++];
  }
}

/** Token attributes are typed `string | number | null`; links and images only ever carry strings. */
function stringAttribute(token: Token, name: string): string {
  const value = token.attrGet(name);
  return typeof value === 'string' ? value : '';
}

/** Joins adjacent text and drops the empty text tokens the parser leaves around emphasis delimiters. */
function mergeText(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'text' && node.text === '') continue;
    const last = merged[merged.length - 1];
    if (node.kind === 'text' && last?.kind === 'text') merged[merged.length - 1] = { kind: 'text', text: last.text + node.text };
    else merged.push(node);
  }
  return merged;
}

function readInlines(reader: TokenReader, closeType?: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  for (let token = reader.next(); token !== undefined; token = reader.next()) {
    if (token.type === closeType) break;
    switch (token.type) {
      case 'code_inline':
        nodes.push({ kind: 'code', text: token.content });
        break;
      case 'softbreak':
        nodes.push({ kind: 'softbreak' });
        break;
      case 'hardbreak':
        nodes.push({ kind: 'hardbreak' });
        break;
      case 'em_open':
        nodes.push({ kind: 'emphasis', children: readInlines(reader, 'em_close') });
        break;
      case 'strong_open':
        nodes.push({ kind: 'strong', children: readInlines(reader, 'strong_close') });
        break;
      case 's_open':
        nodes.push({ kind: 'strikethrough', children: readInlines(reader, 's_close') });
        break;
      case 'link_open':
        nodes.push({
          kind: 'link',
          destination: stringAttribute(token, 'href'),
          children: readInlines(reader, 'link_close'),
        });
        break;
      case 'image':
        nodes.push({ kind: 'image', source: stringAttribute(token, 'src'), alt: token.content });
        break;
      case 'html_inline':
        nodes.push({ kind: 'raw-html', text: token.content });
        break;
      default:
        // `text`, `text_special` and anything unrecognised: only its characters, as text.
        nodes.push({ kind: 'text', text: token.content });
    }
  }
  return mergeText(nodes);
}

function inlineChildren(inline: Token | undefined): InlineNode[] {
  return readInlines(new TokenReader(inline?.children ?? []));
}

function alignmentOf(token: Token): TableAlignment | undefined {
  const style = token.attrGet('style');
  if (style === 'text-align:left') return 'left';
  if (style === 'text-align:center') return 'center';
  if (style === 'text-align:right') return 'right';
  return undefined;
}

/**
 * A row's cells as the parser's own table rule splits its source line: pipes split cells unless a
 * backslash precedes them, and the backslash of an escaped pipe is dropped. A leading or trailing
 * pipe encloses the row and is not a cell. A container prefix (`>`, list markers, indentation)
 * holds no pipe, so it is skipped before the first cell.
 */
function cellsOfLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of line.replace(/^[\s>]*(?:(?:[-*+]|\d{1,9}[.)])\s+)*/, '').trim()) {
    if (character === '|' && !escaped) {
      cells.push(current);
      current = '';
    } else {
      current = escaped && character === '|' ? current.slice(0, -1) + character : current + character;
    }
    escaped = character === '\\';
  }
  cells.push(current);
  if (cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

/**
 * Reads one table. The parser's table rule keeps only as many cells in a body row as the header
 * has and drops the rest, which would lose text without any signal. The source line of each body
 * row is therefore split again, and the cells the parser dropped are read with the same inline
 * rules and kept after it, so every cell written is shown, in order.
 */
function readTable(reader: TokenReader, parser: Parser, sourceLines: readonly string[]): BlockNode {
  const header: TableCell[] = [];
  const rows: TableCell[][] = [];
  let row: TableCell[] | undefined;
  let rowLine: number | undefined;
  let inHeader = false;
  for (let token = reader.next(); token !== undefined && token.type !== 'table_close'; token = reader.next()) {
    switch (token.type) {
      case 'thead_open':
        inHeader = true;
        break;
      case 'thead_close':
        inHeader = false;
        break;
      case 'tr_open':
        row = [];
        rowLine = token.map?.[0];
        break;
      case 'th_open':
      case 'td_open': {
        const align = alignmentOf(token);
        row?.push({ ...(align === undefined ? {} : { align }), children: inlineChildren(reader.next()) });
        reader.next(); // th_close or td_close
        break;
      }
      case 'tr_close':
        if (row !== undefined) {
          if (inHeader) header.push(...row);
          else rows.push(withDroppedCells(row, rowLine, parser, sourceLines));
        }
        row = undefined;
        break;
    }
  }
  return { kind: 'table', header, rows };
}

function withDroppedCells(row: TableCell[], line: number | undefined, parser: Parser, sourceLines: readonly string[]): TableCell[] {
  const written = line === undefined ? [] : cellsOfLine(sourceLines[line] ?? '');
  const dropped = written.slice(row.length);
  if (dropped.length === 0) return row;
  const extra = dropped.map((text): TableCell => {
    const [inline] = parser.parseInline(text, {});
    return { children: inlineChildren(inline) };
  });
  return [...row, ...extra];
}

function readBlocks(reader: TokenReader, parser: Parser, sourceLines: readonly string[], closeType?: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  for (let token = reader.next(); token !== undefined; token = reader.next()) {
    if (token.type === closeType) break;
    switch (token.type) {
      case 'paragraph_open': {
        blocks.push({ kind: 'paragraph', children: inlineChildren(reader.next()) });
        reader.next(); // paragraph_close
        break;
      }
      case 'heading_open': {
        const level = Number(token.tag.slice(1));
        blocks.push({ kind: 'heading', level, children: inlineChildren(reader.next()) });
        reader.next(); // heading_close
        break;
      }
      case 'blockquote_open':
        blocks.push({ kind: 'quote', children: readBlocks(reader, parser, sourceLines, 'blockquote_close') });
        break;
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const closing = token.type === 'bullet_list_open' ? 'bullet_list_close' : 'ordered_list_close';
        const items: BlockNode[][] = [];
        for (let item = reader.next(); item !== undefined && item.type !== closing; item = reader.next()) {
          if (item.type === 'list_item_open') items.push(readBlocks(reader, parser, sourceLines, 'list_item_close'));
        }
        blocks.push({
          kind: 'list',
          ordered: token.type === 'ordered_list_open',
          start: Number(token.attrGet('start') ?? 1),
          items,
        });
        break;
      }
      case 'table_open':
        blocks.push(readTable(reader, parser, sourceLines));
        break;
      case 'fence':
      case 'code_block':
        blocks.push({ kind: 'code-block', text: token.content });
        break;
      case 'html_block':
        blocks.push({ kind: 'raw-html-block', text: token.content.replace(/\n$/, '') });
        break;
      case 'hr':
        blocks.push({ kind: 'rule' });
        break;
      default:
        // An unrecognised block keeps whatever text it carries rather than disappearing.
        if (token.content !== '') blocks.push({ kind: 'paragraph', children: [{ kind: 'text', text: token.content }] });
    }
  }
  return blocks;
}

/** What a document references that a content policy may have to block. */
export interface MarkdownFragments {
  readonly links: number;
  /** Image sources in source order, including images inside link labels. */
  readonly images: readonly string[];
  /** Raw HTML tags, comments and blocks, which are never rendered as markup. */
  readonly rawHtml: number;
}

/** The single walk over a parsed value that inventories its blockable fragments. */
export function fragmentsOf(parsed: ParsedMarkdown): MarkdownFragments {
  let links = 0;
  let rawHtml = 0;
  const images: string[] = [];
  const inlines = (nodes: readonly InlineNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'link') {
        links += 1;
        inlines(node.children);
      } else if (node.kind === 'emphasis' || node.kind === 'strong' || node.kind === 'strikethrough') inlines(node.children);
      else if (node.kind === 'image') images.push(node.source);
      else if (node.kind === 'raw-html') rawHtml += 1;
    }
  };
  const blocks = (nodes: readonly BlockNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'paragraph' || node.kind === 'heading') inlines(node.children);
      else if (node.kind === 'quote') blocks(node.children);
      else if (node.kind === 'list') for (const item of node.items) blocks(item);
      else if (node.kind === 'table') for (const cell of [...node.header, ...node.rows.flat()]) inlines(cell.children);
      else if (node.kind === 'raw-html-block') rawHtml += 1;
    }
  };
  blocks(parsed.blocks);
  return { links, images, rawHtml };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Interprets Markdown under trusted settings. The caller has validated `settings` (see
 * `createFaithfulCardReader`); this function trusts them. Input over `settings.maxLength`, or
 * nested block containers that reach {@link MAX_NESTING_LEVEL}, fail explicitly: nothing is
 * truncated or silently dropped and no partial result is returned. The returned value is deeply
 * immutable and keeps the supplied string as `source`.
 */
export function parseMarkdown(source: string, settings: MarkdownSettings): ParseResult {
  if (source.length > settings.maxLength) {
    return { ok: false, failure: { kind: 'too-long', limit: settings.maxLength, length: source.length } };
  }
  const parser = parsers[settings.dialect];
  const tokens = parser.parse(source, {});
  if (reachesNestingCeiling(tokens)) return { ok: false, failure: { kind: 'too-nested', limit: MAX_NESTING_LEVEL } };
  const blocks = readBlocks(new TokenReader(tokens), parser, source.split('\n'));
  return { ok: true, parsed: deepFreeze({ source, blocks }) };
}
