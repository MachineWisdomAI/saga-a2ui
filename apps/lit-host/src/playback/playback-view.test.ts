import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import {
  InMemoryTransport,
  type CallToolRequest,
  type CallToolResult,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicEpisode } from '../mcp/episode.js';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import {
  MEDIA_BYTES,
  startPlaybackHarness,
  startRecorder,
  type PlaybackHarness,
} from './playback-fixture.js';
import {
  createInstanceHost,
  type InstanceHost,
  type Limits,
  type OpenInstance,
} from '@saga-a2ui/core/actions';
import {
  connectPlaybackView,
  PLAY_CONTROL_ID,
  PlayControl,
  type AudioPlayer,
  type PlayControlEvents,
  type PlaybackViewState,
} from './playback-view.js';

// The view's controller, joined to a real App/AppBridge pair. The bridge's tool handler plays the
// part of the host: it forwards each proxied `tools/call` — including its `_meta` — to the REAL
// listener over HTTP with a real bearer credential. The view's media request is also real HTTP.
// Only the audio device is a double.

const EP1: PublicEpisode = {
  episodeId: 'ep-1',
  title: 'The protected episode',
  description: 'A public description.',
};
const EP2: PublicEpisode = {
  episodeId: 'ep-2',
  title: 'Another protected episode',
  description: 'Also public.',
};

interface FakePlayer extends AudioPlayer {
  readonly started: ArrayBuffer[];
  readonly calls: string[];
  /**
   * Holds the next `start` until the test releases it, to model slow decoding. `survivesStop` models
   * a player that does not reject a pending start when `stop()` runs, which the AudioPlayer contract
   * forbids; the real player's own ordering is checked separately in the browser.
   */
  holdNextStart(options?: { survivesStop?: boolean }): {
    release(outcome?: 'started' | 'blocked'): void;
  };
  failNextStart(): void;
  outcome: 'started' | 'blocked';
  /** What the next `resume` reports once the audio clock has (or has not) advanced. */
  resumeOutcome: 'resumed' | 'blocked';
  /** Holds the next `resume` until the test releases it, to model a slow audio device. */
  holdNextResume(): { release(outcome?: 'resumed' | 'blocked'): void };
  /** Makes the next `pause` fail, as when the browser cannot suspend the audio. */
  failNextPause(): void;
  endPlayback(): void;
}

function fakePlayer(): FakePlayer {
  let ended: (() => void) | undefined;
  let held:
    | {
        resolve(outcome: 'started' | 'blocked'): void;
        reject(error: Error): void;
      }
    | undefined;
  let heldSurvivesStop = false;
  let heldResume:
    | {
        resolve(outcome: 'resumed' | 'blocked'): void;
        reject(error: Error): void;
      }
    | undefined;
  let hold = false;
  let holdSurvivesStop = false;
  let fail = false;
  let holdResume = false;
  let failPause = false;
  // The real player's contract: `start` needs the context `prepare` made, and `stop` destroys it.
  // A controller that stops the player after preparing it leaves nothing to start.
  let live = false;
  const player: FakePlayer = {
    started: [],
    calls: [],
    outcome: 'started',
    prepare() {
      player.calls.push('prepare');
      live = true;
    },
    start(bytes) {
      player.calls.push('start');
      if (!live)
        return Promise.reject(
          new Error('no prepared context: stop() ran after prepare()'),
        );
      if (fail) {
        fail = false;
        return Promise.reject(new Error('undecodable'));
      }
      if (hold) {
        hold = false;
        heldSurvivesStop = holdSurvivesStop;
        return new Promise((resolve, reject) => {
          held = { resolve, reject };
        });
      }
      player.started.push(bytes);
      return Promise.resolve(player.outcome);
    },
    resumeOutcome: 'resumed',
    pause() {
      player.calls.push('pause');
      if (!failPause) return Promise.resolve();
      failPause = false;
      return Promise.reject(new Error('cannot suspend'));
    },
    resume() {
      player.calls.push('resume');
      if (!holdResume) return Promise.resolve(player.resumeOutcome);
      holdResume = false;
      return new Promise((resolve, reject) => {
        heldResume = { resolve, reject };
      });
    },
    stop() {
      player.calls.push('stop');
      live = false;
      if (!heldSurvivesStop) {
        held?.reject(new Error('stopped'));
        held = undefined;
      }
      heldResume?.reject(new Error('stopped'));
      heldResume = undefined;
    },
    onEnded: (listener) => void (ended = listener),
    holdNextStart(options) {
      hold = true;
      holdSurvivesStop = options?.survivesStop ?? false;
      return {
        release(outcome = 'started') {
          player.started.push(new ArrayBuffer(0));
          held?.resolve(outcome);
          held = undefined;
          heldSurvivesStop = false;
        },
      };
    },
    failNextStart: () => void (fail = true),
    holdNextResume() {
      holdResume = true;
      return { release: (outcome = 'resumed') => heldResume?.resolve(outcome) };
    },
    failNextPause: () => void (failPause = true),
    endPlayback: () => ended?.(),
  };
  return player;
}

/**
 * What the user can press on the rendered control. Each press is delivered, synchronously, to the
 * action the controller bound to this exact instance, the way the control's click handler does.
 */
interface ControlPresses {
  play(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

/** The rendered Play control as the test sees it: an instance on the host, with its own liveness. */
function renderControl(host: InstanceHost): {
  readonly instance: OpenInstance<PlayControlEvents>;
  destroy(): void;
} {
  let live = true;
  const instance = host.open<PlayControlEvents>({
    kind: PlayControl,
    componentId: PLAY_CONTROL_ID,
    dataPath: '/',
    events: ['play', 'pause', 'resume'],
    isLive: () => live,
    read: () => undefined,
  });
  return {
    instance,
    destroy() {
      live = false;
      instance.retire();
    },
  };
}

interface Rig {
  readonly app: App;
  readonly harness: PlaybackHarness;
  readonly player: FakePlayer;
  readonly states: PlaybackViewState[];
  /** Every presented state (`show:<kind>`) and every consent call (`revokeAll`, `retire`), in order. */
  readonly consentLog: string[];
  readonly view: ControlPresses;
  /** The action host the controls are bound on, with the limits the rig was given. */
  readonly actions: InstanceHost;
  readonly control: OpenInstance<PlayControlEvents>;
  readonly bridge: AppBridge;
  /** Every proxied tools/call the host forwarded, with the credential used. */
  readonly forwarded: CallToolRequest['params'][];
  /** The cancellation signal the host received with each forwarded call, in order. */
  readonly hostSignals: (AbortSignal | undefined)[];
  useToken(token: string | undefined): void;
  /** Holds the next proxied tools/call at the host until released, to model a slow round trip. */
  holdNextToolCall(): { release(): void };
  last(): PlaybackViewState | undefined;
  /** Delivers an opener result and waits until the view shows that episode. */
  select(episode: PublicEpisode): Promise<void>;
  /** Delivers an opener result and returns, whether or not the view presents anything. */
  deliver(episode: PublicEpisode): Promise<void>;
}

const cleanup: {
  app: App;
  bridge: AppBridge;
  harness: PlaybackHarness;
  actions: InstanceHost;
}[] = [];
const setupErrors: unknown[] = [];

async function rig(
  options: {
    token?: string;
    serverTools?: boolean;
    dropMeta?: boolean;
    entitlements?: Record<string, readonly string[]>;
    /** Runs at the host after the listener granted a Play and before the view sees the grant. */
    afterGrant?: (harness: PlaybackHarness) => void;
    /** Lets a test change the view projection the host hands over, as a buggy or hostile path would. */
    tamperGrant?: (grant: Record<string, unknown>) => Record<string, unknown>;
    /** Replaces the whole Play answer the host resolves with, after the server handled the call. */
    rewriteAnswer?: (result: CallToolResult) => CallToolResult;
    /** The shared runtime's limits for every action on the host (work deadline, hook budget). Defaults to the SDK's. */
    limits?: Limits;
    /** Makes presenting a state fail, as a presenter that throws would. */
    showThrowsFor?: PlaybackViewState['kind'];
    /** Lets a test make the media service's storage slow without stalling the listener's own limits. */
    harnessOptions?: Parameters<typeof startPlaybackHarness>[1];
    /** Joins a description card's consent scope to the view, recording its calls beside every presented state. */
    withContentConsent?: boolean;
  } = {},
): Promise<Rig> {
  const harness = await startPlaybackHarness(
    options.entitlements ?? {
      [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'],
      [DEV_ACCOUNTS.bob]: [],
    },
    options.harnessOptions,
  );
  const states: PlaybackViewState[] = [];
  const forwarded: CallToolRequest['params'][] = [];
  const hostSignals: (AbortSignal | undefined)[] = [];
  let token: string | undefined = options.token ?? DEV_TOKENS.alice;
  let gate: Promise<void> | undefined;
  const player = fakePlayer();
  const app = new App(
    { name: 'test-view', version: '0.0.0' },
    {},
    { autoResize: false },
  );
  const bridge = new AppBridge(
    null,
    { name: 'test-host', version: '0.0.0' },
    options.serverTools === false ? {} : { serverTools: {} },
  );
  bridge.oncalltool = async (params, extra) => {
    forwarded.push(params);
    hostSignals.push(extra?.mcpReq?.signal);
    if (gate) {
      const waiting = gate;
      gate = undefined;
      await waiting;
    }
    const sent = options.dropMeta
      ? { name: params.name, arguments: params.arguments }
      : params;
    const response = await fetch(harness.listener.playbackUrl ?? '', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: sent,
      }),
    });
    if (response.status === 401 || response.status === 403)
      throw new Error(`listener refused (${response.status})`);
    const result = ((await response.json()) as { result: CallToolResult })
      .result;
    // The server really handled the call (and may have issued a capability); only the answer changes.
    if (params.name === 'play_episode' && options.rewriteAnswer)
      return options.rewriteAnswer(result);
    const grant = result._meta?.['saga-a2ui/playback'];
    if (params.name !== 'play_episode' || result.isError || !grant)
      return result;
    options.afterGrant?.(harness);
    const shown =
      options.tamperGrant?.(grant as Record<string, unknown>) ?? grant;
    return {
      ...result,
      _meta: { ...result._meta, 'saga-a2ui/playback': shown },
    };
  };
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  const consentLog: string[] = [];
  const connection = await connectPlaybackView({
    app,
    transport: viewSide,
    player,
    show: (state) => {
      states.push(state);
      consentLog.push(`show:${state.kind}`);
      if (state.kind === options.showThrowsFor)
        throw new Error('the presenter failed');
    },
    ...(options.withContentConsent
      ? {
          contentConsent: {
            revokeAll: () => void consentLog.push('revokeAll'),
            retire: () => void consentLog.push('retire'),
          },
        }
      : {}),
  });
  const actions = createInstanceHost({
    onSetupError: (error) => void setupErrors.push(error),
    ...(options.limits ? { limits: options.limits } : {}),
  });
  actions.register(connection.attach);
  const { instance: control } = renderControl(actions);
  const press = (action: 'play' | 'pause' | 'resume') =>
    void control.activate(action, new Event('click'));
  const view: ControlPresses = {
    play: () => press('play'),
    pause: () => press('pause'),
    resume: () => press('resume'),
    dispose: () => connection.dispose(),
  };
  cleanup.push({ app, bridge, harness, actions });
  return {
    app,
    harness,
    player,
    states,
    consentLog,
    view,
    actions,
    control,
    bridge,
    forwarded,
    hostSignals,
    useToken: (next) => void (token = next),
    holdNextToolCall() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => void (release = resolve));
      return { release };
    },
    last: () => states.at(-1),
    deliver,
    // The host mounts the view by running the model-visible opener, then delivers its real result.
    select: async (episode) => {
      await deliver(episode);
      await expect
        .poll(() => states.at(-1))
        .toMatchObject({ episode: { episodeId: episode.episodeId } });
    },
  };

  /** Runs the opener under the credential in force now and delivers its real result, without waiting for a state. */
  async function deliver(episode: PublicEpisode): Promise<void> {
    const response = await fetch(harness.listener.playbackUrl ?? '', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_playable_episode',
          arguments: { episodeId: episode.episodeId },
        },
      }),
    });
    await bridge.sendToolResult(
      ((await response.json()) as { result: CallToolResult }).result,
    );
  }
}

