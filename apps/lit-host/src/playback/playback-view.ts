import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/client';
import { startBoundedTimer } from '@saga-a2ui/mcp/policy';
import { connectToolResultView, type ToolResult, type ToolResultViewConnection } from '@saga-a2ui/mcp/view';
import { CAPABILITY_HEADER, PROOF_HEADER } from './media-proof.js';
import {
  MEDIA_PATH_PREFIX,
  OpenedEpisodeSchema,
  HOST_CALL_SAFEGUARD_MS,
  PLAY_TOOL_NAME,
  PLAYBACK_ATTEMPT_LIMIT_MS,
  PLAYBACK_DENIED_TEXT,
  PLAYBACK_RESULT_META,
  PLAYBACK_UNSUPPORTED_TEXT,
  RECIPIENT_KEY_META,
  ViewPlaybackSchema,
  type OpenedEpisode,
  type ViewPlayback,
} from './playback.js';
import { createRecipientKey, signMediaProof } from './recipient-proof.js';

/** The one foreground player. A seam so the controller is exercised without audio hardware. */
export interface AudioPlayer {
  /** Called synchronously inside the user's activation, before any asynchronous authorization. */
  prepare(): void;
  /**
   * Decodes and starts the bytes. Resolves `started` only once audio is actually advancing, and
   * `blocked` when the browser withheld audio and needs a new user gesture. Rejects when the
   * bytes cannot be decoded or played. A `stop()` during the call makes it reject.
   */
  start(bytes: ArrayBuffer): Promise<'started' | 'blocked'>;
  /**
   * Suspends the audio. Called synchronously inside the user's activation. Resolves once the audio
   * is actually suspended; rejects when it cannot be. A `stop()` during the call makes it reject.
   */
  pause(): Promise<void>;
  /**
   * Continues the audio. Called synchronously inside the user's activation. Resolves `resumed`
   * only once audio is actually advancing again, and `blocked` when the browser withheld audio and
   * needs a new user gesture. Rejects when the audio cannot continue. A `stop()` during the call
   * makes it reject.
   */
  resume(): Promise<'resumed' | 'blocked'>;
  /** Stops and releases everything the player holds. Idempotent. */
  stop(): void;
  /** Registers the one listener told when audio plays to its end, possibly before `start` settles. */
  onEnded(listener: () => void): void;
}

/** What the view presents. Only the state names carry meaning; wording belongs to the presenter. */
export type PlaybackViewState =
  | { readonly kind: 'no-selection' }
  | { readonly kind: 'ready' | 'pending' | 'playing' | 'paused' | 'ended'; readonly episode: OpenedEpisode }
  | {
      readonly kind:
        | 'resume-blocked'
        | 'denied'
        | 'expired'
        | 'unsupported'
        | 'media-failed'
        | 'gesture-needed'
        | 'session-changed';
      readonly episode?: OpenedEpisode;
    }
  | {
      readonly kind: 'unavailable';
      readonly episode?: OpenedEpisode;
      /**
       * `unknown` when the Play request may have reached the server and nothing says what it did
       * (a rejected or expired host call, a generic tool error, or an unusable grant): a capability
       * may have been issued. The view then invites no retry; a new opener starts a fresh attempt.
       * Absent when nothing was sent, or when a known result came back.
       */
      readonly requestOutcome?: 'unknown';
    };

export interface PlaybackViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  readonly player: AudioPlayer;
  /** Presents a state. Each call replaces everything shown before it. */
  readonly show: (state: PlaybackViewState) => void;
  /**
   * The longest one Play attempt may stay pending, from the press to audio advancing. Must be a
   * finite positive number. Defaults to `PLAYBACK_ATTEMPT_LIMIT_MS`; progress never extends it.
   */
  readonly attemptLimitMs?: number;
}

/** The view was configured with an unusable bound. Raised before anything is requested. */
export class PlaybackConfigurationError extends Error {
  constructor(problem: string) {
    super(`The playback view is not configured: ${problem}.`);
    this.name = 'PlaybackConfigurationError';
  }
}

export interface PlaybackViewConnection extends ToolResultViewConnection {
  /** The user's Play activation. Must be called synchronously from the user's event. */
  play(): void;
  pause(): void;
  resume(): void;
}

