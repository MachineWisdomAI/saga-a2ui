// @vitest-environment jsdom
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('keeps every existing token and adds the font-size and reading-width tokens, each with a fallback', () => {
    for (const token of [
      '--saga-card-font-family',
      '--saga-card-line-height',
      '--saga-card-text-color',
      '--saga-card-accent-color',
      '--saga-card-muted-color',
      '--saga-card-border-color',
      '--saga-card-code-background',
      '--saga-card-font-size',
      '--saga-card-reading-width',
    ]) {
      expect(documentation, token).toContain(token);
      expect(css, token).toMatch(new RegExp(`var\\(${token},`));
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
