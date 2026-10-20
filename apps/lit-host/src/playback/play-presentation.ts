import type { PlayControlEvents, PlaybackViewState } from './playback-view.js';

/** The event of the Play control a press delivers: the name of the action slot it feeds. */
export type PlayControlAction = keyof PlayControlEvents;

/** What a Play control shows for one controller state. The wording is shared by every renderer. */
export interface Presentation {
  readonly status: string;
  /** Absent when there is nothing the user can usefully press. */
  readonly button?: { readonly label: string; readonly action: PlayControlAction };
  /** Pending keeps the button in place and focusable, but a press does nothing. */
  readonly busy?: boolean;
}

/** The title of the page for a state: the selected episode's, or a neutral one. */
export function titleFor(state: PlaybackViewState): string {
  return 'episode' in state && state.episode ? state.episode.title : 'Player';
}

export function presentationFor(state: PlaybackViewState): Presentation {
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