afterEach(async () => {
  for (const { app, bridge, harness, actions } of cleanup.splice(0)) {
    actions.close();
    await app.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
    await harness.listener.close();
  }
});

describe('Play from the view for the entitled listener', () => {
  it('shows pending while authorizing, and playing only after audio has actually started', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart();

    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    // The server has granted access and the bytes arrived, but audio has not started yet.
    expect(r.last()?.kind).toBe('pending');
    expect(r.states.map((state) => state.kind)).not.toContain('playing');

    decoding.release('started');
    await expect.poll(() => r.last()?.kind).toBe('playing');
    expect(r.states.map((state) => state.kind)).toEqual([
      'ready',
      'pending',
      'playing',
    ]);
  });

  it('plays the protected bytes fetched with the capability and a proof from the view’s own key', async () => {
    const r = await rig();
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    expect([
      ...new Uint8Array(r.player.started[0] ?? new ArrayBuffer(0)),
    ]).toEqual([...MEDIA_BYTES]);
    expect(r.harness.playback.mediaReads).toEqual(['ep-1']);
    // The call carried only the episode id as an argument; the key travelled as call metadata.
    expect(r.forwarded[0]?.arguments).toEqual({ episodeId: 'ep-1' });
    expect(Object.keys(r.forwarded[0]?._meta ?? {})).toContain(
      'saga-a2ui/recipient-key',
    );
  });
});

const kinds = (r: Rig) => r.states.map((state) => state.kind);

describe('Play from the view when access is refused', () => {
  it('clears the player and says denied when the account has no access, with no bytes fetched', async () => {
    const r = await rig({ token: DEV_TOKENS.bob });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('denied');

    expect(r.player.calls).toContain('stop');
    expect(r.player.started).toHaveLength(0);
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(kinds(r)).not.toContain('playing');
  });

  it('does not call a refused host call a sign-in problem or a denial: it is unavailable, with the outcome unknown', async () => {
    const r = await rig();
    await r.select(EP1);
    r.useToken(DEV_TOKENS.expired);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('unavailable');
    expect(r.last()).toMatchObject({
      kind: 'unavailable',
      requestOutcome: 'unknown',
    });
    expect(kinds(r)).not.toContain('denied');
    expect(kinds(r)).not.toContain('sign-in-required');
    expect(r.harness.playback.entitlementChecks).toEqual([]);
  });

  it('shows unsupported without any protected fetch when the host cannot proxy server tools', async () => {
    const r = await rig({ serverTools: false });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('unsupported');
    expect(r.forwarded).toEqual([]);
    expect(r.harness.playback.entitlementChecks).toEqual([]);
    expect(r.harness.playback.mediaReads).toEqual([]);
  });

  it('shows unsupported when the host drops the call metadata, so no capability can be bound', async () => {
    const r = await rig({ dropMeta: true });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('unsupported');
    expect(r.harness.playback.entitlementChecks).toEqual([]);
    expect(r.harness.playback.mediaReads).toEqual([]);
  });
});

describe('Play request discipline', () => {
  it('suppresses a second activation while one request is pending: one call, one player start', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart();

    r.view.play();
    r.view.play();
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    decoding.release('started');
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.view.play(); // ignored while playing too: it must not restart the audio
    await new Promise((resolve) => setTimeout(resolve, 80)); // a restart would need this long to surface

    expect(kinds(r)).toEqual(['ready', 'pending', 'playing']);
    expect(
      r.forwarded.filter((call) => call.name === 'play_episode'),
    ).toHaveLength(1);
    expect(r.player.calls.filter((call) => call === 'start')).toHaveLength(1);
    // A suppressed press must not touch the player at all: not even the user-gesture unlock.
    expect(r.player.calls.filter((call) => call === 'prepare')).toHaveLength(1);
  });

  it('performs no protected media fetch for a Play that was retired while the host call was in flight', async () => {
    const r = await rig();
    await r.select(EP1);
    const inFlight = r.holdNextToolCall();

    r.view.play();
    await expect
      .poll(
        () => r.forwarded.filter((call) => call.name === 'play_episode').length,
      )
      .toBe(1);
    await r.select(EP2); // the new selection retires the pending Play
    inFlight.release();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-2' },
    });
    expect(kinds(r)).not.toContain('playing');
  });

  it('does not let a late denial for the old selection overwrite the new selection', async () => {
    const r = await rig({ token: DEV_TOKENS.bob }); // bob is denied everything
    await r.select(EP1);
    const inFlight = r.holdNextToolCall();

    r.view.play();
    await expect
      .poll(
        () => r.forwarded.filter((call) => call.name === 'play_episode').length,
      )
      .toBe(1);
    await r.select(EP2);
    inFlight.release(); // the server now answers the retired request: denied
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-2' },
    });
    expect(kinds(r)).not.toContain('denied');
  });

  it('stops the audio the moment the view is disposed, not when a late decode happens to finish', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    const before = r.player.calls.length;

    r.view.dispose();

    expect(r.player.calls.slice(before)).toEqual(['stop']);
  });

  it('stops the audio when the host tears the view down, before it answers the teardown request', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    const before = r.player.calls.length;

    await r.bridge.teardownResource({});

    expect(r.player.calls.slice(before)).toEqual(['stop']);
  });

  it('rejects a grant minted for a different sign-in than the one that opened the view, fetching nothing', async () => {
    const r = await rig({
      entitlements: {
        [DEV_ACCOUNTS.alice]: ['ep-1'],
        [DEV_ACCOUNTS.bob]: ['ep-1'],
      },
    });
    await r.select(EP1); // opened by Alice
    r.useToken(DEV_TOKENS.bob); // the host's credential changes before the press; Bob is entitled, so the server grants

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('session-changed');

    expect(r.harness.playback.entitlementChecks).toEqual([
      { accountId: DEV_ACCOUNTS.bob, episodeId: 'ep-1' },
    ]);
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(kinds(r)).not.toContain('playing');
  });

  it('keeps a late success from restoring media after a changed sign-in cleared the view', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart();
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);

    // Bob signs in elsewhere and the host delivers his opener result while Alice's start is pending.
    r.useToken(DEV_TOKENS.bob);
    await r.select(EP1).catch(() => undefined);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    decoding.release('started');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(r.last()?.kind).toBe('session-changed');
    expect(kinds(r)).not.toContain('playing');
    expect(r.player.calls.at(-1)).toBe('stop');
  });

  it('keeps a late success from restoring media after the selection changed', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart();
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);

    await r.select(EP2);
    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-2' },
    });
    decoding.release('started');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-2' },
    });
    expect(kinds(r)).not.toContain('playing');
  });

  it('stops and clears on disposal, and a result that arrives afterwards cannot restart anything', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart();
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);

    r.view.dispose();
    decoding.release('started');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(r.player.calls.at(-1)).toBe('stop');
    expect(kinds(r)).not.toContain('playing');
  });
});

