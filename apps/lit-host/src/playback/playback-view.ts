import type { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult, Transport } from '@modelcontextprotocol/client';
import {
  Action,
  ActionError,
  componentKind,
  prerequisite,
  proceed,
  refuse,
  type ActionBinding,
  type ActionDefinition,
  type ErrorCategory,
  type Held,
  type InstanceEvent,
  type InstanceHandle,
  type InstanceView,
  type ServerTransport,
} from '@saga-a2ui/core/actions';
import { connectToolResultView, type ToolResult, type ToolResultViewConnection } from '@saga-a2ui/mcp/view';
import { CAPABILITY_HEADER, PROOF_HEADER } from './media-proof.js';
import {
  MEDIA_PATH_PREFIX,
  OpenedEpisodeSchema,
  HOST_CALL_SAFEGUARD_MS,
  PLAY_TOOL_NAME,
  PLAYBACK_DENIED_TEXT,
  PLAYBACK_RESULT_META,
  PLAYBACK_UNSUPPORTED_TEXT,
  RECIPIENT_KEY_META,
  ViewPlaybackSchema,
  type OpenedEpisode,
  type ViewPlayback,
} from './playback.js';
import { createPlayerOwner, type PlaybackLease } from './player-owner.js';
import { createRecipientKey, signMediaProof, type RecipientKey } from './recipient-proof.js';

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
       * (a rejected or expired host call, a generic tool error, an unusable grant, or the work
       * deadline passing after the request was sent): a capability may have been issued. The view
       * then invites no retry; a new opener starts a fresh attempt. Absent when nothing was sent,
       * or when a known result came back.
       */
      readonly requestOutcome?: 'unknown';
    };

/** The component ID the application's setup looks the rendered Play control up by. */
export const PLAY_CONTROL_ID = 'saga-play-control';

/**
 * The events the rendered Play control offers. Each is the user's own press on the control's
 * button, delivered by the control itself to the action bound to it; nothing routes by name.
 */
export interface PlayControlEvents {
  readonly play: InstanceEvent<unknown>;
  readonly pause: InstanceEvent<unknown>;
  readonly resume: InstanceEvent<unknown>;
}

/** The directly imported token application setup passes to `watchById`. */
export const PlayControl = componentKind<PlayControlEvents>('PlayControl');

/**
 * The two ways this view ends the reader's image consent for a description card shown beside the
 * control. The card's view owns the consent itself (`ContentView.consent`, an image consent scope
 * satisfies this interface); the controller only says when the selection it shows has ended.
 */
export interface ContentConsentEnding {
  /** A new selection is arriving: consent given for the previous one ends. The view stays live. */
  revokeAll(): void;
  /**
   * The view is over (teardown, disposal, a lost sign-in label): nothing still shown may grant consent,
   * and the page ends the card itself, so no retained control of it can act afterwards. Told once.
   */
  retire(): void;
}

export interface PlaybackViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  readonly player: AudioPlayer;
  /** Presents a state. Each call replaces everything shown before it. */
  readonly show: (state: PlaybackViewState) => void;
  /**
   * Present only when the page shows a description card beside the control; a standalone player
   * needs none. Revoked before every opener is presented (a new opener is a new selection even for
   * an unchanged description), retired for good with the view. Consent and Play have separate
   * lifetimes: a press, a Play in flight and its outcome never touch it.
   */
  readonly contentConsent?: ContentConsentEnding;
}

