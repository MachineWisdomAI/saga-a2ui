import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { FAITHFUL_CARD_CONTRACT_VERSION } from '@saga-a2ui/components/faithful-card';
import { createInstanceHost } from '@saga-a2ui/core/actions';
import { FaithfulCardContentElement, provideContentView } from '@saga-a2ui/lit/faithful-card';
import { contentViewFromDocument } from './lit/content-view.js';
import { PlayControlElement } from './lit/play-control.js';
import { createAppHostLinks } from './mcp/host-links.js';
import { connectPlaybackView, type PlaybackViewState } from './playback/playback-view.js';
import { createWebAudioPlayer } from './playback/web-audio-player.js';

// Composition root of the player view (built into one HTML resource by vite.playback-view.config.ts).
// No server code and no credential: the sign-in and the capability arrive only through the host's
// bridge, and every value is written through Lit text bindings.
if (!customElements.get('saga-play-control')) customElements.define('saga-play-control', PlayControlElement);
if (!customElements.get('saga-faithful-card-content')) customElements.define('saga-faithful-card-content', FaithfulCardContentElement);

const control = document.querySelector<PlayControlElement>('saga-play-control');
const title = document.querySelector<HTMLElement>('[data-testid="playback-title"]');
const descriptionRoot = document.querySelector<HTMLElement>('[data-testid="playback-description"]');
if (!control || !title || !descriptionRoot) throw new Error('playback.html is missing its control, title or description');
const descriptionHost: HTMLElement = descriptionRoot;

const app = new App({ name: 'saga-a2ui-playback-view', version: '0.0.0' });

// The description of the selected episode is shown by the optional FaithfulCard under this page's
// own trusted content view: the policy, the opening of links and image consent belong to the page,
// never to the description. The player resource is served verbatim and may connect only to the
// media origin, so it embeds no policy (an embedded one forbids every connection). The card
// therefore runs the default Standard policy with no image host: it loads no image, and a link
// opens only through the host.
const content = contentViewFromDocument(document, createAppHostLinks(app));
if (content.ok) provideContentView(descriptionHost, content.view);

/**
 * Shows the selected episode's description beside the control, or nothing. One card element serves
 * the page: a new description reaches it as a changed property, which ends that card's own image
 * consent and touches nothing else. A state without an episode removes the card, and the private
 * text with it; an element that leaves the document also ends its consent and its link results.
 */
function showDescription(state: PlaybackViewState): void {
  const episode = 'episode' in state ? state.episode : undefined;
  if (!content.ok || !episode) {
    descriptionHost.replaceChildren();
    return;
  }
  let card = descriptionHost.querySelector<FaithfulCardContentElement>('saga-faithful-card-content');
  if (!card) {
    card = document.createElement('saga-faithful-card-content') as FaithfulCardContentElement;
    descriptionHost.append(card);
  }
  card.contractVersion = FAITHFUL_CARD_CONTRACT_VERSION;
  card.markdown = episode.description;
}

const connection = await connectPlaybackView({
  app,
  // The host window is the only permitted peer; the transport checks `event.source`.
  transport: new PostMessageTransport(window.parent, window.parent),
  player: createWebAudioPlayer(),
  // The card's consent belongs to its content view; the controller says when a selection ends.
  ...(content.ok ? { contentConsent: content.view.consent } : {}),
  show(state: PlaybackViewState) {
    control.state = state;
    title.textContent = 'episode' in state && state.episode ? state.episode.title : 'Player';
    showDescription(state);
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