describe('Play outcomes after the server said yes', () => {
  it('reports a browser media failure as media-failed, not as a denial, and offers a fresh Play', async () => {
    const r = await rig();
    await r.select(EP1);
    r.player.failNextStart();

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('media-failed');
    expect(kinds(r)).not.toContain('denied');
    expect(kinds(r)).not.toContain('playing');
    expect(r.player.calls.at(-1)).toBe('stop');

    // Retry is a new Play: a second authorization. Each Play that reached the media service also
    // costs one acquisition check, so two presses that both fetched bytes are four lookups.
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    expect(r.harness.playback.entitlementChecks).toHaveLength(4);
  });

  it('asks for a second explicit Play when the browser withheld audio, and plays on that press', async () => {
    const r = await rig();
    await r.select(EP1);
    r.player.outcome = 'blocked';

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('gesture-needed');
    expect(kinds(r)).not.toContain('playing');

    r.player.outcome = 'started';
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
  });

  it('shows expired when the media service refuses a capability the server already granted', async () => {
    const r = await rig();
    r.harness.playback.mediaReads.length = 0;
    await r.select(EP1);
    // The service is asked for the bytes after its clock has passed the capability's expiry.
    const real = globalThis.fetch;
    globalThis.fetch = (async (input, init) =>
      String(input).includes('/playback/media/')
        ? new Response('{"error":"forbidden"}', { status: 403 })
        : real(input, init)) as typeof fetch;
    try {
      r.view.play();
      await expect.poll(() => r.last()?.kind).toBe('expired');
    } finally {
      globalThis.fetch = real;
    }
    expect(kinds(r)).not.toContain('playing');
    expect(r.player.started).toHaveLength(0);
  });

  it('pauses, resumes and reports ended through the one player', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    r.view.pause();
    await expect.poll(() => r.last()?.kind).toBe('paused');
    r.view.resume();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.player.endPlayback();
    expect(r.last()?.kind).toBe('ended');
  });
});

describe('Pause and Resume report what the audio actually did', () => {
  async function paused(): Promise<Rig> {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.view.pause();
    await expect.poll(() => r.last()?.kind).toBe('paused');
    return r;
  }

  it('does not announce playing until the resume has completed, and ignores a second press meanwhile', async () => {
    const r = await paused();
    const settling = r.player.holdNextResume();

    r.view.resume();
    r.view.resume();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.last()?.kind).toBe('paused'); // the device has not confirmed anything yet
    expect(r.player.calls.filter((call) => call === 'resume')).toHaveLength(1);

    settling.release('resumed');
    await expect.poll(() => r.last()?.kind).toBe('playing');
  });

  it('says another press is needed when the browser withheld the resume, then plays on that press', async () => {
    const r = await paused();
    r.player.resumeOutcome = 'blocked';

    r.view.resume();
    await expect.poll(() => r.last()?.kind).toBe('resume-blocked');
    expect(kinds(r)).toEqual([
      'ready',
      'pending',
      'playing',
      'paused',
      'resume-blocked',
    ]);
    // One Play check and one acquisition check for the single Play; recovery adds none.
    expect(r.harness.playback.entitlementChecks).toHaveLength(2);

    r.player.resumeOutcome = 'resumed';
    r.view.resume();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    expect(r.harness.playback.entitlementChecks).toHaveLength(2);
  });

  it('reports a player that cannot resume at all as media-failed, with a fresh Play on offer', async () => {
    const r = await paused();
    r.player.resume = () => Promise.reject(new Error('context closed'));

    r.view.resume();
    await expect.poll(() => r.last()?.kind).toBe('media-failed');
    expect(kinds(r)).not.toContain('resume-blocked');
    expect(r.player.calls.at(-1)).toBe('stop');
  });

  it('keeps a resume that was retired in flight from restoring playing', async () => {
    const r = await paused();
    const settling = r.player.holdNextResume();
    r.view.resume();
    await expect.poll(() => r.player.calls.includes('resume')).toBe(true);

    await r.select(EP2); // a new selection retires the resume
    const afterSelection = r.states.length;
    settling.release('resumed');
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-2' },
    });
    expect(r.states.slice(afterSelection)).toEqual([]); // the retired resume presented nothing at all
  });

  it('keeps an end reached while the resume was still being confirmed', async () => {
    const r = await paused();
    const settling = r.player.holdNextResume();
    r.view.resume();
    await expect.poll(() => r.player.calls.includes('resume')).toBe(true);

    r.player.endPlayback(); // the media finished before the clock poll confirmed the resume
    settling.release('resumed');

    await expect.poll(() => r.last()?.kind).toBe('ended');
    expect(kinds(r).slice(-2)).toEqual(['paused', 'ended']);
  });

  it('does not announce paused when the player could not suspend, and reports media-failed like a failed resume', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.player.failNextPause();

    r.view.pause();

    await expect.poll(() => r.last()?.kind).toBe('media-failed');
    expect(kinds(r)).not.toContain('paused');
    expect(r.player.calls.at(-1)).toBe('stop');
  });

  it('ignores a second Pause press while the first is still waiting on the player', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    let settle!: () => void;
    r.player.pause = () => (
      r.player.calls.push('pause'),
      new Promise<void>((resolve) => void (settle = resolve))
    );

    r.view.pause();
    r.view.pause();
    expect(r.last()?.kind).toBe('playing'); // the suspend has not completed: "Paused." would be premature
    settle();

    await expect.poll(() => r.last()?.kind).toBe('paused');
    expect(r.player.calls.filter((call) => call === 'pause')).toHaveLength(1);
  });

  it('does not let a pause that settles after the end overwrite ended', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    let settle!: () => void;
    r.player.pause = () =>
      new Promise<void>((resolve) => void (settle = resolve));

    r.view.pause();
    r.player.endPlayback();
    expect(r.last()?.kind).toBe('ended');
    settle();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(r.last()?.kind).toBe('ended');
  });
});

describe('Play when the media ends before the start is confirmed', () => {
  it('shows ended, not playing, when the end arrives before the player reports started', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart();
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);

    r.player.endPlayback(); // a very short episode finished before the clock poll resolved
    decoding.release('started');

    await expect.poll(() => r.last()?.kind).toBe('ended');
    expect(kinds(r)).toEqual(['ready', 'pending', 'ended']);
  });

  it('does not carry an early end of a retired request over to the next Play', async () => {
    const r = await rig();
    await r.select(EP1);
    r.player.holdNextStart();
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    r.player.endPlayback(); // seen by the request that is about to be retired
    await r.select(EP2);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(r.last()).toMatchObject({
      kind: 'playing',
      episode: { episodeId: 'ep-2' },
    });
  });

  it('keeps a retired request from restoring playing after the end, once a new selection cleared it', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart();
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    r.player.endPlayback();

    await r.select(EP2);
    decoding.release('started');
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-2' },
    });
    expect(kinds(r)).not.toContain('playing');
    expect(kinds(r)).not.toContain('ended');
  });
});

describe('Play when the browser cannot play audio', () => {
  it('shows unsupported before any protected call when the player cannot be prepared', async () => {
    const r = await rig();
    await r.select(EP1);
    r.player.prepare = () => {
      throw new Error('AudioContext is not defined');
    };

    expect(() => r.view.play()).not.toThrow(); // the press happens inside a browser event handler
    await expect.poll(() => r.last()?.kind).toBe('unsupported');

    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toEqual(
      [],
    );
    expect(r.harness.playback.entitlementChecks).toEqual([]);
    expect(r.harness.playback.mediaReads).toEqual([]);
  });
});

