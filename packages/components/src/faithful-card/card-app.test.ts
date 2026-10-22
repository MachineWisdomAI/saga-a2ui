import { describe, expect, it } from 'vitest';
import {
  FaithfulCardApp,
  type CardAppTexts,
  type CardContent,
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

const parseAnswer = (value: unknown): CardContent | undefined =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { answer?: unknown }).answer === 'string'
    ? { markdown: (value as { answer: string }).answer }
    : undefined;

function complete() {
  return FaithfulCardApp.define({ name: 'Answers', version: '1.2.3' })
    .reader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 })
    .policy('document')
    .result(parseAnswer)
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
      'parse',
      'policy',
      'reader',
      'texts',
    ]);
  });

  it('parses a supported result into card content and maps anything else to undefined', () => {
    const { parse } = complete().build();
    expect(parse({ answer: 'Yes.' })).toEqual({ markdown: 'Yes.' });
    expect(parse({ answer: 7 })).toBeUndefined();
    expect(parse(undefined)).toBeUndefined();
  });

  it('is immutable: neither the definition nor its parts can be changed', () => {
    const identity = { name: 'Answers', version: '1.2.3' };
    const texts = { ...TEXTS };
    const reader = { dialect: 'commonmark', maxLength: 100 } as const;
    const definition = FaithfulCardApp.define(identity)
      .reader(reader)
      .policy('document')
      .result(parseAnswer)
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
      .result(parseAnswer);
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
          .result(parseAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(new RegExp(`\\b${field}\\b`));
    });

    it('a missing reader', () => {
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .policy('document')
          .result(parseAnswer)
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
          .result(parseAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(new RegExp(`reader.*${field}|${field}`));
    });

    it('a missing or unknown policy source', () => {
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .result(parseAnswer)
          .texts(TEXTS)
          .build(),
      ).toThrow(/policy/);
      expect(() =>
        FaithfulCardApp.define({ name: 'A', version: '1' })
          .reader({ dialect: 'commonmark', maxLength: 10 })
          .policy('network' as never)
          .result(parseAnswer)
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
          .result(parseAnswer)
          .build(),
      ).toThrow(/texts/);
    });

    it.each(Object.keys(TEXTS))('the text %s, absent or empty', (key) => {
      for (const bad of [undefined, '']) {
        expect(() =>
          FaithfulCardApp.define({ name: 'A', version: '1' })
            .reader({ dialect: 'commonmark', maxLength: 10 })
            .policy('document')
            .result(parseAnswer)
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
