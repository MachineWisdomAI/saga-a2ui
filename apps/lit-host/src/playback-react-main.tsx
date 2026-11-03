import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps'; // saga-boundary: integration-import the player page is not an A2UI surface, so neither stack entry starts it; it makes the bridge and the transport the runner connects over
import { createInstanceHost } from '@saga-a2ui/core/actions';
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {
  connectPlaybackView,
  type PlaybackViewState,
} from './playback/playback-view.js';
import { createWebAudioPlayer } from './playback/web-audio-player.js';
import { PlayerPage } from './react/play-control.js';

// Composition root of the React player view (built into one HTML resource by
// vite.playback-react-view.config.ts). It is the same application as the Lit player: the same
// controller, the same Play, Pause and Resume actions and the same server calls, with a React
// control in place of the Lit element. No server code and no credential: the sign-in and the
// capability arrive only through the host's bridge. The optional description card is a separate
// slice and is not part of this page, so the controller is told of no card.
const container = document.getElementById('root');
if (container === null)
  throw new Error('playback-react.html is missing its #root element');

const app = new App({ name: 'saga-a2ui-playback-view', version: '0.0.0' });

// The state the controller last presented, read by the React tree through a subscription so the
// control always shows the controller's current state.
let current: PlaybackViewState = { kind: 'no-selection' };
const subscribers = new Set<() => void>();
const subscribe = (notify: () => void): (() => void) => {
  subscribers.add(notify);
  return () => void subscribers.delete(notify);
};

const connection = await connectPlaybackView({
  app,
  // The host window is the only permitted peer; the transport checks `event.source`.
  transport: new PostMessageTransport(window.parent, window.parent),
  player: createWebAudioPlayer(),
  show(state: PlaybackViewState) {
    current = state;
    for (const notify of [...subscribers]) notify();
  },
});

// The action host keeps the shared runtime's defaults: 30,000 ms of work for a press (key creation
// through the start of audio) and 5,000 ms for each hook or cleanup step. Setup binds Play, Pause
// and Resume directly to the control's own instance once the control opens it on the host. The
// control calls the bound action synchronously from the user's click, which is what lets the
// player unlock audio inside the activation before authorization finishes.
const actions = createInstanceHost({
  onSetupError() {
    // The error text stays out of the page; the control simply stays unbound.
    console.error('The playback controls could not be attached.');
  },
});
actions.register(connection.attach);

function Player() {
  const state = useSyncExternalStore(subscribe, () => current);
  return <PlayerPage host={actions} state={state} />;
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <Player />
  </StrictMode>,
);

// The view ends itself, and releases the player, on `pagehide`. Unmounting the root retires the
// control's instance before the host closes.
window.addEventListener('pagehide', () => {
  root.unmount();
  actions.close();
});
