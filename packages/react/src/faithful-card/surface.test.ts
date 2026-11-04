// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { openSurface, Surface, type BoundSurface } from '../a2ui.js';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import {
  answerCard,
  answerData,
  CATALOG_ID,
  catalog,
  openCards,
  SURFACE_ID,
  surfaceUnder,
  trusted,
  type CardData,
  type CardSpec,
} from './fixture.test-support.js';

// The card through a bound surface: a layout opened by `openSurface` over an application catalog
// that lists `faithfulCardEntry`, rendered by `<Surface>` under the card's provider in Strict
// Mode. Data reaches the card only by A2UI binding, so replacement, failure, disposal and the
// lifecycle of controls are exercised the way an application meets them. Replacing a component
// through the raw protocol is layer A and lives in `surface-protocol.test.ts`.

let mounted: Mounted | undefined;
const surfaces: BoundSurface<CardData>[] = [];
afterEach(() => {
  mounted?.unmount();
  for (const surface of surfaces.splice(0)) surface.dispose();
  mounted = undefined;
  vi.restoreAllMocks();
});

function start(
  cards: readonly CardSpec[],
  data: CardData,
  options: Parameters<typeof trusted>[0] = {},
  strict = true,
) {
  const surface = openCards(cards, data);
  surfaces.push(surface);
  const host = trusted(options);
  mounted = mount({ strict });
  mounted.render(surfaceUnder(host.view, surface.handle));
  return { surface, host, view: mounted };
}

/** An update as the application makes it; the surface accepts it. */
async function change(
  surface: BoundSurface<CardData>,
  data: CardData,
): Promise<void> {
  await act(async () => {
    expect(surface.update(data)).toEqual({ ok: true });
  });
}

