import { LitElement, html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import type { PlaybackViewState } from '../playback/playback-view.js';

export type PlayControlAction = 'saga-play' | 'saga-pause' | 'saga-resume';

interface Presentation {
  readonly status: string;
  readonly button?: { readonly label: string; readonly action: PlayControlAction };
}

function presentationFor(state: PlaybackViewState): Presentation {
  const title = 'episode' in state && state.episode ? state.episode.title : 'this episode';
  switch (state.kind) {
    case 'no-selection':
      return { status: 'Waiting for an episode…' };
    case 'ready':
      return { status: `Ready to play ${title}.`, button: { label: 'Play', action: 'saga-play' } };
    case 'pending':
      return { status: 'Checking access…', button: { label: 'Play', action: 'saga-play' } };
    case 'playing':
      return { status: `Playing ${title}.`, button: { label: 'Pause', action: 'saga-pause' } };
    case 'paused':
      return { status: 'Paused.', button: { label: 'Resume', action: 'saga-resume' } };
    default:
      return { status: 'Playback is unavailable right now.', button: { label: 'Try again', action: 'saga-play' } };
  }
}

/**
 * The Play control: one button and one status line for the controller's current state.
 * Presentation only: it reports the press as an event and shows the state it is given; it never
 * decides whether playback is allowed.
 */
export class PlayControlElement extends LitElement {
  @property({ attribute: false }) state: PlaybackViewState = { kind: 'no-selection' };

  protected override render() {
    const shown = presentationFor(this.state);
    return html`<div data-testid="play-root" data-state=${this.state.kind}>
      ${shown.button
        ? html`<button
            type="button"
            data-testid="play-button"
            @click=${() => this.dispatchEvent(new CustomEvent(shown.button?.action ?? 'saga-play', { bubbles: true, composed: true }))}
          >
            ${shown.button.label}
          </button>`
        : nothing}
      <p data-testid="play-status" role="status" aria-live="polite">${shown.status}</p>
    </div>`;
  }
}
