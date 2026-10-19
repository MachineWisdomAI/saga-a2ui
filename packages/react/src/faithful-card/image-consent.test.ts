// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImageConsent, ImageConsentScope } from '@saga-a2ui/components/faithful-card';
import { mount, type Mounted } from '../actions/fixture.test-support.js';
import { dataUpdate, layout, openSession, surfaceUnder, trusted, type Session, type TrustedOptions } from './fixture.test-support.js';
import { FaithfulCard, FaithfulCardProvider, type FaithfulCardView } from './index.js';

// Image consent across React updates, through the public card and the A2UI catalog entry. The
// consent scope belongs to the application: these tests play the application, revoking and retiring
// it, and watch what the scope is asked to do. They assert what a reader sees (elements and their
// addresses), what the scope was asked for, and what a control kept after its card moved on does.

let mounted: Mounted | undefined;
const sessions: Session[] = [];
afterEach(() => {
  mounted?.unmount();
  for (const session of sessions.splice(0)) session.dispose();
  mounted = undefined;
});

const IMAGE = 'https://images.example.com/chart.png';
const IMAGE_B = 'https://images.example.com/other.png';
const strictOptions: TrustedOptions = { level: 'strict', imageHosts: ['images.example.com'] };
const withImage = (url = IMAGE): string => `See [guide](https://docs.example.com/) and ![chart](${url}).`;

/** Records what a card asks of its scope, and forwards it, so the scope's real behavior still applies. */
interface Watched {
  readonly scope: ImageConsentScope;
  readonly grants: ImageConsent[];
  /** Subscribers that have subscribed and not yet unsubscribed. */
  active(): number;
  readonly calls: { revokeAll: number; retire: number };
}
function watch(scope: ImageConsentScope): Watched {
  const grants: ImageConsent[] = [];
  const calls = { revokeAll: 0, retire: 0 };
  let active = 0;
  const watched: ImageConsentScope = {
    grant() {
      const grant = scope.grant();
      grants.push(grant);
      return grant;
    },
    revokeAll() {
      calls.revokeAll += 1;
      scope.revokeAll();
    },
    retire() {
      calls.retire += 1;
      scope.retire();
    },
    get retired() {
      return scope.retired;
    },
    subscribe(onRevokeAll) {
      active += 1;
      const subscription = scope.subscribe(onRevokeAll);
      let released = false;
      return {
        unsubscribe() {
          if (!released) active -= 1;
          released = true;
          subscription.unsubscribe();
        },
      };
    },
  };
  return { scope: watched, grants, active: () => active, calls };
}

/** A trusted view whose scope is watched; the application's own scope stays reachable as `app`. */
function watchedView(options: TrustedOptions = strictOptions) {
  const host = trusted(options);
  const watched = watch(host.consent);
  const view: FaithfulCardView = { ...host.view, consent: watched.scope };
  return { host, watched, view, app: host.consent };
}

const under = (view: FaithfulCardView, ...children: ReactElement[]): ReactElement =>
  createElement(FaithfulCardProvider, { view, children: createElement(Fragment, null, ...children) });
const card = (markdown: unknown, key?: string): ReactElement => createElement(FaithfulCard, { markdown, contractVersion: 1, key });

