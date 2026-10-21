// @vitest-environment jsdom
import { A2uiSurface } from '@a2ui/react/v0_9';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import {
  dataUpdate,
  layout,
  openSession,
  SURFACE_ID,
  surfaceUnder,
  trusted,
  type Session,
} from './fixture.test-support.js';

// The card through real A2UI: a real message session, the published `@a2ui/react` `A2uiSurface`,
// an application catalog that lists `faithfulCardEntry`, and a React root in Strict Mode. Data
// reaches the card only by A2UI binding, so replacement, failure, disposal and the lifecycle of
// controls are exercised the way an application meets them.

let mounted: Mounted | undefined;
const sessions: Session[] = [];
afterEach(() => {
  mounted?.unmount();
  for (const session of sessions.splice(0)) session.dispose();
  mounted = undefined;
  vi.restoreAllMocks();
});

function start(
  messages: unknown[],
  options: Parameters<typeof trusted>[0] = {},
  strict = true,
) {
  const session = openSession(messages);
  sessions.push(session);
  const host = trusted(options);
  mounted = mount({ strict });
  mounted.render(surfaceUnder(host.view, session.surface));
  return { session, host, view: mounted };
}

const byTestId = (view: Mounted, id: string): HTMLElement[] => [
  ...view.container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const text = (view: Mounted): string => view.container.textContent ?? '';
const press = (view: Mounted, element: HTMLElement | undefined): void =>
  view.press(element as HTMLButtonElement);
const bound = [
  {
    id: 'card',
    markdown: { path: '/answer' },
    contractVersion: { path: '/version' },
  },
];
const answer = (markdown: unknown, version: unknown = 1) =>
  dataUpdate({ answer: markdown, version });

describe('a card in an A2UI surface', () => {
  it('renders what the data model supplies and replaces it, in place, when the model changes', async () => {
    const { session, view } = start([
      ...layout(bound),
      ...answer('First **answer**'),
    ]);
    expect(byTestId(view, 'card-content')).toHaveLength(1);
    expect(view.container.querySelector('strong')?.textContent).toBe('answer');
    await act(async () =>
      session.ingest(
        answer('Second answer with [a link](https://docs.example.com/)'),
      ),
    );
    expect(text(view)).not.toContain('First');
    expect(view.container.querySelector('strong')).toBeNull();
    expect(byTestId(view, 'md-link')).toHaveLength(1);
    expect(byTestId(view, 'card-content')).toHaveLength(1);
  });

  it('shows a refusal in place of the content and recovers with the next valid value', async () => {
    const { session, view } = start(
      [...layout(bound), ...answer('Earlier private answer')],
      { maxLength: 30 },
    );
    await act(async () => session.ingest(answer('z'.repeat(31))));
    expect(byTestId(view, 'card-failure')[0]?.getAttribute('data-reason')).toBe(
      'too-long',
    );
    expect(text(view)).not.toContain('Earlier');
    await act(async () => session.ingest(answer('fine', 2)));
    expect(byTestId(view, 'card-failure')[0]?.getAttribute('data-reason')).toBe(
      'unsupported-version',
    );
    await act(async () => session.ingest(answer({ not: 'a string' })));
    expect(byTestId(view, 'card-failure')).toHaveLength(1);
    await act(async () => session.ingest(answer('Recovered')));
    expect(byTestId(view, 'card-failure')).toEqual([]);
    expect(text(view)).toContain('Recovered');
  });

  it('refuses a card that tries to supply its own dialect, bound, action or handler, so no layout can choose them', () => {
    const session = openSession(layout([{ id: 'card', markdown: 'hello' }]));
    sessions.push(session);
    for (const extra of [
      { dialect: 'commonmark' },
      { maxLength: 10 },
      { action: { event: { name: 'x' } } },
      { handler: 'save' },
      { html: '<b>' },
    ]) {
      const result = session.tryIngest([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: SURFACE_ID,
            components: [
              { id: 'root', component: 'Column', children: ['card'] },
              {
                id: 'card',
                component: 'FaithfulCard',
                contractVersion: 1,
                markdown: 'x',
                ...extra,
              },
            ],
          },
        },
      ]);
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  it('shows the explicit inert failure when the application mounted the surface without a provider', () => {
    const session = openSession([
      ...layout(bound),
      ...answer('Private [link](https://docs.example.com/)'),
    ]);
    sessions.push(session);
    mounted = mount();
    mounted.render(createElement(A2uiSurface, { surface: session.surface }));
    expect(
      byTestId(mounted, 'card-failure')[0]?.getAttribute('data-reason'),
    ).toBe('no-view');
    expect(text(mounted)).not.toContain('Private');
    expect(mounted.container.querySelector('button')).toBeNull();
  });

  it('rebuilds cleanly when a component update replaces the card, and drops the old card with its controls', async () => {
    const { session, host, view } = start([
      ...layout(bound),
      ...answer('[old](https://docs.example.com/old)'),
    ]);
    const oldLink = byTestId(view, 'md-link')[0]!;
    await act(async () =>
      session.ingest([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: SURFACE_ID,
            components: [{ id: 'card', component: 'Text', text: 'plain now' }],
          },
        },
      ]),
    );
    expect(byTestId(view, 'card-root')).toEqual([]);
    expect(text(view)).toContain('plain now');
    expect(oldLink.isConnected).toBe(false);
    press(view, oldLink);
    await view.settle();
    expect(host.requests).toEqual([]);
    // Putting a card back starts it afresh: nothing of the old card's state returns.
    await act(async () =>
      session.ingest([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: SURFACE_ID,
            components: [
              {
                id: 'card',
                component: 'FaithfulCard',
                contractVersion: 1,
                markdown: { path: '/answer' },
              },
            ],
          },
        },
      ]),
    );
    expect(
      byTestId(view, 'md-link-status')[0]?.getAttribute('data-outcome'),
    ).toBeNull();
  });

  it('removes the card when the application unmounts its surface: no control can act afterwards', async () => {
    const { host, view } = start([
      ...layout(bound),
      ...answer('[a](https://docs.example.com/a) and <i>x</i>'),
    ]);
    const control = byTestId(view, 'md-link')[0]!;
    view.render(createElement('p', null, 'the surface is gone'));
    expect(byTestId(view, 'card-root')).toEqual([]);
    expect(control.isConnected).toBe(false);
    press(view, control);
    await view.settle();
    expect(host.requests).toEqual([]);
  });

  it('retires a control the moment A2UI disposes its node, even before React has unmounted it', async () => {
    const { session, host, view } = start([
      ...layout(bound),
      ...answer('[a](https://docs.example.com/a)'),
    ]);
    const control = byTestId(view, 'md-link')[0]!;
    // The resolver disposes the replaced node synchronously; React learns of it on its next
    // render, which has not happened yet.
    session.ingest([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [{ id: 'card', component: 'Text', text: 'replaced' }],
        },
      },
    ]);
    expect(control.isConnected).toBe(true);
    press(view, control);
    await view.settle();
    expect(host.requests).toEqual([]);
    expect(byTestId(view, 'card-root')).toEqual([]);
  });

  it('shows a late host answer only for the content it was asked about', async () => {
    const { session, host, view } = start(
      [...layout(bound), ...answer('[a](https://docs.example.com/a)')],
      { answer: 'pending' },
    );
    press(view, byTestId(view, 'md-link')[0]);
    await act(async () =>
      session.ingest(answer('[b](https://docs.example.com/b)')),
    );
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
    const { session, host, view } = start(
      [
        ...layout(cards),
        ...dataUpdate({
          one: '[a](https://docs.example.com/a)',
          two: '[b](https://docs.example.com/b)',
        }),
      ],
      {
        answer: (url) =>
          Promise.resolve(url.endsWith('/a') ? 'denied' : 'opened'),
      },
    );
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
    await act(async () =>
      session.ingest([
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: SURFACE_ID,
            path: '/one',
            value: 'Only text now',
          },
        },
      ]),
    );
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
        [...layout(bound), ...answer('[a](https://docs.example.com/a)')],
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
    const { session, view } = start(
      [...layout(bound), ...answer('[a](https://docs.example.com/a)')],
      { level: 'strict' },
    );
    press(view, byTestId(view, 'source-toggle')[0]);
    expect(
      byTestId(view, 'md-link-inert')[0]?.getAttribute('data-presentation'),
    ).toBe('source');
    await act(async () =>
      session.ingest(answer('[b](https://docs.example.com/b)')),
    );
    expect(
      byTestId(view, 'md-link-inert')[0]?.getAttribute('data-presentation'),
    ).toBe('placeholder');
    expect(byTestId(view, 'md-link')).toEqual([]);
  });
});