describe('Play when the media origin redirects', () => {
  // Decision: the media service never redirects, so the player treats any redirect as a failed
  // acquisition. Following one would carry the capability and the proof headers to a destination
  // the application never declared.
  it('does not follow a redirect to another destination: the capability and proof reach nobody else', async () => {
    const elsewhere = await startRecorder();
    const redirecting = await startRecorder((req, res) => {
      res
        .writeHead(302, {
          location: `${elsewhere.origin}${req.url}`,
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
        })
        .end();
    });
    try {
      const r = await rig({
        tamperGrant: (grant) => ({
          ...grant,
          mediaUrl: `${redirecting.origin}/playback/media/ep-1`,
        }),
      });
      await r.select(EP1);

      r.view.play();
      await expect.poll(() => r.last()?.kind).toBe('media-failed');

      expect(redirecting.requests).toHaveLength(1); // the media origin the grant named was asked once
      expect(elsewhere.requests).toEqual([]); // the redirect target never heard of it
      expect(r.player.started).toHaveLength(0);
      expect(kinds(r)).not.toContain('playing');
    } finally {
      await Promise.all([redirecting.close(), elsewhere.close()]);
    }
  });
});

/** Records every URL the view fetches while `run` executes, so a test can show where requests went. */
async function fetchedUrls<T>(
  run: () => Promise<T>,
): Promise<{ readonly result: T; readonly urls: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input, init) => (
    urls.push(String(input instanceof Request ? input.url : input)),
    real(input, init)
  )) as typeof fetch;
  try {
    return { result: await run(), urls };
  } finally {
    globalThis.fetch = real;
  }
}

const mediaFetches = (urls: readonly string[]) =>
  urls.filter((url) => url.includes('/playback/media/'));

describe('Recovery after access ends between the grant and the media fetch', () => {
  it('stops, clears the source and offers a deliberate retry; the retry re-checks entitlement and shows denial when revoked', async () => {
    // The subscription lapses after Play was granted but before the bytes were requested.
    const r = await rig({
      afterGrant: (h) => h.playback.setEntitled(DEV_ACCOUNTS.alice, []),
    });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('expired');
    expect(r.player.started).toHaveLength(0);
    expect(r.player.calls.at(-1)).toBe('stop'); // nothing is left playing or held
    expect(r.harness.playback.mediaReads).toEqual([]); // the service gave no protected bytes

    // Retry is a new Play with fresh checks: this time the entitlement check itself says no.
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('denied');
    expect(
      r.forwarded.filter((call) => call.name === 'play_episode'),
    ).toHaveLength(2);
    expect(r.player.started).toHaveLength(0);
    expect(r.harness.playback.mediaReads).toEqual([]);
  });

  it('obtains fresh access on retry once the server permits it, never reusing the earlier capability', async () => {
    let lapseAfterFirstGrant = true; // only the first Play loses access between grant and fetch
    const r = await rig({
      afterGrant: (h) => {
        if (!lapseAfterFirstGrant) return;
        lapseAfterFirstGrant = false;
        h.playback.setEntitled(DEV_ACCOUNTS.alice, []);
      },
    });
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('expired');

    r.harness.playback.setEntitled(DEV_ACCOUNTS.alice, ['ep-1', 'ep-2']);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    const grants = r.forwarded.filter((call) => call.name === 'play_episode');
    expect(grants).toHaveLength(2); // two separate Play calls, each with the same business input
    expect(
      grants.every(
        (call) =>
          JSON.stringify(call.arguments) ===
          JSON.stringify({ episodeId: 'ep-1' }),
      ),
    ).toBe(true);
    expect(r.harness.playback.mediaReads).toEqual(['ep-1']);
  });

  it('does not retry on its own: after expiry no further Play or media request is made until the user presses', async () => {
    const r = await rig({
      afterGrant: (h) => h.playback.setEntitled(DEV_ACCOUNTS.alice, []),
    });
    await r.select(EP1);
    const { urls } = await fetchedUrls(async () => {
      r.view.play();
      await expect.poll(() => r.last()?.kind).toBe('expired');
      await new Promise((resolve) => setTimeout(resolve, 300)); // long enough for any hidden retry loop to show itself
    });

    expect(mediaFetches(urls)).toHaveLength(1);
    expect(
      r.forwarded.filter((call) => call.name === 'play_episode'),
    ).toHaveLength(1);
    expect(r.harness.playback.entitlementChecks).toHaveLength(2); // one for Play, one for the single acquisition
  });
});

describe('Recovery when the media service is unavailable', () => {
  it('shows a media failure, not expiry, and a retry fetches only from the freshly granted URL', async () => {
    const r = await rig();
    await r.select(EP1);
    r.harness.playback.failReadsWith('storage down');

    const first = await fetchedUrls(async () => {
      r.view.play();
      await expect.poll(() => r.last()?.kind).toBe('media-failed');
    });
    expect(kinds(r)).not.toContain('expired');
    expect(r.player.started).toHaveLength(0);
    expect(r.player.calls.at(-1)).toBe('stop');

    r.harness.playback.failReadsWith(undefined);
    const second = await fetchedUrls(async () => {
      r.view.play();
      await expect.poll(() => r.last()?.kind).toBe('playing');
    });

    const allowed = new URL(r.harness.listener.playbackUrl ?? '').origin;
    for (const url of [...first.urls, ...second.urls])
      expect(new URL(url).origin).toBe(allowed); // no public mp3 or chat URL
    expect(mediaFetches(first.urls)).toHaveLength(1);
    expect(mediaFetches(second.urls)).toHaveLength(1);
    expect(
      r.forwarded.filter((call) => call.name === 'play_episode'),
    ).toHaveLength(2);
  });
});

// Host teardown (STATE1). The bridge stops delivering notifications and answers the host, but the
// view's own controls and every asynchronous continuation of an earlier press would still run. The
// view retires its work on teardown without disposing the connection; the later dispose() closes it
// once.
describe('host teardown of the playback view', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 80));

  it('makes Play inert: no audio unlock, no host call and nothing presented', async () => {
    const r = await rig();
    await r.select(EP1);
    await r.bridge.teardownResource({});
    const shown = r.states.length;
    const calls = r.player.calls.length;

    r.view.play();
    await settled();

    expect(r.states.length).toBe(shown);
    expect(r.player.calls.length).toBe(calls);
    expect(r.forwarded).toEqual([]);
  });

  it('makes Pause and Resume inert', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    await r.bridge.teardownResource({});
    const shown = r.states.length;
    const calls = r.player.calls.length;

    r.view.pause();
    r.view.resume();
    await settled();

    expect(r.states.length).toBe(shown);
    expect(r.player.calls.slice(calls)).toEqual([]);
  });

  it('keeps a Resume that was still being confirmed from presenting after teardown', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.view.pause();
    await expect.poll(() => r.last()?.kind).toBe('paused');
    const waking = r.player.holdNextResume();
    r.view.resume();
    await expect.poll(() => r.player.calls.includes('resume')).toBe(true);
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    waking.release('resumed');
    await settled();

    expect(r.states.length).toBe(shown);
  });

  it('presents nothing when the audio ends after teardown', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    r.player.endPlayback();
    await settled();

    expect(r.states.length).toBe(shown);
  });

  it('makes a Play whose host call was in flight start no acquisition, player work or presentation', async () => {
    const r = await rig();
    await r.select(EP1);
    const inFlight = r.holdNextToolCall();
    r.view.play();
    await expect
      .poll(
        () => r.forwarded.filter((call) => call.name === 'play_episode').length,
      )
      .toBe(1);
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    inFlight.release();
    await settled();

    expect(r.states.length).toBe(shown);
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(r.player.calls).not.toContain('start');
  });

  it('presents nothing when a start that was pending at teardown settles', async () => {
    const r = await rig();
    await r.select(EP1);
    const decoding = r.player.holdNextStart({ survivesStop: true });
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    await r.bridge.teardownResource({});
    const shown = r.states.length;

    decoding.release('started');
    await settled();

    expect(r.states.length).toBe(shown);
    expect(kinds(r)).not.toContain('playing');
  });

  it('leaves the connection for dispose(), which closes it once however often it is called', async () => {
    const r = await rig();
    await r.select(EP1);
    let closes = 0;
    const close = r.app.close.bind(r.app);
    r.app.close = () => ((closes += 1), close());
    await r.bridge.teardownResource({});
    expect(closes).toBe(0);

    r.view.dispose();
    r.view.dispose();

    expect(closes).toBe(1);
  });
});

