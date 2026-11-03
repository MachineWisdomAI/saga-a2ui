import type { DeliveredResult } from '@saga-a2ui/core/delivered-result';
import { describe, expect, it } from 'vitest';
import {
  FaithfulCardApp,
  readCardResult,
  type CardAppTexts,
  type CardResultOutcome,
} from './card-app.js';

// The definition of a card application, built and read without a DOM, a connection or a renderer.
// The tests go through the fluent builder the way an application does.

const TEXTS: CardAppTexts = {
  waiting: 'Waiting for the answer…',
  problem: 'The answer could not be shown.',
  connectFailure: 'The host did not answer.',
  readyFailure: 'The fonts did not load.',
  policyFailure: 'The content policy is not valid.',
};

// The application's own reader: this fixture decides what a result means, the package does not.
const delivered = (
  structuredContent?: unknown,
  overrides: Partial<DeliveredResult> = {},
): DeliveredResult => ({
  isError: false,
  content: [],
  ...(structuredContent === undefined ? {} : { structuredContent }),
  ...overrides,
});

const readAnswer = (result: DeliveredResult): CardResultOutcome => {
  const value = result.structuredContent;
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as { answer?: unknown }).answer === 'string'
    ? {
        kind: 'content',
        content: { markdown: (value as { answer: string }).answer },
      }
    : { kind: 'rejected' };
};

function complete() {
  return FaithfulCardApp.define({ name: 'Answers', version: '1.2.3' })
    .reader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 })
    .policy('document')
    .result(readAnswer)
    .texts(TEXTS);
}

