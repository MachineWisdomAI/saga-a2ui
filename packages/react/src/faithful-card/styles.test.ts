// @vitest-environment jsdom
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FAITHFUL_CARD_STYLING } from '@saga-a2ui/components/faithful-card';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import { createElement } from 'react';
import { FaithfulCard, FaithfulCardProvider } from './index.js';
import { trusted } from './fixture.test-support.js';

// The stylesheet is an explicit export, and its documentation is the contract an application styles
// against: every class the card renders and every token it reads is listed there. Computed
// typography and an isolated consumer are checked in a real browser (apps/lit-host, React card
// consumer); here the file is read the way a bundler resolves it.

const css = fs.readFileSync(
  fileURLToPath(import.meta.resolve('@saga-a2ui/react/faithful-card.css')),
  'utf8',
);
const documentation = css.slice(0, css.indexOf('*/'));

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const markdown = [
  '# Heading',
  'A [link](https://docs.example.com/) and ![image](https://images.example.com/a.png) and <b>markup</b>.',
  '',
  '[bad](http://docs.example.com/)',
  '',
  '<div>block</div>',
  '',
  '| a |\n| - |\n| 1 |',
].join('\n');

/** The committed class names a source does not name: the structural scan of the styling surface. */
function missingNames(source: string): string[] {
  return FAITHFUL_CARD_STYLING.classes.filter(
    (name) => !source.includes(`.${name} `),
  );
}

function classesRendered(level: 'standard' | 'strict'): Set<string> {
  const host = trusted({ level });
  mounted = mount();
  mounted.render(
    createElement(FaithfulCardProvider, {
      view: host.view,
      children: createElement(FaithfulCard, { contractVersion: 1, markdown }),
    }),
  );
  const used = new Set<string>();
  for (const element of mounted.container.querySelectorAll('[class]'))
    for (const name of element.classList) used.add(name);
  mounted.unmount();
  mounted = undefined;
  return used;
}

describe('the exported stylesheet', () => {
  it('documents every semantic class the card renders, under Standard and Strict', () => {
    const used = new Set([
      ...classesRendered('standard'),
      ...classesRendered('strict'),
    ]);
    expect([...used].every((name) => name.startsWith('saga-card'))).toBe(true);
    for (const name of used) expect(documentation, name).toContain(`.${name} `);
    // A refused card is styled too.
    mounted = mount();
    mounted.render(
      createElement(FaithfulCard, { contractVersion: 1, markdown: 'x' }),
    );
    expect(
      mounted.container
        .querySelector('.saga-card-failure')
        ?.classList.contains('saga-card'),
    ).toBe(true);
  });

  it('keeps every committed token, each documented and read with a fallback', () => {
    for (const token of FAITHFUL_CARD_STYLING.tokens) {
      expect(documentation, token).toContain(token);
      expect(css, token).toMatch(new RegExp(`var\\(${token},`));
    }
  });

  it('documents the closing marker and every committed class, and the card renders each committed class', () => {
    expect(documentation).toContain(
      `${FAITHFUL_CARD_STYLING.closing.attribute}="${FAITHFUL_CARD_STYLING.closing.value}"`,
    );
    expect(missingNames(documentation)).toEqual([]);
    const used = new Set([
      ...classesRendered('standard'),
      ...classesRendered('strict'),
    ]);
    // The link and its answer exist only while a link is activatable, the controls only under Strict.
    for (const name of FAITHFUL_CARD_STYLING.classes)
      expect([...used], name).toContain(name);
  });

  it('fails the scan when a committed class is removed from the stylesheet’s contract', () => {
    for (const name of FAITHFUL_CARD_STYLING.classes) {
      const without = documentation.replaceAll(`.${name} `, '. ');
      expect(missingNames(without), name).toEqual([name]);
    }
  });

  it('scopes every rule under the card, so it cannot restyle the surrounding application', () => {
    const body = css.slice(css.indexOf('*/') + 2);
    const selectors = [...body.matchAll(/(^|\})\s*([^{}]+)\{/g)].map((match) =>
      match[2]!.trim(),
    );
    expect(selectors.length).toBeGreaterThan(5);
    for (const group of selectors) {
      for (const selector of group.split(','))
        expect(selector.trim(), selector).toMatch(/^\.saga-card\b/);
    }
  });
});

describe('the committed content elements', () => {
  // One document that uses every Markdown construct the committed element list names.
  const everyElement = [
    '# One',
    '## Two',
    '### Three',
    '#### Four',
    'A paragraph with **strong**, *emphasis* and `code`.',
    '- a bullet',
    '1. a number',
    '> a quote',
    '```\npreformatted\n```',
    '| a |\n| - |\n| 1 |',
    '---',
  ].join('\n\n');

  it('renders each one inside .saga-card-content, in the React card', () => {
    mounted = mount();
    mounted.render(
      createElement(FaithfulCardProvider, {
        view: trusted({}).view,
        children: createElement(FaithfulCard, {
          contractVersion: 1,
          markdown: everyElement,
        }),
      }),
    );
    const content = mounted.container.querySelector('.saga-card-content');
    for (const name of FAITHFUL_CARD_STYLING.elements)
      expect(content?.querySelector(name), name).not.toBeNull();
  });

  it('documents each one in the stylesheet’s header', () => {
    const elements = documentation.slice(documentation.indexOf('Elements.'));
    for (const name of FAITHFUL_CARD_STYLING.elements)
      expect(elements, name).toMatch(new RegExp(`\\b${name}\\b`));
  });
});
