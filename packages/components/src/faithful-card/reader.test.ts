import { describe, expect, it } from 'vitest';
import {
  createFaithfulCardReader,
  describeContentFailure,
  type FaithfulCardReader,
} from './reader.js';

// The reader is the component's one entry for untrusted content: trusted settings in, a value
// or an explicit failure out. The trusted bound and dialect are validated independently of the
// content, and no failure repeats the content that caused it.

function readerWith(settings: unknown): FaithfulCardReader {
  const created = createFaithfulCardReader(settings);
  if (!created.ok)
    throw new Error(
      `unexpected configuration failure: ${created.failure.kind}`,
    );
  return created.reader;
}

const episode = { dialect: 'commonmark', maxLength: 2000 } as const;
const answer = {
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 20_000,
} as const;
const content = (markdown: unknown) => ({ contractVersion: 1, markdown });

describe('creating a reader from trusted settings', () => {
  it('accepts each supported dialect with a finite positive integer bound', () => {
    expect(createFaithfulCardReader(episode).ok).toBe(true);
    expect(createFaithfulCardReader(answer).ok).toBe(true);
  });

  it.each([
    ['no dialect', { maxLength: 100 }, 'invalid-dialect'],
    [
      'an unknown dialect',
      { dialect: 'gfm', maxLength: 100 },
      'invalid-dialect',
    ],
    ['no bound', { dialect: 'commonmark' }, 'invalid-limit'],
    ['a zero bound', { dialect: 'commonmark', maxLength: 0 }, 'invalid-limit'],
    [
      'a negative bound',
      { dialect: 'commonmark', maxLength: -1 },
      'invalid-limit',
    ],
    [
      'a fractional bound',
      { dialect: 'commonmark', maxLength: 10.5 },
      'invalid-limit',
    ],
    [
      'an infinite bound',
      { dialect: 'commonmark', maxLength: Infinity },
      'invalid-limit',
    ],
    [
      'a bound given as text',
      { dialect: 'commonmark', maxLength: '100' },
      'invalid-limit',
    ],
    [
      'an unknown setting',
      { dialect: 'commonmark', maxLength: 100, html: true },
      'invalid-config',
    ],
    ['settings that are not an object', 'commonmark', 'invalid-config'],
  ])('refuses %s', (_name, settings, kind) => {
    const created = createFaithfulCardReader(settings);
    expect(created.ok).toBe(false);
    expect(!created.ok && created.failure.kind).toBe(kind);
  });
});

describe('reading supplied content', () => {
  it('returns the immutable original source with its blocks and blockable fragments', () => {
    const source = '# Title\n\nSee [guide](https://docs.example.com/g).';
    const result = readerWith(episode).read(content(source));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.source).toBe(source);
    expect(result.card.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
    ]);
    expect(result.card.fragments).toEqual({ links: 1, images: [], rawHtml: 0 });
    expect(Object.isFrozen(result.card.blocks)).toBe(true);
  });

  it('reads the same content differently only as its trusted dialect says', () => {
    const table = '| a |\n|---|\n| b |';
    const asEpisode = readerWith(episode).read(content(table));
    const asAnswer = readerWith(answer).read(content(table));
    expect(
      asEpisode.ok && asEpisode.card.blocks.map((block) => block.kind),
    ).toEqual(['paragraph']);
    expect(
      asAnswer.ok && asAnswer.card.blocks.map((block) => block.kind),
    ).toEqual(['table']);
  });

  it('accepts content exactly at the bound and refuses one unit more, without truncating', () => {
    const reader = readerWith({ dialect: 'commonmark', maxLength: 50 });
    expect(reader.read(content('a'.repeat(50))).ok).toBe(true);
    expect(reader.read(content('a'.repeat(51)))).toEqual({
      ok: false,
      failure: { kind: 'too-long', limit: 50, length: 51 },
    });
  });

  it('applies each reader its own bound, so a long answer does not change the episode bound', () => {
    const long = 'word '.repeat(1000).trim(); // 4,999 units
    expect(readerWith(answer).read(content(long)).ok).toBe(true);
    expect(readerWith(episode).read(content(long))).toMatchObject({
      ok: false,
      failure: { kind: 'too-long', limit: 2000, length: 4999 },
    });
  });

  it('counts the bound in UTF-16 code units', () => {
    const reader = readerWith({ dialect: 'commonmark', maxLength: 4 });
    expect(reader.read(content('😀😀')).ok).toBe(true); // two surrogate pairs: 4 units
    expect(reader.read(content('😀😀a')).ok).toBe(false);
  });

  it('refuses nesting that would make the parser stop reading, instead of dropping text', () => {
    expect(
      readerWith(answer).read(content('> '.repeat(20) + 'visible-word')),
    ).toEqual({
      ok: false,
      failure: { kind: 'too-nested', limit: 20 },
    });
  });

  it('refuses an unsupported contract version without reading the markdown', () => {
    for (const version of [0, 2, '1', null, undefined, 1.5]) {
      const result = readerWith(episode).read({
        contractVersion: version,
        markdown: 'private text',
      });
      expect(result, String(version)).toEqual({
        ok: false,
        failure: { kind: 'unsupported-version' },
      });
    }
  });

  it.each([
    ['not an object', 'just a string'],
    ['null', null],
    ['an array', ['a']],
    ['missing markdown', { contractVersion: 1 }],
    ['markdown that is not a string', { contractVersion: 1, markdown: 7 }],
    ['an unknown field', { contractVersion: 1, markdown: 'x', html: '<b>' }],
  ])(
    'refuses content that is %s as invalid, and never repeats it',
    (_name, input) => {
      expect(readerWith(episode).read(input)).toEqual({
        ok: false,
        failure: { kind: 'invalid' },
      });
    },
  );

  it('does not let supplied content change the trusted settings', () => {
    const reader = readerWith(episode);
    const result = reader.read({
      contractVersion: 1,
      markdown: 'x',
      dialect: 'commonmark-tables-strikethrough',
      maxLength: 99999,
    });
    expect(result).toEqual({ ok: false, failure: { kind: 'invalid' } });
    expect(reader.read(content('a'.repeat(2001))).ok).toBe(false);
  });
});

describe('telling the reader why content was refused', () => {
  const secret = 'PRIVATE-ANSWER-TEXT';
  const failureOf = (input: unknown, maxLength = 20) => {
    const result = readerWith({ dialect: 'commonmark', maxLength }).read(input);
    if (result.ok) throw new Error('expected a refusal');
    return result.failure;
  };

  it('names the limit that was exceeded and nothing of the content', () => {
    const tooLong = describeContentFailure(
      failureOf(content(`${secret} ${'x'.repeat(30)}`)),
    );
    expect(tooLong).toBe(
      'This content is too long to display (50 characters; the limit is 20).',
    );
    const tooNested = describeContentFailure(
      failureOf(content(`${'> '.repeat(25)}${secret}`), 1000),
    );
    expect(tooNested).toContain('nesting limit is 20 levels');
    expect(tooNested).not.toContain(secret);
  });

  it('distinguishes an unsupported version from content of the wrong shape', () => {
    expect(
      describeContentFailure(
        failureOf({ contractVersion: 2, markdown: secret }),
      ),
    ).toBe(
      'This content uses a version of the card contract that this application does not support.',
    );
    expect(
      describeContentFailure(
        failureOf({ contractVersion: 1, markdown: secret, extra: true }),
      ),
    ).toBe('This content is not valid for this card.');
  });
});