describe('FaithfulCardApp', () => {
  it('builds a definition that holds exactly the application’s decisions', () => {
    const definition = complete().build();
    expect(definition.identity).toEqual({ name: 'Answers', version: '1.2.3' });
    expect(definition.reader).toEqual({
      dialect: 'commonmark-tables-strikethrough',
      maxLength: 50_000,
    });
    expect(definition.policy).toBe('document');
    expect(definition.texts).toEqual(TEXTS);
    expect(Object.keys(definition).sort()).toEqual([
      'identity',
      'policy',
      'readResult',
      'reader',
      'texts',
    ]);
  });

  it('holds the one reader the application supplied, which turns a delivered result into an outcome', () => {
    const { readResult } = complete().build();
    expect(readResult).toBe(readAnswer);
    expect(readResult(delivered({ answer: 'Yes.' }))).toEqual({
      kind: 'content',
      content: { markdown: 'Yes.' },
    });
    expect(readResult(delivered({ answer: 7 }))).toEqual({ kind: 'rejected' });
  });

  it('is immutable: neither the definition nor its parts can be changed', () => {
    const identity = { name: 'Answers', version: '1.2.3' };
    const texts = { ...TEXTS };
    const reader = { dialect: 'commonmark', maxLength: 100 } as const;
    const definition = FaithfulCardApp.define(identity)
      .reader(reader)
      .policy('document')
      .result(readAnswer)
      .texts(texts)
      .build();

    for (const frozen of [
      definition,
      definition.identity,
      definition.reader,
      definition.texts,
    ])
      expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      (definition as { readResult: unknown }).readResult = () => undefined;
    }).toThrow(TypeError);
    expect(() => {
      (definition.texts as { problem: string }).problem = 'changed';
    }).toThrow(TypeError);

    // The caller's own objects are not the definition's: changing them later changes nothing.
    identity.name = 'Renamed';
    texts.problem = 'changed';
    expect(definition.identity.name).toBe('Answers');
    expect(definition.texts.problem).toBe(TEXTS.problem);
  });

  it('lets a partly specified builder be reused without one build affecting another', () => {
    const base = FaithfulCardApp.define({ name: 'A', version: '1' })
      .reader({ dialect: 'commonmark', maxLength: 10 })
      .policy('document')
      .result(readAnswer);
    const first = base.texts(TEXTS).build();
    const second = base.texts({ ...TEXTS, problem: 'Other' }).build();
    expect(first.texts.problem).toBe(TEXTS.problem);
    expect(second.texts.problem).toBe('Other');
  });

  describe('build() names the first missing or invalid field', () => {
    it.each([
      ['identity name', { name: '', version: '1' }, 'name'],
      ['identity version', { name: 'A', version: '' }, 'version'],
    ])('%s', (_label, identity, field) => {
      expect(() =>
        FaithfulCardApp.define(identity)
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .policy('document')
          .result(readAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(new RegExp(`\\b${field}\\b`));
    });

    it('a missing reader', () => {
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .policy('document')
          .result(readAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(/reader/);
    });

    it.each([
      ['dialect', { dialect: 'markdown', maxLength: 10 }],
      ['maxLength', { dialect: 'commonmark', maxLength: 0 }],
    ])('an invalid reader %s', (field, reader) => {
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader(reader as never)
          .policy('document')
          .result(readAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(new RegExp(`reader.*${field}|${field}`));
    });

    it('a missing or unknown policy source', () => {
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .result(readAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(/policy/);
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .policy('network' as never)
          .result(readAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(/policy/);
    });

    it('a missing or non-function result operation', () => {
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .policy('document')
          .texts(TEXTS)
          .build(),
      ).toThrow(/result/);
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .policy('document')
          .result('parse' as never)
          .texts(TEXTS)
          .build(),
      ).toThrow(/result/);
    });

    it('missing texts', () => {
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .policy('document')
          .result(readAnswer)
          .build(),
      ).toThrow(/texts/);
    });

    it.each(Object.keys(TEXTS))('the text %s, absent or empty', (key) => {
      for (const bad of [undefined, '']) {
        expect(() =>
          FaithfulCardApp.define({ name: 'A', version: '1' })
            .reader({ dialect: 'commonmark', maxLength: 10 })
            .policy('document')
            .result(readAnswer)
            .texts({ ...TEXTS, [key]: bad } as never)
            .build(),
        ).toThrow(new RegExp(`texts\\.${key}\\b`));
      }
    });

    it('reports the first problem in a fixed order, not every one', () => {
      expect(() =>
        FaithfulCardApp.define({ name: '', version: '' }).build(),
      ).toThrow(/\bname\b/);
    });
  });
});

describe('readCardResult', () => {
  const quiet = () => undefined;
  const asDefinition = (readResult: (result: DeliveredResult) => unknown) => ({
    readResult: readResult as never,
  });

  it('gives the reader the delivered result untouched and returns its outcome', () => {
    const whole = delivered({ answer: 'x' }, { isError: true });
    const seen: unknown[] = [];
    const outcome = readCardResult(
      asDefinition((result) => {
        seen.push(result);
        return { kind: 'rejected', text: 'Supplied wording.' };
      }),
      () => whole,
      quiet,
    );
    expect(seen).toEqual([whole]);
    expect(seen[0]).toBe(whole);
    expect(outcome).toEqual({ kind: 'rejected', text: 'Supplied wording.' });
    expect(
      readCardResult(
        asDefinition(() => ({
          kind: 'content',
          content: { markdown: 'Shown.\n', heading: '' },
        })),
        () => whole,
        quiet,
      ),
    ).toEqual({
      kind: 'content',
      content: { markdown: 'Shown.\n', heading: '' },
    });
  });

  it('rejects without wording, and reports, a reader that throws', () => {
    const errors: unknown[] = [];
    expect(
      readCardResult(
        asDefinition(() => {
          throw new Error('reader broke');
        }),
        () => delivered(),
        (error) => errors.push(error),
      ),
    ).toEqual({ kind: 'rejected' });
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('reader broke');
  });

  it('rejects without wording, and reports, a delivery mapping that throws, without calling the reader', () => {
    const errors: unknown[] = [];
    let read = false;
    expect(
      readCardResult(
        asDefinition(() => {
          read = true;
          return { kind: 'rejected' };
        }),
        () => {
          throw new TypeError('no content list');
        },
        (error) => errors.push(error),
      ),
    ).toEqual({ kind: 'rejected' });
    expect(read).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('rejects, without wording, a return that is not an outcome, since a reader’s return is unchecked input', () => {
    const errors: unknown[] = [];
    const reportError = (error: unknown) => errors.push(error);
    for (const bad of [
      undefined,
      null,
      'text',
      { kind: 'content' },
      { kind: 'content', content: { markdown: 3 } },
      { kind: 'rejected', text: '' },
      { kind: 'rejected', text: 7 },
      { kind: 'other' },
    ]) {
      expect(
        readCardResult(
          asDefinition(() => bad),
          () => delivered(),
          reportError,
        ),
      ).toEqual({ kind: 'rejected' });
    }
    expect(errors).toEqual([]);
  });
});
