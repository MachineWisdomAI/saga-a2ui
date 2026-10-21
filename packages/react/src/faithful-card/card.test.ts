// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import { trusted, type TrustedOptions } from './fixture.test-support.js';
import { FaithfulCard, FaithfulCardProvider, type FaithfulCardView } from './index.js';

// Real React 19 rendering, in Strict Mode unless a test says otherwise, of the card exported for
// direct use. jsdom supplies the DOM and the clicks are real DOM clicks that React's own event
// system delivers. Nothing asserts on how the card is built: only on the document it produces,
// what the application's host adapter was asked, and what a reader could see and press.

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.restoreAllMocks();
});

const card = (markdown: unknown, contractVersion: unknown = 1): ReactElement => createElement(FaithfulCard, { markdown, contractVersion });
const under = (view: FaithfulCardView, ...children: ReactElement[]): ReactElement =>
  createElement(FaithfulCardProvider, { view, children: createElement(Fragment, null, ...children) });

function show(markdown: unknown, options: TrustedOptions = {}, strict = true) {
  const host = trusted(options);
  mounted = mount({ strict });
  mounted.render(under(host.view, card(markdown)));
  return { host, view: mounted };
}

const text = (view: Mounted): string => view.container.textContent ?? '';
const byTestId = (view: Mounted, id: string): HTMLElement[] => [...view.container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const one = (view: Mounted, id: string): HTMLElement => {
  const found = byTestId(view, id);
  if (found.length !== 1) throw new Error(`${found.length} elements are marked '${id}'`);
  return found[0]!;
};
const click = (view: Mounted, element: HTMLElement): void => view.press(element as HTMLButtonElement);

describe('rendering supplied Markdown as escaped elements', () => {
  it('shows ordinary formatting in the order it was written', () => {
    const { view } = show(
      ['# Title', '', 'First *soft* and **strong** and ~~gone~~ and `code`.', '', '> quoted', '', '1. one', '2. two', '', '- a', '- b', '', '---', '', 'Last.'].join('\n'),
    );
    const root = one(view, 'card-content');
    expect([...root.children].map((child) => child.tagName.toLowerCase())).toEqual(['h3', 'p', 'blockquote', 'ol', 'ul', 'hr', 'p']);
    expect(root.querySelector('h3')?.textContent).toBe('Title');
    expect(root.querySelector('em')?.textContent).toBe('soft');
    expect(root.querySelector('strong')?.textContent).toBe('strong');
    expect(root.querySelector('s')?.textContent).toBe('gone');
    expect(root.querySelector('p code')?.textContent).toBe('code');
    expect([...root.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['one', 'two', 'a', 'b']);
    expect(root.textContent?.indexOf('Title')).toBeLessThan(root.textContent?.indexOf('Last.') ?? -1);
  });

  it('starts card headings at level three and keeps lower levels distinct', () => {
    const { view } = show('# one\n\n## two\n\n### three\n\n#### four\n\n##### five');
    expect([...view.container.querySelectorAll('h3, h4, h5, h6')].map((heading) => `${heading.tagName.toLowerCase()}:${heading.textContent}`)).toEqual([
      'h3:one',
      'h4:two',
      'h5:three',
      'h6:four',
      'h6:five',
    ]);
    expect(view.container.querySelector('h1, h2')).toBeNull();
  });

  it('keeps markup, scripts and entities as the text that was written, never as elements', () => {
    const written = ['<script>window.pwned = 1</script>', '', 'Inline <b onclick="window.pwned = 2">bold</b> &amp; <img src=x onerror="window.pwned = 3">', '', '<div class="x">block</div>'].join('\n');
    const { view } = show(written);
    expect(view.container.querySelector('script, b, div.x, img')).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(text(view)).toContain('<script>window.pwned = 1</script>');
    expect(text(view)).toContain('<b onclick="window.pwned = 2">bold</b>');
    // An entity is text the parser decodes; it is still only text.
    expect(text(view)).toContain('& ');
  });

  it('marks every block with automatic direction so Arabic and mixed text read as written', () => {
    const arabic = 'مرحبا بالعالم';
    const { view } = show(`${arabic}\n\n> ${arabic}\n\n- ${arabic}\n\nEnglish then ${arabic}`);
    expect(text(view)).toContain(arabic);
    expect(one(view, 'card-content').querySelector('p')?.getAttribute('dir')).toBe('auto');
    expect(view.container.querySelector('blockquote')?.getAttribute('dir')).toBe('auto');
    expect(view.container.querySelector('li')?.getAttribute('dir')).toBe('auto');
    expect(text(view)).toContain('English then مرحبا بالعالم');
  });

  it('puts a wide table in its own keyboard-focusable region with labelled column headers', () => {
    const { view } = show('| Name | Count |\n| :--- | ---: |\n| apples | 3 |\n| pears | 10 | extra |');
    const region = one(view, 'md-table');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBe('Table 1');
    expect([...region.querySelectorAll('th')].map((cell) => `${cell.textContent}:${cell.getAttribute('scope')}:${cell.getAttribute('data-align')}`)).toEqual([
      'Name:col:left',
      'Count:col:right',
    ]);
    // A cell written beyond the header's width is kept, not dropped.
    expect(region.textContent).toContain('extra');
  });

  it('numbers each table in the order it appears', () => {
    const { view } = show('| a |\n| - |\n| 1 |\n\ntext\n\n| b |\n| - |\n| 2 |');
    expect(byTestId(view, 'md-table').map((region) => region.getAttribute('aria-label'))).toEqual(['Table 1', 'Table 2']);
  });
});

describe('refusing content explicitly', () => {
  it.each([
    ['too long', { contractVersion: 1, markdown: 'x'.repeat(60) }, { maxLength: 50 }, 'too-long', 'too long to display (60 characters; the limit is 50)'],
    ['too deeply nested', { contractVersion: 1, markdown: `${'> '.repeat(25)}deep` }, {}, 'too-nested', 'nested too deeply'],
    ['of an unsupported version', { contractVersion: 2, markdown: 'hello' }, {}, 'unsupported-version', 'version of the card contract'],
    ['not valid for the card', { contractVersion: 1, markdown: 5 }, {}, 'invalid', 'not valid for this card'],
    ['without a version', { contractVersion: null, markdown: 'hello' }, {}, 'unsupported-version', 'version of the card contract'],
  ])('shows an alert for content that is %s, and none of the content', (_name, supplied, options, reason, message) => {
    const host = trusted(options);
    mounted = mount();
    mounted.render(under(host.view, card(supplied.markdown, supplied.contractVersion)));
    const alert = one(mounted, 'card-failure');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('data-reason')).toBe(reason);
    expect(alert.textContent).toContain(message);
    expect(byTestId(mounted, 'card-content')).toEqual([]);
  });

  it('shows nothing of earlier content when a refusal follows, and recovers when valid content returns', () => {
    const host = trusted({ maxLength: 40 });
    mounted = mount();
    mounted.render(under(host.view, card('Earlier private answer')));
    expect(text(mounted)).toContain('Earlier private answer');
    mounted.render(under(host.view, card('y'.repeat(41))));
    expect(one(mounted, 'card-failure').getAttribute('data-reason')).toBe('too-long');
    expect(text(mounted)).not.toContain('Earlier private answer');
    mounted.render(under(host.view, card('Recovered answer')));
    expect(byTestId(mounted, 'card-failure')).toEqual([]);
    expect(text(mounted)).toContain('Recovered answer');
  });

  it('fails explicitly and inertly with no provider: nothing is interpreted, shown or requested', () => {
    mounted = mount();
    mounted.render(card('Secret [link](https://docs.example.com/)'));
    const alert = one(mounted, 'card-failure');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('data-reason')).toBe('no-view');
    expect(text(mounted)).not.toContain('Secret');
    expect(mounted.container.querySelector('button, a')).toBeNull();
  });
});

