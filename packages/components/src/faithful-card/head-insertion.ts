// Where, in the text of an HTML document, the content restrictions may be inserted. The decision
// needs the real structure of the markup around the head, not substrings: a `>` inside a quoted
// attribute does not end a tag, and a comment that mentions a head, a script or a charset
// declaration contains no element. This reads exactly that much of HTML's tokenization (comments,
// doctype and other markup declarations, start and end tags with quoted attributes, and the
// contents of raw-text elements) and nothing else: it builds no tree and normalizes no byte, so the
// caller can insert at the returned offset and leave the source untouched around it.
//
// A purpose-built reader rather than an HTML parser dependency: this module is part of
// `@saga-a2ui/components/faithful-card`, which browser views import for `contentPolicyFromEmbedded`,
// and the package keeps that entry free of a general HTML parser, a DOM and Node built-ins.

const SPACE = /[\t\n\f\r ]/;
const TAG_NAME_END = /[\t\n\f\r />]/;
const ATTRIBUTE_NAME_END = /[\t\n\f\r />=]/;
const UNQUOTED_VALUE_END = /[\t\n\f\r >]/;

/** Elements whose content is text, not markup, until their own closing tag. */
const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
]);

type Token =
  | { readonly kind: 'text'; readonly start: number; readonly end: number }
  | { readonly kind: 'markup'; readonly start: number; readonly end: number }
  | {
      readonly kind: 'start' | 'end';
      readonly name: string;
      readonly attributes: ReadonlyMap<string, string>;
      readonly start: number;
      readonly end: number;
    };

/** The end of a comment that begins at `start`, as the HTML tokenizer ends it. */
function commentEnd(html: string, start: number): number {
  const body = start + '<!--'.length;
  // `<!-->` and `<!--->` are complete, empty comments.
  if (html.startsWith('>', body)) return body + 1;
  if (html.startsWith('->', body)) return body + 2;
  const close = /--!?>/g;
  close.lastIndex = body;
  const found = close.exec(html);
  return found === null ? html.length : found.index + found[0].length;
}

/** The end of a declaration, processing instruction or other bogus comment: the next `>`. */
function bogusCommentEnd(html: string, start: number): number {
  const close = html.indexOf('>', start);
  return close === -1 ? html.length : close + 1;
}

/** Reads a tag whose `<` is at `start`; `undefined` when the text ends inside it. */
function readTag(html: string, start: number): Token | undefined {
  const closing = html[start + 1] === '/';
  let at = start + (closing ? 2 : 1);
  const nameStart = at;
  while (at < html.length && !TAG_NAME_END.test(html[at] as string)) at += 1;
  const name = html.slice(nameStart, at).toLowerCase();
  const attributes = new Map<string, string>();
  for (;;) {
    while (at < html.length && /[\t\n\f\r /]/.test(html[at] as string)) at += 1;
    if (at >= html.length) return undefined;
    if (html[at] === '>')
      return {
        kind: closing ? 'end' : 'start',
        name,
        attributes,
        start,
        end: at + 1,
      };
    // A leading `=` belongs to the attribute name, as in the HTML tokenizer.
    const attributeStart = at;
    at += 1;
    while (at < html.length && !ATTRIBUTE_NAME_END.test(html[at] as string))
      at += 1;
    const attribute = html.slice(attributeStart, at).toLowerCase();
    while (at < html.length && SPACE.test(html[at] as string)) at += 1;
    let value = '';
    if (html[at] === '=') {
      at += 1;
      while (at < html.length && SPACE.test(html[at] as string)) at += 1;
      const quote = html[at];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, at + 1);
        if (close === -1) return undefined;
        value = html.slice(at + 1, close);
        at = close + 1;
      } else {
        const valueStart = at;
        while (at < html.length && !UNQUOTED_VALUE_END.test(html[at] as string))
          at += 1;
        value = html.slice(valueStart, at);
      }
    }
    if (!attributes.has(attribute)) attributes.set(attribute, value);
  }
}