/** Outcome of acquiring one episode's bytes, kept apart from the server's completed Play response. */
type Acquisition =
  | { readonly kind: 'bytes'; readonly bytes: ArrayBuffer }
  | { readonly kind: 'refused' } // the media service said no: expired or revoked
  | { readonly kind: 'failed' }; // the network or the response body failed

/** What a resolved Play result establishes. Only `unclassified` leaves the server's effect unknown. */
type PlayAnswer =
  | { readonly kind: 'denied' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'label-lost' }
  | { readonly kind: 'unclassified' }
  | { readonly kind: 'grant'; readonly grant: ViewPlayback };

/**
 * Presents one episode with a Play control and owns the one foreground player.
 *
 * Request discipline: a Play press starts one request, identified by a generation number. Anything
 * that retires the request (a new press after a failure, a changed selection or sign-in, a denial,
 * disposal) advances the generation, aborts the byte fetch and stops the player, so a late success
 * finds a different generation and is dropped before any media is mounted. Duplicate presses while
 * a request is pending or audio is playing are ignored.
 *
 * Teardown: the host's teardown request stops the audio and retires the controller (`tornDown`):
 * Play, Pause, Resume, the end event and every continuation of an earlier press then do nothing.
 * It does not dispose the connection; the later `dispose()` still closes it once. A start that
 * settles for a retired press releases the player only if no later press has taken it over.
 *
 * Time: one attempt bound (`attemptLimitMs`) starts at the press, before the key is created, and
 * covers every client stage after it. It is cleared by any outcome and by retirement, never by a
 * successful start (the audio keeps playing), and nothing that happens inside the attempt renews
 * it. On expiry the attempt is retired like any other end: its signal aborts, the player stops, and
 * the view says `unavailable`, inviting no retry when a request may already have reached the server
 * with an unknown effect. The host call also gets the attempt's signal and a timeout no wider than
 * what the attempt has left.
 *
 * Label loss: an opener or a grant under a label other than the pinned one ends this view for good.
 * The selection is cleared, the player stops, and `session-changed` stays: every later opener (the
 * old label, the new one or an unreadable one) is ignored, and Play, Pause and Resume do nothing.
 * Recovery is a new view or a reload, which pins its own label. The loss is detected only when a
 * result carries a different label; a delayed opener under the same label cannot be told apart.
 *
 * Trust: the response is accepted only if it names the selected episode, the pinned sign-in and a
 * media URL for that same episode. The sign-in label is freshness only; the server authorizes every
 * Play and every media acquisition. A retry never reuses saved authorization: it is a new Play.
 */