const byTestId = (root: ParentNode, id: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const one = (root: ParentNode, id: string): HTMLElement => {
  const found = byTestId(root, id);
  if (found.length !== 1) throw new Error(`${found.length} elements are marked '${id}'`);
  return found[0]!;
};
const sources = (root: ParentNode): Array<string | null> => [...root.querySelectorAll('img')].map((image) => image.getAttribute('src'));
const press = (view: Mounted, element: HTMLElement): void => view.press(element as HTMLButtonElement);
const showImages = (view: Mounted, root: ParentNode = view.container): void => press(view, one(root, 'images-toggle'));

describe('consent made and given back by a card', () => {
  it('asks the scope for nothing and subscribes only after commit, however often React renders', () => {
    const { watched, view } = watchedView();
    mounted = mount({ strict: true });
    mounted.render(under(view, card(withImage())));
    expect(watched.grants).toEqual([]);
    // One card holds one subscription, even though Strict Mode replayed its mount.
    expect(watched.active()).toBe(1);
    expect(watched.calls).toEqual({ revokeAll: 0, retire: 0 });
    expect(sources(mounted.container)).toEqual([]);
  });

  it('releases its subscription on unmount, and never revokes or retires the scope it shared', () => {
    const { watched, view, app } = watchedView();
    mounted = mount({ strict: true });
    mounted.render(under(view, card(withImage())));
    showImages(mounted);
    mounted.render(under(view));
    expect(watched.active()).toBe(0);
    expect(watched.calls).toEqual({ revokeAll: 0, retire: 0 });
    expect(app.retired).toBe(false);
    expect(watched.grants.map((grant) => grant.live)).toEqual([false]);
  });

  it('does not retire a live scope when Strict Mode replays a mount, so the first press still works', () => {
    const { watched, view, app } = watchedView();
    mounted = mount({ strict: true });
    mounted.render(under(view, card(withImage())));
    expect(app.retired).toBe(false);
    expect(one(mounted.container, 'images-toggle').hasAttribute('disabled')).toBe(false);
    showImages(mounted);
    expect(sources(mounted.container)).toEqual([IMAGE]);
    expect(watched.grants.map((grant) => grant.live)).toEqual([true]);
  });

  it('gives back only its own grants: unmounting one card leaves a sibling in the same view showing', () => {
    const { view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage(), 'a'), card(withImage(IMAGE_B), 'b')));
    const [a, b] = byTestId(mounted.container, 'card-root');
    showImages(mounted, a!);
    showImages(mounted, b!);
    expect(sources(mounted.container)).toEqual([IMAGE, IMAGE_B]);
    mounted.render(under(view, card(withImage(IMAGE_B), 'b')));
    expect(sources(mounted.container)).toEqual([IMAGE_B]);
    expect(one(mounted.container, 'images-toggle').textContent).toBe('Hide images');
  });

  it('makes a grant only for a press, and makes a fresh one for each Show images', () => {
    const { watched, view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    showImages(mounted);
    const first = watched.grants[0]!;
    showImages(mounted); // Hide images
    expect(first.live).toBe(false);
    expect(sources(mounted.container)).toEqual([]);
    showImages(mounted);
    expect(watched.grants).toHaveLength(2);
    expect(watched.grants[1]!.live).toBe(true);
    expect(first.live).toBe(false);
    expect(sources(mounted.container)).toEqual([IMAGE]);
  });
});

