// @vitest-environment jsdom
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HostLinks, LinkOpenOutcome } from '@saga-a2ui/core/host-links';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import { SagaAttribution, type SagaAttributionProps } from './index.js';

// The credit is the application's own element: trusted configuration in, one readable sentence out,
// and the host as the only way it can ever navigate. Rendering is checked in a real React root,
// under Strict Mode as in development.

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A host that answers each request when the test says so, and records what it was asked. */
function controllableHost() {
  const asked: string[] = [];
  const answers: ((outcome: LinkOpenOutcome) => void)[] = [];
  const links: HostLinks = {
    open(url) {
      asked.push(url);
      return new Promise((resolve) => answers.push(resolve));
    },
  };
  return {
    links,
    asked,
    async answer(outcome: LinkOpenOutcome) {
      await act(async () => {
        answers.shift()?.(outcome);
        await Promise.resolve();
      });
    },
  };
}

function show(props: SagaAttributionProps = {}): HTMLElement {
  mounted = mount();
  mounted.render(createElement(SagaAttribution, props));
  return mounted.container;
}

const click = (element: Element | null) =>
  act(() => {
    (element as HTMLElement).click();
  });

describe('the default credit', () => {
  it('reads as the agreed sentence, with the name as the only control', () => {
    const container = show({ links: controllableHost().links });
    const credit = container.querySelector('.saga-attribution');
    expect(credit?.tagName).toBe('P');
    expect(credit?.textContent).toBe('Built with saga a2ui');
    const controls = container.querySelectorAll('button, a');
    expect(controls).toHaveLength(1);
    expect(controls[0]?.textContent).toBe('saga a2ui');
  });

  it('makes no request while rendering and none without an activation', () => {
    const host = controllableHost();
    show({ links: host.links });
    expect(host.asked).toEqual([]);
  });

  it('is trusted configuration: text and destination come from the props alone', () => {
    const host = controllableHost();
    const container = show({
      links: host.links,
      prefix: 'Powered by',
      name: 'Example',
      href: 'https://example.com/path?x=1',
    });
    expect(container.textContent).toBe('Powered by Example');
    click(container.querySelector('button'));
    expect(host.asked).toEqual(['https://example.com/path?x=1']);
  });

  it('renders configured text as text, never as markup', () => {
    const container = show({
      prefix: '<img src=x onerror=alert(1)> by',
      name: '<b>name</b>',
    });
    expect(container.querySelector('img, b')).toBeNull();
    expect(container.textContent).toContain('<b>name</b>');
  });

  it('falls back to the agreed wording for blank text', () => {
    const container = show({ prefix: '  ', name: '' });
    expect(container.querySelector('.saga-attribution')?.textContent).toMatch(
      /^Built with saga a2ui /,
    );
  });
});

describe('opening the destination', () => {
  it('asks the host once for the fixed destination, however often it is pressed meanwhile', async () => {
    const host = controllableHost();
    const container = show({ links: host.links });
    const button = container.querySelector('button');
    click(button);
    click(button);
    click(button);
    expect(host.asked).toEqual(['https://saga-ai.dev/']);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    await host.answer('opened');
    expect(button?.hasAttribute('aria-disabled')).toBe(false);
    // Opened: the credit says nothing more, and may be pressed again.
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
    click(button);
    expect(host.asked).toHaveLength(2);
  });

  it.each<[LinkOpenOutcome, string]>([
    [
      'denied',
      'The host did not open this link. Destination: https://saga-ai.dev/',
    ],
    [
      'unavailable',
      'This host cannot open links. Destination: https://saga-ai.dev/',
    ],
    [
      'failed',
      'The link could not be opened. Destination: https://saga-ai.dev/',
    ],
  ])(
    'says so when the host answers %s, and keeps the credit usable',
    async (outcome, sentence) => {
      const host = controllableHost();
      const container = show({ links: host.links });
      click(container.querySelector('button'));
      await host.answer(outcome);
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        sentence,
      );
      expect(container.querySelector('button')?.textContent).toBe('saga a2ui');
    },
  );

  it('treats a host that throws as a failed request', async () => {
    const container = show({
      links: {
        open() {
          return Promise.reject(new Error('lost'));
        },
      },
    });
    await act(async () => {
      click(container.querySelector('button'));
      await Promise.resolve();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'The link could not be opened.',
    );
  });

  it('drops a late answer once the credit has been removed', async () => {
    const host = controllableHost();
    const container = show({ links: host.links });
    click(container.querySelector('button'));
    mounted!.render(createElement('div', null, 'gone'));
    await host.answer('denied');
    expect(container.textContent).toBe('gone');
  });

  it('drops a late answer once the host or destination was replaced, and asks the new host afresh', async () => {
    const first = controllableHost();
    const second = controllableHost();
    const container = show({ links: first.links });
    click(container.querySelector('button'));
    mounted!.render(createElement(SagaAttribution, { links: second.links }));
    await first.answer('denied');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
    click(container.querySelector('button'));
    expect(second.asked).toEqual(['https://saga-ai.dev/']);
  });
});

