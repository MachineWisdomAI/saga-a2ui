// @vitest-environment jsdom
import { Action } from '@saga-a2ui/core/actions';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSurface } from '../a2ui.js';
import { Surface } from '../bound-surface.js';
import { ActionButton } from './action-button.js';
import {
  catalog,
  markLayout,
  mount,
  type Mounted,
} from './fixture.test-support.js';
import { ActionsScope, createReactActions } from './react-actions.js';

// The React counterpart of `createLitActions`: an application states the setup that binds its
// actions once, and the scope it mounts around a bound surface owns the host, the setup and the
// failure boundary that the application used to write by hand. Driven through real React 19
// rendering of the published `@a2ui/react` surface and real DOM clicks.

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const markRead = (log: string[]) =>
  Action.local<{ read(path: string): unknown }>('mark')
    .input(() => ({}))
    .run(() => void log.push('marked'))
    .build();

describe('createReactActions', () => {
  it('binds the application’s actions to the controls the surface renders', () => {
    const log: string[] = [];
    const mark = markRead(log);
    const bound = openSurface(markLayout, catalog);
    const actions = createReactActions({
      attach: (view) =>
        void view.watchById(
          'mark',
          ActionButton,
          (handle) => void handle.bindAction('activate', mark),
        ),
      onSetupError: () => undefined,
    });
    mounted = mount();
    mounted.render(
      createElement(ActionsScope, {
        actions,
        children: createElement(Surface, { of: bound.handle }),
      }),
    );

    mounted.press(mounted.button('Mark'));
    expect(log).toEqual(['marked']);

    // An ordinary update keeps the mounted control and its binding.
    const control = mounted.button('Mark');
    bound.update({ label: 'Mark', status: 'Done' });
    expect(mounted.button('Mark')).toBe(control);
    mounted.press(control);
    expect(log).toEqual(['marked', 'marked']);
  });

  it('reports a setup that throws and renders nothing in its place', () => {
    const onSetupError = vi.fn();
    const bound = openSurface(markLayout, catalog);
    const actions = createReactActions({
      attach: () => {
        throw new Error('setup broke');
      },
      onSetupError,
    });
    mounted = mount({ strict: false });
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mounted.render(
        createElement(ActionsScope, {
          actions,
          children: createElement(Surface, { of: bound.handle }),
        }),
      );
    } finally {
      silence.mockRestore();
    }
    expect(onSetupError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'setup broke' }),
    );
    expect(mounted.container.querySelector('button')).toBeNull();
  });

  it('refuses invalid action limits when the integration is created, before anything mounts', () => {
    expect(() =>
      createReactActions({
        attach: () => undefined,
        onSetupError: () => undefined,
        limits: { deadlineMs: -1 },
      }),
    ).toThrow();
  });
});
