import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDES, SOURCE_ENTRIES, headingSlug, locate, locateAll, type GuideLink } from '../demo/tour/src/source-map.js';
import { repoRoot } from './packed-consumer.js';

// Documentation/source checks run without installing any SDK workspace or server.
const readRepository = (file: string): string => fs.readFileSync(path.join(repoRoot, file), 'utf8');

describe('the tour’s source links stay aligned with the source they quote', () => {
  it('finds every quoted source in the file it names, on the lines the page links', () => {
    const located = locateAll(readRepository);
    expect(located).toHaveLength(SOURCE_ENTRIES.length);
    for (const entry of located) {
      const lines = readRepository(entry.path).split('\n');
      const linked = lines.slice(entry.start - 1, entry.end).map((line) => line.trim()).filter((line) => line !== '');
      expect(linked, `${entry.id}: lines ${entry.start}-${entry.end} of ${entry.path}`).toEqual(entry.quote.map((line) => line.trim()));
    }
  });

  it('fails loudly, naming the quote and the file, when a quoted line has changed', () => {
    const changed = (file: string): string => readRepository(file).replace('return prerequisite(\'session\'', 'return prerequisite(\'sessions\'');
    expect(() => locateAll(changed)).toThrow(/The asynchronous session prerequisite.*examples\/pack1-consumer\/src\/notes-actions\.ts/);
  });

  it('locates a quote regardless of indentation, and refuses lines that are only found apart', () => {
    const text = ['function f() {', '    one();', '', '    two();', '    other();', '    three();', '}'].join('\n');
    expect(locate(text, ['one();', 'two();'])).toEqual({ start: 2, end: 4 });
    expect(locate(text, ['one();', 'three();'])).toBeUndefined();
    expect(locate(text, [])).toBeUndefined();
  });

  it('links each guide at a heading that exists, with the anchor GitHub gives it', () => {
    for (const guide of Object.values(GUIDES) as readonly GuideLink[]) {
      const text = readRepository(guide.path); // a guide that does not exist is an error
      if (guide.heading === undefined) continue;
      const headings = text.split('\n').filter((line) => /^#{1,6} /.test(line)).map((line) => line.replace(/^#+ /, ''));
      expect(headings, `${guide.path} has the heading "${guide.heading}"`).toContain(guide.heading);
    }
    expect(headingSlug('Prerequisites: session validity, confirmation and an audit entry')).toBe('prerequisites-session-validity-confirmation-and-an-audit-entry');
    expect(headingSlug('Trace one press, allowed and denied')).toBe('trace-one-press-allowed-and-denied');
  });

  it('quotes the same Archive definition, prerequisite, attachment and cleanup as the action guide', () => {
    const guide = readRepository('docs/actions.md');
    const guideLines = new Set(guide.split('\n').map((line) => line.trim()));
    for (const id of ['definition', 'prerequisite', 'attachment-lit', 'attachment-react', 'cleanup-success', 'cleanup-canceled', 'holds'] as const) {
      const entry = SOURCE_ENTRIES.find((one) => one.id === id);
      for (const line of (entry as (typeof SOURCE_ENTRIES)[number]).quote) expect(guideLines.has(line.trim()), `${id}: "${line}" is quoted by docs/actions.md`).toBe(true);
    }
  });
});

it('retains the third-party notice required by the components package', () => {
  expect(readRepository('THIRD_PARTY_NOTICES.md')).toContain('markdown-it');
});
