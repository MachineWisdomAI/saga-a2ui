// @vitest-environment jsdom
import { FAITHFUL_CARD_STYLING } from '@saga-a2ui/components/faithful-card';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FaithfulCardContentElement,
  provideContentView,
  registerFaithfulCard,
} from './index.js';
import {
  settle,
  trusted,
  type TrustedOptions,
} from './fixture.test-support.js';

// The Lit card emits the same styling surface as the React card: the committed class names, in the
// same places, and the structural closing marker on the final top-level block.

registerFaithfulCard();

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

async function render(markdown: string, options: TrustedOptions = {}) {
  const host = document.createElement('section');
  const end = provideContentView(host, trusted(options).view);
  const card = document.createElement(
    'saga-faithful-card-content',
  ) as FaithfulCardContentElement;
  host.append(card);
  card.contractVersion = 1;
  card.markdown = markdown;
  document.body.append(host);
  cleanup.push(() => {
    end();
    host.remove();
  });
  await card.updateComplete;
  await settle();
  const content = card.querySelector('.saga-card-content');
  return {
    card,
    content,
    marked: [...card.querySelectorAll('[data-saga-closing]')],
  };
}

const classesIn = (root: Element): Set<string> => {
  const used = new Set<string>();
  for (const element of root.querySelectorAll('[class]'))
    for (const name of element.classList) used.add(name);
  return used;
};

describe('the Lit card’s styling surface', () => {
  it('roots the card in .saga-card and puts the content in .saga-card-content', async () => {
    const { card, content } = await render('A paragraph.');
    expect(card.querySelector('.saga-card')).not.toBeNull();
    expect(card.querySelector('.saga-card > .saga-card-content')).toBe(content);
  });

  it('emits every committed class name', async () => {
    const standard = await render('A [link](https://docs.example.com/).');
    const strict = await render('<b>x</b> [l](https://docs.example.com/)', {
      level: 'strict',
    });
    const used = new Set([
      ...classesIn(standard.card),
      ...classesIn(strict.card),
    ]);
    for (const name of FAITHFUL_CARD_STYLING.classes)
      expect([...used], name).toContain(name);
    // Everything the card calls a class belongs to the surface.
    expect([...used].every((name) => name.startsWith('saga-card'))).toBe(true);
    expect(standard.card.querySelector('button.saga-card-link')).not.toBeNull();
    expect(
      standard.card.querySelector('.saga-card-link + .saga-card-link-status'),
    ).not.toBeNull();
  });

  it('marks the final top-level paragraph, whatever its words', async () => {
    const { content, marked } = await render('First.\n\nThe last words.');
    expect(marked).toEqual([content?.lastElementChild]);
    expect(marked[0]?.tagName).toBe('P');
    expect(marked[0]?.getAttribute('data-saga-closing')).toBe('paragraph');
  });

  it('marks a final paragraph that reads like an attribution exactly like any other', async () => {
    const { marked } = await render(
      'Answer.\n\nThis information came from example.test.',
    );
    expect(marked).toHaveLength(1);
  });

  it('marks nothing when the card ends with a list, a quote, a table or code', async () => {
    for (const ending of [
      '- one\n- two',
      '1. one\n2. two',
      '> quoted',
      '| a |\n| - |\n| 1 |',
      '```\ncode\n```',
    ])
      expect((await render(`Intro.\n\n${ending}`)).marked, ending).toEqual([]);
  });

  it('never marks a paragraph nested in a quote, a list item or a table cell', async () => {
    for (const nested of [
      '> only quoted',
      '- an item\n\n  with a second paragraph',
      '| a |\n| - |\n| cell |',
    ])
      expect((await render(nested)).marked, nested).toEqual([]);
  });

  it('marks a trailing paragraph under Strict too, and not a trailing blocked markup block', async () => {
    expect((await render('A.\n\nB.', { level: 'strict' })).marked).toHaveLength(
      1,
    );
    expect(
      (await render('A.\n\n<div>markup</div>', { level: 'strict' })).marked,
    ).toEqual([]);
  });

  it('shows a refused card as .saga-card with the failure class', async () => {
    const { card } = await render('x'.repeat(6000));
    const failure = card.querySelector('[data-testid="card-failure"]');
    expect(failure?.classList.contains('saga-card')).toBe(true);
    expect(failure?.classList.contains('saga-card-failure')).toBe(true);
  });
});