describe('Standard links', () => {
  const link = '[the guide](https://Docs.Example.com:8443/guide?a=1#top)';

  it('discloses the parsed hostname inside the control before it is used, and asks the host for nothing yet', () => {
    const { host, view } = show(`Read ${link} now.`);
    const control = one(view, 'md-link');
    expect(control.tagName).toBe('BUTTON');
    expect(control.textContent).toBe('the guide (docs.example.com)');
    expect(one(view, 'md-link-host').textContent).toBe('(docs.example.com)');
    expect(host.requests).toEqual([]);
  });

  it('sends exactly the validated absolute URL through the host callback, once per press, even in Strict Mode', async () => {
    const { host, view } = show(link);
    click(view, one(view, 'md-link'));
    await view.settle();
    expect(host.requests).toEqual(['https://docs.example.com:8443/guide?a=1#top']);
    expect(one(view, 'md-link-status').textContent).toBe('');
    expect(one(view, 'md-link-status').getAttribute('data-outcome')).toBe('opened');
  });

  it.each([
    ['denied', 'The host did not open this link.'],
    ['unavailable', 'This host cannot open links.'],
    ['failed', 'The link could not be opened.'],
    ['reject', 'The link could not be opened.'],
  ] as const)('keeps a link the host answers %s readable and inert, showing its destination as text', async (answer, sentence) => {
    const { host, view } = show(link, { answer });
    click(view, one(view, 'md-link'));
    await view.settle();
    expect(one(view, 'md-link-status').textContent).toBe(`${sentence} Destination: https://docs.example.com:8443/guide?a=1#top`);
    // The only way out is the callback: no anchor exists, and no second request is made on its own.
    expect(view.container.querySelector('a, [href]')).toBeNull();
    expect(host.requests).toHaveLength(1);
  });

  it.each([
    ['an http URL', '[x](http://docs.example.com/)', 'http://docs.example.com/'],
    ['a relative URL', '[x](/guide)', '/guide'],
    ['a URL with credentials', '[x](https://user:pass@docs.example.com/)', 'https://user:pass@docs.example.com/'],
  ])('shows %s as inert text with its destination and offers no control', async (_name, markdown, destination) => {
    const { host, view } = show(markdown);
    const inert = one(view, 'md-link-inert');
    expect(inert.textContent).toBe(`x (${destination})`);
    expect(view.container.querySelector('button, a, [href]')).toBeNull();
    click(view, inert);
    await view.settle();
    expect(host.requests).toEqual([]);
  });

  it.each([
    ['a script URL', '[x](javascript:alert(1))'],
    ['a data URL', '[x](data:text/html;base64,PGI+)'],
  ])('never even makes %s a link: the parser leaves it as the text that was written', async (_name, markdown) => {
    const { host, view } = show(markdown);
    expect(one(view, 'card-content').textContent).toBe(markdown);
    expect(view.container.querySelector('button, a, [href], [data-testid^="md-link"]')).toBeNull();
    expect(host.requests).toEqual([]);
  });

  it('keeps separate outcomes for separate links in one card', async () => {
    const host = trusted({ answer: (url) => Promise.resolve(url.includes('ok') ? 'opened' : 'denied') });
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://ok.example.com/) and [b](https://no.example.com/)')));
    const [first, second] = byTestId(mounted, 'md-link');
    click(mounted, second!);
    await mounted.settle();
    expect(byTestId(mounted, 'md-link-status').map((status) => status.getAttribute('data-outcome'))).toEqual([null, 'denied']);
    click(mounted, first!);
    await mounted.settle();
    expect(byTestId(mounted, 'md-link-status').map((status) => status.getAttribute('data-outcome'))).toEqual(['opened', 'denied']);
  });

  it('can be used from the keyboard like any button', async () => {
    const { host, view } = show(link);
    const control = one(view, 'md-link');
    control.focus();
    expect(document.activeElement).toBe(control);
    // A button's keyboard activation is the browser's own click; the control is a real, focusable button.
    expect(control.getAttribute('type')).toBe('button');
    expect(control.hasAttribute('disabled')).toBe(false);
    click(view, control);
    await view.settle();
    expect(host.requests).toHaveLength(1);
  });
});