/** Where the content of a raw-text element that opened at `from` ends: its closing tag, or the end. */
function rawTextEnd(html: string, from: number, name: string): number {
  const closing = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'ig');
  closing.lastIndex = from;
  return closing.exec(html)?.index ?? html.length;
}

/** The tokens of `html` in order; throws when the text ends inside a tag. */
function* tokens(html: string): Generator<Token> {
  let at = 0;
  while (at < html.length) {
    if (html[at] !== '<') {
      const next = html.indexOf('<', at);
      const end = next === -1 ? html.length : next;
      yield { kind: 'text', start: at, end };
      at = end;
      continue;
    }
    const after = html[at + 1] ?? '';
    if (html.startsWith('<!--', at)) {
      const end = commentEnd(html, at);
      yield { kind: 'markup', start: at, end };
      at = end;
    } else if (after === '!' || after === '?') {
      const end = bogusCommentEnd(html, at);
      yield { kind: 'markup', start: at, end };
      at = end;
    } else if (
      /[a-zA-Z]/.test(after) ||
      (after === '/' && /[a-zA-Z]/.test(html[at + 2] ?? ''))
    ) {
      const tag = readTag(html, at);
      if (tag === undefined)
        throw new Error('The view document ends inside a tag.');
      yield tag;
      at = tag.end;
      if (tag.kind === 'start' && RAW_TEXT_ELEMENTS.has(tag.name)) {
        const end = rawTextEnd(html, at, tag.name);
        if (end > at) yield { kind: 'text', start: at, end };
        at = end;
      }
    } else {
      // A `<` that opens no tag is text.
      yield { kind: 'text', start: at, end: at + 1 };
      at += 1;
    }
  }
}

/**
 * The offset at which the policy-derived restrictions go: immediately after the `<head …>` tag,
 * or after a `<meta charset>` only when that meta is head's first element, so the declaration stays
 * at the top and the restrictions still precede every script.
 *
 * Throws, and never guesses a position, when the document has no head tag of its own, has anything
 * before it but a doctype, comments and the `html` tag (the HTML parser would then have made a
 * head already, and this one would be ignored), declares its charset anywhere but as head's first
 * element, or ends inside a tag.
 */
export function headInsertionPoint(html: string): number {
  let head: number | undefined;
  let insertAt = 0;
  let firstElementSeen = false;
  let seenHtml = false;
  for (const token of tokens(html)) {
    if (token.kind === 'markup') continue;
    if (token.kind === 'text') {
      const text = html.slice(token.start, token.end);
      if (head === undefined && !/^\uFEFF?[\t\n\f\r ]*$/.test(text))
        throw new Error(
          'The view document has text before its <head>, so the content restrictions could not be placed in it.',
        );
      continue;
    }
    if (head === undefined) {
      if (token.kind === 'start' && token.name === 'html' && !seenHtml) {
        seenHtml = true;
      } else if (token.kind === 'start' && token.name === 'head') {
        head = token.end;
        insertAt = token.end;
      } else if (token.kind === 'start' && token.name === 'script') {
        throw new Error(
          'The view document has a script before its <head>, so the content restrictions would not precede every script.',
        );
      } else {
        throw new Error(
          `The view document has <${token.kind === 'end' ? '/' : ''}${token.name}> before its <head>, so the content restrictions could not be placed in it.`,
        );
      }
      continue;
    }
    if (token.kind !== 'start') continue;
    const declaresCharset =
      token.name === 'meta' && token.attributes.has('charset');
    if (!firstElementSeen) {
      firstElementSeen = true;
      if (declaresCharset) insertAt = token.end;
    } else if (declaresCharset) {
      throw new Error(
        'The charset declaration must be the first element of the view document head: it would otherwise follow the content restrictions or a script.',
      );
    }
  }
  if (head === undefined)
    throw new Error(
      'The view document has no <head> to carry its content restrictions.',
    );
  return insertAt;
}