export interface PlaybackViewConnection extends ToolResultViewConnection {
  /**
   * Application setup for the rendered Play control. Pass it to `InstanceHost.register`: it binds
   * the Play, Pause and Resume actions directly to the exact control instance the host delivers.
   * Their limits are the host's (`createInstanceHost({ limits })`), so the work deadline and the
   * hook budget are the shared runtime's, resolved per setting like any other action's.
   */
  readonly attach: (view: InstanceView) => void;
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

/** How far one Play got, which decides what the view may say about the server's part in it. */
type Reached = 'nothing-sent' | 'request-sent' | 'grant-known';

/** Why a Play handler stopped, as the application's own typed cause. It carries no capability. */
type PlayFailureKind = 'denied' | 'unsupported' | 'label-lost' | 'unknown-effect' | 'expired' | 'media-failed';

const failureCategory: Readonly<Record<PlayFailureKind, ErrorCategory>> = {
  denied: 'permission-denied',
  unsupported: 'application',
  'label-lost': 'application',
  'unknown-effect': 'unknown',
  expired: 'application',
  'media-failed': 'unavailable',
};

class PlayFailure extends ActionError {
  constructor(
    readonly failure: PlayFailureKind,
    cause?: unknown,
  ) {
    super(failureCategory[failure], `Play stopped: ${failure}.`, cause === undefined ? undefined : { cause });
    this.name = 'PlayFailure';
  }
}

/** A press the controller does not take (nothing selected, already pending or playing, retired). */
class PressIgnored extends Error {
  constructor() {
    super('This press is not available in the current state.');
    this.name = 'PressIgnored';
  }
}

/** What Play's handler and hooks share for one invocation, returned from the synchronous prefix. */
interface PlayActivation {
  readonly lease: PlaybackLease;
  readonly held: Held<PlaybackLease>;
  /** Written by the handler as it goes; read by the failure hook. Never leaves the invocation. */
  reached: Reached;
}

/** What a resolved Play handler returned. A failure is thrown, not returned. */
type PlayResult =
  | { readonly kind: 'playing'; readonly lease: PlaybackLease }
  | { readonly kind: 'gesture-needed' }
  /** The handler found itself obsolete; the runtime has decided or will decide cancellation. */
  | { readonly kind: 'abandoned' };

const STATES_THAT_BLOCK_PLAY: ReadonlySet<PlaybackViewState['kind']> = new Set(['pending', 'playing', 'paused', 'resume-blocked']);

/**
 * Presents one episode with a Play control and owns the one foreground player.
 *
 * Play is one server action built with `Action.server` and bound directly to the rendered control
 * (the playback mapping "one action work interval"): a single invocation spans every pending stage.
 * The synchronous prefix (`input`, `atActivation`) selects the item, takes a lease from the player
 * owner and unlocks audio inside the user's event. The host-capability check and key creation are
 * prerequisites; the handler makes the host call, validates the grant, signs the proof, acquires
 * the body, decodes and starts the player, and on a confirmed start transfers the lease to the
 * owner with nothing awaited between. The work deadline therefore bounds key creation through the
 * start, progress cannot extend it, and the success hook (presenting `playing`) is under the hook
 * budget. Pause and Resume are local actions that call the player inside the activation.
 *
 * Request discipline: duplicate presses while a Play is pending are ignored by the binding's busy
 * policy; a press while audio is playing or paused is not taken. A changed selection is a changed
 * subject, which cancels an undecided invocation at its next checkpoint, and the owner ends the
 * audio at once. Cancellation never claims the server stopped.
 *
 * Teardown: the host's teardown request disposes the bindings and stops the audio, then retires the
 * controller (`tornDown`): every continuation of an earlier press does nothing. It does not dispose
 * the connection; the later `dispose()` still closes it once.
 *
 * Label loss: an opener or a grant under a label other than the pinned one ends this view for good.
 * The selection is cleared, the bindings are disposed, the player stops, and `session-changed`
 * stays: every later opener is ignored. Recovery is a new view or a reload, which pins its own label.
 *
 * Trust: the response is accepted only if it names the selected episode, the pinned sign-in and a
 * media URL for that same episode. The sign-in label is freshness only; the server authorizes every
 * Play and every media acquisition. A retry never reuses saved authorization: it makes a new Play.
 */
export async function connectPlaybackView(deps: PlaybackViewDependencies): Promise<PlaybackViewConnection> {
  const { app } = deps;
  const owner = createPlayerOwner(deps.player);
  let selected: OpenedEpisode | undefined;
  let pinnedSession: string | undefined;
  let kind: PlaybackViewState['kind'] = 'no-selection';
  // The host asked the view to tear down. This retires the view's own work and presentation but is
  // not `disposed`: that flag makes `dispose()` return before it reaches the bridge, and the host's
  // teardown does not close the connection, so the later `dispose()` must still close it once.
  let tornDown = false;
  let disposed = false;
  // The pinned label was lost through an opener or a grant. Permanent for the view: nothing clears
  // it, so no later result can reactivate the controller.
  let labelLost = false;
  const bindings = new Set<ActionBinding>();

  // `dispose()` has begun. Set before the bindings end so a canceled Play presents nothing while the
  // view is closing; `disposed` itself stays last because it makes a second `dispose()` return early.
  let closing = false;
  // The identity of the current selection as a press's subject. A new object on every opener, valid
  // or not, so an opener that retires the presentation also ends an undecided Play for the old
  // selection even when it leaves the selected item itself unchanged (a malformed opener).
  let selection: object = {};

  const retired = () => disposed || closing || tornDown || labelLost;

  const present = (state: PlaybackViewState) => {
    kind = state.kind;
    if (!retired()) deps.show(state);
  };

  const disposeBindings = () => {
    for (const binding of [...bindings]) binding.dispose();
    bindings.clear();
  };

  // Terminal, and told once: the view is over, so no card on screen may grant image consent again.
  let consentRetired = false;
  const retireConsent = () => {
    if (consentRetired) return;
    consentRetired = true;
    deps.contentConsent?.retire();
  };

  /** Stops the audio and presents `state`. The owner's whole-player stop is the application's own call. */
  const clearWith = (state: PlaybackViewState) => {
    owner.teardown();
    present(state);
  };

  /**
   * Ends the view after the pinned label was lost: clears the selection, ends the bindings and the
   * audio, and shows `session-changed`. The flag is set last and never cleared.
   */
  const loseLabel = () => {
    selected = undefined;
    selection = {};
    disposeBindings();
    owner.teardown();
    labelLost = true;
    retireConsent();
    kind = 'session-changed';
    if (!disposed && !tornDown) deps.show({ kind: 'session-changed' });
  };

  owner.onEnded((lease) => {
    if (!selected || retired() || !owner.isCurrent(lease)) return;
    // While a Play is still starting, the owner remembers the end and the invocation reports it.
    if (kind === 'playing' || kind === 'paused' || kind === 'resume-blocked') present({ kind: 'ended', episode: selected });
  });

  const onOpened = (result: ToolResult) => {
    if (retired()) return;
    // Every opener retires the presentation, so an undecided Play for the earlier presentation is
    // stale at its next checkpoint whether or not the opener names a different item.
    selection = {};
    // Likewise, image consent given for what was shown does not carry to what is about to be.
    deps.contentConsent?.revokeAll();
    const opened = result.isError ? undefined : OpenedEpisodeSchema.safeParse(result.structuredContent);
    if (!opened?.success) return clearWith({ kind: 'unavailable', ...(selected ? { episode: selected } : {}) });
    if (pinnedSession !== undefined && opened.data.viewSession !== pinnedSession) return loseLabel();
    pinnedSession = opened.data.viewSession;
    selected = opened.data;
    clearWith({ kind: 'ready', episode: opened.data });
  };

  /**
   * Fetches the protected bytes with the capability and a fresh proof from the bound key. `current`
   * is the invocation's own checkpoint: it also reads the work deadline's clock, so a proof that
   * finished after the bound (its continuation delivered before the deadline timer) sends nothing.
   */
  async function acquire(view: ViewPlayback, key: RecipientKey, signal: AbortSignal, current: () => boolean): Promise<Acquisition> {
    try {
      if (!current() || signal.aborted) return { kind: 'failed' };
      const proof = await signMediaProof(key, { capability: view.capability, url: view.mediaUrl });
      // The work deadline may have passed, or the Play been retired, while the proof was signed: no
      // request carrying the capability and the proof leaves the view now.
      if (!current() || signal.aborted) return { kind: 'failed' };
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

  // The application's seam to its server: the MCP Apps bridge itself. Progress from the host never
  // extends the deadline, and the request carries its `_meta` beside (never inside) its arguments.
  const transport: ServerTransport<CallToolResult> = {
    callServerTool: (request, options) =>
      app.callServerTool(
        {
          name: request.name,
          ...(request.arguments === undefined ? {} : { arguments: { ...request.arguments } }),
          ...(request._meta === undefined ? {} : { _meta: { ...request._meta } }),
        },
        { ...options, resetTimeoutOnProgress: false },
      ),
  };

  /** Selects the item a press acts on, or ignores the press. Runs in the event, before any effect. */
  const pressable = (allowed: (current: PlaybackViewState['kind']) => boolean): { readonly episode: OpenedEpisode } => {
    if (retired() || !selected || !allowed(kind)) throw new PressIgnored();
    return { episode: selected };
  };

  // Prerequisites: a failure of either is a prerequisite-stage failure, and the host call never starts.
  const hostForwardsServerTools = prerequisite('host-server-tools', () =>
    app.getHostCapabilities()?.serverTools ? proceed() : refuse('the host cannot proxy server tools'),
  );
  const recipientKey = prerequisite('recipient-key', async () => proceed({ key: await createRecipientKey() }));

  /** Presents what a Play that returned its result established. */
  const presentResult = (result: PlayResult, episode: OpenedEpisode): void => {
    if (result.kind === 'gesture-needed') return present({ kind: 'gesture-needed', episode });
    // Audio that is short enough can end before the player confirms it started. That end belongs
    // to this lease, so it wins over the late `started` result.
    if (result.kind === 'playing') present({ kind: owner.hasEnded(result.lease) ? 'ended' : 'playing', episode });
  };

  const play: ActionDefinition<PlayControlEvents['play']> = Action.server<PlayControlEvents['play'], CallToolResult>('play', transport)
    .input(() => pressable((current) => !STATES_THAT_BLOCK_PLAY.has(current)))
    .atActivation(({ scope }): PlayActivation => {
      // Inside the user's activation: end the previous audio, unlock this press's, and own the lease.
      // A browser with no Web Audio cannot play at all, so `begin` throws and nothing protected is requested.
      const lease = owner.begin();
      const held = scope.own(lease, (token) => owner.end(token));
      if (selected) present({ kind: 'pending', episode: selected });
      return { lease, held, reached: 'nothing-sent' };
    })
    .before(hostForwardsServerTools)
    .before(recipientKey)
    .run(async ({ call, signal, current, params, provided, activation }): Promise<PlayResult> => {
      const { episode } = params;
      const { key } = provided;
      const abandoned: PlayResult = { kind: 'abandoned' };

      activation.reached = 'request-sent';
      let result: ToolResult;
      try {
        result = await call(
          PLAY_TOOL_NAME,
          { episodeId: episode.episodeId },
          { timeoutMs: HOST_CALL_SAFEGUARD_MS, meta: { [RECIPIENT_KEY_META]: key.publicJwk } },
        );
      } catch (error) {
        // A rejection, a timeout and an abort look the same from here: the host may or may not have
        // forwarded the call, so this does not say the credential was refused.
        throw new PlayFailure('unknown-effect', error);
      }
      // Classify before anything decides recovery, and before asking whether this press is still
      // wanted: only a precise early refusal or a valid grant for this episode and sign-in
      // establishes a known result, even for an answer that came back too late to be used.
      const answer = classifyAnswer(result, episode);
      if (answer.kind !== 'unclassified') activation.reached = 'grant-known';
      if (!current()) return abandoned; // retired while waiting: a late success must not restore anything
      if (answer.kind === 'unclassified') throw new PlayFailure('unknown-effect');
      if (answer.kind === 'denied') throw new PlayFailure('denied');
      if (answer.kind === 'unsupported') throw new PlayFailure('unsupported');
      if (answer.kind === 'label-lost') throw new PlayFailure('label-lost');

      const media = await acquire(answer.grant, key, signal, current);
      if (!current()) return abandoned;
      if (media.kind === 'refused') throw new PlayFailure('expired');
      if (media.kind === 'failed') throw new PlayFailure('media-failed');

      let started: 'started' | 'blocked';
      try {
        started = await owner.start(activation.lease, media.bytes);
      } catch (error) {
        // The bytes arrived; the browser could not play them. That is not a server denial.
        if (!current()) return abandoned;
        throw new PlayFailure('media-failed', error);
      }
      if (!current()) return abandoned; // the scope releases this press's lease
      // A browser that withheld audio needs a new gesture. Nothing plays, so nothing is handed over.
      if (started === 'blocked') return { kind: 'gesture-needed' };
      // Synchronous hand-off: the owner holds the lease from here, and nothing was awaited since the start.
      if (!activation.held.transfer((lease) => owner.retain(lease))) return abandoned;
      return { kind: 'playing', lease: activation.lease };
    })
    .onSuccess(({ result, params, current }) => {
      if (!current()) return;
      presentResult(result, params.episode);
    })
    .onCanceled((context) => {
      // A changed subject was a new opener, which presented its own state; a label loss, teardown
      // or disposal retired the view and presents nothing. What is left is this Play's own control
      // being retired (unmounted or replaced) while the view still shows it pending: with nothing
      // else to move it on, pending would stay for good and refuse every later press.
      if (context.cause !== 'disposed' || retired() || kind !== 'pending' || selected !== context.params.episode) return;
      const { episode } = context.params;
      // Audio that already started under this press belongs to the owner and is reported as such.
      if (context.stage === 'completing') return presentResult(context.result, episode);
      // Say only what the progress supports. A request that may have reached the server has an
      // unknown effect, so no retry is invited; a new opener starts a fresh attempt. A grant whose
      // bytes were never fetched is a known result and offers a fresh Play, never the old capability.
      switch (context.activation.reached) {
        case 'nothing-sent':
          return present({ kind: 'ready', episode });
        case 'request-sent':
          return present({ kind: 'unavailable', episode, requestOutcome: 'unknown' });
        case 'grant-known':
          return present({ kind: 'unavailable', episode });
      }
    })
    .onFailure((context) => {
      if (!context.current()) return;
      if (context.stage === 'input') {
        // A press the controller did not take changes nothing; a prefix that could not unlock audio
        // means nothing protected was requested.
        if (context.failure.kind === 'invalid-input') return;
        return present({ kind: 'unsupported', ...(selected ? { episode: selected } : {}) });
      }
      const { episode } = context.params;
      if (context.stage === 'prerequisites') {
        // The protected play request was not sent. A refusal or a failed key is "this host cannot",
        // and a deadline that passed here is not an unknown remote effect.
        return present(context.failure.kind === 'timeout' ? { kind: 'unavailable', episode } : { kind: 'unsupported', episode });
      }
      const { failure } = context;
      // The handler returned and the required success work failed: the audio keeps playing.
      if (failure.kind === 'success-hook-error' || failure.kind === 'success-hook-timeout') return;
      const unknownEffect = { kind: 'unavailable', episode, requestOutcome: 'unknown' } as const;
      if (failure.kind === 'timeout') {
        // Past the work deadline: a request that may have reached the server has an unknown effect.
        return present(context.activation.reached === 'request-sent' ? unknownEffect : { kind: 'unavailable', episode });
      }
      if (failure.error instanceof PlayFailure) {
        switch (failure.error.failure) {
          case 'denied':
            return present({ kind: 'denied', episode });
          case 'unsupported':
            return present({ kind: 'unsupported', episode });
          case 'expired':
            return present({ kind: 'expired', episode });
          case 'media-failed':
            return present({ kind: 'media-failed', episode });
          case 'label-lost':
            return loseLabel();
          case 'unknown-effect':
            return present(unknownEffect);
        }
      }
      // Any other failure of the handler: say only what the progress made supports.
      present(context.activation.reached === 'request-sent' ? unknownEffect : { kind: 'unavailable', episode });
    })
    .build();

  /**
   * Pause and Resume: local actions that call the player inside the user's activation and present
   * what the player reports once it answers. The shown state changes only for the lease the player
   * still holds and while the view still shows the state the press started from.
   */
  function playerStep<T>(
    label: string,
    allowed: readonly PlaybackViewState['kind'][],
    step: (lease: PlaybackLease) => Promise<T>,
    outcome: (result: T) => 'playing' | 'paused' | 'resume-blocked',
  ): ActionDefinition<PlayControlEvents['play']> {
    const stillRelevant = (lease: PlaybackLease) => owner.isCurrent(lease) && allowed.includes(kind);
    return Action.local<PlayControlEvents['play']>(label)
      .input(() => pressable((current) => allowed.includes(current)))
      .atActivation(() => {
        const lease = owner.current();
        if (!lease) throw new PressIgnored();
        // The player call happens here, in the event's own call stack, because the browser can
        // require a gesture. The wrapper keeps the returned promise out of the prefix's return type.
        const pending = step(lease);
        pending.catch(() => undefined); // the handler awaits it; no unhandled rejection if it never gets to
        return { lease, pending };
      })
      .run(({ activation }) => activation.pending)
      .onSuccess(({ result, params, activation, current }) => {
        if (current() && stillRelevant(activation.lease)) present({ kind: outcome(result), episode: params.episode });
      })
      .onFailure((context) => {
        if (context.stage === 'input' || !context.current() || !stillRelevant(context.activation.lease)) return;
        // A player that cannot do it is a media failure, not a server denial.
        owner.end(context.activation.lease);
        present({ kind: 'media-failed', episode: context.params.episode });
      })
      .build();
  }

  const pause = playerStep(
    'pause',
    ['playing'],
    (lease) => owner.pause(lease),
    () => 'paused',
  );
  const resume = playerStep(
    'resume',
    ['paused', 'resume-blocked'],
    (lease) => owner.resume(lease),
    (resumed) => (resumed === 'resumed' ? 'playing' : 'resume-blocked'),
  );

  const connection = await connectToolResultView({
    app,
    transport: deps.transport,
    onToolResult: onOpened,
    // The host ends the connection right after it answers teardown, so audio must stop now.
    onTeardown() {
      tornDown = true;
      disposeBindings();
      owner.teardown();
      retireConsent();
    },
  });

  const attach = (view: InstanceView): void => {
    view.watchById(PLAY_CONTROL_ID, PlayControl, (handle: InstanceHandle<PlayControlEvents>) => {
      if (retired()) return;
      // The selection is the subject of every press: a new opener changes it, which cancels an
      // undecided invocation at its next checkpoint instead of letting it finish for the old item.
      const options = { subject: () => selection };
      bindings.add(handle.bindAction('play', play, options));
      bindings.add(handle.bindAction('pause', pause, options));
      bindings.add(handle.bindAction('resume', resume, options));
    });
  };

  return {
    attach,
    dispose() {
      if (disposed) return;
      closing = true;
      disposeBindings();
      owner.teardown();
      retireConsent();
      disposed = true;
      connection.dispose();
    },
  };
}
