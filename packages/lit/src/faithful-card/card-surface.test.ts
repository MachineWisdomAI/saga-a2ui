// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  openFaithfulCardSurface,
  provideContentView,
  registerFaithfulCard,
  type CardSurface,
} from './index.js';
import {
  queryDeep,
  settle,
  trusted,
  type TrustedOptions,
} from './fixture.test-support.js';

// The card surface as an application meets it: opened once, placed in the document under the
// view it provides, and given content with `present`, the one operation that selects what the
// card shows.

registerFaithfulCard();

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

async function start(options: TrustedOptions = {}) {
  const host = trusted(options);
  const container = document.createElement('main');
  document.body.append(container);
  const surface = openFaithfulCardSurface();
  const end = provideContentView(container, host.view);
  container.append(surface.element);
  cleanup.push(() => {
    surface.dispose();
    end();
    container.remove();
  });
  await settle();
  const byTestId = (id: string): HTMLElement[] => [
    ...queryDeep(surface.element, `[data-testid="${id}"]`),
  ];
  const present = async (markdown: unknown) => {
    const result = surface.present({ markdown: markdown as string });
    await settle();
    return result;
  };
  const press = async (element: HTMLElement | undefined) => {
    element?.click();
    await settle();
  };
  return { host, surface, container, byTestId, present, press };
}

const IMAGE_MARKDOWN = 'Chart: ![chart](https://images.example.com/a.png)';
const STRICT_IMAGES: TrustedOptions = {
  level: 'strict',
  imageHosts: ['images.example.com'],
};

describe('a Lit card surface', () => {
  it('shows an empty card until content is presented, then shows it', async () => {
    const { surface, byTestId, present } = await start();
    expect(byTestId('card-content')).toHaveLength(1);
    expect(shownText(surface).trim()).toBe('');
    expect(await present('First **answer**')).toEqual({ ok: true });
    expect(queryDeep(surface.element, 'strong')[0]?.textContent).toBe('answer');
  });

  it('shows a new answer in place of the old one', async () => {
    const { surface, present } = await start();
    await present('First answer');
    await present('Second answer');
    expect(shownText(surface)).toContain('Second answer');
    expect(shownText(surface)).not.toContain('First answer');
  });

  it('presenting equal text is a new presentation: a fresh card that has lost the old one’s state', async () => {
    const { byTestId, present, press } = await start({ level: 'strict' });
    await present('Text with a <b>tag</b>.');
    const before = byTestId('card-content')[0];
    await press(byTestId('source-toggle')[0]);
    expect(byTestId('md-markup')[0]?.getAttribute('data-presentation')).toBe(
      'source',
    );
    await present('Text with a <b>tag</b>.');
    expect(byTestId('card-content')).toHaveLength(1);
    expect(byTestId('card-content')[0]).not.toBe(before);
    expect(before?.isConnected).toBe(false);
    expect(byTestId('md-markup')[0]?.getAttribute('data-presentation')).toBe(
      'placeholder',
    );
  });

  it('presenting equal text revokes the image consent the reader gave', async () => {
    const { host, byTestId, present, press } = await start(STRICT_IMAGES);
    await present(IMAGE_MARKDOWN);
    await press(byTestId('images-toggle')[0]);
    expect(byTestId('md-image')).toHaveLength(1);
    const watcher = host.consent.grant();
    await present(IMAGE_MARKDOWN);
    expect(watcher.live).toBe(false);
    expect(byTestId('md-image')).toEqual([]);
    expect(byTestId('images-toggle')[0]?.textContent?.trim()).toBe(
      'Show images',
    );
    expect(host.consent.retired).toBe(false);
    await press(byTestId('images-toggle')[0]);
    expect(byTestId('md-image')).toHaveLength(1);
  });

  it('drops a host answer that arrives after its presentation was replaced, even by equal text', async () => {
    const { host, byTestId, present, press } = await start({
      answer: 'pending',
    });
    await present('[a](https://docs.example.com/a)');
    await press(byTestId('md-link')[0]);
    await present('[a](https://docs.example.com/a)');
    host.pending[0]!('opened');
    await settle();
    expect(
      byTestId('md-link-status')[0]?.getAttribute('data-outcome'),
    ).toBeNull();
    expect(host.requests).toEqual(['https://docs.example.com/a']);
  });

  it('clear empties the card, ends the consent given for it, and lets the next present show again', async () => {
    const { surface, host, byTestId, present, press } =
      await start(STRICT_IMAGES);
    await present(IMAGE_MARKDOWN);
    await press(byTestId('images-toggle')[0]);
    const watcher = host.consent.grant();
    surface.clear();
    await settle();
    expect(byTestId('card-content')).toHaveLength(1);
    expect(shownText(surface).trim()).toBe('');
    expect(watcher.live).toBe(false);
    await present('Back again');
    expect(shownText(surface)).toContain('Back again');
  });

  it('leaves the shown presentation as it was when content is rejected', async () => {
    const { byTestId, present, press } = await start(STRICT_IMAGES);
    await present(IMAGE_MARKDOWN);
    await press(byTestId('images-toggle')[0]);
    const shown = byTestId('card-content')[0];
    const rejected = await present(42);
    // The same structured failure the React card surface returns for the same content.
    expect(rejected).toEqual({
      ok: false,
      failure: {
        kind: 'invalid-data',
        message: expect.stringContaining('markdown'),
      },
    });
    expect(byTestId('card-content')[0]).toBe(shown);
    expect(byTestId('md-image')).toHaveLength(1);
  });

  it('keeps content presented before it was in the document, and shows it once it is', async () => {
    const host = trusted();
    const surface = openFaithfulCardSurface();
    expect(surface.present({ markdown: 'Early answer' })).toEqual({ ok: true });
    const container = document.createElement('main');
    document.body.append(container);
    const end = provideContentView(container, host.view);
    container.append(surface.element);
    cleanup.push(() => {
      surface.dispose();
      end();
      container.remove();
    });
    await settle();
    expect(shownText(surface)).toContain('Early answer');
  });

  it('refuses presenting after it was disposed, and shows nothing', async () => {
    const { surface, byTestId, present } = await start();
    await present('Shown');
    surface.dispose();
    await settle();
    expect(byTestId('card-root')).toEqual([]);
    expect(surface.present({ markdown: 'Late' })).toEqual({
      ok: false,
      failure: { kind: 'rejected', message: 'The surface was disposed.' },
    });
  });

  it('needs the card registered before it can be opened, and says so', () => {
    const empty = {
      get: () => undefined,
      define: () => undefined,
    };
    expect(() => registerFaithfulCard(empty)).not.toThrow();
    // `registerFaithfulCard` above ran against the global registry; opening names the missing setup
    // only when the surface tag is not the SDK's, which a fresh registry models.
    const held: CardSurface = openFaithfulCardSurface();
    expect(held.element.localName).toBe('saga-faithful-card-surface');
  });
});

/** The text the card of `surface` shows, whatever shadow roots it sits in. */
function shownText(surface: CardSurface): string {
  return queryDeep(surface.element, '[data-testid="card-content"]')
    .map((content) => content.textContent ?? '')
    .join('');
}
