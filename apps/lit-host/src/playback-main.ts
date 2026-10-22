import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { FAITHFUL_CARD_CONTRACT_VERSION } from '@saga-a2ui/components/faithful-card';
import { createInstanceHost } from '@saga-a2ui/core/actions';
import {
  FaithfulCardContentElement,
  provideContentView,
} from '@saga-a2ui/lit/faithful-card';
import { contentViewFromDocument } from './lit/content-view.js';
import { PlayControlElement } from './lit/play-control.js';
import { hostLinksFromApp } from '@saga-a2ui/mcp/view';
import {
  connectPlaybackView,
  type PlaybackViewState,
} from './playback/playback-view.js';
import { createWebAudioPlayer } from './playback/web-audio-player.js';

// Composition root of the player view (built into one HTML resource by vite.playback-view.config.ts).
// No server code and no credential: the sign-in and the capability arrive only through the host's
// bridge, and every value is written through Lit text bindings.
if (!customElements.get('saga-play-control'))
  customElements.define('saga-play-control', PlayControlElement);
if (!customElements.get('saga-faithful-card-content'))
  customElements.define(
    'saga-faithful-card-content',
    FaithfulCardContentElement,
  );

const control = document.querySelector<PlayControlElement>('saga-play-control');
const title = document.querySelector<HTMLElement>(
  '[data-testid="playback-title"]',
);
const descriptionRoot = document.querySelector<HTMLElement>(
  '[data-testid="playback-description"]',
);
if (!control || !title || !descriptionRoot)
  throw new Error('playback.html is missing its control, title or description');
const descriptionHost: HTMLElement = descriptionRoot;

const app = new App({ name: 'saga-a2ui-playback-view', version: '0.0.0' });

// The description of the selected episode is shown by the optional FaithfulCard under this page's
// own trusted content view: the policy, the opening of links and image consent belong to the page,
// never to the description. The player resource is served verbatim and may connect only to the
// media origin, so it embeds no policy (an embedded one forbids every connection). The card
// therefore runs the default Standard policy with no image host: it loads no image, and a link
// opens only through the host.
const content = contentViewFromDocument(document, hostLinksFromApp(app));
if (content.ok) provideContentView(descriptionHost, content.view);

// The view is over (host teardown, disposal or a lost sign-in label): no card may be shown again.
let cardEnded = false;

/**
 * What the controller tells the page about the selection's end. Image consent keeps its one owner,
 * the content view's scope. On the terminal call the page also removes the card: a card that
 * stayed mounted would keep its revision current, so a retained safe link would still ask the
 * host to open it and a host answer still pending would still be shown. Removing the element
 * retires both (the card ends its consent and invalidates its link results when it leaves the
 * document), and `cardEnded` keeps any later presentation from mounting another.
 */
const contentConsent = content.ok
  ? {
      revokeAll: () => content.view.consent.revokeAll(),
      retire() {
        content.view.consent.retire();
        cardEnded = true;
        descriptionHost.replaceChildren();
      },
    }
  : undefined;

/**
 * Shows the selected episode's description beside the control, or nothing. One card element serves
 * the page: a new description reaches it as a changed property, which ends that card's own image
 * consent and touches nothing else. A state without an episode removes the card, and the private
 * text with it; an element that leaves the document also ends its consent and its link results.
 */
function showDescription(state: PlaybackViewState): void {
  const episode = 'episode' in state ? state.episode : undefined;
  if (cardEnded) return;
  if (!content.ok || !episode) {
    descriptionHost.replaceChildren();
    return;
  }
  let card = descriptionHost.querySelector<FaithfulCardContentElement>(
    'saga-faithful-card-content',
  );
  if (!card) {
    card = document.createElement(
      'saga-faithful-card-content',
    ) as FaithfulCardContentElement;
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
  ...(contentConsent ? { contentConsent } : {}),
  show(state: PlaybackViewState) {
    control.state = state;
    title.textContent =
      'episode' in state && state.episode ? state.episode.title : 'Player';
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

// The view ends itself, and releases the player, on `pagehide`; the action host is this page's own.
window.addEventListener('pagehide', () => actions.close());