// A late completion belongs to the acquisition that started it. The AudioPlayer seam holds one
// resource, so an old start's cleanup may release it only while no newer Play has taken it over.
describe('late player-start cleanup is scoped to its own acquisition', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 80));

  it('does not stop the audio of a newer Play when an older start settles late', async () => {
    const r = await rig();
    await r.select(EP1);
    const older = r.player.holdNextStart({ survivesStop: true });
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);

    await r.select(EP2); // retires the older Play
    r.view.play();
    await expect
      .poll(() => r.last())
      .toMatchObject({ kind: 'playing', episode: { episodeId: 'ep-2' } });
    const shown = r.states.length;
    const calls = r.player.calls.length;

    older.release('started');
    await settled();

    expect(r.player.calls.slice(calls)).toEqual([]);
    expect(r.states.length).toBe(shown);
    expect(r.last()).toMatchObject({
      kind: 'playing',
      episode: { episodeId: 'ep-2' },
    });
  });

  it('still releases the player when a retired start settles and no newer Play exists', async () => {
    const r = await rig();
    await r.select(EP1);
    const older = r.player.holdNextStart({ survivesStop: true });
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    await r.select(EP2);
    const calls = r.player.calls.length;

    older.release('started');
    await settled();

    expect(r.player.calls.slice(calls)).toEqual(['stop']);
    expect(kinds(r)).not.toContain('playing');
  });
});

// The sign-in label pinned by the first opener is the view's freshness check. Losing it through a
// mismatched opener or grant is final for the view instance: recovery is a new view or a reload.
// The selection stays cleared, every later opener (old label, new label or unreadable) is ignored,
// and Play, Pause and Resume cannot reactivate the view or issue protected work.
describe('final loss of the pinned sign-in label', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 80));
  const BOTH = {
    entitlements: {
      [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'],
      [DEV_ACCOUNTS.bob]: ['ep-1', 'ep-2'],
    },
  };
  const playRequests = (r: Rig) =>
    r.forwarded.filter((call) => call.name === 'play_episode').length;
  const unreadable = (r: Rig) =>
    r.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: 'Episode unavailable.' }],
    });
  const garbled = (r: Rig) =>
    r.bridge.sendToolResult({
      content: [{ type: 'text', text: 'x' }],
      structuredContent: { surprise: true },
    });

  /** Presses every control and reports whether anything reached the host, the player or the media service. */
  async function pressEverything(r: Rig): Promise<void> {
    r.view.play();
    r.view.pause();
    r.view.resume();
    await settled();
  }

  /** The state the view must hold for good once the label is lost, with nothing selected or playing. */
  function expectRetired(
    r: Rig,
    before: { states: number; calls: number; playRequests: number },
  ): void {
    expect(r.last()).toEqual({ kind: 'session-changed' });
    expect(
      r.states
        .slice(before.states)
        .every((state) => state.kind === 'session-changed'),
    ).toBe(true);
    expect(playRequests(r)).toBe(before.playRequests);
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(r.player.calls.slice(before.calls)).not.toContain('prepare');
    expect(r.player.calls.slice(before.calls)).not.toContain('start');
    expect(r.player.calls.slice(before.calls)).not.toContain('resume');
  }

  it('ignores an opener under the old label after an opener under another label retired the view', async () => {
    const r = await rig(BOTH);
    await r.select(EP1); // pins Alice's label
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    const before = {
      states: r.states.length,
      calls: r.player.calls.length,
      playRequests: playRequests(r),
    };

    r.useToken(DEV_TOKENS.alice); // the old label is back
    await r.deliver(EP1);
    await r.deliver(EP2);
    await pressEverything(r);

    expectRetired(r, before);
  });

  it('ignores a later opener under the new label as well, without adopting it', async () => {
    const r = await rig(BOTH);
    await r.select(EP1);
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    const before = {
      states: r.states.length,
      calls: r.player.calls.length,
      playRequests: playRequests(r),
    };

    await r.deliver(EP2); // still Bob: the label that caused the loss
    await pressEverything(r);

    expectRetired(r, before);
  });

  it('clears the selection when the label is lost through a mismatched grant, and keeps it cleared', async () => {
    const r = await rig(BOTH);
    await r.select(EP1); // opened by Alice
    r.useToken(DEV_TOKENS.bob); // the host now proxies Bob's credential; Bob is entitled, so the server grants
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    expect(r.last()).toEqual({ kind: 'session-changed' }); // no selected episode is carried
    const before = {
      states: r.states.length,
      calls: r.player.calls.length,
      playRequests: playRequests(r),
    };

    await unreadable(r); // an unreadable opener cannot fall back to the old selection
    await garbled(r);
    r.useToken(DEV_TOKENS.alice);
    await r.deliver(EP1); // nor can an opener under the old label
    await pressEverything(r);

    expectRetired(r, before);
    expect(r.harness.playback.entitlementChecks).toEqual([
      { accountId: DEV_ACCOUNTS.bob, episodeId: 'ep-1' },
    ]);
  });

  it('stays retired through an unreadable opener, which neither reselects nor offers Try again', async () => {
    const r = await rig(BOTH);
    await r.select(EP1);
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    const before = {
      states: r.states.length,
      calls: r.player.calls.length,
      playRequests: playRequests(r),
    };

    await unreadable(r);
    await garbled(r);
    await pressEverything(r);

    expectRetired(r, before);
  });

  it('stops playing audio at the loss and keeps Pause, Resume, a stale end and the old label from reviving it', async () => {
    const r = await rig(BOTH);
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    expect(r.player.calls.at(-1)).toBe('stop');
    const before = {
      states: r.states.length,
      calls: r.player.calls.length,
      playRequests: playRequests(r),
    };
    const reads = r.harness.playback.mediaReads.length;

    r.useToken(DEV_TOKENS.alice);
    await r.deliver(EP1);
    r.player.endPlayback();
    await pressEverything(r);

    expect(r.last()).toEqual({ kind: 'session-changed' });
    expect(
      r.states
        .slice(before.states)
        .every((state) => state.kind === 'session-changed'),
    ).toBe(true);
    expect(r.player.calls.slice(before.calls)).toEqual([]);
    expect(playRequests(r)).toBe(before.playRequests);
    expect(r.harness.playback.mediaReads.length).toBe(reads);
  });

  it('does not let Resume revive a paused view after the label was lost', async () => {
    const r = await rig(BOTH);
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.view.pause();
    await expect.poll(() => r.last()?.kind).toBe('paused');
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    const calls = r.player.calls.length;

    await unreadable(r);
    await pressEverything(r);

    expect(r.last()).toEqual({ kind: 'session-changed' });
    expect(r.player.calls.slice(calls)).toEqual([]);
  });

  it('keeps a start that was pending at the loss from playing, even after an opener under the old label', async () => {
    const r = await rig(BOTH);
    await r.select(EP1);
    const decoding = r.player.holdNextStart({ survivesStop: true });
    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    r.useToken(DEV_TOKENS.alice);
    await r.deliver(EP1);
    const calls = r.player.calls.length;
    const shown = r.states.length;

    decoding.release('started'); // the retired start settles late
    await settled();

    expect(r.last()).toEqual({ kind: 'session-changed' });
    expect(kinds(r)).not.toContain('playing');
    expect(r.states.length).toBe(shown);
    expect(r.player.calls.slice(calls)).toEqual(['stop']); // released once, never restarted
  });

  it('does not let a Play whose grant is still in flight at the loss outlive it', async () => {
    const r = await rig(BOTH);
    await r.select(EP1);
    const inFlight = r.holdNextToolCall();
    r.view.play();
    await expect.poll(() => playRequests(r)).toBe(1);
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    r.useToken(DEV_TOKENS.alice);
    await r.deliver(EP1);

    inFlight.release();
    await settled();

    expect(r.last()).toEqual({ kind: 'session-changed' });
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(kinds(r)).not.toContain('playing');
  });

  it('still lets a same-label opener for another item move the view on before any loss', async () => {
    const r = await rig(BOTH);
    await r.select(EP1);
    await r.select(EP2);
    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-2' },
    });

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    expect(r.last()).toMatchObject({
      kind: 'playing',
      episode: { episodeId: 'ep-2' },
    });
    expect(r.harness.playback.mediaReads).toEqual(['ep-2']);
  });

  it('lets a fresh view bootstrap and play after another view lost its label, leaving independent views alone', async () => {
    const lost = await rig(BOTH);
    const other = await rig(BOTH);
    await lost.select(EP1);
    await other.select(EP1);
    lost.useToken(DEV_TOKENS.bob);
    await lost.deliver(EP1);
    await expect.poll(() => lost.last()?.kind).toBe('session-changed');

    const fresh = await rig({ ...BOTH, token: DEV_TOKENS.bob }); // a new view, as after a reload
    await fresh.select(EP1);
    fresh.view.play();
    other.view.play();

    await expect.poll(() => fresh.last()?.kind).toBe('playing');
    await expect.poll(() => other.last()?.kind).toBe('playing');
    expect(lost.last()).toEqual({ kind: 'session-changed' });
  });
});

