// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import {
  FaithfulCardProvider,
  FaithfulCardSurface,
  openFaithfulCardSurface,
  type CardSurface,
} from './index.js';
import { trusted, type TrustedOptions } from './fixture.test-support.js';

// The card surface as an application meets it: opened once, mounted under the card's provider, and
// given content with `present`, the one operation that selects what the card shows.

let mounted: Mounted | undefined;
const surfaces: CardSurface[] = [];
afterEach(() => {
  mounted?.unmount();
  for (const surface of surfaces.splice(0)) surface.dispose();
  mounted = undefined;
});

function start(options: TrustedOptions = {}, strict = true) {
  const host = trusted(options);
  const surface = openFaithfulCardSurface();
  surfaces.push(surface);
  mounted = mount({ strict });
  mounted.render(
    createElement(FaithfulCardProvider, {
      view: host.view,
      children: createElement(FaithfulCardSurface, { of: surface }),
    }),
  );
  const view = mounted;
  const byTestId = (id: string): HTMLElement[] => [
    ...view.container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
  ];
  const present = async (markdown: unknown) => {
    let result: ReturnType<CardSurface['present']> | undefined;
    await act(async () => {
      result = surface.present({ markdown: markdown as string });
    });
    return result!;
  };
  return { host, surface, view, byTestId, present };
}

const IMAGE_MARKDOWN = 'Chart: ![chart](https://images.example.com/a.png)';
const STRICT_IMAGES: TrustedOptions = {
  level: 'strict',
  imageHosts: ['images.example.com'],
};

describe('a card surface', () => {
  it('shows nothing until content is presented, then shows it', async () => {
    const { view, byTestId, present } = start();
    expect(byTestId('card-root')).toEqual([]);
    expect(view.container.textContent).toBe('');
    expect(await present('First **answer**')).toEqual({ ok: true });
    expect(view.container.querySelector('strong')?.textContent).toBe('answer');
  });

  it('shows a new answer in place of the old one', async () => {
    const { view, present } = start();
    await present('First answer');
    await present('Second answer');
    expect(view.container.textContent).toBe('Second answer');
  });

  it('presenting equal text is a new presentation: a fresh card that has lost the old one’s state', async () => {
    const { byTestId, present, view } = start({
      level: 'strict',
    });
    await present('Text with a <b>tag</b>.');
    const before = byTestId('card-content')[0];
    press(view, byTestId('source-toggle')[0]);
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
    const { host, byTestId, present, view } = start(STRICT_IMAGES);
    await present(IMAGE_MARKDOWN);
    expect(byTestId('md-image')).toEqual([]);
    press(view, byTestId('images-toggle')[0]);
    expect(byTestId('md-image')).toHaveLength(1);
    const grant = host.consent.grant();
    expect(grant.live).toBe(true);
    await present(IMAGE_MARKDOWN);
    expect(grant.live).toBe(false);
    expect(byTestId('md-image')).toEqual([]);
    expect(byTestId('images-toggle')[0]?.textContent).toBe('Show images');
    // Revoking is not retiring: the reader may consent again to the new presentation.
    expect(host.consent.retired).toBe(false);
    press(view, byTestId('images-toggle')[0]);
    expect(byTestId('md-image')).toHaveLength(1);
  });

  it('drops a host answer that arrives after its presentation was replaced, even by equal text', async () => {
    const { host, byTestId, present, view } = start({ answer: 'pending' });
    await present('[a](https://docs.example.com/a)');
    press(view, byTestId('md-link')[0]);
    await present('[a](https://docs.example.com/a)');
    await act(async () => host.pending[0]!('opened'));
    expect(
      byTestId('md-link-status')[0]?.getAttribute('data-outcome'),
    ).toBeNull();
    expect(host.requests).toEqual(['https://docs.example.com/a']);
  });

  it('clear empties the card, ends the consent given for it, and lets the next present show again', async () => {
    const { host, byTestId, present, surface, view } = start(STRICT_IMAGES);
    await present(IMAGE_MARKDOWN);
    press(view, byTestId('images-toggle')[0]);
    const grant = host.consent.grant();
    act(() => surface.clear());
    expect(view.container.textContent).toBe('');
    expect(grant.live).toBe(false);
    await present('Back again');
    expect(view.container.textContent).toBe('Back again');
  });

  it('leaves the shown presentation as it was when content is rejected', async () => {
    const { byTestId, present, view } = start(STRICT_IMAGES);
    await present(IMAGE_MARKDOWN);
    press(view, byTestId('images-toggle')[0]);
    const shown = byTestId('card-content')[0];
    const rejected = await present(42);
    expect(rejected.ok).toBe(false);
    expect(byTestId('card-content')[0]).toBe(shown);
    expect(byTestId('md-image')).toHaveLength(1);
  });

  it('mounts and unmounts cleanly under and without Strict Mode', async () => {
    for (const strict of [true, false]) {
      const { present, view } = start({}, strict);
      await present('Shown');
      expect(view.container.textContent).toBe('Shown');
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('refuses presenting after it was disposed, and shows nothing', async () => {
    const { present, surface, view } = start();
    await present('Shown');
    act(() => surface.dispose());
    expect(view.container.textContent).toBe('');
    const after = surface.present({ markdown: 'Late' });
    expect(after.ok).toBe(false);
  });
});

function press(view: Mounted, element: HTMLElement | undefined): void {
  view.press(element as HTMLButtonElement);
}
