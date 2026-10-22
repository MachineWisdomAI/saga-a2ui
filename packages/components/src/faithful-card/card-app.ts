import type { CardContent } from './card-layout.js';
import { createFaithfulCardReader } from './reader.js';

// The definition of a card application: what the application decides, as one validated, immutable
// value. It holds identity, the reader's options, where the content policy comes from, the
// operation that reads a tool result and the texts the application shows. It knows nothing of a
// document, a connection or a renderer, so each stack package can start the same definition; that
// reuse by a delivery other than MCP is unqualified until such a consumer exists.

export type { CardContent } from './card-layout.js';

/** Who the application is, as the host sees it. */
export interface CardAppIdentity {
  readonly name: string;
  readonly version: string;
}

/** The Markdown dialect and the bound (UTF-16 code units) the application's card reads under. */
export interface CardAppReaderOptions {
  readonly dialect: 'commonmark' | 'commonmark-tables-strikethrough';
  readonly maxLength: number;
}

/**
 * Where the content policy comes from. The embedded policy in the document the host mounted is the
 * only source in 0.7; a second source arrives with a consumer that needs it.
 */
export type CardAppPolicySource = 'document';

/**
 * Reads one tool result's `structuredContent` (unchecked input) into card content. `undefined` is
 * an unsupported result: the stack clears the answer and shows `texts.problem`. The application
 * wraps its own schema's `safeParse`, so this package stays independent of the schema library.
 */
export type CardResultParser = (
  structuredContent: unknown,
) => CardContent | undefined;

/** Every sentence the application shows around the card. The card never decides what they say. */
export interface CardAppTexts {
  /** Before the first answer. */
  readonly waiting: string;
  /** An unsupported or rejected result. */
  readonly problem: string;
  /** The handshake with the host failed. */
  readonly connectFailure: string;
  /** The application's own readiness work (for example fonts) failed. */
  readonly readyFailure: string;
  /** The embedded content policy is malformed or not valid. */
  readonly policyFailure: string;
}

declare const built: unique symbol;

function invalid(field: string, why: string): never {
  throw new Error(`Invalid FaithfulCardApp ${field}: ${why}`);
}

/** The built, validated and immutable definition. Only {@link FaithfulCardApp} makes one. */
export interface FaithfulCardAppDefinition {
  readonly [built]: true;
  readonly identity: CardAppIdentity;
  readonly reader: CardAppReaderOptions;
  readonly policy: CardAppPolicySource;
  readonly parse: CardResultParser;
  readonly texts: CardAppTexts;
}

const TEXT_KEYS = [
  'waiting',
  'problem',
  'connectFailure',
  'readyFailure',
  'policyFailure',
] as const satisfies readonly (keyof CardAppTexts)[];

/** What the builder has been told so far; any step may still be missing until `build()`. */
interface Draft {
  readonly identity: CardAppIdentity;
  readonly reader?: CardAppReaderOptions;
  readonly policy?: CardAppPolicySource;
  readonly parse?: CardResultParser;
  readonly texts?: CardAppTexts;
}

/**
 * The fluent builder. Each step returns a new builder and changes none that exists, so a partly
 * specified builder can be shared. Nothing is checked until `build()`.
 */
export class FaithfulCardAppBuilder {
  /** @internal Use {@link FaithfulCardApp.define}. */
  constructor(private readonly draft: Draft) {}

  reader(options: CardAppReaderOptions): FaithfulCardAppBuilder {
    return new FaithfulCardAppBuilder({ ...this.draft, reader: options });
  }

  policy(source: CardAppPolicySource): FaithfulCardAppBuilder {
    return new FaithfulCardAppBuilder({ ...this.draft, policy: source });
  }

  result(parse: CardResultParser): FaithfulCardAppBuilder {
    return new FaithfulCardAppBuilder({ ...this.draft, parse });
  }

  texts(texts: CardAppTexts): FaithfulCardAppBuilder {
    return new FaithfulCardAppBuilder({ ...this.draft, texts });
  }

  /**
   * Validates every field once and returns the immutable definition. Throws an `Error` naming the
   * first missing or invalid field, in the order identity, reader, policy, result, texts.
   */
  build(): FaithfulCardAppDefinition {
    const { identity, reader, policy, parse, texts } = this.draft;
    const text = (field: string, value: unknown): string =>
      typeof value === 'string' && value !== ''
        ? value
        : invalid(field, 'a non-empty string is required.');

    const name = text('name', identity?.name);
    const version = text('version', identity?.version);

    if (reader === undefined) invalid('reader', 'the reader is missing.');
    const created = createFaithfulCardReader({
      dialect: reader.dialect,
      maxLength: reader.maxLength,
    });
    if (!created.ok) {
      const field =
        created.failure.kind === 'invalid-limit'
          ? 'reader.maxLength'
          : created.failure.kind === 'invalid-dialect'
            ? 'reader.dialect'
            : 'reader';
      invalid(field, created.failure.message);
    }

    if (policy !== 'document')
      invalid(
        'policy',
        policy === undefined
          ? 'the policy source is missing.'
          : 'the only supported source is "document".',
      );
    if (typeof parse !== 'function')
      invalid('result', 'the operation that reads a result is missing.');
    if (texts === undefined) invalid('texts', 'the texts are missing.');

    const checkedTexts = Object.fromEntries(
      TEXT_KEYS.map((key) => [key, text(`texts.${key}`, texts[key])]),
    ) as unknown as CardAppTexts;

    // The factory establishes the invariants the interface promises; nothing else makes one.
    return Object.freeze({
      identity: Object.freeze({ name, version }),
      reader: Object.freeze({
        dialect: reader.dialect,
        maxLength: reader.maxLength,
      }),
      policy: 'document' as const,
      parse,
      texts: Object.freeze(checkedTexts),
    }) as FaithfulCardAppDefinition;
  }
}

/** Starts the definition of a card application. */
export const FaithfulCardApp = {
  define(identity: CardAppIdentity): FaithfulCardAppBuilder {
    // Copied, so the caller changing its object later changes nothing built from it.
    return new FaithfulCardAppBuilder({
      identity: { name: identity?.name, version: identity?.version },
    });
  },
} as const;