describe('the bound on one Play attempt', () => {
  const settle = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it('takes its bound from the action host, which refuses an unusable one where it is supplied, before anything is requested', () => {
    for (const bad of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '30000' as unknown as number,
    ]) {
      expect(() =>
        createInstanceHost({
          onSetupError: () => undefined,
          limits: { deadlineMs: bad },
        }),
      ).toThrow(TypeError);
    }
  });

  it('gives the host call the attempt’s signal and a timeout no wider than the attempt has left', async () => {
    const r = await rig({ limits: { deadlineMs: 5_000 } });
    await r.select(EP1);
    const call = vi.spyOn(r.app, 'callServerTool');

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    const options = call.mock.calls[0]?.[1];
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.timeout).toBeGreaterThan(0);
    expect(options?.timeout).toBeLessThanOrEqual(5_000);
    expect(options?.resetTimeoutOnProgress).toBe(false); // host progress must not extend the attempt
  });

  it('ends a stalled host call as unavailable with an unknown outcome, aborts it, and invites no retry', async () => {
    const r = await rig({ limits: { deadlineMs: 150 } });
    await r.select(EP1);
    const held = r.holdNextToolCall();

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    expect(r.last()).toMatchObject({
      kind: 'unavailable',
      requestOutcome: 'unknown',
    });
    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
    await expect.poll(() => r.hostSignals[0]?.aborted).toBe(true);
    expect(r.player.calls).toContain('stop');

    // The late host result finds a different generation: no media request, nothing restored.
    held.release();
    await settle(200);
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
  });

  it('allows a new press after an expiry that proves nothing was sent', async () => {
    const r = await rig({ limits: { deadlineMs: 150 } });
    await r.select(EP1);
    // Key creation never finishes, so the Play request is never sent.
    vi.spyOn(crypto.subtle, 'generateKey').mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');
    expect(r.last()).toMatchObject({
      kind: 'unavailable',
      episode: { episodeId: 'ep-1' },
    });
    expect(r.last()).not.toHaveProperty('requestOutcome'); // nothing left the view, so a retry is honest
    expect(r.forwarded).toEqual([]);

    r.view.play(); // an explicit new press is a fresh attempt
    await expect.poll(() => r.last()?.kind).toBe('playing');
  });

  it('ends a stalled proof signature after the grant is known, with no media request', async () => {
    const r = await rig({ limits: { deadlineMs: 200 } });
    await r.select(EP1);
    vi.spyOn(crypto.subtle, 'sign').mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    expect(r.last()).toMatchObject({ kind: 'unavailable' });
    expect(r.last()).not.toHaveProperty('requestOutcome');
    expect(r.forwarded).toHaveLength(1); // the grant came back, so a retry is a plain new Play
    expect(r.harness.playback.mediaReads).toEqual([]);
  });

  it('ends a stalled media body, aborts the request, and drops the late bytes', async () => {
    const r = await rig({ limits: { deadlineMs: 250 } });
    await r.select(EP1);
    const read = r.harness.playback.holdNextRead();

    r.view.play();
    await read.reached;
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    expect(r.last()).toMatchObject({ kind: 'unavailable' });
    expect(r.last()).not.toHaveProperty('requestOutcome');
    read.release();
    await settle(150);
    expect(r.player.calls).not.toContain('start');
    expect(kinds(r)).not.toContain('playing');
  });

  it('ends a decode or start that never settles, stops the player, and ignores the late start', async () => {
    const r = await rig({ limits: { deadlineMs: 250 } });
    await r.select(EP1);
    const decoding = r.player.holdNextStart({ survivesStop: true }); // a player that ignores abort

    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');
    expect(r.player.calls.at(-1)).toBe('stop');

    decoding.release('started');
    await settle(100);
    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
    // The late start released the player again only because no later press had taken it over.
    expect(
      r.player.calls.filter((call) => call === 'stop').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('keeps successful playback going past the bound: the clock ends with the outcome, not the audio', async () => {
    const r = await rig({ limits: { deadlineMs: 200 } });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    const stops = r.player.calls.filter((call) => call === 'stop').length;
    await settle(450);

    expect(r.last()?.kind).toBe('playing');
    expect(kinds(r)).toEqual(['ready', 'pending', 'playing']);
    expect(r.player.calls.filter((call) => call === 'stop').length).toBe(stops);
  });

  it('starts a fresh bound for a later attempt instead of inheriting what an earlier one used', async () => {
    const r = await rig({ limits: { deadlineMs: 400 } });
    await r.select(EP1);
    const held = r.holdNextToolCall();
    r.view.play();
    await settle(250);
    held.release(); // the first attempt finishes in time, 250 ms in
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.player.endPlayback();
    await expect.poll(() => r.last()?.kind).toBe('ended');

    const second = r.holdNextToolCall();
    r.view.play();
    await settle(250); // would be 500 ms in total if the clocks were shared
    second.release();
    await expect.poll(() => r.last()?.kind).toBe('playing');
  });

  it('does not let a lost label, a teardown or a dispose leave the clock running', async () => {
    const r = await rig({ limits: { deadlineMs: 150 } });
    await r.select(EP1);
    const held = r.holdNextToolCall();
    r.view.play();
    await r.deliver({ ...EP1 }); // same label: no loss, a new opener is just a new selection
    held.release();
    r.view.dispose();
    await settle(300);
    expect(kinds(r)).not.toContain('unavailable');
  });
});

describe('the bound on one Play attempt does not depend on timer delivery', () => {
  const settle = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  /** Blocks the thread: the promise continuation that follows is delivered before the attempt's timer. */
  const blockFor = (ms: number) => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      // Synchronous work that overruns the bound.
    }
  };

  it('keeps an accepted limit above the native timer maximum instead of expiring it at once', async () => {
    const r = await rig({ limits: { deadlineMs: 3_000_000_000 } });
    await r.select(EP1);
    const held = r.holdNextToolCall();

    r.view.play();
    await settle(150); // a 32-bit overflow would have ended the attempt after about a millisecond
    expect(r.last()?.kind).toBe('pending');

    held.release();
    await expect.poll(() => r.last()?.kind).toBe('playing');
  });

  it('refuses a proof that finished after the bound: no media request, no start', async () => {
    const r = await rig({ limits: { deadlineMs: 100 } });
    await r.select(EP1);
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'sign').mockImplementationOnce(
      async (...args: Parameters<typeof sign>) => {
        const signature = await sign(...args);
        blockFor(150);
        return signature;
      },
    );

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(r.player.calls).not.toContain('start');
    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
  });

  it('ends an attempt whose player start came back after the bound, and stops the player', async () => {
    const r = await rig({ limits: { deadlineMs: 150 } });
    await r.select(EP1);
    vi.spyOn(r.player, 'start').mockImplementationOnce(() => {
      blockFor(200);
      return Promise.resolve('started');
    });

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
    expect(r.player.calls.at(-1)).toBe('stop');
  });
});

