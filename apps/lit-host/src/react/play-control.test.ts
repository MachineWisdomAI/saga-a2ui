// @vitest-environment jsdom
import {
  Action,
  createInstanceHost,
  type InstanceHost,
  type OpenInfo,
} from '@saga-a2ui/core/actions';
import {
  act,
  createElement,
  StrictMode,
  Component,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PLAY_CONTROL_ID,
  PlayControl,
  type PlayControlEvents,
  type PlaybackViewState,
} from '../playback/playback-view.js';
import { PlayControlView } from './play-control.js';

// The seams this adapter adds to the accepted player: which instance a committed React control
// owns, when it is retired, and what a press delivers. The controller, the actions and the
// authorization they drive are covered once, by the controller's own tests and by the built player
// spec that runs against this view too. Real React 19 in jsdom; Strict Mode is on unless stated.

const EPISODE = {
  episodeId: 'ep-1',
  title: 'The protected episode',
  description: '',
  viewSession: 'vs_x',
} as const;
const READY: PlaybackViewState = { kind: 'ready', episode: EPISODE };
const PENDING: PlaybackViewState = { kind: 'pending', episode: EPISODE };
const PLAYING: PlaybackViewState = { kind: 'playing', episode: EPISODE };
const UNCONFIRMED: PlaybackViewState = {
  kind: 'unavailable',
  episode: EPISODE,
  requestOutcome: 'unknown',
};

interface Opened {
  readonly name: string;
  readonly isLive: () => boolean;
}

/** A real host that also reports each instance opened on it, in order, with its liveness pull. */
function observed(
  name: string,
  log: string[],
): { host: InstanceHost; opened: Opened[] } {
  const real = createInstanceHost({
    onSetupError: () => log.push(`${name}.setup-error`),
  });
  const opened: Opened[] = [];
  const host: InstanceHost = {
    register: (setup) => real.register(setup),
    close: () => real.close(),
    open<Events>(info: OpenInfo<Events>) {
      const index = opened.length;
      opened.push({ name: `${name}#${index}`, isLive: info.isLive });
      log.push(`${name}#${index}.open`);
      const instance = real.open(info);
      return {
        ...instance,
        retire() {
          log.push(`${name}#${index}.retire(live=${info.isLive()})`);
          instance.retire();
        },
      };
    },
  };
  return { host, opened };
}

declare global {
  // React's switch for `act` to treat updates in this test as expected.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function mount(): (element: ReactNode, strict?: boolean) => void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  return (element, strict = true) =>
    act(() =>
      mounted.render(
        strict ? createElement(StrictMode, null, element) : element,
      ),
    );
}

const view = (host: InstanceHost | undefined, state: PlaybackViewState) =>
  createElement(PlayControlView, { host, state });
const button = (): HTMLButtonElement | null =>
  container?.querySelector('[data-testid="play-button"]') ?? null;
const status = (): HTMLElement | null =>
  container?.querySelector('[data-testid="play-status"]') ?? null;

/** Binds a recording local action to each slot of the control, the way the application's setup binds the real ones. */
function bindRecorders(host: InstanceHost, pressed: string[]): () => void {
  return host.register((instances) => {
    instances.watchById(PLAY_CONTROL_ID, PlayControl, (handle) => {
      for (const slot of ['play', 'pause', 'resume'] as const) {
        handle.bindAction(
          slot,
          Action.local<PlayControlEvents['play']>(slot)
            .atActivation(() => void pressed.push(`${slot}:activation`))
            .run(async () => {
              await Promise.resolve(); // asynchronous work, as the real Play does
              pressed.push(`${slot}:run`);
            })
            .build(),
        );
      }
    });
  });
}

