// @vitest-environment jsdom
import { LitElement, html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindHostLink,
  provideContentView,
  type HostLinkBinding,
} from './index.js';
import {
  settle,
  trusted,
  type TrustedOptions,
} from './fixture.test-support.js';

// The host-link helper for a link an application renders itself (for example in its own chrome),
// held to the rules of the card's own links: the policy decides at activation, the host is asked
// once per activation, and an answer for a link that has since been replaced is dropped.

const URL_A = 'https://docs.example.com/a';
const URL_B = 'https://docs.example.com/b';

class LinkProbe extends LitElement {
  link?: HostLinkBinding;
  protected override createRenderRoot(): HTMLElement {
    return this;
  }
  protected override render() {
    const link = this.link;
    return html`<button
        data-testid="open"
        data-allowed=${String(link?.allowed)}
        @click=${() => void link?.open()}
      >
        open
      </button>
      <span data-testid="status" data-kind=${link?.outcome?.kind ?? ''}
        >${link?.outcome?.message ?? ''}</span
      >`;
  }
}
customElements.define('link-probe', LinkProbe);

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

async function start(
  url: string,
  options: TrustedOptions = {},
  provided = true,
) {
  const host = trusted(options);
  const container = document.createElement('main');
  const end = provided ? provideContentView(container, host.view) : () => {};
  const probe = new LinkProbe();
  container.append(probe);
  document.body.append(container);
  probe.link = bindHostLink(probe, url);
  cleanup.push(() => {
    end();
    container.remove();
  });
  await probe.updateComplete;
  const query = (id: string) =>
    probe.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  const press = async () => {
    query('open').click();
    await settle();
    await probe.updateComplete;
  };
  return { host, probe, container, query, press };
}

describe('the Lit host-link helper', () => {
  it('reports a link the policy allows, and asks the host exactly once per activation', async () => {
    const { host, query, press } = await start(URL_A);
    expect(query('open').dataset.allowed).toBe('true');
    expect(host.requests).toEqual([]);
    await press();
    expect(host.requests).toEqual([URL_A]);
    expect(query('status').dataset.kind).toBe('opened');
  });

  it('under Strict allows nothing and never reaches the host', async () => {
    const { host, query, press } = await start(URL_A, { level: 'strict' });
    expect(query('open').dataset.allowed).toBe('false');
    await press();
    expect(host.requests).toEqual([]);
    expect(query('status').dataset.kind).toBe('');
  });

  it('allows nothing the policy refuses, such as a link that is not HTTPS', async () => {
    const { host, query, press } = await start('http://docs.example.com/a');
    expect(query('open').dataset.allowed).toBe('false');
    await press();
    expect(host.requests).toEqual([]);
  });

  it('words a refusal with the destination, as the card does', async () => {
    const { query, press } = await start(URL_A, { answer: 'denied' });
    await press();
    expect(query('status').dataset.kind).toBe('denied');
    expect(query('status').textContent).toBe(
      `The host did not open this link. Destination: ${URL_A}`,
    );
  });

  it('reports a host adapter that rejects as failed', async () => {
    const { query, press } = await start(URL_A, { answer: 'reject' });
    await press();
    expect(query('status').dataset.kind).toBe('failed');
  });

  it('drops a late answer once the binding it was asked through has been released', async () => {
    const { host, probe, query, press } = await start(URL_A, {
      answer: 'pending',
    });
    await press();
    probe.link?.release();
    probe.link = bindHostLink(probe, URL_B);
    host.pending[0]!('opened');
    await settle();
    await probe.updateComplete;
    expect(query('status').dataset.kind).toBe('');
    expect(probe.link.outcome).toBeUndefined();
    expect(host.requests).toEqual([URL_A]);
  });

  it('drops a late answer after the view selects new content, and forgets the earlier outcome', async () => {
    const { host, query, press } = await start(URL_A, { answer: 'pending' });
    await press();
    host.consent.revokeAll();
    host.pending[0]!('opened');
    await settle();
    expect(query('status').dataset.kind).toBe('');
  });

  it('forgets an outcome shown when the view selects new content', async () => {
    const { host, probe, query, press } = await start(URL_A);
    await press();
    expect(query('status').dataset.kind).toBe('opened');
    host.consent.revokeAll();
    await probe.updateComplete;
    expect(query('status').dataset.kind).toBe('');
  });

  it('drops a late answer after the element was removed, without failing', async () => {
    const { host, probe, press } = await start(URL_A, { answer: 'pending' });
    await press();
    probe.remove();
    host.pending[0]!('opened');
    await settle();
    expect(probe.link?.outcome).toBeUndefined();
    expect(host.requests).toEqual([URL_A]);
  });

  it('outside a view allows nothing and does not throw', async () => {
    const { host, query, press } = await start(URL_A, {}, false);
    expect(query('open').dataset.allowed).toBe('false');
    await press();
    expect(host.requests).toEqual([]);
  });
});
