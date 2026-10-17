import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/client';
import { connectToolResultView, type ToolResult, type ToolResultViewConnection } from '@saga-a2ui/mcp/view';
import { CAPABILITY_HEADER, PROOF_HEADER } from './media-proof.js';
import {
  MEDIA_PATH_PREFIX,
  OpenedEpisodeSchema,
  PLAY_TOOL_NAME,
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
        | 'sign-in-required'
        | 'expired'
        | 'unsupported'
        | 'unavailable'
        | 'media-failed'
        | 'gesture-needed'
        | 'session-changed';
      readonly episode?: OpenedEpisode;
    };

export interface PlaybackViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  readonly player: AudioPlayer;
  /** Presents a state. Each call replaces everything shown before it. */
  readonly show: (state: PlaybackViewState) => void;
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

/**
 * Presents one episode with a Play control and owns the one foreground player.
 *
 * Request discipline: a Play press starts one request, identified by a generation number. Anything
 * that retires the request (a new press after a failure, a changed selection or sign-in, a denial,
 * disposal) advances the generation, aborts the byte fetch and stops the player, so a late success
 * finds a different generation and is dropped before any media is mounted. Duplicate presses while
 * a request is pending or audio is playing are ignored.
 *
 * Trust: the response is accepted only if it names the selected episode, the pinned sign-in and a
 * media URL for that same episode. The sign-in label is freshness only; the server authorizes every
 * Play and every media acquisition. A retry never reuses saved authorization: it is a new Play.
 */
export async function connectPlaybackView(deps: PlaybackViewDependencies): Promise<PlaybackViewConnection> {
  const { app, player } = deps;
  let selected: OpenedEpisode | undefined;
  let pinnedSession: string | undefined;
  let kind: PlaybackViewState['kind'] = 'no-selection';
  let generation = 0;
  let abort: AbortController | undefined;
  let disposed = false;
  // The Pause or Resume the player has not yet confirmed. The shown state stays the one the user
  // last saw until the player reports what the audio actually did.
  let settlingCounter = 0;
  let settling: number | undefined;
  // The start the player has not yet confirmed, and whether the audio ended while it was waiting.
  let starting: { readonly generation: number; ended: boolean } | undefined;

  const present = (state: PlaybackViewState) => {
    kind = state.kind;
    if (!disposed) deps.show(state);
  };

  /** Retires any pending request and stops the player; nothing audible or fetchable survives. */
  const retire = () => {
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

  player.onEnded(() => {
    if (!selected) return;
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
    if (settling !== undefined || !selected) return;
    const episode = selected;
    settlingCounter += 1;
    const mine = settlingCounter;
    settling = mine;
    const current = () => settling === mine && !disposed;
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
    if (disposed) return;
    const opened = result.isError ? undefined : OpenedEpisodeSchema.safeParse(result.structuredContent);
    if (!opened?.success) return clearWith({ kind: 'unavailable', ...(selected ? { episode: selected } : {}) });
    if (pinnedSession !== undefined && opened.data.viewSession !== pinnedSession) {
      selected = undefined;
      return clearWith({ kind: 'session-changed' });
    }
    pinnedSession = opened.data.viewSession;
    selected = opened.data;
    clearWith({ kind: 'ready', episode: opened.data });
  };

  /** Fetches the protected bytes with the capability and a fresh proof from the bound key. */
  async function acquire(view: ViewPlayback, key: Awaited<ReturnType<typeof createRecipientKey>>, signal: AbortSignal): Promise<Acquisition> {
    try {
      const proof = await signMediaProof(key, { capability: view.capability, url: view.mediaUrl });
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

  async function run(episode: OpenedEpisode, mine: number): Promise<void> {
    const current = () => mine === generation && !disposed;
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
    if (!current()) return;

    let result: ToolResult;
    try {
      result = await app.callServerTool({
        name: PLAY_TOOL_NAME,
        arguments: { episodeId: episode.episodeId },
        _meta: { [RECIPIENT_KEY_META]: key.publicJwk },
      });
    } catch {
      // The host refused the proxied call (the listener's 401/403, before any tool handler).
      if (current()) clearWith({ kind: 'sign-in-required', episode });
      return;
    }
    if (!current()) return; // retired while waiting: a late success must not restore anything

    if (result.isError) {
      const text = result.content?.find((part) => part.type === 'text')?.text;
      if (text === PLAYBACK_DENIED_TEXT) return clearWith({ kind: 'denied', episode });
      if (text === PLAYBACK_UNSUPPORTED_TEXT) return clearWith({ kind: 'unsupported', episode });
      return clearWith({ kind: 'unavailable', episode });
    }
    const granted = ViewPlaybackSchema.safeParse(result._meta?.[PLAYBACK_RESULT_META]);
    if (!granted.success || !acceptable(granted.data, episode)) {
      const changed = granted.success && granted.data.viewSession !== pinnedSession;
      return clearWith({ kind: changed ? 'session-changed' : 'unavailable', episode });
    }

    const media = await acquire(granted.data, key, controller.signal);
    if (!current()) return;
    if (media.kind === 'refused') return clearWith({ kind: 'expired', episode });
    if (media.kind === 'failed') return clearWith({ kind: 'media-failed', episode });

    // Audio that is short enough can end before the player confirms it started. That end belongs to
    // this request, so it is remembered here and wins over the late `started` result.
    const awaited = { generation: mine, ended: false };
    starting = awaited;
    try {
      const started = await player.start(media.bytes);
      if (!current()) return player.stop();
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
    onTeardown: retire,
  });

  return {
    play() {
      if (disposed || !selected) return;
      if (kind === 'pending' || kind === 'playing' || kind === 'paused' || kind === 'resume-blocked' || kind === 'session-changed') return;
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