export async function connectPlaybackView(deps: PlaybackViewDependencies): Promise<PlaybackViewConnection> {
  const { app, player } = deps;
  const attemptLimitMs: unknown = deps.attemptLimitMs ?? PLAYBACK_ATTEMPT_LIMIT_MS;
  if (typeof attemptLimitMs !== 'number' || !Number.isFinite(attemptLimitMs) || attemptLimitMs <= 0) {
    throw new PlaybackConfigurationError('attemptLimitMs must be a finite positive number');
  }
  let selected: OpenedEpisode | undefined;
  let pinnedSession: string | undefined;
  let kind: PlaybackViewState['kind'] = 'no-selection';
  let generation = 0;
  let abort: AbortController | undefined;
  // The host asked the view to tear down. This retires the view's own work and presentation but is
  // not `disposed`: that flag makes `dispose()` return before it reaches the bridge, and the host's
  // teardown does not close the connection, so the later `dispose()` must still close it once.
  let tornDown = false;
  let disposed = false;
  // The pinned label was lost through an opener or a grant. Unlike the per-request generation, this
  // is permanent for the view: nothing clears it, so no later result can reactivate the controller.
  let labelLost = false;
  // The generation of the latest Play press, which owns the player's one resource. A start that
  // settles for an earlier press may release the player only while no later press has taken it.
  let latestPlay = 0;
  // The Pause or Resume the player has not yet confirmed. The shown state stays the one the user
  // last saw until the player reports what the audio actually did.
  let settlingCounter = 0;
  let settling: number | undefined;
  // The start the player has not yet confirmed, and whether the audio ended while it was waiting.
  let starting: { readonly generation: number; ended: boolean } | undefined;

  // The one timer and deadline of the attempt in flight. Both are cleared together.
  let cancelAttemptTimer: (() => void) | undefined;
  let attemptDeadline = 0;
  // How far the attempt got, which decides what the view may say about the server's part in it.
  // `grant-known` is reached only by a classified answer (a precise early refusal or a valid grant);
  // a resolved call that is a generic error or an unusable grant stays `request-sent`.
  let reached: 'nothing-sent' | 'request-sent' | 'grant-known' = 'nothing-sent';

  const retired = () => disposed || tornDown || labelLost;

  const disarmAttempt = () => {
    cancelAttemptTimer?.();
    cancelAttemptTimer = undefined;
  };

  const present = (state: PlaybackViewState) => {
    kind = state.kind;
    // Any outcome other than pending ends the attempt's clock. Playing is an outcome: the audio
    // continues, only the bound on getting there is over.
    if (state.kind !== 'pending') disarmAttempt();
    if (!retired()) deps.show(state);
  };

  /** Retires any pending request and stops the player; nothing audible or fetchable survives. */
  const retire = () => {
    disarmAttempt();
    generation += 1;
    settling = undefined;
    abort?.abort();
    abort = undefined;
    player.stop();
  };

  const clearWith = (state: PlaybackViewState) => {
    retire();
    present(state);
  };

  /**
   * Starts the attempt's clock for the press that was just made. The deadline is absolute: nothing
   * done later in the attempt moves it. If the attempt is still the current one and still pending
   * when it passes, it ends like any other failure, and what the view may say depends on how far the
   * attempt got: a request that may have reached the server has an unknown outcome.
   */
  const armAttempt = (mine: number, episode: OpenedEpisode) => {
    disarmAttempt();
    attemptDeadline = performance.now() + attemptLimitMs;
    // Segmented, so an accepted limit above the native timer's maximum is not cut to about a millisecond.
    cancelAttemptTimer = startBoundedTimer(attemptLimitMs, () => {
      cancelAttemptTimer = undefined;
      if (mine !== generation || retired() || kind !== 'pending') return;
      expireAttempt(episode);
    });
  };

  const expireAttempt = (episode: OpenedEpisode) =>
    clearWith(reached === 'request-sent' ? { kind: 'unavailable', episode, requestOutcome: 'unknown' } : { kind: 'unavailable', episode });

  /**
   * Whether the attempt's deadline has passed and it was ended here. A timer is not the only witness:
   * work that blocked the thread, or a continuation delivered before the timer, reaches the next stage
   * after the deadline with the timer still waiting. Every continuation asks this before it goes on.
   */
  const attemptOver = (mine: number, episode: OpenedEpisode): boolean => {
    if (mine !== generation || retired() || kind !== 'pending' || performance.now() < attemptDeadline) return false;
    expireAttempt(episode);
    return true;
  };

  /**
   * Ends the view after the pinned label was lost: clears the selection, stops the player and shows
   * `session-changed`. The flag is set last and never cleared, so every later input is inert.
   */
  const loseLabel = () => {
    selected = undefined;
    retire();
    labelLost = true;
    kind = 'session-changed';
    if (!disposed && !tornDown) deps.show({ kind: 'session-changed' });
  };

  player.onEnded(() => {
    if (!selected || retired()) return;
    if (kind === 'playing' || kind === 'paused' || kind === 'resume-blocked') {
      settling = undefined; // a Pause or Resume still in flight must not replace the end
      present({ kind: 'ended', episode: selected });
    } else if (kind === 'pending' && starting?.generation === generation) {
      starting.ended = true; // the start has not been confirmed yet: remember it for that moment
    }
  });

  /**
   * Runs one Pause or Resume and presents what the player reports. The player is called inside the
   * user's activation; the shown state changes only when it answers, and not at all if the audio
   * was retired or ended meanwhile. A player that cannot do it is a media failure.
   */
  function settle<T>(attempt: () => Promise<T>, outcome: (result: T, episode: OpenedEpisode) => PlaybackViewState): void {
    if (settling !== undefined || !selected || retired()) return;
    const episode = selected;
    settlingCounter += 1;
    const mine = settlingCounter;
    settling = mine;
    const current = () => settling === mine && !retired();
    (async () => attempt())().then(
      (result) => {
        if (!current()) return;
        settling = undefined;
        present(outcome(result, episode));
      },
      () => {
        if (current()) clearWith({ kind: 'media-failed', episode });
      },
    );
  }

  const onOpened = (result: ToolResult) => {
    if (retired()) return;
    const opened = result.isError ? undefined : OpenedEpisodeSchema.safeParse(result.structuredContent);
    if (!opened?.success) return clearWith({ kind: 'unavailable', ...(selected ? { episode: selected } : {}) });
    if (pinnedSession !== undefined && opened.data.viewSession !== pinnedSession) return loseLabel();
    pinnedSession = opened.data.viewSession;
    selected = opened.data;
    clearWith({ kind: 'ready', episode: opened.data });
  };

  /** Fetches the protected bytes with the capability and a fresh proof from the bound key. */
  async function acquire(view: ViewPlayback, key: Awaited<ReturnType<typeof createRecipientKey>>, signal: AbortSignal): Promise<Acquisition> {
    try {
      const proof = await signMediaProof(key, { capability: view.capability, url: view.mediaUrl });
      // Past the bound (the timer may not have been delivered yet): no request leaves the view now.
      if (signal.aborted || performance.now() >= attemptDeadline) return { kind: 'failed' };
      const response = await fetch(view.mediaUrl, {
        headers: { [CAPABILITY_HEADER]: view.capability, [PROOF_HEADER]: proof },
        cache: 'no-store',
        credentials: 'omit',
        // The media service never redirects. Following one would carry the capability and the
        // proof headers to a destination the application did not declare, so a redirect fails.
        redirect: 'error',
        signal,
      });
      if (response.status === 403) return { kind: 'refused' };
      if (!response.ok) return { kind: 'failed' };
      return { kind: 'bytes', bytes: await response.arrayBuffer() };
    } catch {
      return { kind: 'failed' };
    }
  }

  const acceptable = (view: ViewPlayback, episode: OpenedEpisode): boolean => {
    if (view.episodeId !== episode.episodeId || view.viewSession !== pinnedSession) return false;
    try {
      const url = new URL(view.mediaUrl);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === `${MEDIA_PATH_PREFIX}${episode.episodeId}`;
    } catch {
      return false;
    }
  };

  /**
   * Reads a resolved Play result without trusting the transport. Only the server's two fixed early
   * refusals (both made before any capability exists) and a valid grant for the selected episode
   * establish a known outcome. Every other answer is `unclassified`: a generic tool error or an
   * unusable grant does not show that no capability was issued (the server issues one before it
   * finishes building the response), so it is never matched on its wording or its origin.
   */
  const classifyAnswer = (result: ToolResult, episode: OpenedEpisode): PlayAnswer => {
    if (result.isError) {
      const text = result.content?.find((part) => part.type === 'text')?.text;
      if (text === PLAYBACK_DENIED_TEXT) return { kind: 'denied' };
      if (text === PLAYBACK_UNSUPPORTED_TEXT) return { kind: 'unsupported' };
      return { kind: 'unclassified' };
    }
    const granted = ViewPlaybackSchema.safeParse(result._meta?.[PLAYBACK_RESULT_META]);
    if (!granted.success) return { kind: 'unclassified' };
    // A well-formed grant under another label proves the sign-in changed, whatever it names.
    if (granted.data.viewSession !== pinnedSession) return { kind: 'label-lost' };
    return acceptable(granted.data, episode) ? { kind: 'grant', grant: granted.data } : { kind: 'unclassified' };
  };

  async function run(episode: OpenedEpisode, mine: number): Promise<void> {
    const current = () => mine === generation && !retired();
    if (!app.getHostCapabilities()?.serverTools) return present({ kind: 'unsupported', episode });
    const controller = new AbortController();
    abort = controller;

    let key;
    try {
      key = await createRecipientKey();
    } catch {
      if (current()) present({ kind: 'unsupported', episode });
      return;
    }
    if (!current() || attemptOver(mine, episode)) return;

    let result: ToolResult;
    reached = 'request-sent';
    try {
      result = await app.callServerTool(
        {
          name: PLAY_TOOL_NAME,
          arguments: { episodeId: episode.episodeId },
          _meta: { [RECIPIENT_KEY_META]: key.publicJwk },
        },
        {
          signal: controller.signal,
          // No wider than what the attempt has left or the transport's own safeguard, and progress
          // from the host never extends it (the App's default would).
          timeout: Math.max(1, Math.min(attemptDeadline - performance.now(), HOST_CALL_SAFEGUARD_MS)),
          resetTimeoutOnProgress: false,
        },
      );
    } catch {
      // A rejection, a timeout and an abort look the same from here: the host may or may not have
      // forwarded the call, so this does not say the credential was refused, and the outcome of the
      // request is unknown.
      if (current()) clearWith({ kind: 'unavailable', episode, requestOutcome: 'unknown' });
      return;
    }
    if (!current()) return; // retired while waiting: a late success must not restore anything

    // Classify the answer before anything decides expiry or recovery. A transport that resolved says
    // nothing about the server's effect: only a precise early refusal or a valid grant for this
    // episode and sign-in establishes a known result. Any other answer leaves the request's effect
    // unknown (`reached` stays 'request-sent'), whether the bound has passed or not.
    const answer = classifyAnswer(result, episode);
    if (answer.kind !== 'unclassified') reached = 'grant-known';
    if (attemptOver(mine, episode)) return; // answered, but after the bound: the result is dropped

    if (answer.kind === 'unclassified') return clearWith({ kind: 'unavailable', episode, requestOutcome: 'unknown' });
    if (answer.kind === 'denied') return clearWith({ kind: 'denied', episode });
    if (answer.kind === 'unsupported') return clearWith({ kind: 'unsupported', episode });
    if (answer.kind === 'label-lost') return loseLabel();

    const media = await acquire(answer.grant, key, controller.signal);
    if (!current() || attemptOver(mine, episode)) return;
    if (media.kind === 'refused') return clearWith({ kind: 'expired', episode });
    if (media.kind === 'failed') return clearWith({ kind: 'media-failed', episode });

    // Audio that is short enough can end before the player confirms it started. That end belongs to
    // this request, so it is remembered here and wins over the late `started` result.
    const awaited = { generation: mine, ended: false };
    starting = awaited;
    try {
      const started = await player.start(media.bytes);
      if (!current()) {
        // Release what this press started, unless a later press has since taken the player over.
        if (latestPlay === mine) player.stop();
        return;
      }
      if (attemptOver(mine, episode)) return; // started after the bound: ending the attempt stops the player
      if (awaited.ended) return present({ kind: 'ended', episode });
      if (started === 'blocked') return clearWith({ kind: 'gesture-needed', episode });
      present({ kind: 'playing', episode });
    } catch {
      // The bytes arrived; the browser could not play them. That is not a server denial.
      if (current()) clearWith({ kind: 'media-failed', episode });
    } finally {
      if (starting === awaited) starting = undefined;
    }
  }

  const connection = await connectToolResultView({
    app,
    transport: deps.transport,
    onToolResult: onOpened,
    // The host ends the connection right after it answers teardown, so audio must stop now.
    onTeardown() {
      tornDown = true;
      retire();
    },
  });

  return {
    play() {
      if (retired() || !selected) return;
      if (kind === 'pending' || kind === 'playing' || kind === 'paused' || kind === 'resume-blocked') return;
      const episode = selected;
      // Retire first: stopping releases the player's context, so preparing before it would
      // destroy the context this press just unlocked.
      retire();
      // Still inside the user's activation: unlock audio now, before any asynchronous authorization.
      // A browser with no Web Audio cannot play at all, so nothing protected is requested for it.
      try {
        player.prepare();
      } catch {
        present({ kind: 'unsupported', episode });
        return;
      }
      present({ kind: 'pending', episode });
      latestPlay = generation;
      reached = 'nothing-sent';
      armAttempt(generation, episode);
      void run(episode, generation);
    },
    pause() {
      if (kind !== 'playing') return;
      settle(
        () => player.pause(),
        (_, episode) => ({ kind: 'paused', episode }),
      );
    },
    resume() {
      if (kind !== 'paused' && kind !== 'resume-blocked') return;
      settle(
        () => player.resume(),
        (resumed, episode) => ({ kind: resumed === 'resumed' ? 'playing' : 'resume-blocked', episode }),
      );
    },
    dispose() {
      if (disposed) return;
      retire();
      disposed = true;
      connection.dispose();
    },
  };
}
