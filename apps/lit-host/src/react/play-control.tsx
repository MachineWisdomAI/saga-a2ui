import type { InstanceHost, OpenInstance } from '@saga-a2ui/core/actions';
import { useCallback, useLayoutEffect, useRef, type MouseEvent } from 'react';
import {
  presentationFor,
  titleFor,
  type PlayControlAction,
} from '../playback/play-presentation.js';
import {
  PLAY_CONTROL_ID,
  PlayControl,
  type PlayControlEvents,
  type PlaybackViewState,
} from '../playback/playback-view.js';
import './play-control.css';

/**
 * Owns one rendered Play control instance for one committed host.
 *
 * A function component is not the instance: React can re-run it, discard a render before commit or
 * mount it twice (Strict Mode). The instance is the span between this layout effect's setup and its
 * cleanup, so a render that is never committed opens nothing, and a control that leaves the screen
 * (or is given another host) is retired in the same commit. The layout effect makes the previous
 * instance retire and the new one open before the browser paints, so a visible control is never
 * without its instance and a removed one never keeps its own.
 *
 * `isLive` is a fresh pull at every call; the flag is cleared before `retire`, so a handle, a
 * binding and a press all see the control as gone from the first moment of cleanup.
 */
function useControlInstance(
  host: InstanceHost | undefined,
): (action: PlayControlAction, native: Event) => void {
  // Written only by the layout effect below. A press reads it at press time, never at render time.
  const instance = useRef<OpenInstance<PlayControlEvents> | undefined>(
    undefined,
  );
  useLayoutEffect(() => {
    if (!host) return undefined;
    let committed = true;
    const open = host.open<PlayControlEvents>({
      kind: PlayControl,
      componentId: PLAY_CONTROL_ID,
      dataPath: '/',
      events: ['play', 'pause', 'resume'],
      isLive: () => committed,
      read: () => undefined, // the control shows no data scope of its own
    });
    instance.current = open;
    return () => {
      committed = false;
      if (instance.current === open) instance.current = undefined;
      open.retire();
    };
  }, [host]);
  return useCallback(
    (action, native) => void instance.current?.activate(action, native),
    [],
  );
}

/**
 * The Play control: one button and one status line for the controller's current state.
 *
 * Presentation only, and the same markup, wording and accessibility as the Lit control: it never
 * decides whether playback is allowed. It hands the user's press, still inside the click event
 * (React delivers `onClick` synchronously from the DOM event), to whatever action the application
 * bound to this exact rendered instance. The button stays in place and focusable while a request
 * is pending (`aria-disabled`, `aria-busy`), every change is announced by one polite status
 * region, and when a state removes the button while it had focus, focus moves to the status.
 */
export function PlayControlView(props: {
  readonly host: InstanceHost | undefined;
  readonly state: PlaybackViewState;
}) {
  const activate = useControlInstance(props.host);
  const shown = presentationFor(props.state);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const focusStranded = useRef(false);

  // Detaches before React removes the button, while it is still the focused element of the document.
  const buttonRef = useCallback((node: HTMLButtonElement | null) => {
    if (node === null) return undefined;
    return () => {
      if (node.ownerDocument.activeElement === node)
        focusStranded.current = true;
    };
  }, []);
  useLayoutEffect(() => {
    if (!focusStranded.current) return;
    focusStranded.current = false;
    statusRef.current?.focus();
  });

  const press = (
    action: PlayControlAction,
    busy: boolean | undefined,
    event: MouseEvent,
  ): void => {
    if (busy) return; // a pending request ignores the press; the bound action's busy policy also does
    activate(action, event.nativeEvent);
  };

  return (
    <div
      className="saga-play"
      data-testid="play-root"
      data-state={props.state.kind}
    >
      {shown.button ? (
        <button
          type="button"
          ref={buttonRef}
          data-testid="play-button"
          aria-disabled={shown.busy ? 'true' : 'false'}
          aria-busy={shown.busy ? 'true' : 'false'}
          onClick={(event) =>
            press(shown.button?.action ?? 'play', shown.busy, event)
          }
        >
          {shown.button.label}
        </button>
      ) : null}
      <p
        className="saga-play-status"
        data-testid="play-status"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={statusRef}
      >
        {shown.status}
      </p>
    </div>
  );
}

/** The player page: the selected episode's title above its control. */
export function PlayerPage(props: {
  readonly host: InstanceHost | undefined;
  readonly state: PlaybackViewState;
}) {
  return (
    <main>
      <h1 data-testid="playback-title">{titleFor(props.state)}</h1>
      <PlayControlView host={props.host} state={props.state} />
    </main>
  );
}
