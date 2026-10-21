import { z } from 'zod';
import {
  fragmentsOf,
  parseMarkdown,
  type BlockNode,
  type MarkdownDialect,
  type MarkdownFragments,
  type MarkdownSettings,
  type ParseFailure,
} from './markdown.js';

// The FaithfulCard content contract and its one reader. Content is untrusted input: an object
// with the supported contract version and the Markdown to show, nothing else. The reader is built
// from trusted settings the application chooses (the Markdown dialect and a finite content
// bound) and validated on their own, so nothing in the content can select a dialect, enlarge the
// bound or reach any behavior. Every outcome is a value: the interpreted card, or a failure that
// names a kind and never repeats the content that caused it.

/** The only contract version this component reads. */
export const FAITHFUL_CARD_CONTRACT_VERSION = 1;

/** What an application supplies to display: the contract version and the Markdown, exactly as written. */
export interface FaithfulCardContent {
  readonly contractVersion: typeof FAITHFUL_CARD_CONTRACT_VERSION;
  readonly markdown: string;
}

/** Trusted settings for one reader. They are never taken from content. */
export type FaithfulCardSettings = MarkdownSettings;

export type ReaderFailure =
  | { readonly kind: 'invalid-dialect'; readonly message: string }
  | { readonly kind: 'invalid-limit'; readonly message: string }
  | { readonly kind: 'invalid-config'; readonly message: string };

export type CreateReaderResult =
  | { readonly ok: true; readonly reader: FaithfulCardReader }
  | { readonly ok: false; readonly failure: ReaderFailure };

/** A card ready to render: the immutable original source, its blocks in order and what a policy may have to block. */
export interface InterpretedCard {
  readonly source: string;
  readonly blocks: readonly BlockNode[];
  readonly fragments: MarkdownFragments;
}

/**
 * Why supplied content was refused. `invalid` and `unsupported-version` carry nothing from the
 * content, so a failure cannot leak a private answer.
 */
export type ContentFailure =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unsupported-version' }
  | ParseFailure;

export type ReadResult =
  | { readonly ok: true; readonly card: InterpretedCard }
  | { readonly ok: false; readonly failure: ContentFailure };

export interface FaithfulCardReader {
  /** The trusted settings this reader was created with. */
  readonly settings: FaithfulCardSettings;
  /** Validates unchecked content and interprets its Markdown. Never throws for any input. */
  read(input: unknown): ReadResult;
}

const SettingsSchema = z
  .object({
    dialect: z.enum([
      'commonmark',
      'commonmark-tables-strikethrough',
    ] satisfies MarkdownDialect[]),
    maxLength: z.number().int().positive().safe(),
  })
  .strict();

function failureFor(error: z.ZodError): ReaderFailure {
  const settings = error.issues.map((issue) => issue.path[0]);
  if (settings.includes('dialect')) {
    return {
      kind: 'invalid-dialect',
      message:
        'The Markdown dialect must be "commonmark" or "commonmark-tables-strikethrough".',
    };
  }
  if (settings.includes('maxLength')) {
    return {
      kind: 'invalid-limit',
      message:
        'The content bound must be a finite positive whole number of UTF-16 code units.',
    };
  }
  return {
    kind: 'invalid-config',
    message: 'The FaithfulCard settings are not valid.',
  };
}

/**
 * Validates unchecked trusted settings and returns a reader or an explicit failure. A missing or
 * unknown dialect, a missing, non-integer, non-positive or infinite bound, or an unknown setting
 * is a failure; the caller must not mount a card on guessed settings. There are no defaults:
 * the application decides what its content may be.
 */
export function createFaithfulCardReader(
  settings: unknown,
): CreateReaderResult {
  const parsed = SettingsSchema.safeParse(settings);
  if (!parsed.success) return { ok: false, failure: failureFor(parsed.error) };
  const trusted: FaithfulCardSettings = Object.freeze({
    dialect: parsed.data.dialect,
    maxLength: parsed.data.maxLength,
  });
  return {
    ok: true,
    reader: Object.freeze({
      settings: trusted,
      read(input: unknown): ReadResult {
        if (typeof input !== 'object' || input === null || Array.isArray(input))
          return { ok: false, failure: { kind: 'invalid' } };
        const fields = input as Readonly<Record<string, unknown>>;
        // The version decides whether the rest of the shape means anything, so it is checked first.
        if (fields.contractVersion !== FAITHFUL_CARD_CONTRACT_VERSION)
          return { ok: false, failure: { kind: 'unsupported-version' } };
        const names = Object.keys(fields);
        if (typeof fields.markdown !== 'string' || names.length !== 2)
          return { ok: false, failure: { kind: 'invalid' } };
        const result = parseMarkdown(fields.markdown, trusted);
        if (!result.ok) return result;
        return {
          ok: true,
          card: Object.freeze({
            source: result.parsed.source,
            blocks: result.parsed.blocks,
            fragments: fragmentsOf(result.parsed),
          }),
        };
      },
    }),
  };
}

/**
 * The sentence a reader sees when supplied content is refused. Every renderer shows this text, so
 * the wording has one owner. It names the limit that was exceeded, never any of the content.
 */
export function describeContentFailure(failure: ContentFailure): string {
  switch (failure.kind) {
    case 'too-long':
      return `This content is too long to display (${failure.length} characters; the limit is ${failure.limit}).`;
    case 'too-nested':
      return `This content is nested too deeply to display (the nesting limit is ${failure.limit} levels; a quote counts as one and a list item as two).`;
    case 'unsupported-version':
      return 'This content uses a version of the card contract that this application does not support.';
    case 'invalid':
      return 'This content is not valid for this card.';
  }
}
