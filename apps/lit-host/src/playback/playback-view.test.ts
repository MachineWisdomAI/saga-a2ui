import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport, type CallToolRequest, type CallToolResult } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublicEpisode } from '../mcp/episode.js';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import { MEDIA_BYTES, startPlaybackHarness, startRecorder, type PlaybackHarness } from './playback-fixture.js';
import { connectPlaybackView, type AudioPlayer, type PlaybackViewConnection, type PlaybackViewState } from './playback-view.js';

// The view's controller, joined to a real App/AppBridge pair. The bridge's tool handler plays the
// part of the host: it forwards each proxied `tools/call` — including its `_meta` — to the REAL
// listener over HTTP with a real bearer credential. The view's media request is also real HTTP.
// Only the audio device is a double.

const EP1: PublicEpisode = { episodeId: 'ep-1', title: 'The protected episode', description: 'A public description.' };
const EP2: PublicEpisode = { episodeId: 'ep-2', title: 'Another protected episode', description: 'Also public.' };

interface FakePlayer extends AudioPlayer {
  readonly started: ArrayBuffer[];
  readonly calls: string[];
  /**
   * Holds the next `start` until the test releases it, to model slow decoding. `survivesStop` models
   * a player that does not reject a pending start when `stop()` runs, which the AudioPlayer contract
   * forbids; the real player's own ordering is checked separately in the browser.
   */
  holdNextStart(options?: { survivesStop?: boolean }): { release(outcome?: 'started' | 'blocked'): void };
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
  let held: { resolve(outcome: 'started' | 'blocked'): void; reject(error: Error): void } | undefined;
  let heldSurvivesStop = false;
  let heldResume: { resolve(outcome: 'resumed' | 'blocked'): void; reject(error: Error): void } | undefined;
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
      if (!live) return Promise.reject(new Error('no prepared context: stop() ran after prepare()'));
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

interface Rig {
  readonly app: App;
  readonly harness: PlaybackHarness;
  readonly player: FakePlayer;
  readonly states: PlaybackViewState[];
  readonly view: PlaybackViewConnection;
  readonly bridge: AppBridge;
  /** Every proxied tools/call the host forwarded, with the credential used. */
  readonly forwarded: CallToolRequest['params'][];
  useToken(token: string | undefined): void;
  /** Holds the next proxied tools/call at the host until released, to model a slow round trip. */
  holdNextToolCall(): { release(): void };
  last(): PlaybackViewState | undefined;
  select(episode: PublicEpisode): Promise<void>;
}

const cleanup: { app: App; bridge: AppBridge; harness: PlaybackHarness }[] = [];

async function rig(options: {
  token?: string;
  serverTools?: boolean;
  dropMeta?: boolean;
  entitlements?: Record<string, readonly string[]>;
  /** Runs at the host after the listener granted a Play and before the view sees the grant. */
  afterGrant?: (harness: PlaybackHarness) => void;
  /** Lets a test change the view projection the host hands over, as a buggy or hostile path would. */
  tamperGrant?: (grant: Record<string, unknown>) => Record<string, unknown>;
} = {}): Promise<Rig> {
  const harness = await startPlaybackHarness(
    options.entitlements ?? { [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'], [DEV_ACCOUNTS.bob]: [] },
  );
  const states: PlaybackViewState[] = [];
  const forwarded: CallToolRequest['params'][] = [];
  let token: string | undefined = options.token ?? DEV_TOKENS.alice;
  let gate: Promise<void> | undefined;
  const player = fakePlayer();
  const app = new App({ name: 'test-view', version: '0.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, options.serverTools === false ? {} : { serverTools: {} });
  bridge.oncalltool = async (params) => {
    forwarded.push(params);
    if (gate) {
      const waiting = gate;
      gate = undefined;
      await waiting;
    }
    const sent = options.dropMeta ? { name: params.name, arguments: params.arguments } : params;
    const response = await fetch(harness.listener.playbackUrl ?? '', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: sent }),
    });
    if (response.status === 401 || response.status === 403) throw new Error(`listener refused (${response.status})`);
    const result = ((await response.json()) as { result: CallToolResult }).result;
    const grant = result._meta?.['saga-a2ui/playback'];
    if (params.name !== 'play_episode' || result.isError || !grant) return result;
    options.afterGrant?.(harness);
    const shown = options.tamperGrant?.(grant as Record<string, unknown>) ?? grant;
    return { ...result, _meta: { ...result._meta, 'saga-a2ui/playback': shown } };
  };
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  const view = await connectPlaybackView({ app, transport: viewSide, player, show: (state) => states.push(state) });
  cleanup.push({ app, bridge, harness });
  return {
    app,
    harness,
    player,
    states,
    view,
    bridge,
    forwarded,
    useToken: (next) => void (token = next),
    holdNextToolCall() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => void (release = resolve));
      return { release };
    },
    last: () => states.at(-1),
    // The host mounts the view by running the model-visible opener, then delivers its real result.
    select: async (episode) => {
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
          params: { name: 'get_playable_episode', arguments: { episodeId: episode.episodeId } },
        }),
      });
      await bridge.sendToolResult(((await response.json()) as { result: CallToolResult }).result);
      await expect.poll(() => states.at(-1)).toMatchObject({ episode: { episodeId: episode.episodeId } });
    },
  };
}

