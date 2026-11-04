// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import { FaithfulCardProvider, useHostLink } from './index.js';
import { trusted, type TrustedOptions } from './fixture.test-support.js';

// The host-link helper for a link an application renders itself (for example in its own chrome),
// held to the rules of the card's own links: the policy decides at activation, the host is asked
// once per activation, and an answer for a link that has since been replaced is dropped.

const URL_A = 'https://docs.example.com/a';
const URL_B = 'https://docs.example.com/b';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function Probe(props: { readonly url: string }): ReactElement {
  const link = useHostLink(props.url);
  return createElement(
    'div',
    null,
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'open',
        'data-allowed': String(link.allowed),
        onClick: () => void link.open(),
      },
      'open',
    ),
    createElement(
      'span',
      { 'data-testid': 'status', 'data-kind': link.outcome?.kind },
      link.outcome?.message,
    ),
  );
}

function start(url: string, options: TrustedOptions = {}) {
  const host = trusted(options);
  mounted = mount();
  const show = (shown: string) =>
    mounted!.render(
      createElement(FaithfulCardProvider, {
        view: host.view,
        children: createElement(Probe, { url: shown }),
      }),
    );
  show(url);
  const query = (id: string) =>
    mounted!.container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  return { host, show, query, view: mounted };
}

describe('the host-link helper', () => {
  it('reports a link the policy allows, and asks the host exactly once per activation', async () => {
    const { host, query, view } = start(URL_A);
    expect(query('open').dataset.allowed).toBe('true');
    expect(host.requests).toEqual([]);
    view.press(query('open') as HTMLButtonElement);
    await view.settle();
    expect(host.requests).toEqual([URL_A]);
    expect(query('status').dataset.kind).toBe('opened');
  });

  it('under Strict allows nothing and never reaches the host', async () => {
    const { host, query, view } = start(URL_A, { level: 'strict' });
    expect(query('open').dataset.allowed).toBe('false');
    view.press(query('open') as HTMLButtonElement);
    await view.settle();
    expect(host.requests).toEqual([]);
    expect(query('status').dataset.kind).toBeUndefined();
  });

  it('allows nothing the policy refuses, such as a link that is not HTTPS', async () => {
    const { host, query, view } = start('http://docs.example.com/a');
    expect(query('open').dataset.allowed).toBe('false');
    view.press(query('open') as HTMLButtonElement);
    await view.settle();
    expect(host.requests).toEqual([]);
  });

  it('words a refusal with the destination, as the card does', async () => {
    const { query, view } = start(URL_A, { answer: 'denied' });
    view.press(query('open') as HTMLButtonElement);
    await view.settle();
    expect(query('status').dataset.kind).toBe('denied');
    expect(query('status').textContent).toBe(
      `The host did not open this link. Destination: ${URL_A}`,
    );
  });

  it('reports a host adapter that rejects as failed', async () => {
    const { query, view } = start(URL_A, { answer: 'reject' });
    view.press(query('open') as HTMLButtonElement);
    await view.settle();
    expect(query('status').dataset.kind).toBe('failed');
  });

  it('drops a late answer once the link it was asked about has been replaced', async () => {
    const { host, show, query, view } = start(URL_A, { answer: 'pending' });
    view.press(query('open') as HTMLButtonElement);
    show(URL_B);
    await act(async () => host.pending[0]!('opened'));
    expect(query('status').dataset.kind).toBeUndefined();
    expect(host.requests).toEqual([URL_A]);
  });

  it('drops a late answer after the view selects new content, and forgets the earlier outcome', async () => {
    const { host, query, view } = start(URL_A, { answer: 'pending' });
    view.press(query('open') as HTMLButtonElement);
    act(() => host.consent.revokeAll());
    await act(async () => host.pending[0]!('opened'));
    expect(query('status').dataset.kind).toBeUndefined();
  });

  it('drops a late answer after unmount without failing', async () => {
    const { host, query, view } = start(URL_A, { answer: 'pending' });
    view.press(query('open') as HTMLButtonElement);
    const problems = vi.spyOn(console, 'error').mockImplementation(() => {});
    view.unmount();
    mounted = undefined;
    await act(async () => host.pending[0]!('opened'));
    expect(problems).not.toHaveBeenCalled();
    expect(host.requests).toEqual([URL_A]);
    problems.mockRestore();
  });

  it('outside a provider allows nothing and does not throw', async () => {
    mounted = mount();
    mounted.render(createElement(Probe, { url: URL_A }));
    const open = mounted.container.querySelector<HTMLButtonElement>(
      '[data-testid="open"]',
    )!;
    expect(open.dataset.allowed).toBe('false');
    mounted.press(open);
    await mounted.settle();
  });
});