describe('retiring consent', () => {
  it.each([
    ['new content', (view: Mounted, v: FaithfulCardView) => view.render(under(v, card(withImage(IMAGE_B))))],
    // The application builds a new view (here with its own scope, as a new selection does).
    ['a replaced view', (view: Mounted) => view.render(under(watchedView().view, card(withImage())))],
  ])('removes the images and ends the grant on %s, and the next images need a fresh press', (_name, change) => {
    const { watched, view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    showImages(mounted);
    const grant = watched.grants[0]!;
    change(mounted, view);
    expect(grant.live).toBe(false);
    expect(sources(mounted.container)).toEqual([]);
    expect(one(mounted.container, 'images-toggle').textContent).toBe('Show images');
    expect(one(mounted.container, 'md-image-blocked').getAttribute('data-reason')).toBe('consent-required');
  });

  it('ends every card of a view when the application revokes all, and leaves another view alone', () => {
    const one1 = watchedView();
    const two = watchedView();
    mounted = mount();
    mounted.render(
      createElement(
        Fragment,
        null,
        createElement('section', { 'data-view': 'one' }, under(one1.view, card(withImage(), 'a'), card(withImage(), 'b'))),
        createElement('section', { 'data-view': 'two' }, under(two.view, card(withImage(IMAGE_B)))),
      ),
    );
    for (const toggle of byTestId(mounted.container, 'images-toggle')) press(mounted, toggle);
    expect(sources(mounted.container)).toEqual([IMAGE, IMAGE, IMAGE_B]);
    act(() => one1.app.revokeAll());
    const viewOne = mounted.container.querySelector<HTMLElement>('[data-view="one"]')!;
    const viewTwo = mounted.container.querySelector<HTMLElement>('[data-view="two"]')!;
    expect(sources(viewOne)).toEqual([]);
    expect(byTestId(viewOne, 'images-toggle').map((toggle) => toggle.textContent)).toEqual(['Show images', 'Show images']);
    expect(sources(viewTwo)).toEqual([IMAGE_B]);
    // The view is still live, so a new press in it is a new grant.
    press(mounted, byTestId(viewOne, 'images-toggle')[0]!);
    expect(sources(viewOne)).toEqual([IMAGE]);
  });

  it('ends consent for good when the application retires the view: nothing shows, and no control can grant again', () => {
    const { watched, view, app } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    const toggle = one(mounted.container, 'images-toggle');
    showImages(mounted);
    act(() => app.retire());
    expect(sources(mounted.container)).toEqual([]);
    const after = one(mounted.container, 'images-toggle');
    expect(after.hasAttribute('disabled')).toBe(true);
    expect(one(mounted.container, 'images-unavailable').getAttribute('data-reason')).toBe('view-ended');
    // The button a reader or old code still holds does nothing.
    press(mounted, toggle);
    press(mounted, after);
    expect(sources(mounted.container)).toEqual([]);
    expect(watched.grants.filter((grant) => grant.live)).toEqual([]);
  });

  it('shows a card mounted after the view ended as ended, with no grant to bring images back', () => {
    const { watched, view, app } = watchedView();
    app.retire();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    expect(one(mounted.container, 'images-toggle').hasAttribute('disabled')).toBe(true);
    expect(one(mounted.container, 'images-unavailable').getAttribute('data-reason')).toBe('view-ended');
    showImages(mounted);
    expect(sources(mounted.container)).toEqual([]);
    expect(watched.grants).toEqual([]);
  });

  it('cannot be undone by a control kept from before: a stale Hide or Show does nothing to the new content', () => {
    const { watched, view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    const oldToggle = one(mounted.container, 'images-toggle');
    showImages(mounted);
    mounted.render(under(view, card(withImage(IMAGE_B))));
    expect(sources(mounted.container)).toEqual([]);
    const grantsBefore = watched.grants.length;
    press(mounted, oldToggle);
    expect(oldToggle.isConnected).toBe(true); // React reuses the element, but the old handler is gone
    expect(sources(mounted.container)).toEqual([IMAGE_B]);
    expect(watched.grants.length).toBe(grantsBefore + 1);
    // The press acted for the new content only.
    expect(one(mounted.container, 'images-toggle').textContent).toBe('Hide images');
  });
});

describe('late results', () => {
  it('shows an image that failed to load as readable text, and a late failure from an earlier grant does not touch the new one', () => {
    const { view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    showImages(mounted);
    const first = mounted.container.querySelector('img')!;
    showImages(mounted); // Hide images
    showImages(mounted); // a new grant
    const second = mounted.container.querySelector('img')!;
    expect(second).not.toBe(first);
    act(() => void first.dispatchEvent(new Event('error')));
    expect(sources(mounted.container)).toEqual([IMAGE]);
    act(() => void second.dispatchEvent(new Event('error')));
    expect(sources(mounted.container)).toEqual([]);
    expect(one(mounted.container, 'md-image-blocked').getAttribute('data-reason')).toBe('load-failed');
    expect(one(mounted.container, 'md-image-blocked').textContent).toBe('[Image blocked: chart]');
  });

  it('does not bring consent back when a failure is followed by content, a load or a revoke', () => {
    const { view, app } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    showImages(mounted);
    const image = mounted.container.querySelector('img')!;
    act(() => app.revokeAll());
    expect(sources(mounted.container)).toEqual([]);
    // A load or error event for an image that is gone cannot show it again.
    act(() => void image.dispatchEvent(new Event('load')));
    act(() => void image.dispatchEvent(new Event('error')));
    expect(sources(mounted.container)).toEqual([]);
    expect(one(mounted.container, 'images-toggle').textContent).toBe('Show images');
  });

  it('a failed Standard image is text, and new content gets a fresh attempt', () => {
    const { view } = watchedView({ imageHosts: ['images.example.com'] });
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    act(() => void mounted!.container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(one(mounted.container, 'md-image-blocked').getAttribute('data-reason')).toBe('load-failed');
    mounted.render(under(view, card(withImage(IMAGE_B))));
    expect(sources(mounted.container)).toEqual([IMAGE_B]);
  });
});

describe('a committed image', () => {
  it('receives its address only once it is in the document, so a render React discards cannot start a request', () => {
    // A browser requests an image as soon as an element has an address, attached or not. React
    // creates and fills in the elements of a render before it knows the render will be kept, so an
    // address set at that point would be requested for a render that may never be shown.
    const { view } = watchedView({ imageHosts: ['images.example.com'] });
    const created: Array<{ readonly src: string; readonly inDocument: boolean }> = [];
    const original = document.createElement.bind(document);
    const spy = (name: string, options?: ElementCreationOptions) => {
      const element = original(name, options);
      if (name === 'img') {
        const set = element.setAttribute.bind(element);
        element.setAttribute = (key: string, value: string) => {
          if (key === 'src') created.push({ src: value, inDocument: element.isConnected });
          set(key, value);
        };
      }
      return element;
    };
    document.createElement = spy as typeof document.createElement;
    try {
      mounted = mount({ strict: true });
      mounted.render(under(view, card(withImage())));
    } finally {
      document.createElement = original;
    }
    // Set once, after the commit, even though Strict Mode rendered twice and replayed the effects.
    expect(created).toEqual([{ src: IMAGE, inDocument: true }]);
  });
});

describe('interleaved cards and views', () => {
  it('keeps two cards of one view apart: one Hide images leaves the other showing', () => {
    const { view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage(), 'a'), card(withImage(IMAGE_B), 'b')));
    const [a, b] = byTestId(mounted.container, 'card-root');
    showImages(mounted, a!);
    showImages(mounted, b!);
    showImages(mounted, a!); // Hide images in a
    expect(sources(a!)).toEqual([]);
    expect(sources(b!)).toEqual([IMAGE_B]);
    // New content in a leaves b's consent alone.
    mounted.render(under(view, card(withImage(IMAGE_B), 'a'), card(withImage(IMAGE_B), 'b')));
    expect(sources(mounted.container)).toEqual([IMAGE_B]);
  });

  it('keeps cards in different views apart, including their policies', () => {
    const standard = watchedView({ imageHosts: ['images.example.com'] });
    const strict = watchedView();
    mounted = mount();
    mounted.render(
      createElement(
        Fragment,
        null,
        createElement('section', { 'data-view': 'standard' }, under(standard.view, card(withImage()))),
        createElement('section', { 'data-view': 'strict' }, under(strict.view, card(withImage(IMAGE_B)))),
      ),
    );
    const strictRoot = mounted.container.querySelector<HTMLElement>('[data-view="strict"]')!;
    const standardRoot = mounted.container.querySelector<HTMLElement>('[data-view="standard"]')!;
    expect(sources(standardRoot)).toEqual([IMAGE]);
    expect(sources(strictRoot)).toEqual([]);
    showImages(mounted, strictRoot);
    expect(sources(strictRoot)).toEqual([IMAGE_B]);
    act(() => strict.app.retire());
    expect(sources(strictRoot)).toEqual([]);
    expect(sources(standardRoot)).toEqual([IMAGE]);
    expect(standard.watched.calls).toEqual({ revokeAll: 0, retire: 0 });
  });
});

describe('source reveal and protected actions', () => {
  it('cannot grant an effect: revealing source makes no grant, no image and no host request', () => {
    const { host, watched, view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    press(mounted, one(mounted.container, 'source-toggle'));
    press(mounted, one(mounted.container, 'md-link-inert'));
    press(mounted, one(mounted.container, 'md-image-blocked'));
    expect(watched.grants).toEqual([]);
    expect(sources(mounted.container)).toEqual([]);
    expect(host.requests).toEqual([]);
    expect(mounted.container.querySelector('a, [href]')).toBeNull();
  });

  it('keeps Show images local: it asks the host for nothing and the view needs no action runtime', () => {
    const { host, view } = watchedView();
    mounted = mount();
    mounted.render(under(view, card(withImage())));
    showImages(mounted);
    showImages(mounted);
    expect(host.requests).toEqual([]);
  });
});

describe('consent in an A2UI surface', () => {
  const bound = [{ id: 'card', markdown: { path: '/answer' }, contractVersion: { path: '/version' } }];
  const answer = (markdown: unknown) => dataUpdate({ answer: markdown, version: 1 });

  function start(markdown: string, options: TrustedOptions = strictOptions) {
    const session = openSession([...layout(bound), ...answer(markdown)]);
    sessions.push(session);
    const { view, watched, app } = watchedView(options);
    mounted = mount();
    mounted.render(surfaceUnder(view, session.surface));
    return { session, watched, app, view: mounted };
  }

  it('retires the images when the data model replaces the content, and a new press shows the new ones', async () => {
    const { session, watched, view } = start(withImage());
    showImages(view);
    expect(sources(view.container)).toEqual([IMAGE]);
    await act(async () => session.ingest(answer(withImage(IMAGE_B))));
    expect(watched.grants[0]!.live).toBe(false);
    expect(sources(view.container)).toEqual([]);
    showImages(view);
    expect(sources(view.container)).toEqual([IMAGE_B]);
  });

  it('retires the grant when A2UI replaces the component, and a control kept from the old node does nothing', async () => {
    const { session, watched, view } = start(withImage());
    const toggle = one(view.container, 'images-toggle');
    showImages(view);
    await act(async () =>
      session.ingest([{ version: 'v0.9', updateComponents: { surfaceId: 'cards', components: [{ id: 'card', component: 'Text', text: 'plain now' }] } }]),
    );
    expect(byTestId(view.container, 'card-root')).toEqual([]);
    expect(watched.grants[0]!.live).toBe(false);
    press(view, toggle);
    expect(watched.grants).toHaveLength(1);
    expect(sources(view.container)).toEqual([]);
  });

  it('retires the controls of a disposed node before React has unmounted it, so a press makes no grant', async () => {
    const { session, watched, view } = start(withImage());
    const toggle = one(view.container, 'images-toggle');
    session.ingest([{ version: 'v0.9', updateComponents: { surfaceId: 'cards', components: [{ id: 'card', component: 'Text', text: 'replaced' }] } }]);
    expect(toggle.isConnected).toBe(true);
    press(view, toggle);
    await view.settle();
    expect(watched.grants).toEqual([]);
    expect(sources(view.container)).toEqual([]);
  });

  it('releases the card’s subscription and grant when the application unmounts its surface, leaving the scope live', () => {
    const { watched, app, view } = start(withImage());
    showImages(view);
    view.render(createElement('p', null, 'the surface is gone'));
    expect(watched.active()).toBe(0);
    expect(watched.grants.map((grant) => grant.live)).toEqual([false]);
    expect(app.retired).toBe(false);
  });
});