describe('a resolved Play result that does not establish its effect', () => {
  const settle = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const PLAY_RESULT_META = 'saga-a2ui/playback';
  /** The server really handled the call (issuing a capability for a good request); the host resolves with this instead. */
  const genericError =
    (
      text = 'Playback is unavailable.',
    ): ((result: CallToolResult) => CallToolResult) =>
    () => ({
      isError: true,
      content: [{ type: 'text', text }],
    });
  const withGrant =
    (change: (grant: Record<string, unknown>) => Record<string, unknown>) =>
    (result: CallToolResult): CallToolResult => ({
      ...result,
      _meta: {
        ...result._meta,
        [PLAY_RESULT_META]: change(
          result._meta?.[PLAY_RESULT_META] as Record<string, unknown>,
        ),
      },
    });

  /** An unknown outcome sends nothing more on its own: one Play call, no media request, no player start. */
  async function expectUnknownAndInert(r: Rig): Promise<void> {
    expect(r.last()).toMatchObject({
      kind: 'unavailable',
      episode: { episodeId: 'ep-1' },
      requestOutcome: 'unknown',
    });
    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
    await settle(200);
    expect(
      r.forwarded.filter((call) => call.name === 'play_episode'),
    ).toHaveLength(1);
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(r.player.calls).not.toContain('start');
    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
  }

  it('keeps a generic tool error unknown: no retry, no media, no player start and no automatic second call', async () => {
    const r = await rig({ rewriteAnswer: genericError() });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('unavailable');

    await expectUnknownAndInert(r);
    expect(r.harness.playback.entitlementChecks).toHaveLength(1); // the server's one lookup for the one Play
  });

  it.each([
    [
      'unusable private metadata',
      withGrant(({ capability: _capability, ...rest }) => rest),
    ],
    [
      'metadata for another episode',
      withGrant((grant) => ({ ...grant, episodeId: 'ep-2' })),
    ],
    [
      'no private metadata at all',
      (result: CallToolResult): CallToolResult => ({ content: result.content }),
    ],
  ])(
    'keeps a success result carrying %s unknown, never grant-known, and fetches nothing',
    async (_name, rewriteAnswer) => {
      const r = await rig({ rewriteAnswer });
      await r.select(EP1);

      r.view.play();
      await expect.poll(() => r.last()?.kind).toBe('unavailable');

      await expectUnknownAndInert(r);
    },
  );

  it('still reads a precise early refusal as its own outcome, whatever else a generic error says', async () => {
    const denied = await rig({ token: DEV_TOKENS.bob });
    await denied.select(EP1);
    denied.view.play();
    await expect.poll(() => denied.last()?.kind).toBe('denied');
    expect(denied.last()).not.toHaveProperty('requestOutcome');

    // Wording that merely resembles the fixed sentences is not a refusal.
    const lookalike = await rig({
      rewriteAnswer: genericError(
        'Playback denied: this account does not have access to this episode. ',
      ),
    });
    await lookalike.select(EP1);
    lookalike.view.play();
    await expect.poll(() => lookalike.last()?.kind).toBe('unavailable');
    expect(lookalike.last()).toMatchObject({ requestOutcome: 'unknown' });
  });

  it('keeps a generic error that arrives after the bound, before its timer, unknown rather than safe to retry', async () => {
    const r = await rig({
      limits: { deadlineMs: 100 },
      rewriteAnswer: (result) => {
        // The thread is blocked past the absolute bound: the continuation runs before the attempt's timer.
        const until = performance.now() + 150;
        while (performance.now() < until) {
          // Synchronous work that overruns the bound.
        }
        return genericError()(result);
      },
    });
    await r.select(EP1);

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    await expectUnknownAndInert(r);
  });

  it('keeps a malformed result that arrives after the bound unknown, and a late valid grant fetches nothing', async () => {
    const block = () => {
      const until = performance.now() + 150;
      while (performance.now() < until) {
        // Synchronous work that overruns the bound.
      }
    };
    const malformed = await rig({
      limits: { deadlineMs: 100 },
      rewriteAnswer: (result) => {
        block();
        return { content: result.content };
      },
    });
    await malformed.select(EP1);
    malformed.view.play();
    await expect
      .poll(() => malformed.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');
    await expectUnknownAndInert(malformed);

    // A valid, matching grant is a known result even when late: nothing is revived and no media is requested.
    const late = await rig({
      limits: { deadlineMs: 100 },
      rewriteAnswer: (result) => {
        block();
        return result;
      },
    });
    await late.select(EP1);
    late.view.play();
    await expect
      .poll(() => late.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');
    expect(late.last()).not.toHaveProperty('requestOutcome');
    await settle(150);
    expect(late.harness.playback.mediaReads).toEqual([]);
    expect(kinds(late)).toEqual(['ready', 'pending', 'unavailable']);
  });

  it('still reads a valid grant under another sign-in label as a permanent session change', async () => {
    const r = await rig({
      rewriteAnswer: withGrant((grant) => ({
        ...grant,
        viewSession: `vs_${'z'.repeat(22)}`,
      })),
    });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('session-changed');

    expect(r.last()).toEqual({ kind: 'session-changed' });
    expect(r.harness.playback.mediaReads).toEqual([]);
  });

  it('keeps a valid matching grant known: a later media failure still offers a fresh Play, never the old capability', async () => {
    const r = await rig();
    await r.select(EP1);
    r.player.failNextStart();

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('media-failed');
    expect(r.last()).not.toHaveProperty('requestOutcome');
    expect(r.harness.playback.mediaReads).toEqual(['ep-1']);

    r.view.play(); // the deliberate recovery is a new Play, with a freshly granted capability
    await expect.poll(() => r.last()?.kind).toBe('playing');
    expect(
      r.forwarded.filter((call) => call.name === 'play_episode'),
    ).toHaveLength(2);
    const [first, second] = r.forwarded.filter(
      (call) => call.name === 'play_episode',
    );
    expect(second?._meta).not.toBe(first?._meta);
  });
});

// Play is one server action bound to the exact rendered control: one work interval spans every
// pending stage, from creating the recipient key through starting the player. The binding's own
// phase is the pending presentation's source, and the application keeps the rest as its own state.
describe('Play as one action on the rendered control', () => {
  const settle = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const playBinding = (r: Rig) => r.control.attached('play');

  it('is pending exactly while the binding runs, and the binding is idle again once audio plays', async () => {
    const r = await rig();
    await r.select(EP1);
    expect(playBinding(r)?.state.phase).toBe('idle');
    const decoding = r.player.holdNextStart();

    r.view.play();
    await expect.poll(() => r.player.calls.includes('start')).toBe(true);
    expect(r.last()?.kind).toBe('pending');
    expect(playBinding(r)?.state.phase).toBe('running');

    decoding.release('started');
    await expect.poll(() => r.last()?.kind).toBe('playing');
    await expect.poll(() => playBinding(r)?.state.phase).toBe('idle');
  });

  it('keeps Play unavailable while audio plays as application state, not as binding busy state', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    await expect.poll(() => playBinding(r)?.state.phase).toBe('idle');
    const plays = () =>
      r.forwarded.filter((call) => call.name === 'play_episode').length;

    r.view.play();
    await settle(60);

    expect(plays()).toBe(1);
    expect(r.player.calls.filter((call) => call === 'prepare')).toHaveLength(1);
    expect(r.last()?.kind).toBe('playing');
  });

  it('creates a fresh recipient key for every Play and never puts one in the arguments', async () => {
    const r = await rig();
    await r.select(EP1);
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.player.endPlayback();
    await expect.poll(() => r.last()?.kind).toBe('ended');

    r.view.play();
    await expect
      .poll(() => r.states.filter((state) => state.kind === 'playing'))
      .toHaveLength(2);

    const keys = r.forwarded.map(
      (call) =>
        (call._meta?.['saga-a2ui/recipient-key'] as { x: string } | undefined)
          ?.x,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeDefined();
    expect(keys[0]).not.toBe(keys[1]);
    expect(r.forwarded.map((call) => call.arguments)).toEqual([
      { episodeId: 'ep-1' },
      { episodeId: 'ep-1' },
    ]);
  });

  it('ends a stalled key creation at the work deadline: the host call never starts and nothing is unknown', async () => {
    const r = await rig({ limits: { deadlineMs: 150 } });
    await r.select(EP1);
    vi.spyOn(crypto.subtle, 'generateKey').mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    expect(r.last()).not.toHaveProperty('requestOutcome');
    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toEqual(
      [],
    );
    expect(kinds(r)).toEqual(['ready', 'pending', 'unavailable']);
    expect(playBinding(r)?.state.phase).toBe('idle');
  });

  it('shows unsupported when the recipient key cannot be created, without sending the protected request', async () => {
    const r = await rig();
    await r.select(EP1);
    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(
      new Error('no WebCrypto'),
    );

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('unsupported');

    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toEqual(
      [],
    );
    expect(r.player.calls).toContain('stop'); // the lease taken for this press is given back
  });

  it('cancels an undecided Play when the selection changes and the user presses again, aborting its host call', async () => {
    const r = await rig();
    await r.select(EP1);
    const call = vi.spyOn(r.app, 'callServerTool');
    const held = r.holdNextToolCall();
    r.view.play();
    await expect.poll(() => call.mock.calls.length).toBe(1);
    const firstSignal = call.mock.calls[0]?.[1]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    await r.select(EP2);
    r.view.play(); // the binding notices the changed subject and starts the new Play at once
    await expect
      .poll(() => r.last())
      .toMatchObject({ kind: 'playing', episode: { episodeId: 'ep-2' } });
    held.release();
    await settle(60);

    expect(firstSignal?.aborted).toBe(true);
    expect(r.last()).toMatchObject({
      kind: 'playing',
      episode: { episodeId: 'ep-2' },
    });
    expect(r.harness.playback.mediaReads).toEqual(['ep-2']);
  });

  it('keeps the audio playing when presenting playing fails: the handler already returned its result', async () => {
    const r = await rig({ showThrowsFor: 'playing' });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.player.started.length).toBe(1);
    await settle(80);

    expect(r.player.calls.at(-1)).toBe('start'); // nothing stopped the audio after it started
    expect(playBinding(r)?.state.phase).toBe('idle');
  });

  it('ends the bindings with the view: a lost label, a teardown and a disposal each leave nothing to press', async () => {
    const lost = await rig({
      entitlements: {
        [DEV_ACCOUNTS.alice]: ['ep-1'],
        [DEV_ACCOUNTS.bob]: ['ep-1'],
      },
    });
    await lost.select(EP1);
    lost.useToken(DEV_TOKENS.bob);
    await lost.deliver(EP1);
    await expect.poll(() => lost.last()?.kind).toBe('session-changed');
    expect(lost.control.attached('play')).toBeUndefined();
    expect(lost.control.attached('pause')).toBeUndefined();
    expect(lost.control.attached('resume')).toBeUndefined();

    const torn = await rig();
    await torn.select(EP1);
    expect(torn.control.attached('play')).toBeDefined();
    await torn.bridge.teardownResource({});
    expect(torn.control.attached('play')).toBeUndefined();

    const disposed = await rig();
    await disposed.select(EP1);
    disposed.view.dispose();
    expect(disposed.control.attached('resume')).toBeUndefined();
    expect(disposed.control.activate('play', new Event('click'))).toBe(
      'unbound',
    );
  });
});

// Review repair for PR 133: the three behaviours the migration to one action must keep. Each test
// drives the public rig and checks what was dispatched, not only what the server recorded.
describe('a Play that is retired keeps its protected fetch unsent and its presentation accurate', () => {
  const settle = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const blockFor = (ms: number) => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      // Synchronous work that overruns the bound.
    }
  };
  const playRequests = (r: Rig) =>
    r.forwarded.filter((call) => call.name === 'play_episode').length;
  const mediaDispatches = (fetchSpy: { mock: { calls: unknown[][] } }) =>
    fetchSpy.mock.calls.filter(([input]) =>
      String(input instanceof Request ? input.url : input).includes('/media/'),
    );

  it('dispatches no protected fetch when the proof finished after the work deadline, even before the timer ran', async () => {
    const r = await rig({ limits: { deadlineMs: 100 } });
    await r.select(EP1);
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'sign').mockImplementationOnce(
      async (...args: Parameters<typeof sign>) => {
        const signature = await sign(...args);
        blockFor(150);
        return signature;
      },
    );
    const dispatched = vi.spyOn(globalThis, 'fetch');

    r.view.play();
    await expect
      .poll(() => r.last()?.kind, { timeout: 2_000 })
      .toBe('unavailable');

    // The capability and the proof never left the view: not "the server saw nothing", but no dispatch.
    expect(mediaDispatches(dispatched)).toEqual([]);
    expect(r.harness.playback.mediaReads).toEqual([]);
  });

  it('dispatches no protected fetch when the Play was retired while its proof was being signed', async () => {
    const r = await rig();
    await r.select(EP1);
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'sign').mockImplementationOnce(
      async (...args: Parameters<typeof sign>) => {
        const signature = await sign(...args);
        r.control.retire(); // the control leaves while the proof is being signed
        return signature;
      },
    );
    const dispatched = vi.spyOn(globalThis, 'fetch');

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('unavailable');
    await settle(60);

    expect(mediaDispatches(dispatched)).toEqual([]);
    expect(r.harness.playback.mediaReads).toEqual([]);
  });

  it('does not leave Play pending when its control is retired and replaced: the effect is unknown, and a deliberate press still plays', async () => {
    const r = await rig();
    await r.select(EP1);
    const held = r.holdNextToolCall();
    r.view.play();
    await expect.poll(() => playRequests(r)).toBe(1);

    r.control.retire();
    const replacement = renderControl(r.actions);
    held.release(); // the old request is answered after its control is gone
    await settle(80);

    // Honest about what is unknown, offering no blind retry, and never fetching for the old press.
    expect(r.last()).toMatchObject({
      kind: 'unavailable',
      requestOutcome: 'unknown',
      episode: { episodeId: 'ep-1' },
    });
    expect(r.harness.playback.mediaReads).toEqual([]);

    // The replacement control is not stuck behind a stale pending state.
    expect(replacement.instance.activate('play', new Event('click'))).toBe(
      'started',
    );
    await expect.poll(() => r.last()?.kind).toBe('playing');
    expect(playRequests(r)).toBe(2);
    expect(r.harness.playback.mediaReads).toEqual(['ep-1']);
  });

  it('returns to ready when its control is retired before any request was sent', async () => {
    const r = await rig();
    await r.select(EP1);
    vi.spyOn(crypto.subtle, 'generateKey').mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    r.view.play();
    expect(r.last()?.kind).toBe('pending');

    r.control.retire();
    const replacement = renderControl(r.actions);

    expect(r.last()).toMatchObject({
      kind: 'ready',
      episode: { episodeId: 'ep-1' },
    });
    expect(playRequests(r)).toBe(0);
    expect(replacement.instance.activate('play', new Event('click'))).toBe(
      'started',
    );
    await expect.poll(() => r.last()?.kind).toBe('playing');
    expect(r.player.calls).toContain('stop'); // the lease taken for the retired press was given back
  });

  it('presents nothing from a Play canceled by the view’s own disposal', async () => {
    const r = await rig();
    await r.select(EP1);
    const held = r.holdNextToolCall();
    r.view.play();
    await expect.poll(() => playRequests(r)).toBe(1);
    const before = r.states.length;

    r.view.dispose();
    held.release();
    await settle(60);

    expect(r.states).toHaveLength(before);
    expect(r.harness.playback.mediaReads).toEqual([]);
  });

  it('retires a Play in flight when a malformed opener clears the presentation, keeping a deliberate retry', async () => {
    const r = await rig();
    await r.select(EP1);
    const held = r.holdNextToolCall();
    r.view.play();
    await expect.poll(() => playRequests(r)).toBe(1);
    const dispatched = vi.spyOn(globalThis, 'fetch');

    await r.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: 'Episode unavailable.' }],
    });
    await expect.poll(() => r.last()?.kind).toBe('unavailable');
    held.release(); // the old, valid grant arrives after the opener retired the presentation
    await settle(80);

    expect(mediaDispatches(dispatched)).toEqual([]);
    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(r.last()).toMatchObject({
      kind: 'unavailable',
      episode: { episodeId: 'ep-1' },
    });
    expect(r.player.calls).not.toContain('start');

    // The unchanged selection stays pressable: a deliberate new Play asks the server afresh.
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    expect(playRequests(r)).toBe(2);
    expect(r.harness.playback.mediaReads).toEqual(['ep-1']);
  });
});

