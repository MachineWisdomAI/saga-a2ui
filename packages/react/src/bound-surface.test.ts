// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Action } from '@saga-a2ui/core/actions';
import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import {
  openSurface,
  type BoundSurface,
  type UpdateResult,
} from '@saga-a2ui/react/a2ui';
import { ActionButton } from '@saga-a2ui/react/actions';
import {
  boundView,
  catalog,
  CATALOG_ID,
  markLayout,
  mount,
  SURFACE_ID,
  type Mounted,
} from './actions/fixture.test-support.js';

// A typed surface through its public interface only: an application opens a layout with its
// catalog, mounts `<Surface of={handle}/>`, and updates the data. The session, the decoder and the
// message order stay behind `openSurface`.

let mounted: Mounted | undefined;
const opened: BoundSurface<unknown>[] = [];
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  for (const surface of opened.splice(0)) surface.dispose();
});

function open(): BoundSurface<{ label: string; status: string }> {
  const surface = openSurface(markLayout, catalog);
  opened.push(surface as BoundSurface<unknown>);
  return surface;
}

/** An update as an application makes it: from an event, so React renders what changed. */
function update<TData>(surface: BoundSurface<TData>, data: TData) {
  let result: UpdateResult | undefined;
  act(() => {
    result = surface.update(data);
  });
  return result;
}

describe('a bound surface with an application’s own catalog', () => {
  it('keeps the mounted control, its action binding and its focus across an ordinary update', () => {
    const pressed: string[] = [];
    const surface = open();
    mounted = mount();
    mounted.render(
      boundView({
        handle: surface.handle,
        setup: (view) =>
          void view.watchById(
            'mark',
            ActionButton,
            (handle) =>
              void handle.bindAction(
                'activate',
                Action.local('mark')
                  .run(() => void pressed.push('mark'))
                  .build(),
              ),
          ),
      }),
    );
    const control = mounted.button('Mark');
    control.focus();
    expect(document.activeElement).toBe(control);
    expect(mounted.container.textContent).toContain('Ready');

    expect(update(surface, { label: 'Mark again', status: 'Saved' })).toEqual({
      ok: true,
    });

    expect(mounted.button('Mark again')).toBe(control);
    expect(document.activeElement).toBe(control);
    expect(mounted.container.textContent).toContain('Saved');
    mounted.press(control);
    expect(pressed).toEqual(['mark']);
  });

  it('refuses data the layout does not allow, and leaves the data and the control as they were', () => {
    const surface = open();
    mounted = mount();
    mounted.render(
      boundView({ handle: surface.handle, setup: () => undefined }),
    );
    const control = mounted.button('Mark');
    control.focus();

    // The update is typed from the layout: a wrong field type does not compile.
    // @ts-expect-error `label` is a string
    const wrongType = update(surface, { label: 1, status: 'Saved' });
    expect(wrongType?.ok).toBe(false);
    const refused = update(surface, { label: 'Changed' } as never);

    expect(refused?.ok).toBe(false);
    if (refused?.ok === false) expect(refused.message).toContain('status');
    const unknown = update(surface, {
      label: 'Changed',
      status: 'Saved',
      extra: true,
    } as never);
    expect(unknown?.ok).toBe(false);
    expect(mounted.button('Mark')).toBe(control);
    expect(document.activeElement).toBe(control);
    expect(mounted.container.textContent).toContain('Ready');
    expect(mounted.container.textContent).not.toContain('Changed');
    // A refusal is not terminal: the next valid update applies.
    expect(update(surface, { label: 'Mark', status: 'Saved' })).toEqual({
      ok: true,
    });
    expect(mounted.container.textContent).toContain('Saved');
  });

  it('survives the Strict Mode replay of mounting, and a remount of the view, without being disposed', () => {
    const surface = open();
    mounted = mount({ strict: true });
    const view = boundView({ handle: surface.handle, setup: () => undefined });
    mounted.render(view);
    mounted.render(createElement('p', null, 'elsewhere'));
    expect(mounted.container.textContent).toBe('elsewhere');
    // Leaving the page does not end the surface; coming back shows its current data.
    expect(update(surface, { label: 'Mark', status: 'Later' })).toEqual({
      ok: true,
    });
    mounted.render(view);
    expect(mounted.container.textContent).toContain('Later');
  });

  it('is disposed once however often it is asked, after which an update fails and nothing renders', () => {
    const surface = open();
    mounted = mount();
    mounted.render(
      boundView({ handle: surface.handle, setup: () => undefined }),
    );
    expect(mounted.container.textContent).toContain('Ready');

    act(() => surface.dispose());
    expect(() => surface.dispose()).not.toThrow();

    expect(mounted.container.textContent).toBe('');
    const late = update(surface, { label: 'Mark', status: 'Late' });
    expect(late?.ok).toBe(false);
    if (late?.ok === false) expect(late.message).toContain('disposed');
    expect(mounted.container.textContent).toBe('');
  });

  it('renders nothing for a surface that was disposed before it was mounted', () => {
    const surface = open();
    surface.dispose();
    mounted = mount();
    expect(() =>
      mounted?.render(
        boundView({ handle: surface.handle, setup: () => undefined }),
      ),
    ).not.toThrow();
    expect(mounted.container.textContent).toBe('');
  });
});

describe('a layout the session does not accept', () => {
  const unaccepted = (component: string, catalogId = CATALOG_ID) =>
    defineSurface({
      surfaceId: SURFACE_ID,
      catalogId,
      data: z.object({ text: z.string() }),
      initial: { text: 'hello' },
      root: { component, bind: { text: 'text' } },
    });

  it('throws with the session’s failure message when the catalog lacks a component', () => {
    expect(() => openSurface(unaccepted('NoSuchComponent'), catalog)).toThrow(
      /NoSuchComponent/,
    );
  });

  it('throws when the layout names another catalog, and a later layout still opens', () => {
    expect(() =>
      openSurface(unaccepted('Text', 'https://example.test/other'), catalog),
    ).toThrow(/other/);
    const accepted = openSurface(unaccepted('Text'), catalog);
    opened.push(accepted as BoundSurface<unknown>);
    expect(accepted.update({ text: 'again' })).toEqual({ ok: true });
  });
});
