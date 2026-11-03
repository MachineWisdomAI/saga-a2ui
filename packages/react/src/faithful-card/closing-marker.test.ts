// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import { FaithfulCard, FaithfulCardProvider } from './index.js';
import { trusted } from './fixture.test-support.js';

// The closing marker is structural: `data-saga-closing="paragraph"` sits on the final top-level
// block of the content and only when that block is a paragraph.

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function render(markdown: string, level: 'standard' | 'strict' = 'standard') {
  mounted = mount();
  mounted.render(
    createElement(FaithfulCardProvider, {
      view: trusted({ level }).view,
      children: createElement(FaithfulCard, { contractVersion: 1, markdown }),
    }),
  );
  const content = mounted.container.querySelector('.saga-card-content');
  if (!content) throw new Error('the card rendered no content');
  return {
    content,
    marked: [...content.querySelectorAll('[data-saga-closing]')],
  };
}

describe('the closing marker in the React card', () => {
  it('marks the final top-level paragraph, whatever its words', () => {
    const { content, marked } = render('First.\n\nThe last words.');
    expect(marked).toEqual([content.lastElementChild]);
    expect(marked[0]?.tagName).toBe('P');
    expect(marked[0]?.getAttribute('data-saga-closing')).toBe('paragraph');
    expect(marked[0]?.textContent).toBe('The last words.');
  });

  it('marks a final paragraph that reads like an attribution exactly like any other', () => {
    const { marked } = render(
      'Answer.\n\nThis information came from example.test. [Source](https://example.test/)',
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain('This information came from');
  });

  it('marks nothing when the card ends with a list, a quote, a table or code', () => {
    for (const ending of [
      '- one\n- two',
      '1. one\n2. two',
      '> quoted',
      '| a |\n| - |\n| 1 |',
      '```\ncode\n```',
    ]) {
      mounted?.unmount();
      expect(render(`Intro.\n\n${ending}`).marked, ending).toEqual([]);
    }
  });

  it('never marks a paragraph nested in a quote, a list item or a table cell', () => {
    for (const nested of [
      '> only quoted',
      '- an item\n\n  with a second paragraph',
      '| a |\n| - |\n| cell |',
    ]) {
      mounted?.unmount();
      expect(render(nested).marked, nested).toEqual([]);
    }
  });

  it('marks a trailing paragraph under Strict too, and not a trailing blocked markup block', () => {
    expect(render('A.\n\nB.', 'strict').marked).toHaveLength(1);
    mounted?.unmount();
    expect(render('A.\n\n<div>markup</div>', 'strict').marked).toEqual([]);
  });
});
