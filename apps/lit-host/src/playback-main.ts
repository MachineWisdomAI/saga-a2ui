import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { createInstanceHost } from '@saga-a2ui/core/actions';
import { PlayControlElement } from './lit/play-control.js';
import { connectPlaybackView, type PlaybackViewState } from './playback/playback-view.js';
import { createWebAudioPlayer } from './playback/web-audio-player.js';

// Composition root of the player view (built into one HTML resource by vite.playback-view.config.ts).
// No server code and no credential: the sign-in and the capability arrive only through the host's
// bridge, and every value is written through Lit text bindings.
if (!customElements.get('saga-play-control')) customElements.define('saga-play-control', PlayControlElement);

const control = document.querySelector<PlayControlElement>('saga-play-control');
const title = document.querySelector<HTMLElement>('[data-testid="playback-title"]');
if (!control || !title) throw new Error('playback.html is missing its control or title');

const connection = await connectPlaybackView({
  app: new App({ name: 'saga-a2ui-playback-view', version: '0.0.0' }),
  // The host window is the only permitted peer; the transport checks `event.source`.
  transport: new PostMessageTransport(window.parent, window.parent),
  player: createWebAudioPlayer(),
  show(state: PlaybackViewState) {
    control.state = state;
    title.textContent = 'episode' in state && state.episode ? state.episode.title : 'Player';
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
control.host = actions;

// Release the player even if the host never sends a teardown request.
window.addEventListener('pagehide', () => {
  connection.dispose();
  actions.close();
});
