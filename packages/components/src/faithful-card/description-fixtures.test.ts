import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LISTED_IMAGE,
  REFUSED_DESCRIPTIONS,
  SAFE_LINK,
  UNLISTED_IMAGE,
  VALID_DESCRIPTIONS,
} from './description-fixtures.test-support.js';
import { createContentPolicy } from './policy.js';
import { createFaithfulCardReader, type FaithfulCardReader } from './reader.js';

// The shared description fixtures are the renderer-neutral contract the Lit card, and later the
// React card, are qualified against. These tests read each fixture through the production reader and
// policy, so a fixture can never describe something the component does not actually do.

function readerFor(dialect: 'commonmark' | 'commonmark-tables-strikethrough', maxLength: number): FaithfulCardReader {
  const created = createFaithfulCardReader({ dialect, maxLength });
  if (!created.ok) throw new Error(`unexpected configuration failure: ${created.failure.kind}`);
  return created.reader;
}

describe('the valid description fixtures', () => {
  it('are readable under their own dialect, in the structure they state', () => {
    expect(VALID_DESCRIPTIONS.map((fixture) => fixture.id)).toEqual(['multilingual-long', 'structured', 'hostile-references', 'unbroken-long']);
    for (const fixture of VALID_DESCRIPTIONS) {
      const read = readerFor(fixture.dialect, 50_000).read({ contractVersion: fixture.contractVersion, markdown: fixture.markdown });
      expect(read.ok, fixture.id).toBe(true);
      if (!read.ok) continue;
      expect(read.card.blocks.map((block) => block.kind), fixture.id).toEqual(fixture.outline);
      expect(read.card.source, fixture.id).toBe(fixture.markdown);
    }
  });

  it('keep the text they promise in the order they promise it, in the source itself', () => {
    for (const fixture of VALID_DESCRIPTIONS) {
      let from = 0;
      for (const piece of fixture.order) {
        const at = fixture.markdown.indexOf(piece, from);
        expect(at, `${fixture.id}: ${piece}`).toBeGreaterThanOrEqual(from);
        from = at + piece.length;
      }
    }
  });

  it('are long and varied enough to matter: multilingual, wide and past the episode bound', () => {
    const byId = Object.fromEntries(VALID_DESCRIPTIONS.map((fixture) => [fixture.id, fixture.markdown]));
    expect(byId['multilingual-long']).toMatch(/[\u0600-\u06FF]/);
    expect(byId['multilingual-long']).toMatch(/[\u3040-\u30FF]/);
    expect(byId['unbroken-long']).toMatch(/\S{200,}/);
  });

  it('give the hostile fixture references a policy has to decide, with every decision a Standard policy makes', () => {
    const hostile = VALID_DESCRIPTIONS.find((fixture) => fixture.id === 'hostile-references');
    if (!hostile) throw new Error('missing the hostile fixture');
    const created = createContentPolicy({ level: 'standard', imageHosts: ['images.example.com'] });
    if (!created.ok) throw new Error(created.failure.message);
    const { policy } = created;
    expect(policy.decideLink(SAFE_LINK).allowed).toBe(true);
    for (const refused of ['http://docs.example.com/notes', 'javascript:alert(1)', 'https://user:secret@docs.example.com/in']) {
      expect(policy.decideLink(refused).allowed, refused).toBe(false);
      expect(hostile.markdown, refused).toContain(refused);
    }
    expect(policy.decideImage(LISTED_IMAGE, { enforcement: 'established', consent: 'not-granted' }).allowed).toBe(true);
    expect(policy.decideImage(UNLISTED_IMAGE, { enforcement: 'established', consent: 'not-granted' }).allowed).toBe(false);
    expect(policy.decideImage('data:image/png;base64,iVBORw0KGgo=', { enforcement: 'established', consent: 'not-granted' }).allowed).toBe(false);
  });
});

describe('the refused description fixtures', () => {
  it('are each refused for the stated reason, and no failure repeats what was supplied', () => {
    for (const fixture of REFUSED_DESCRIPTIONS) {
      const read = readerFor('commonmark', fixture.maxLength).read({ contractVersion: fixture.contractVersion, markdown: fixture.markdown });
      expect(read.ok, fixture.id).toBe(false);
      if (read.ok) continue;
      expect(read.failure.kind, fixture.id).toBe(fixture.failure);
      expect(JSON.stringify(read.failure), fixture.id).not.toContain(fixture.secret);
    }
  });

  it('cover each way a result is refused', () => {
    expect(new Set(REFUSED_DESCRIPTIONS.map((fixture) => fixture.failure))).toEqual(new Set(['invalid', 'unsupported-version', 'too-long', 'too-nested']));
  });
});

describe('the fixtures module', () => {
  it('imports nothing and uses no DOM, so any renderer or runtime may share it', () => {
    const source = readFileSync(new URL('./description-fixtures.test-support.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\b(document|window|HTMLElement|customElements|lit)\b/);
  });
});