describe('Strict links, markup and source', () => {
  const markdown = 'See [the guide](https://docs.example.com/) and <b>bold</b> text.\n\n<div>block</div>';

  it('keeps every link inert behind a placeholder, even an otherwise valid one, and never asks the host', async () => {
    const { host, view } = show(markdown, { level: 'strict' });
    const inert = one(view, 'md-link-inert');
    expect(inert.getAttribute('data-presentation')).toBe('placeholder');
    expect(inert.textContent).toBe('the guide [Link blocked]');
    expect(view.container.querySelector('a, [href]')).toBeNull();
    expect(byTestId(view, 'md-link')).toEqual([]);
    click(view, inert);
    await view.settle();
    expect(host.requests).toEqual([]);
    expect(byTestId(view, 'md-markup').map((fragment) => fragment.textContent)).toEqual(['[Markup blocked]', '[Markup blocked]', '[Markup blocked]']);
  });

  it('reveals the source as text and hides it again, without activating anything', async () => {
    const { host, view } = show(markdown, { level: 'strict' });
    const toggle = one(view, 'source-toggle');
    expect(toggle.textContent).toBe('Reveal source');
    click(view, toggle);
    expect(one(view, 'source-toggle').textContent).toBe('Hide source');
    expect(one(view, 'md-link-inert').getAttribute('data-presentation')).toBe('source');
    expect(one(view, 'md-link-inert').textContent).toBe('[the guide](https://docs.example.com/)');
    expect(text(view)).toContain('<b>');
    expect(text(view)).toContain('<div>block</div>');
    // Revealed source is inert: no element, control or request exists for it.
    expect(view.container.querySelector('a, [href], b, button[data-testid="md-link"]')).toBeNull();
    expect(one(view, 'card-content').querySelector('div')).toBeNull();
    click(view, one(view, 'md-link-inert'));
    await view.settle();
    expect(host.requests).toEqual([]);
    click(view, one(view, 'source-toggle'));
    expect(one(view, 'md-link-inert').getAttribute('data-presentation')).toBe('placeholder');
  });

  it('starts revealed as readable inert text when the trusted policy chooses that presentation', () => {
    const { view } = show(markdown, { level: 'strict', blockedPresentation: 'inert-text' });
    expect(one(view, 'md-link-inert').getAttribute('data-presentation')).toBe('source');
    expect(one(view, 'source-toggle').textContent).toBe('Hide source');
  });

  it('offers no source control when nothing was blocked, and no controls at all under Standard', () => {
    expect(byTestId(show('Just *text*.', { level: 'strict' }).view, 'card-controls')).toEqual([]);
    mounted?.unmount();
    const standard = show(markdown, { level: 'standard' });
    expect(byTestId(standard.view, 'card-controls')).toEqual([]);
  });

  it('resets the reveal when new content arrives, so one answer never reveals the next', () => {
    const host = trusted({ level: 'strict' });
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    click(mounted, one(mounted, 'source-toggle'));
    expect(one(mounted, 'md-link-inert').getAttribute('data-presentation')).toBe('source');
    mounted.render(under(host.view, card('[b](https://docs.example.com/b)')));
    expect(one(mounted, 'md-link-inert').getAttribute('data-presentation')).toBe('placeholder');
    expect(one(mounted, 'source-toggle').textContent).toBe('Reveal source');
  });
});