afterEach(async () => {
  for (const { app, bridge, harness } of cleanup.splice(0)) {
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
    expect(r.states.map((state) => state.kind)).toEqual(['ready', 'pending', 'playing']);
  });

  it('plays the protected bytes fetched with the capability and a proof from the view’s own key', async () => {
    const r = await rig();
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('playing');

    expect([...new Uint8Array(r.player.started[0] ?? new ArrayBuffer(0))]).toEqual([...MEDIA_BYTES]);
    expect(r.harness.playback.mediaReads).toEqual(['ep-1']);
    // The call carried only the episode id as an argument; the key travelled as call metadata.
    expect(r.forwarded[0]?.arguments).toEqual({ episodeId: 'ep-1' });
    expect(Object.keys(r.forwarded[0]?._meta ?? {})).toContain('saga-a2ui/recipient-key');
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

  it('distinguishes sign-in recovery from entitlement denial: a refused credential is not a denial', async () => {
    const r = await rig();
    await r.select(EP1);
    r.useToken(DEV_TOKENS.expired);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('sign-in-required');
    expect(kinds(r)).not.toContain('denied');
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
    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toHaveLength(1);
    expect(r.player.calls.filter((call) => call === 'start')).toHaveLength(1);
    // A suppressed press must not touch the player at all: not even the user-gesture unlock.
    expect(r.player.calls.filter((call) => call === 'prepare')).toHaveLength(1);
  });

  it('performs no protected media fetch for a Play that was retired while the host call was in flight', async () => {
    const r = await rig();
    await r.select(EP1);
    const inFlight = r.holdNextToolCall();

    r.view.play();
    await expect.poll(() => r.forwarded.filter((call) => call.name === 'play_episode').length).toBe(1);
    await r.select(EP2); // the new selection retires the pending Play
    inFlight.release();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(r.harness.playback.mediaReads).toEqual([]);
    expect(r.last()).toMatchObject({ kind: 'ready', episode: { episodeId: 'ep-2' } });
    expect(kinds(r)).not.toContain('playing');
  });

  it('does not let a late denial for the old selection overwrite the new selection', async () => {
    const r = await rig({ token: DEV_TOKENS.bob }); // bob is denied everything
    await r.select(EP1);
    const inFlight = r.holdNextToolCall();

    r.view.play();
    await expect.poll(() => r.forwarded.filter((call) => call.name === 'play_episode').length).toBe(1);
    await r.select(EP2);
    inFlight.release(); // the server now answers the retired request: denied
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(r.last()).toMatchObject({ kind: 'ready', episode: { episodeId: 'ep-2' } });
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
    const r = await rig({ entitlements: { [DEV_ACCOUNTS.alice]: ['ep-1'], [DEV_ACCOUNTS.bob]: ['ep-1'] } });
    await r.select(EP1); // opened by Alice
    r.useToken(DEV_TOKENS.bob); // the host's credential changes before the press; Bob is entitled, so the server grants

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('session-changed');

    expect(r.harness.playback.entitlementChecks).toEqual([{ accountId: DEV_ACCOUNTS.bob, episodeId: 'ep-1' }]);
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
    expect(r.last()).toMatchObject({ kind: 'ready', episode: { episodeId: 'ep-2' } });
    decoding.release('started');
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(r.last()).toMatchObject({ kind: 'ready', episode: { episodeId: 'ep-2' } });
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
      String(input).includes('/playback/media/') ? new Response('{"error":"forbidden"}', { status: 403 }) : real(input, init)) as typeof fetch;
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
    expect(kinds(r)).toEqual(['ready', 'pending', 'playing', 'paused', 'resume-blocked']);
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

    expect(r.last()).toMatchObject({ kind: 'ready', episode: { episodeId: 'ep-2' } });
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
    r.player.pause = () => (r.player.calls.push('pause'), new Promise<void>((resolve) => void (settle = resolve)));

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
    r.player.pause = () => new Promise<void>((resolve) => void (settle = resolve));

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

    expect(r.last()).toMatchObject({ kind: 'playing', episode: { episodeId: 'ep-2' } });
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

    expect(r.last()).toMatchObject({ kind: 'ready', episode: { episodeId: 'ep-2' } });
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

    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toEqual([]);
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
      res.writeHead(302, { location: `${elsewhere.origin}${req.url}`, 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }).end();
    });
    try {
      const r = await rig({ tamperGrant: (grant) => ({ ...grant, mediaUrl: `${redirecting.origin}/playback/media/ep-1` }) });
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
async function fetchedUrls<T>(run: () => Promise<T>): Promise<{ readonly result: T; readonly urls: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input, init) => (urls.push(String(input instanceof Request ? input.url : input)), real(input, init))) as typeof fetch;
  try {
    return { result: await run(), urls };
  } finally {
    globalThis.fetch = real;
  }
}

const mediaFetches = (urls: readonly string[]) => urls.filter((url) => url.includes('/playback/media/'));

describe('Recovery after access ends between the grant and the media fetch', () => {
  it('stops, clears the source and offers a deliberate retry; the retry re-checks entitlement and shows denial when revoked', async () => {
    // The subscription lapses after Play was granted but before the bytes were requested.
    const r = await rig({ afterGrant: (h) => h.playback.setEntitled(DEV_ACCOUNTS.alice, []) });
    await r.select(EP1);

    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('expired');
    expect(r.player.started).toHaveLength(0);
    expect(r.player.calls.at(-1)).toBe('stop'); // nothing is left playing or held
    expect(r.harness.playback.mediaReads).toEqual([]); // the service gave no protected bytes

    // Retry is a new Play with fresh checks: this time the entitlement check itself says no.
    r.view.play();
    await expect.poll(() => r.last()?.kind).toBe('denied');
    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toHaveLength(2);
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
    expect(grants.every((call) => JSON.stringify(call.arguments) === JSON.stringify({ episodeId: 'ep-1' }))).toBe(true);
    expect(r.harness.playback.mediaReads).toEqual(['ep-1']);
  });

  it('does not retry on its own: after expiry no further Play or media request is made until the user presses', async () => {
    const r = await rig({ afterGrant: (h) => h.playback.setEntitled(DEV_ACCOUNTS.alice, []) });
    await r.select(EP1);
    const { urls } = await fetchedUrls(async () => {
      r.view.play();
      await expect.poll(() => r.last()?.kind).toBe('expired');
      await new Promise((resolve) => setTimeout(resolve, 300)); // long enough for any hidden retry loop to show itself
    });

    expect(mediaFetches(urls)).toHaveLength(1);
    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toHaveLength(1);
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
    for (const url of [...first.urls, ...second.urls]) expect(new URL(url).origin).toBe(allowed); // no public mp3 or chat URL
    expect(mediaFetches(first.urls)).toHaveLength(1);
    expect(mediaFetches(second.urls)).toHaveLength(1);
    expect(r.forwarded.filter((call) => call.name === 'play_episode')).toHaveLength(2);
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
    await expect.poll(() => r.forwarded.filter((call) => call.name === 'play_episode').length).toBe(1);
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
    r.app.close = () => (closes += 1, close());
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
    await expect.poll(() => r.last()).toMatchObject({ kind: 'playing', episode: { episodeId: 'ep-2' } });
    const shown = r.states.length;
    const calls = r.player.calls.length;

    older.release('started');
    await settled();

    expect(r.player.calls.slice(calls)).toEqual([]);
    expect(r.states.length).toBe(shown);
    expect(r.last()).toMatchObject({ kind: 'playing', episode: { episodeId: 'ep-2' } });
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