describe('without a host', () => {
  it('is readable text that shows its destination and offers nothing to activate', () => {
    const container = show();
    expect(container.querySelectorAll('button, a')).toHaveLength(0);
    expect(container.querySelector('.saga-attribution')?.textContent).toBe(
      'Built with saga a2ui (https://saga-ai.dev/)',
    );
  });
});

describe.each([
  ['http://saga-ai.dev/'],
  ['javascript:alert(1)'],
  ['data:text/html,x'],
  ['https://user:pass@saga-ai.dev/'],
  ['/relative'],
  ['not a url'],
  [''],
])('an unacceptable destination %j', (href) => {
  it('leaves plain text with nothing to activate and no request', () => {
    const host = controllableHost();
    const container = show({ links: host.links, href });
    expect(container.querySelectorAll('button, a')).toHaveLength(0);
    expect(container.querySelector('.saga-attribution')?.textContent).toBe(
      'Built with saga a2ui',
    );
    expect(host.asked).toEqual([]);
  });
});

describe('removal', () => {
  it('is not rendering the element: nothing of the credit remains', () => {
    const container = show({ links: controllableHost().links });
    mounted!.render(createElement('main', null, 'application'));
    expect(container.querySelector('.saga-attribution')).toBeNull();
    expect(container.textContent).toBe('application');
  });
});

describe('the exported stylesheet', () => {
  const css = fs.readFileSync(
    fileURLToPath(import.meta.resolve('@saga-a2ui/react/attribution.css')),
    'utf8',
  );
  const documentation = css.slice(0, css.indexOf('*/'));

  it('documents every class the credit renders, with and without a host', () => {
    const used = new Set<string>();
    for (const props of [
      { links: controllableHost().links },
      {},
    ] as SagaAttributionProps[]) {
      const container = show(props);
      for (const element of container.querySelectorAll('[class]'))
        for (const name of element.classList) used.add(name);
      mounted?.unmount();
      mounted = undefined;
    }
    expect([...used].sort()).toEqual([
      'saga-attribution',
      'saga-attribution-destination',
      'saga-attribution-link',
      'saga-attribution-name',
      'saga-attribution-status',
    ]);
    for (const name of used) expect(documentation, name).toContain(`.${name} `);
  });

  it('documents every token and reads each with a fallback', () => {
    const tokens = new Set(css.match(/--saga-attribution-[a-z-]+/g));
    expect(tokens.size).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(documentation, token).toContain(token);
      expect(css, token).toMatch(new RegExp(`var\\(${token},`));
    }
  });

  it('scopes every rule to the credit and never removes keyboard focus', () => {
    const selectors = css
      .slice(css.indexOf('*/') + 2)
      .match(/^[^{}\n]+(?=\{)/gm);
    for (const selector of selectors ?? [])
      expect(selector.trim(), selector).toMatch(/^\.saga-attribution/);
    expect(css).toContain(':focus-visible');
    expect(css).not.toMatch(/outline:\s*(none|0)/);
  });
});