describe('image references', () => {
  const markdown = 'Before ![a chart](https://images.example.com/chart.png) after.';

  it('load in Standard from an exactly listed HTTPS host, with no consent, in their original position', () => {
    const { view } = show(markdown, { imageHosts: ['images.example.com'] });
    const image = one(view, 'md-image');
    expect(image.getAttribute('src')).toBe('https://images.example.com/chart.png');
    expect(image.getAttribute('alt')).toBe('a chart');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(byTestId(view, 'md-image-blocked')).toEqual([]);
    expect(byTestId(view, 'card-controls')).toEqual([]);
    expect(one(view, 'card-content').textContent).toBe('Before  after.');
  });

  it.each([
    ['a host that is not listed', 'https://other.example.com/x.png', 'host-not-allowed'],
    ['a subdomain of a listed host', 'https://cdn.images.example.com/x.png', 'host-not-allowed'],
    ['a different port', 'https://images.example.com:8443/x.png', 'host-not-allowed'],
    ['an http address', 'http://images.example.com/x.png', 'not-https'],
    ['an address with credentials', 'https://user:pass@images.example.com/x.png', 'credentials'],
    ['a relative address', '/x.png', 'malformed'],
    ['a data reference', 'data:image/png;base64,iVBORw0KGgo=', 'not-https'],
    ['a blob reference', 'blob:https://images.example.com/0f8fad5b-d9cb-469f-a165-70867728950e', 'not-https'],
  ])('stay inert text in Standard for %s', (_name, source, reason) => {
    const { view } = show(`Before ![chart](${source}) after.`, { imageHosts: ['images.example.com'] });
    expect(view.container.querySelector('img, picture, source, [src]')).toBeNull();
    const placeholder = one(view, 'md-image-blocked');
    expect(placeholder.textContent).toBe('[Image not loaded: chart]');
    expect(placeholder.getAttribute('data-reason')).toBe(reason);
  });

  it('stay inert in Standard when the document does not demonstrably carry the policy restrictions', () => {
    const { view } = show(markdown, { imageHosts: ['images.example.com'], enforcement: 'unestablished' });
    expect(view.container.querySelector('img, [src]')).toBeNull();
    expect(one(view, 'md-image-blocked').getAttribute('data-reason')).toBe('enforcement-unestablished');
  });

  it('stay inert behind a placeholder in Strict until the reader consents, and revealing the source loads nothing', () => {
    const { host, view } = show(markdown, { level: 'strict', imageHosts: ['images.example.com'] });
    expect(one(view, 'md-image-blocked').textContent).toBe('[Image blocked: a chart]');
    expect(one(view, 'md-image-blocked').getAttribute('data-reason')).toBe('consent-required');
    expect(one(view, 'images-toggle').textContent).toBe('Show images');
    click(view, one(view, 'source-toggle'));
    expect(one(view, 'md-image-blocked').textContent).toBe('![a chart](https://images.example.com/chart.png)');
    expect(view.container.querySelector('img, picture, source, [src]')).toBeNull();
    // Looking at the source is not consent, and it asks nothing of the host.
    expect(one(view, 'images-toggle').textContent).toBe('Show images');
    expect(host.requests).toEqual([]);
  });

  it('are shown in Strict after Show images and removed again by Hide images', () => {
    const { view } = show(markdown, { level: 'strict', imageHosts: ['images.example.com'] });
    click(view, one(view, 'images-toggle'));
    const image = one(view, 'md-image');
    expect(image.getAttribute('src')).toBe('https://images.example.com/chart.png');
    expect(image.getAttribute('loading')).toBe('eager');
    expect(one(view, 'images-toggle').textContent).toBe('Hide images');
    expect(one(view, 'images-status').textContent).toBe('Images shown.');
    click(view, one(view, 'images-toggle'));
    expect(view.container.querySelector('img, [src]')).toBeNull();
    expect(one(view, 'md-image-blocked').getAttribute('data-reason')).toBe('consent-required');
    expect(one(view, 'images-toggle').textContent).toBe('Show images');
    expect(one(view, 'images-status').textContent).toBe('');
  });

  it('never become an element for a data or blob reference in Strict, even after Show images', () => {
    const { view } = show(
      '![a](https://images.example.com/a.png) ![d](data:image/png;base64,iVBORw0KGgo=) ![b](blob:https://images.example.com/x)',
      { level: 'strict', imageHosts: ['images.example.com'] },
    );
    click(view, one(view, 'images-toggle'));
    expect([...view.container.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual(['https://images.example.com/a.png']);
    expect(byTestId(view, 'md-image-blocked').map((fragment) => fragment.getAttribute('data-reason'))).toEqual(['not-https', 'not-https']);
  });

  it('offer no Show images when no image could ever load, and say why', () => {
    for (const options of [
      { level: 'strict', imageHosts: [] },
      { level: 'strict', imageHosts: ['images.example.com'], enforcement: 'unestablished' },
    ] as const) {
      const { view } = show(markdown, options);
      expect(one(view, 'images-toggle').hasAttribute('disabled')).toBe(true);
      expect(one(view, 'images-unavailable').getAttribute('data-reason')).toBe('none-qualify');
      click(view, one(view, 'images-toggle'));
      expect(view.container.querySelector('img, [src]')).toBeNull();
      mounted?.unmount();
    }
  });

  it('describe an image with no alternative text readably', () => {
    const { view } = show('![](https://images.example.com/x.png)');
    expect(one(view, 'md-image-blocked').textContent).toBe('[Image not loaded: no description]');
  });
});

describe('the lifecycle of a card and its controls', () => {
  it('asks the host for nothing while rendering, however often React renders', () => {
    const { host } = show('[a](https://docs.example.com/)\n\n[b](https://docs.example.com/b)');
    expect(host.requests).toEqual([]);
  });

  it('drops a host answer that arrives after the content changed, and shows no outcome for the new content', async () => {
    const host = trusted({ answer: 'pending' });
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    click(mounted, one(mounted, 'md-link'));
    expect(host.requests).toEqual(['https://docs.example.com/a']);
    // New content with a link in the same position replaces the card's revision.
    mounted.render(under(host.view, card('[b](https://docs.example.com/b)')));
    await act(async () => host.pending[0]!('denied'));
    expect(one(mounted, 'md-link-status').textContent).toBe('');
    expect(one(mounted, 'md-link-status').getAttribute('data-outcome')).toBeNull();
  });

  it('does not show an outcome the host answered for content that returned later', async () => {
    const host = trusted({ answer: 'pending' });
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    click(mounted, one(mounted, 'md-link'));
    mounted.render(under(host.view, card('other')));
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    await act(async () => host.pending[0]!('opened'));
    expect(one(mounted, 'md-link-status').textContent).toBe('');
  });

  it('shows the outcome of the latest press for the current content', async () => {
    const host = trusted({ answer: 'pending' });
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    click(mounted, one(mounted, 'md-link'));
    await act(async () => host.pending[0]!('opened'));
    expect(one(mounted, 'md-link-status').textContent).toBe('');
  });

  it('forgets earlier outcomes when new content arrives', async () => {
    const host = trusted();
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    click(mounted, one(mounted, 'md-link'));
    await mounted.settle();
    expect(one(mounted, 'md-link-status').getAttribute('data-outcome')).toBe('opened');
    mounted.render(under(host.view, card('[b](https://docs.example.com/b)')));
    expect(one(mounted, 'md-link-status').getAttribute('data-outcome')).toBeNull();
  });

  it('ignores an answer that arrives after the card was removed, without any React complaint', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = trusted({ answer: 'pending' });
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    click(mounted, one(mounted, 'md-link'));
    mounted.render(under(host.view));
    expect(byTestId(mounted, 'md-link')).toEqual([]);
    await act(async () => host.pending[0]!('opened'));
    expect(error).not.toHaveBeenCalled();
  });

  it('starts from fresh state when the application replaces its trusted view', async () => {
    const first = trusted({ answer: 'pending' });
    mounted = mount();
    mounted.render(under(first.view, card('[a](https://docs.example.com/a)\n\n<i>x</i>')));
    click(mounted, one(mounted, 'md-link'));
    const second = trusted({ level: 'strict' });
    mounted.render(under(second.view, card('[a](https://docs.example.com/a)\n\n<i>x</i>')));
    // The new policy governs at once: the link is a placeholder, and the old host is never answered into it.
    expect(byTestId(mounted, 'md-link')).toEqual([]);
    expect(one(mounted, 'md-link-inert').getAttribute('data-presentation')).toBe('placeholder');
    await act(async () => first.pending[0]!('opened'));
    expect(text(mounted)).not.toContain('The host was asked');
    expect(second.requests).toEqual([]);
  });

  it('keeps its state across re-renders that hand the provider an equal view', async () => {
    const host = trusted();
    mounted = mount();
    mounted.render(under(host.view, card('[a](https://docs.example.com/a)')));
    click(mounted, one(mounted, 'md-link'));
    await mounted.settle();
    mounted.render(under({ ...host.view }, card('[a](https://docs.example.com/a)')));
    expect(one(mounted, 'md-link-status').getAttribute('data-outcome')).toBe('opened');
  });

  it('keeps several cards apart: each has its own view, outcomes and revealed source', async () => {
    const standard = trusted({ answer: 'denied' });
    const strict = trusted({ level: 'strict' });
    mounted = mount();
    mounted.render(
      createElement(
        Fragment,
        null,
        createElement('section', { 'data-card': 'one' }, under(standard.view, card('[a](https://docs.example.com/a)'))),
        createElement('section', { 'data-card': 'two' }, under(strict.view, card('[b](https://docs.example.com/b)'))),
        createElement('section', { 'data-card': 'three' }, under(strict.view, card('[c](https://docs.example.com/c)'))),
      ),
    );
    const section = (name: string): HTMLElement => mounted!.container.querySelector<HTMLElement>(`[data-card="${name}"]`)!;
    click(mounted, section('one').querySelector<HTMLElement>('[data-testid="md-link"]')!);
    await mounted.settle();
    click(mounted, section('two').querySelector<HTMLElement>('[data-testid="source-toggle"]')!);
    expect(section('one').querySelector('[data-testid="md-link-status"]')?.getAttribute('data-outcome')).toBe('denied');
    expect(section('two').querySelector('[data-testid="md-link-inert"]')?.getAttribute('data-presentation')).toBe('source');
    expect(section('three').querySelector('[data-testid="md-link-inert"]')?.getAttribute('data-presentation')).toBe('placeholder');
    expect(standard.requests).toEqual(['https://docs.example.com/a']);
    expect(strict.requests).toEqual([]);
  });
});