describe('the React Play control', () => {
  it('opens one live instance for the committed host, under Strict Mode too, and never re-opens it for a new state', () => {
    const log: string[] = [];
    const { host, opened } = observed('A', log);
    const render = mount();

    render(view(host, READY));
    expect(opened.filter((one) => one.isLive())).toHaveLength(1);
    const opens = log.filter((line) => line.endsWith('.open')).length;

    render(view(host, PENDING));
    render(view(host, PLAYING));
    expect(log.filter((line) => line.endsWith('.open'))).toHaveLength(opens);
    expect(opened.filter((one) => one.isLive())).toHaveLength(1);
    // Strict Mode's simulated unmount retired the first instance before the kept one opened.
    expect(log.slice(0, 3)).toEqual([
      'A#0.open',
      'A#0.retire(live=false)',
      'A#1.open',
    ]);
  });

  it('delivers a press to the action bound to this exact instance, inside the click, and not twice', async () => {
    const { host } = observed('A', []);
    const pressed: string[] = [];
    bindRecorders(host, pressed);
    const render = mount();
    render(view(host, READY));

    await act(async () => {
      button()?.click();
      // The activation prefix has already run when the click returns: no await sits between them,
      // which is what lets the player unlock audio inside the user's gesture.
      expect(pressed).toEqual(['play:activation']);
    });
    expect(pressed).toEqual(['play:activation', 'play:run']);

    render(view(host, PLAYING));
    await act(async () => button()?.click());
    expect(pressed.filter((line) => line.endsWith(':activation'))).toEqual([
      'play:activation',
      'pause:activation',
    ]);
  });

  it('ignores a press while pending: nothing is delivered and the button stays in place, marked busy', () => {
    const { host } = observed('A', []);
    const pressed: string[] = [];
    bindRecorders(host, pressed);
    const render = mount();
    render(view(host, PENDING));

    expect(button()?.getAttribute('aria-disabled')).toBe('true');
    expect(button()?.getAttribute('aria-busy')).toBe('true');
    expect(button()?.disabled).toBe(false); // focusable
    act(() => button()?.click());
    expect(pressed).toEqual([]);
  });

  it('retires the instance when the control leaves the screen, and a retained element delivers nothing', () => {
    const log: string[] = [];
    const { host, opened } = observed('A', log);
    const pressed: string[] = [];
    bindRecorders(host, pressed);
    const render = mount();
    render(view(host, READY));
    const retained = button();

    act(() => root?.unmount());
    root = undefined;

    expect(opened.every((one) => !one.isLive())).toBe(true);
    expect(log.at(-1)).toMatch(/\.retire\(live=false\)$/);
    retained?.click();
    expect(pressed).toEqual([]);
  });

  it("retires the old host's instance before the new host's opens, and never delivers to the old one", async () => {
    const log: string[] = [];
    const first = observed('A', log);
    const second = observed('B', log);
    const pressedA: string[] = [];
    const pressedB: string[] = [];
    bindRecorders(first.host, pressedA);
    bindRecorders(second.host, pressedB);
    const render = mount();
    render(view(first.host, READY), false);
    render(view(second.host, READY), false);

    expect(log).toEqual(['A#0.open', 'A#0.retire(live=false)', 'B#0.open']);
    await act(async () => button()?.click());
    expect(pressedA).toEqual([]);
    expect(pressedB).toEqual(['play:activation', 'play:run']);
  });

  it('opens nothing for a render React discards before commit', () => {
    class Boundary extends Component<
      { readonly children: ReactNode },
      { readonly failed: boolean }
    > {
      override state = { failed: false };
      static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
      }
      override render(): ReactNode {
        return this.state.failed ? 'fallback' : this.props.children;
      }
    }
    const Throws = (): never => {
      throw new Error('this render never commits');
    };
    const log: string[] = [];
    const { host } = observed('A', log);
    const render = mount();
    const errors = console.error;
    console.error = () => undefined; // React reports the deliberate error; the test asserts its effect
    try {
      render(
        createElement(Boundary, null, view(host, READY), createElement(Throws)),
        false,
      );
    } finally {
      console.error = errors;
    }
    expect(log).toEqual([]);
    expect(container?.textContent).toBe('fallback');
  });

  it('reports no instance, and still renders, for a page with no host yet', () => {
    const render = mount();
    render(view(undefined, READY));
    expect(button()?.textContent).toBe('Play');
    act(() => button()?.click()); // nothing is attached; the press does nothing and throws nothing
  });

  it('moves focus to the status when a state removes the button that had it, and keeps it on the button otherwise', () => {
    const { host } = observed('A', []);
    const render = mount();
    render(view(host, READY));

    button()?.focus();
    render(view(host, PLAYING)); // the same button, relabeled
    expect(document.activeElement).toBe(button());
    expect(button()?.textContent).toBe('Pause');

    render(view(host, UNCONFIRMED)); // no button remains
    expect(button()).toBeNull();
    expect(document.activeElement).toBe(status());
    expect(status()?.getAttribute('role')).toBe('status');
    expect(status()?.getAttribute('aria-live')).toBe('polite');
  });

  it('does not steal focus when the removed button did not have it', () => {
    const { host } = observed('A', []);
    const render = mount();
    render(view(host, READY));
    (document.activeElement as HTMLElement | null)?.blur();
    render(view(host, UNCONFIRMED));
    expect(document.activeElement).not.toBe(status());
  });
});
