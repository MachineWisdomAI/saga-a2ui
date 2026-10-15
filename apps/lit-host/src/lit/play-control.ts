import { LitElement, css, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import type { PlaybackViewState } from '../playback/playback-view.js';

export type PlayControlAction = 'saga-play' | 'saga-pause' | 'saga-resume';

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
      return { status: `Ready to play ${title}.`, button: { label: 'Play', action: 'saga-play' } };
    case 'pending':
      return { status: 'Checking access…', button: { label: 'Play', action: 'saga-play' }, busy: true };
    case 'playing':
      return { status: `Playing ${title}.`, button: { label: 'Pause', action: 'saga-pause' } };
    case 'paused':
      return { status: 'Paused.', button: { label: 'Resume', action: 'saga-resume' } };
    case 'ended':
      return { status: 'Finished playing.', button: { label: 'Play again', action: 'saga-play' } };
    case 'denied':
      // Signing in again does not grant a subscription, so this offers a retry, not a sign-in.
      return {
        status: 'Playback denied: this account does not have access to this episode.',
        button: { label: 'Try again', action: 'saga-play' },
      };
    case 'sign-in-required':
      return { status: 'Sign in to play this episode.', button: { label: 'Try again', action: 'saga-play' } };
    case 'expired':
      return {
        status: 'Playback access expired. Press Play to ask for access again.',
        button: { label: 'Play', action: 'saga-play' },
      };
    case 'unsupported':
      return { status: 'Playback is not supported here.' };
    case 'unavailable':
      return { status: 'Playback is unavailable right now.', button: { label: 'Try again', action: 'saga-play' } };
    case 'media-failed':
      return { status: 'The audio could not be played.', button: { label: 'Try again', action: 'saga-play' } };
    case 'gesture-needed':
      return {
        status: 'Your browser needs another press to start the audio.',
        button: { label: 'Play', action: 'saga-play' },
      };
    case 'session-changed':
      return { status: 'Your session changed. Reload to continue.' };
  }
}

/**
 * The Play control: one button and one status line for the controller's current state.
 *
 * Presentation only. It never decides whether playback is allowed; it reports the user's press as
 * an event and shows whatever state it is given.
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

  protected override willUpdate(): void {
    const button = this.renderRoot.querySelector('button');
    this.buttonHadFocus = button !== null && button === this.shadowRoot?.activeElement;
  }

  protected override updated(): void {
    if (this.buttonHadFocus && !this.renderRoot.querySelector('button')) {
      this.renderRoot.querySelector<HTMLElement>('.status')?.focus();
    }
  }

  private press(action: PlayControlAction, busy: boolean | undefined): void {
    if (busy) return; // a pending request ignores the press; the controller also suppresses it
    this.dispatchEvent(new CustomEvent(action, { bubbles: true, composed: true }));
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
            @click=${() => this.press(shown.button?.action ?? 'saga-play', shown.busy)}
          >
            ${shown.button.label}
          </button>`
        : nothing}
      <p class="status" data-testid="play-status" role="status" aria-live="polite" tabindex="-1">${shown.status}</p>
    </div>`;
  }
}
