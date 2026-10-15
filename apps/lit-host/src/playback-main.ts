import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { PlayControlElement, type PlayControlAction } from './lit/play-control.js';
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

// Each listener calls the controller synchronously from the user's event, which is what lets the
// player unlock audio inside the activation before authorization finishes.
const actions: Record<PlayControlAction, () => void> = {
  'saga-play': () => connection.play(),
  'saga-pause': () => connection.pause(),
  'saga-resume': () => connection.resume(),
};
for (const [name, run] of Object.entries(actions)) control.addEventListener(name, run);

// Release the player even if the host never sends a teardown request.
window.addEventListener('pagehide', () => connection.dispose());
