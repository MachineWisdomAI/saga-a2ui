import fs from 'node:fs';
import {
  a2uiV0_9Decoder,
  defineSurface,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { describe, expect, it } from 'vitest';

// The starter example in the view composition design is documentation a reader copies. It is
// executed here through the real `defineSurface` validation, so it cannot drift into an invalid
// root, a repeated component id or a field the schema lacks.

const DESIGN = new URL(
  '../blueprints/features/view_composition.blueprint.md',
  import.meta.url,
);

/** The text of the first `defineSurface({...})` call after `marker`, found by bracket matching. */
function callAfter(text: string, marker: string): string {
  const from = text.indexOf(marker);
  if (from < 0) throw new Error(`The design no longer contains "${marker}".`);
  const start = text.indexOf('defineSurface(', from);
  if (start < 0) throw new Error('No defineSurface call follows the marker.');
  let depth = 0;
  for (let at = text.indexOf('(', start); at < text.length; at += 1) {
    if (text[at] === '(') depth += 1;
    if (text[at] === ')' && --depth === 0) return text.slice(start, at + 1);
  }
  throw new Error('The defineSurface call is not closed.');
}

describe('the view composition design’s starter example', () => {
  const source = callAfter(
    fs.readFileSync(DESIGN, 'utf8'),
    'the starter template becomes',
  );
  const CATALOG_ID = 'https://starter.example/catalogs/starter/v1';
  const evaluate = () =>
    new Function(
      'defineSurface',
      'z',
      'CATALOG_ID',
      'CLEAR_ID',
      `return ${source};`,
    )(defineSurface, z, CATALOG_ID, 'clear') as ReturnType<
      typeof defineSurface<z.ZodObject<{ headline: z.ZodString }>>
    >;

  it('passes defineSurface validation', () => {
    expect(evaluate).not.toThrow();
  });

  it('opens a session whose root is the layout’s own root, and updates its data', () => {
    const layout = evaluate();
    const opening = layout.opening as readonly {
      updateComponents?: { components: { id: string; component: string }[] };
    }[];
    const components = opening[1]?.updateComponents?.components ?? [];
    expect(components.map((entry) => entry.id)).toEqual([
      'root',
      'headline',
      'clear',
      'clear-label',
    ]);
    expect(components[0]?.component).toBe('Column');
    expect(layout.update({ headline: 'Hello' }).ok).toBe(true);
    expect(layout.update({ headline: 3 } as never).ok).toBe(false);
  });

  it('is accepted by the decoder', () => {
    const layout = evaluate();
    expect(a2uiV0_9Decoder.decode(layout.opening).ok).toBe(true);
  });
});
