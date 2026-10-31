// Converts one repository guide, as it existed at a pinned revision, into a Mintlify (MDX) page.
//
// The conversion is deliberately small: it changes only what MDX would otherwise reject or what
// would stop working outside the repository. Prose, tables, headings and every fenced code block
// are kept as written. It is a pure function of its inputs so a page can be reproduced from the
// pinned source (see docs/mintlify.md).

export interface ConvertContext {
  readonly sourcePath: string;
  /** The public route of a repository file that is published as a page of this release. */
  readonly routeOf: (repoPath: string) => string | undefined;
  /** What a repository path is at the pinned revision. */
  readonly kindOf: (repoPath: string) => 'file' | 'dir' | 'missing';
  /** Absolute URL for a repository file or directory at the pinned revision. */
  readonly sourceUrl: (repoPath: string, kind: 'file' | 'dir') => string;
  /** Absolute URL of an image stored in the repository at the pinned revision. */
  readonly imageUrl: (repoPath: string) => string;
}

export interface ConvertedGuide {
  readonly title: string;
  readonly body: string;
  /** GitHub-style anchors of the page's headings, in document order. */
  readonly anchors: readonly string[];
  /** Relative links whose target does not exist at the pinned revision. */
  readonly brokenLinks: readonly string[];
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * The heading anchor Mintlify renders, as observed on its local and hosted pages (docs/mintlify.md):
 * lower case, spaces to hyphens, a straight apostrophe turned into a typographic one, `@`, `/`, `+`
 * and that apostrophe kept, commas, periods, colons, semicolons and code marks removed. A repeated
 * heading is numbered from 2 and the first keeps the plain form, unlike GitHub, which numbers from 1.
 */
export function anchorsOf(headings: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const base = headingText(heading)
      .toLowerCase()
      .replace(/'/g, '\u2019')
      .replace(/[^\p{L}\p{M}\p{N}\- @/+\u2019]/gu, '')
      .replace(/ /g, '-');
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

/** Characters of a heading whose anchor form has not been observed on Mintlify, so a link to it cannot be trusted. */
export function unverifiedAnchorCharacters(heading: string): string[] {
  return [
    ...new Set(
      headingText(heading).replace(/[\p{L}\p{M}\p{N}\-@/+',.:; ]/gu, ''),
    ),
  ];
}

function headingText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*~]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/** Remove the fence structure from the lines, returning [isCode, text] per line. */
function classify(lines: readonly string[]): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  let open: { char: string; length: number } | undefined;
  for (const text of lines) {
    const match = FENCE.exec(text);
    if (open === undefined) {
      if (match !== null) {
        open = { char: match[2]![0]!, length: match[2]!.length };
        out.push({ code: true, text });
      } else out.push({ code: false, text });
    } else {
      out.push({ code: true, text });
      if (
        match !== null &&
        match[2]![0] === open.char &&
        match[2]!.length >= open.length &&
        match[3]!.trim() === ''
      )
        open = undefined;
    }
  }
  if (open !== undefined)
    throw new Error('A fenced code block is not closed in the source.');
  return out;
}

function stripComments(lines: { code: boolean; text: string }[]) {
  const out: { code: boolean; text: string }[] = [];
  let inComment = false;
  for (const line of lines) {
    if (line.code) {
      out.push(line);
      continue;
    }
    let text = line.text;
    let result = '';
    while (text.length > 0) {
      if (inComment) {
        const end = text.indexOf('-->');
        if (end < 0) {
          text = '';
        } else {
          inComment = false;
          text = text.slice(end + 3);
        }
      } else {
        const start = text.indexOf('<!--');
        if (start < 0) {
          result += text;
          text = '';
        } else {
          result += text.slice(0, start);
          inComment = true;
          text = text.slice(start + 4);
        }
      }
    }
    if (result.trim() === '' && line.text.trim() !== '') continue;
    out.push({ code: false, text: result });
  }
  return out;
}

function splitDestination(destination: string): {
  path: string;
  fragment: string;
} {
  const hash = destination.indexOf('#');
  return hash < 0
    ? { path: destination, fragment: '' }
    : { path: destination.slice(0, hash), fragment: destination.slice(hash) };
}

function resolveRepoPath(from: string, relative: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i;

function rewriteDestination(
  destination: string,
  isImage: boolean,
  context: ConvertContext,
  broken: string[],
): string {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(destination) ||
    destination.startsWith('//') ||
    destination.startsWith('#')
  )
    return destination;
  const { path: relative, fragment } = splitDestination(destination);
  const repoPath = resolveRepoPath(context.sourcePath, decodeURI(relative));
  const kind = context.kindOf(repoPath);
  if (kind === 'missing') {
    broken.push(destination);
    return destination;
  }
  if (isImage && IMAGE_EXTENSIONS.test(repoPath))
    return context.imageUrl(repoPath);
  const route = kind === 'file' ? context.routeOf(repoPath) : undefined;
  if (route !== undefined) return route + fragment;
  return context.sourceUrl(repoPath, kind) + fragment;
}

/** Escape what MDX would read as JavaScript or markup; code spans and destinations are held aside. */
function escapeProse(text: string): string {
  return text.replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/</g, '&lt;');
}

function convertLine(
  line: string,
  context: ConvertContext,
  broken: string[],
): string {
  const held: string[] = [];
  const hold = (value: string) => {
    held.push(value);
    return `\u0000${held.length - 1}\u0000`;
  };
  // Code spans first, so nothing inside them is rewritten or escaped.
  let text = line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (span) => hold(span));
  // Autolinks and line breaks become Markdown and self-closed JSX.
  text = text.replace(
    /<((?:https?:\/\/|mailto:)[^<>\s]+)>/g,
    (_m, url: string) => hold(`[${url.replace(/^mailto:/, '')}](${url})`),
  );
  text = text.replace(/<br\s*\/?>/gi, () => hold('<br />'));
  // Inline links and images; reference definitions use the same rewrite.
  text = text.replace(
    /(!?)\[((?:[^\][]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]*)((?:\s+"[^"]*")?)\s*\)/g,
    (_m, bang: string, label: string, raw: string, title: string) => {
      const destination = raw.startsWith('<') ? raw.slice(1, -1) : raw;
      const rewritten = rewriteDestination(
        destination,
        bang === '!',
        context,
        broken,
      ).replace(/[{}]/g, (c) => (c === '{' ? '%7B' : '%7D'));
      return hold(`${bang}[${escapeProse(label)}](${rewritten}${title})`);
    },
  );
  text = text.replace(
    /^(\s{0,3}\[[^\]]+\]:\s+)(\S+)/,
    (_m, head: string, destination: string) =>
      head + hold(rewriteDestination(destination, false, context, broken)),
  );
  text = escapeProse(text);
  // Held values may contain placeholders for the code spans they enclose.
  const restore = (value: string): string =>
    value.replace(/\u0000(\d+)\u0000/g, (_m, i: string) =>
      restore(held[Number(i)]!),
    );
  return restore(text);
}

export function convertGuide(
  markdown: string,
  context: ConvertContext,
): ConvertedGuide {
  const classified = stripComments(classify(markdown.split('\n')));
  const broken: string[] = [];
  const headings: string[] = [];
  let title: string | undefined;
  const out: string[] = [];
  for (const line of classified) {
    if (line.code) {
      out.push(line.text);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line.text);
    if (heading !== null) {
      if (heading[1] === '#' && title === undefined) {
        title = headingText(heading[2]!);
        continue;
      }
      headings.push(heading[2]!);
    }
    out.push(convertLine(line.text, context, broken));
  }
  if (title === undefined)
    throw new Error(`${context.sourcePath} has no level-one heading.`);
  const body = out
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n');
  return {
    title,
    body: body.endsWith('\n') ? body : body + '\n',
    anchors: anchorsOf(headings),
    brokenLinks: broken,
  };
}

/** Fenced blocks of a document, verbatim, for comparing a page with its source. */
export function fencedBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] | undefined;
  let open: { char: string; length: number } | undefined;
  for (const text of markdown.split('\n')) {
    const match = FENCE.exec(text);
    if (open === undefined) {
      if (match !== null) {
        open = { char: match[2]![0]!, length: match[2]!.length };
        current = [text];
      }
    } else {
      current!.push(text);
      if (
        match !== null &&
        match[2]![0] === open.char &&
        match[2]!.length >= open.length &&
        match[3]!.trim() === ''
      ) {
        blocks.push(current!.join('\n'));
        open = undefined;
        current = undefined;
      }
    }
  }
  if (open !== undefined) throw new Error('A fenced code block is not closed.');
  return blocks;
}
