import type { InstanceHost, OpenInstance } from '@saga-a2ui/core/actions';
import { LitElement, css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { PLAY_CONTROL_ID, PlayControl, type PlayControlEvents, type PlaybackViewState } from '../playback/playback-view.js';

/** The event of this control a press delivers: the name of the action slot it feeds. */
export type PlayControlAction = keyof PlayControlEvents;

interface Presentation {
  readonly status: string;
  /** Absent when there is nothing the user can usefully press. */
  readonly button?: { readonly label: string; readonly action: PlayControlAction };
  /** Pending keeps the button in place and focusable, but a press does nothing. */
  readonly busy?: boolean;
}

function presentationFor(state: PlaybackViewState): Presentation {
  const title = 'episode' in state && state.episode ? state.episode.title : 'this episode';
  switch (state.kind) {
    case 'no-selection':
      return { status: 'Waiting for an episode…' };
    case 'ready':
      return { status: `Ready to play ${title}.`, button: { label: 'Play', action: 'play' } };
    case 'pending':
      return { status: 'Checking access…', button: { label: 'Play', action: 'play' }, busy: true };
    case 'playing':
      return { status: `Playing ${title}.`, button: { label: 'Pause', action: 'pause' } };
    case 'paused':
      return { status: 'Paused.', button: { label: 'Resume', action: 'resume' } };
    case 'resume-blocked':
      // The audio is still paused where it stopped; another press, not a new authorization, retries.
      return {
        status: 'Your browser needs another press to continue the audio.',
        button: { label: 'Resume', action: 'resume' },
      };
    case 'ended':
      return { status: 'Finished playing.', button: { label: 'Play again', action: 'play' } };
    case 'denied':
      // Signing in again does not grant a subscription, so this offers a retry, not a sign-in.
      return {
        status: 'Playback denied: this account does not have access to this episode.',
        button: { label: 'Try again', action: 'play' },
      };
    case 'expired':
      return {
        status: 'Playback access expired. Press Play to ask for access again.',
        button: { label: 'Play', action: 'play' },
      };
    case 'unsupported':
      return { status: 'Playback is not supported here.' };
    case 'unavailable':
      // The request may have reached the server and nothing says what it did, so pressing again is
      // not offered: opening the episode again starts a fresh attempt with a fresh view of access.
      if (state.requestOutcome === 'unknown') {
        return { status: 'Playback could not be confirmed. Open this episode again to try playing it.' };
      }
      return { status: 'Playback is unavailable right now.', button: { label: 'Try again', action: 'play' } };
    case 'media-failed':
      return { status: 'The audio could not be played.', button: { label: 'Try again', action: 'play' } };
    case 'gesture-needed':
      return {
        status: 'Your browser needs another press to start the audio.',
        button: { label: 'Play', action: 'play' },
      };
    case 'session-changed':
      return { status: 'Your session changed. Open a new view or reload to continue.' };
  }
}

/**
 * The Play control: one button and one status line for the controller's current state.
 *
 * Presentation only. It never decides whether playback is allowed; it hands the user's press, still
 * inside the click event, to whatever action the application bound to this exact rendered instance,
 * and shows whatever state it is given. It opens one instance on the host it is given and retires it
 * when it leaves the document; the application's setup finds it by `PLAY_CONTROL_ID` and binds to it.
 *
 * Accessibility: the button stays in place and focusable while a request is pending (it is marked
 * `aria-disabled` and `aria-busy` rather than removed or `disabled`), so a keyboard user is not
 * stranded; every change is announced through one polite status region; and when a state removes
 * the button while it had focus, focus moves to the status instead of falling to the page.
 * Layout wraps instead of overflowing, so it reflows at a 320px width and with enlarged text.
 */
export class PlayControlElement extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 100%;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
    }
    .root {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    button {
      box-sizing: border-box;
      max-width: 100%;
      min-width: 2.75rem;
      min-height: 2.75rem;
      padding: 0.5rem 1rem;
      font: inherit;
      white-space: normal;
      cursor: pointer;
    }
    button[aria-disabled='true'] {
      cursor: progress;
      opacity: 0.7;
    }
    button:focus-visible,
    .status:focus-visible {
      outline: 3px solid Highlight;
      outline-offset: 2px;
    }
    .status {
      flex: 1 1 12rem;
      min-width: 0;
      margin: 0;
      overflow-wrap: anywhere;
    }
  `;

  @property({ attribute: false }) state: PlaybackViewState = { kind: 'no-selection' };

  private buttonHadFocus = false;
  #host: InstanceHost | undefined;
  #instance: OpenInstance<PlayControlEvents> | undefined;

  /** The action host this control opens its instance on. Set once, before or after it connects. */
  get host(): InstanceHost | undefined {
    return this.#host;
  }
  set host(value: InstanceHost | undefined) {
    if (value === this.#host) return;
    this.#retire();
    this.#host = value;
    this.#open();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#open();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#retire();
  }

  #open(): void {
    const host = this.#host;
    if (!host || this.#instance || !this.isConnected) return;
    this.#instance = host.open<PlayControlEvents>({
      kind: PlayControl,
      componentId: PLAY_CONTROL_ID,
      dataPath: '/',
      events: ['play', 'pause', 'resume'],
      // A fresh pull on every call: the control left the document, or was given another host.
      isLive: () => this.isConnected && this.#host === host,
      read: () => undefined, // the control shows no data scope of its own
    });
  }

  #retire(): void {
    this.#instance?.retire();
    this.#instance = undefined;
  }

  protected override willUpdate(): void {
    const button = this.renderRoot.querySelector('button');
    this.buttonHadFocus = button !== null && button === this.shadowRoot?.activeElement;
  }

  protected override updated(): void {
    if (this.buttonHadFocus && !this.renderRoot.querySelector('button')) {
      this.renderRoot.querySelector<HTMLElement>('.status')?.focus();
    }
  }

  private press(action: PlayControlAction, busy: boolean | undefined, event: Event): void {
    if (busy) return; // a pending request ignores the press; the bound action's busy policy also does
    // Synchronous, inside the click: the bound action's activation prefix runs in this call stack.
    this.#instance?.activate(action, event);
  }

  protected override render() {
    const shown = presentationFor(this.state);
    return html`<div class="root" data-testid="play-root" data-state=${this.state.kind}>
      ${shown.button
        ? html`<button
            type="button"
            data-testid="play-button"
            aria-disabled=${shown.busy ? 'true' : 'false'}
            aria-busy=${shown.busy ? 'true' : 'false'}
            @click=${(event: Event) => this.press(shown.button?.action ?? 'play', shown.busy, event)}
          >
            ${shown.button.label}
          </button>`
        : nothing}
      <p class="status" data-testid="play-status" role="status" aria-live="polite" tabindex="-1">${shown.status}</p>
    </div>`;
  }
}