const byTestId = (view: Mounted, id: string): HTMLElement[] => [
  ...view.container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const text = (view: Mounted): string => view.container.textContent ?? '';
const press = (view: Mounted, element: HTMLElement | undefined): void =>
  view.press(element as HTMLButtonElement);
describe('a card in a bound surface', () => {
  it('renders what the data model supplies and replaces it, in place, when the model changes', async () => {
    const { surface, view } = start(
      [answerCard],
      answerData('First **answer**'),
    );
    expect(byTestId(view, 'card-content')).toHaveLength(1);
    expect(view.container.querySelector('strong')?.textContent).toBe('answer');
    const mountedContent = byTestId(view, 'card-content')[0];
    await change(
      surface,
      answerData('Second answer with [a link](https://docs.example.com/)'),
    );
    expect(text(view)).not.toContain('First');
    expect(view.container.querySelector('strong')).toBeNull();
    expect(byTestId(view, 'md-link')).toHaveLength(1);
    expect(byTestId(view, 'card-content')).toHaveLength(1);
    // An ordinary data update is applied in place: the mounted content is the same element.
    expect(byTestId(view, 'card-content')[0]).toBe(mountedContent);
  });

  it('opens a layout whose root is the card, and validates each update against the layout', async () => {
    const layout = defineSurface({
      surfaceId: SURFACE_ID,
      catalogId: CATALOG_ID,
      data: z.object({ contractVersion: z.literal(1), markdown: z.string() }),
      initial: { contractVersion: 1, markdown: 'Waiting.' },
      root: {
        component: 'FaithfulCard',
        bind: { contractVersion: 'contractVersion', markdown: 'markdown' },
      },
    });
    const surface = openSurface(layout, catalog);
    surfaces.push(surface as BoundSurface<CardData>);
    mounted = mount();
    mounted.render(surfaceUnder(trusted().view, surface.handle));
    expect(text(mounted)).toContain('Waiting.');

    await act(async () => {
      expect(
        surface.update({ contractVersion: 1, markdown: '**Done**' }),
      ).toEqual({ ok: true });
    });
    expect(mounted.container.querySelector('strong')?.textContent).toBe('Done');

    // The layout allowed only contract version 1: the schema refuses 2 before the card sees it.
    const refused = surface.update({
      contractVersion: 2,
      markdown: 'x',
    } as never);
    expect(refused.ok).toBe(false);
    expect(mounted.container.querySelector('strong')?.textContent).toBe('Done');
  });

  it('shows a refusal in place of the content and recovers with the next valid value', async () => {
    const { surface, view } = start(
      [answerCard],
      answerData('Earlier private answer'),
      { maxLength: 30 },
    );
    await change(surface, answerData('z'.repeat(31)));
    expect(byTestId(view, 'card-failure')[0]?.getAttribute('data-reason')).toBe(
      'too-long',
    );
    expect(text(view)).not.toContain('Earlier');
    await change(surface, answerData('fine', 2));
    expect(byTestId(view, 'card-failure')[0]?.getAttribute('data-reason')).toBe(
      'unsupported-version',
    );
    await change(surface, answerData({ not: 'a string' }));
    expect(byTestId(view, 'card-failure')).toHaveLength(1);
    await change(surface, answerData('Recovered'));
    expect(byTestId(view, 'card-failure')).toEqual([]);
    expect(text(view)).toContain('Recovered');
  });

  it('refuses a card that tries to supply its own dialect, bound, action or handler, so no layout can choose them', () => {
    for (const extra of [
      { dialect: 'commonmark' },
      { maxLength: 10 },
      { action: { event: { name: 'x' } } },
      { handler: 'save' },
      { html: '<b>' },
    ]) {
      const layout = defineSurface({
        surfaceId: SURFACE_ID,
        catalogId: CATALOG_ID,
        data: z.object({}),
        initial: {},
        root: {
          component: 'FaithfulCard',
          bind: {},
          props: { contractVersion: 1, markdown: 'x', ...extra },
        },
      });
      expect(
        () => openSurface(layout, catalog),
        JSON.stringify(extra),
      ).toThrow();
    }
  });

  it('shows the explicit inert failure when the application mounted the surface without a provider', () => {
    const surface = openCards(
      [answerCard],
      answerData('Private [link](https://docs.example.com/)'),
    );
    surfaces.push(surface);
    mounted = mount();
    mounted.render(createElement(Surface, { of: surface.handle }));
    expect(
      byTestId(mounted, 'card-failure')[0]?.getAttribute('data-reason'),
    ).toBe('no-view');
    expect(text(mounted)).not.toContain('Private');
    expect(mounted.container.querySelector('button')).toBeNull();
  });

  it('removes the card when the application unmounts its surface: no control can act afterwards', async () => {
    const { host, view } = start(
      [answerCard],
      answerData('[a](https://docs.example.com/a) and <i>x</i>'),
    );
    const control = byTestId(view, 'md-link')[0]!;
    view.render(createElement('p', null, 'the surface is gone'));
    expect(byTestId(view, 'card-root')).toEqual([]);
    expect(control.isConnected).toBe(false);
    press(view, control);
    await view.settle();
    expect(host.requests).toEqual([]);
  });

  it('removes the card when the application disposes its surface: no control can act afterwards', async () => {
    const { surface, host, view } = start(
      [answerCard],
      answerData('[a](https://docs.example.com/a)'),
    );
    const control = byTestId(view, 'md-link')[0]!;
    act(() => surface.dispose());
    expect(byTestId(view, 'card-root')).toEqual([]);
    press(view, control);
    await view.settle();
    expect(host.requests).toEqual([]);
  });

  it('shows a late host answer only for the content it was asked about', async () => {
    const { surface, host, view } = start(
      [answerCard],
      answerData('[a](https://docs.example.com/a)'),
      { answer: 'pending' },
    );
    press(view, byTestId(view, 'md-link')[0]);
    await change(surface, answerData('[b](https://docs.example.com/b)'));
    await act(async () => host.pending[0]!('opened'));
    expect(
      byTestId(view, 'md-link-status')[0]?.getAttribute('data-outcome'),
    ).toBeNull();
    expect(host.requests).toEqual(['https://docs.example.com/a']);
  });

  it('keeps several cards in one surface independent, including each one’s data, outcome and source', async () => {
    const cards = [
      { id: 'one', markdown: { path: '/one' } },
      { id: 'two', markdown: { path: '/two' } },
      { id: 'three', markdown: 'Fixed [c](https://docs.example.com/c)' },
    ];
    const data = {
      one: '[a](https://docs.example.com/a)',
      two: '[b](https://docs.example.com/b)',
    };
    const { surface, host, view } = start(cards, data, {
      answer: (url) =>
        Promise.resolve(url.endsWith('/a') ? 'denied' : 'opened'),
    });
    const links = byTestId(view, 'md-link');
    expect(links).toHaveLength(3);
    press(view, links[0]);
    await view.settle();
    press(view, links[2]);
    await view.settle();
    expect(
      byTestId(view, 'md-link-status').map((status) =>
        status.getAttribute('data-outcome'),
      ),
    ).toEqual(['denied', null, 'opened']);
    // Replacing one card's data changes only that card.
    await change(surface, { ...data, one: 'Only text now' });
    expect(
      byTestId(view, 'md-link-status').map((status) =>
        status.getAttribute('data-outcome'),
      ),
    ).toEqual([null, 'opened']);
    expect(host.requests).toEqual([
      'https://docs.example.com/a',
      'https://docs.example.com/c',
    ]);
  });

  it('is rendered once per press and never during render under Strict Mode or a plain root', async () => {
    for (const strict of [true, false]) {
      const { host, view } = start(
        [answerCard],
        answerData('[a](https://docs.example.com/a)'),
        {},
        strict,
      );
      expect(host.requests).toEqual([]);
      press(view, byTestId(view, 'md-link')[0]);
      await view.settle();
      expect(host.requests, `strict=${strict}`).toEqual([
        'https://docs.example.com/a',
      ]);
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('keeps Strict content policy and source visibility per card through data updates', async () => {
    const { surface, view } = start(
      [answerCard],
      answerData('[a](https://docs.example.com/a)'),
      { level: 'strict' },
    );
    press(view, byTestId(view, 'source-toggle')[0]);
    expect(
      byTestId(view, 'md-link-inert')[0]?.getAttribute('data-presentation'),
    ).toBe('source');
    await change(surface, answerData('[b](https://docs.example.com/b)'));
    expect(
      byTestId(view, 'md-link-inert')[0]?.getAttribute('data-presentation'),
    ).toBe('placeholder');
    expect(byTestId(view, 'md-link')).toEqual([]);
  });
});
