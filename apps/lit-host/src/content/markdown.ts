import MarkdownIt, { type Token } from 'markdown-it';

// Markdown interpretation for episode descriptions. A maintained parser (markdown-it) reads the
// string; this module converts its token stream into a small closed set of restricted nodes, in
// source order, so a renderer can use fixed templates and text bindings only. No HTML is ever
// produced here, and nothing here decides whether a link or image may be used: that is the
// content policy's job.
//
// Supported dialect: CommonMark as implemented by markdown-it's "commonmark" preset with raw HTML
// disabled and no linkify, typographer, tables or strikethrough. Raw HTML and every unsupported
// construct therefore stay in the text as written (`<b>x</b>` is the characters `<b>x</b>`).

/** The longest description (in UTF-16 code units) that is interpreted. Longer input is refused. */
export const MAX_DESCRIPTION_LENGTH = 2000;

export type InlineNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'emphasis' | 'strong'; readonly children: readonly InlineNode[] }
  | { readonly kind: 'link'; readonly destination: string; readonly children: readonly InlineNode[] }
  | { readonly kind: 'image'; readonly source: string; readonly alt: string }
  | { readonly kind: 'softbreak' }
  | { readonly kind: 'hardbreak' };

export type BlockNode =
  | { readonly kind: 'paragraph'; readonly children: readonly InlineNode[] }
  | { readonly kind: 'heading'; readonly level: number; readonly children: readonly InlineNode[] }
  | { readonly kind: 'quote'; readonly children: readonly BlockNode[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly BlockNode[])[] }
  | { readonly kind: 'code-block'; readonly text: string }
  | { readonly kind: 'rule' };

export interface ParsedDescription {
  /** The supplied string, exactly as given. */
  readonly source: string;
  readonly blocks: readonly BlockNode[];
}

export type ParseFailure = { readonly kind: 'too-long'; readonly limit: number; readonly length: number };

export type ParseResult =
  | { readonly ok: true; readonly description: ParsedDescription }
  | { readonly ok: false; readonly failure: ParseFailure };

const parser = new MarkdownIt('commonmark', { html: false, linkify: false, typographer: false });

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

function mergeText(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const node of nodes) {
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

function readBlocks(reader: TokenReader, closeType?: string): BlockNode[] {
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
        blocks.push({ kind: 'quote', children: readBlocks(reader, 'blockquote_close') });
        break;
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const closing = token.type === 'bullet_list_open' ? 'bullet_list_close' : 'ordered_list_close';
        const items: BlockNode[][] = [];
        for (let item = reader.next(); item !== undefined && item.type !== closing; item = reader.next()) {
          if (item.type === 'list_item_open') items.push(readBlocks(reader, 'list_item_close'));
        }
        blocks.push({
          kind: 'list',
          ordered: token.type === 'ordered_list_open',
          start: Number(token.attrGet('start') ?? 1),
          items,
        });
        break;
      }
      case 'fence':
      case 'code_block':
        blocks.push({ kind: 'code-block', text: token.content });
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

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Interprets a description. Input over {@link MAX_DESCRIPTION_LENGTH} fails explicitly: it is not
 * truncated and no partial result is returned. The returned value is deeply immutable and keeps
 * the supplied string as `source`.
 */
export function parseDescription(source: string): ParseResult {
  if (source.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, failure: { kind: 'too-long', limit: MAX_DESCRIPTION_LENGTH, length: source.length } };
  }
  const blocks = readBlocks(new TokenReader(parser.parse(source, {})));
  return { ok: true, description: deepFreeze({ source, blocks }) };
}