// The description card beside the Play control (CARD1). The card's image consent has one owner, the
// page's content view; this controller only tells it when the selection it shows ends. Consent and
// Play have separate lifetimes: a press, playback and a pause never touch consent, and consent
// ending never touches a Play.
describe('the description card’s image consent beside the Play control', () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 80));
  const BOTH = {
    entitlements: {
      [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'],
      [DEV_ACCOUNTS.bob]: ['ep-1', 'ep-2'],
    },
  };
  const consentCalls = (r: Rig) =>
    r.consentLog.filter((entry) => !entry.startsWith('show:'));

  it('ends consent before each opener presents, so images agreed to for one selection never show beside the next', async () => {
    const r = await rig({ withContentConsent: true });
    await r.select(EP1);
    await r.select(EP2);
    await r.select(EP2); // the same episode again is still a new selection

    expect(r.consentLog).toEqual([
      'revokeAll',
      'show:ready',
      'revokeAll',
      'show:ready',
      'revokeAll',
      'show:ready',
    ]);
  });

  it('ends consent for an opener the view cannot read as well, before it presents the unavailable state', async () => {
    const r = await rig({ withContentConsent: true });
    await r.select(EP1);
    await r.bridge.sendToolResult({
      isError: true,
      content: [{ type: 'text', text: 'Episode unavailable.' }],
    });
    await expect.poll(() => r.last()?.kind).toBe('unavailable');

    expect(r.consentLog.slice(-2)).toEqual(['revokeAll', 'show:unavailable']);
  });

  it('leaves consent alone while the listener plays, pauses and resumes', async () => {
    const r = await rig({ withContentConsent: true });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');
    r.view.pause();
    await expect.poll(() => r.last()?.kind).toBe('paused');
    r.view.resume();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    expect(consentCalls(r)).toEqual(['revokeAll']);
  });

  it('retires consent for good when the pinned sign-in label is lost, and no later opener revives it', async () => {
    const r = await rig({ ...BOTH, withContentConsent: true });
    await r.select(EP1);
    r.useToken(DEV_TOKENS.bob);
    await r.deliver(EP1);
    await expect.poll(() => r.last()?.kind).toBe('session-changed');
    // The opener under the other label still revokes first (every opener does), then the loss retires.
    expect(r.consentLog.slice(-3)).toEqual([
      'revokeAll',
      'retire',
      'show:session-changed',
    ]);

    r.useToken(DEV_TOKENS.alice);
    await r.deliver(EP2);
    await settled();

    expect(r.consentLog.slice(-3)).toEqual([
      'revokeAll',
      'retire',
      'show:session-changed',
    ]);
    expect(r.last()).toEqual({ kind: 'session-changed' });
  });

  it('retires consent when the host tears the view down, and a late opener neither revokes nor presents', async () => {
    const r = await rig({ withContentConsent: true });
    await r.select(EP1);
    await r.bridge.teardownResource({});
    expect(consentCalls(r)).toEqual(['revokeAll', 'retire']);
    const logged = r.consentLog.length;

    await r.deliver(EP2);
    await settled();

    expect(r.consentLog).toHaveLength(logged);
  });

  it('retires consent when the view is disposed, once however often it is disposed', async () => {
    const r = await rig({ withContentConsent: true });
    await r.select(EP1);

    r.view.dispose();
    r.view.dispose();

    expect(consentCalls(r)).toEqual(['revokeAll', 'retire']);
  });

  it('does not touch consent while a Play is pending or when it settles', async () => {
    const r = await rig({ withContentConsent: true });
    await r.select(EP1);
    const held = r.holdNextToolCall();
    r.view.play();
    await expect
      .poll(
        () => r.forwarded.filter((call) => call.name === 'play_episode').length,
      )
      .toBe(1);

    held.release();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    expect(consentCalls(r)).toEqual(['revokeAll']);
  });
});
