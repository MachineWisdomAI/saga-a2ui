import { readFile } from 'node:fs/promises';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../src/mcp/dev-auth.js';
import {
  acquireMedia,
  createRecipientKey,
  MEDIA_BYTES,
  rpcOverHttp,
  signMediaProof,
  startPlaybackHarness,
  type PlaybackHarness,
  type PlaybackHarnessOptions,
} from '../src/playback/playback-fixture.js';
import { toneWav } from '../src/playback/synthetic-media.js';
import type { HostedResource } from './host-fixture/host.js';

// End to end: the real listener with real bearer credentials, the controlled media service, and
// the BUILT player view in the sandboxed iframe of the local host fixture. The host fixture's
// tool handler plays the host: it forwards each proxied tools/call, including its `_meta`, over
// real HTTP. Audio is real Web Audio in Chromium; a wrapper records the contexts the view creates
// so a test can observe the audio clock. This is not evidence for any actual chat host.

const builtView = new URL('../dist/playback-view/playback.html', import.meta.url);
const OPENER = 'get_playable_episode';
const PLAY = 'play_episode';

let harness: PlaybackHarness | undefined;

test.afterEach(async () => {
  await harness?.listener.close();
  harness = undefined;
});

interface HostOptions {
  readonly token?: string;
  /** Models a host that does not forward the call's `_meta`. */
  readonly dropMeta?: boolean;
  readonly entitlements?: Record<string, readonly string[]>;
  readonly harness?: Omit<PlaybackHarnessOptions, 'viewHtml'>;
  /** Runs at the host after the listener granted a Play and before the view sees the grant. */
  readonly afterGrant?: () => void;
  /** Changes the view projection the host hands over, as a buggy or hostile host path would. */
  readonly tamperGrant?: (grant: Record<string, unknown>) => Record<string, unknown>;
}

interface MountedHost {
  readonly view: FrameLocator;
  readonly harness: PlaybackHarness;
  /** The proxied calls the host forwarded, with the exact result the listener returned. */
  readonly calls: { params: { name: string; arguments?: unknown; _meta?: Record<string, unknown> }; result: { _meta?: Record<string, unknown> } }[];
  useToken(token: string | undefined): void;
  /** Holds the next proxied tools/call at the host until released, to observe the pending state. */
  holdNextToolCall(): { release(): void };
  open(episodeId: string): Promise<void>;
}

async function mountPlayer(page: Page, options: HostOptions = {}): Promise<MountedHost> {
  const viewHtml = await readFile(builtView, 'utf8');
  harness = await startPlaybackHarness(
    options.entitlements ?? { [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'], [DEV_ACCOUNTS.bob]: [] },
    { mediaBytes: toneWav(1), ...options.harness, viewHtml },
  );
  const running = harness;
  let token: string | undefined = options.token ?? DEV_TOKENS.alice;
  const calls: MountedHost['calls'] = [];
  let gate: Promise<void> | undefined;

  // Records the audio contexts the view creates, in every frame, so the audio clock is observable.
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const created: AudioContext[] = [];
    (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts = created;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args);
        created.push(this);
      }
    };
  });

  const post = async (body: unknown) =>
    rpcOverHttp(running.listener.playbackUrl, token, body);

  await page.exposeFunction('handleToolCall', async (params: MountedHost['calls'][number]['params']) => {
    if (gate) {
      const waiting = gate;
      gate = undefined;
      await waiting;
    }
    const sent = options.dropMeta ? { name: params.name, arguments: params.arguments } : params;
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: sent });
    if (response.status === 401 || response.status === 403) throw new Error(`listener refused (${response.status})`);
    const result = (response.body as { result: MountedHost['calls'][number]['result'] }).result;
    calls.push({ params, result });
    if (params.name === PLAY && !(result as { isError?: boolean }).isError) options.afterGrant?.();
    const grant = result._meta?.['saga-a2ui/playback'];
    if (params.name !== PLAY || !grant || !options.tamperGrant) return result;
    return { ...result, _meta: { ...result._meta, 'saga-a2ui/playback': options.tamperGrant(grant as Record<string, unknown>) } };
  });

  const resource = await post({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://saga-a2ui/playback-view.html' } });
  const content = (resource.body as { result: { contents: { text: string; _meta: { ui: { csp: HostedResource['csp'] } } }[] } }).result.contents[0];
  if (!content) throw new Error('resources/read returned no contents');
  await page.goto('/host-fixture/index.html');
  await page.evaluate((hosted) => window.mountView?.(hosted), { html: content.text, csp: content._meta.ui.csp });

  return {
    view: page.frameLocator('iframe[title="MCP App view"]'),
    harness: running,
    calls,
    useToken: (next) => void (token = next),
    holdNextToolCall() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => void (release = resolve));
      return { release };
    },
    // The host mounts the view by running the model-visible opener and delivering its real result.
    async open(episodeId) {
      const opened = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: OPENER, arguments: { episodeId } } });
      await page.evaluate((result) => window.deliverToolResult?.(result), (opened.body as { result: never }).result);
    },
  };
}

const status = (view: FrameLocator) => view.getByTestId('play-status');
const button = (view: FrameLocator) => view.getByTestId('play-button');

/** The audio clock of every context the view created: proof that sound is (or is not) being produced. */
async function audioClocks(page: Page): Promise<{ state: string; time: number }[]> {
  const perFrame = await Promise.all(
    page.frames().map((frame) =>
      frame
        .evaluate(() =>
          ((window as unknown as { __audioContexts?: AudioContext[] }).__audioContexts ?? []).map((context) => ({
            state: context.state,
            time: context.currentTime,
          })),
        )
        .catch(() => []), // a frame that is mid-navigation has no contexts to report
    ),
  );
  return perFrame.flat();
}

test.describe('the built player for the entitled listener', () => {
  test('shows playing only once audio is audibly advancing, and fetched the protected bytes exactly once', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    await expect(status(host.view)).toContainText('Ready to play The protected episode');

    await button(host.view).click();

    await expect(status(host.view)).toContainText('Playing The protected episode');
    const [first] = await audioClocks(page);
    expect(first?.state).toBe('running');
    await expect.poll(async () => ((await audioClocks(page))[0]?.time ?? 0) > (first?.time ?? 0)).toBe(true);
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']);
    expect(host.harness.playback.entitlementChecks).toEqual([{ accountId: DEV_ACCOUNTS.alice, episodeId: 'ep-1' }]);
  });

  test('is operable from the keyboard alone and keeps focus on the control', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    await expect(button(host.view)).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(button(host.view)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(status(host.view)).toContainText('Playing');
    await expect(button(host.view)).toBeFocused();
    await expect(button(host.view)).toHaveText('Pause');
    await page.keyboard.press('Space');
    await expect(status(host.view)).toHaveText('Paused.');
    await expect(button(host.view)).toBeFocused();
  });
});

const DENIED = 'Playback denied: this account does not have access to this episode.';

/** What the built view was granted by the real listener: the capability only the view receives. */
function lastGrant(host: MountedHost): { capability: string; mediaUrl: string; episodeId: string } {
  const grant = [...host.calls].reverse().find((call) => call.params.name === PLAY)?.result._meta?.['saga-a2ui/playback'];
  if (!grant) throw new Error('the host saw no Play grant');
  return grant as { capability: string; mediaUrl: string; episodeId: string };
}

/** True when no audio context the view created is still producing sound. */
const silent = async (page: Page) => (await audioClocks(page)).every((context) => context.state !== 'running');

test.describe('the built player when access is refused', () => {
  test('denied B: says so, plays nothing, and the server read no media', async ({ page }) => {
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob });
    await host.open('ep-1');

    await button(host.view).click();

    await expect(status(host.view)).toHaveText(DENIED);
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'denied');
    expect(await silent(page)).toBe(true);
    expect(host.harness.playback.mediaReads).toEqual([]);
    expect(host.harness.playback.entitlementChecks).toEqual([{ accountId: DEV_ACCOUNTS.bob, episodeId: 'ep-1' }]);
  });

  test('a refused credential is sign-in recovery, not an entitlement denial', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    host.useToken(DEV_TOKENS.expired);

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'sign-in-required');
    await expect(status(host.view)).toHaveText('Sign in to play this episode.');
    await expect(status(host.view)).not.toContainText('denied');
    expect(host.harness.playback.entitlementChecks).toEqual([]);
    expect(host.harness.playback.mediaReads).toEqual([]);
  });

  test('a host that drops the call metadata gets an unsupported view, no checks and no bytes', async ({ page }) => {
    const host = await mountPlayer(page, { dropMeta: true });
    await host.open('ep-1');

    await button(host.view).click();

    await expect(status(host.view)).toHaveText('Playback is not supported here.');
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'unsupported');
    expect(host.harness.playback.entitlementChecks).toEqual([]);
    expect(host.harness.playback.mediaReads).toEqual([]);
    // Nothing the user can press remains, so keyboard focus moves to the announced status.
    await expect(button(host.view)).toHaveCount(0);
    await expect(status(host.view)).toBeFocused();
  });

  test('valid replay rechecks current permission: access revoked after the first play is denied', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toHaveText('Finished playing.', { timeout: 10_000 });

    host.harness.playback.setEntitled(DEV_ACCOUNTS.alice, []);
    await button(host.view).click();

    await expect(status(host.view)).toHaveText(DENIED);
    expect(host.harness.playback.entitlementChecks).toHaveLength(2);
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']); // only the first, entitled play read media
  });

  test('retry after a denial is a fresh authorization that succeeds once access is granted', async ({ page }) => {
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob });
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toHaveText(DENIED);

    host.harness.playback.setEntitled(DEV_ACCOUNTS.bob, ['ep-1']);
    await button(host.view).click();

    await expect(status(host.view)).toContainText('Playing');
    expect(host.harness.playback.entitlementChecks).toHaveLength(2);
  });
});

test.describe('capability expiry through the built player', () => {
  test('a capability that expires before the bytes are requested is announced as expired, not as a denial or a failure, and Play recovers', async ({ page }) => {
    // The service's clock is ours. The capability lives 5 seconds and the clock jumps 6 between the
    // grant and the media request, so the proof (made now) is still fresh: only the capability is stale.
    const clock = { now: Math.floor(Date.now() / 1000) };
    let advance = true;
    const host = await mountPlayer(page, {
      harness: { capabilityTtlSeconds: 5, nowSeconds: () => clock.now },
      afterGrant: () => {
        if (advance) clock.now += 6;
      },
    });
    await host.open('ep-1');

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'expired');
    await expect(status(host.view)).toHaveText('Playback access expired. Press Play to ask for access again.');
    expect(await silent(page)).toBe(true);
    expect(host.harness.playback.mediaReads).toEqual([]); // the service refused: no protected read

    // Recovery is a new Play with fresh checks, never a refreshed capability.
    advance = false;
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    expect(host.harness.playback.entitlementChecks).toHaveLength(2);
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']);
  });
});

test.describe('recipient binding through the built player', () => {
  test('the capability the built player received gives another user or another episode no bytes', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    const grant = lastGrant(host);
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']); // the built player's own acquisition

    const bobKey = await createRecipientKey();
    const asBob = await acquireMedia({
      url: grant.mediaUrl,
      capability: grant.capability,
      proof: await signMediaProof({ key: bobKey, capability: grant.capability, url: grant.mediaUrl }),
    });
    const otherUrl = grant.mediaUrl.replace('/ep-1', '/ep-2');
    const otherEpisode = await acquireMedia({
      url: otherUrl,
      capability: grant.capability,
      proof: await signMediaProof({ key: bobKey, capability: grant.capability, url: otherUrl }),
    });
    const bareCopy = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability });

    for (const attempt of [asBob, otherEpisode, bareCopy]) {
      expect(attempt.status).toBe(403);
      expect(Buffer.from(attempt.bytes).includes(Buffer.from(MEDIA_BYTES))).toBe(false);
    }
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']); // still only the built player's read
  });
});

/** Makes every `AudioContext.resume()` in every frame reject, as a device the browser withholds does. */
async function rejectResume(page: Page, errorName: string): Promise<void> {
  for (const frame of page.frames()) {
    await frame.evaluate((name) => {
      AudioContext.prototype.resume = () => Promise.reject(new DOMException('Audio device unavailable', name));
    }, errorName);
  }
}

test.describe('the built player Pause and Resume tell the truth about the audio', () => {
  test('a Resume the browser withholds is not announced as playing, and the next press resumes', async ({ page }) => {
    const host = await mountPlayer(page, { harness: { mediaBytes: toneWav(10) } });
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    await button(host.view).click();
    await expect(status(host.view)).toHaveText('Paused.');
    const [paused] = await audioClocks(page);
    expect(paused?.state).toBe('suspended');
    await rejectResume(page, 'NotAllowedError');

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'resume-blocked');
    await expect(status(host.view)).not.toContainText('Playing');
    await expect(button(host.view)).toHaveText('Resume'); // the offered recovery keeps the position
    expect((await audioClocks(page))[0]?.state).toBe('suspended');

    // The browser relents: the next explicit press resumes from where the audio stopped.
    for (const frame of page.frames()) await frame.evaluate(() => void delete (AudioContext.prototype as Partial<AudioContext>).resume);
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    await expect.poll(async () => ((await audioClocks(page))[0]?.time ?? 0) > (paused?.time ?? 0)).toBe(true);
    expect(host.harness.playback.entitlementChecks).toHaveLength(1); // recovery is not a new authorization
  });

  test('a Resume the player can no longer perform is a media failure with a fresh Play on offer', async ({ page }) => {
    const host = await mountPlayer(page, { harness: { mediaBytes: toneWav(10) } });
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    await button(host.view).click();
    await expect(status(host.view)).toHaveText('Paused.');
    await rejectResume(page, 'InvalidStateError');

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'media-failed');
    await expect(status(host.view)).toHaveText('The audio could not be played.');
    expect(await silent(page)).toBe(true);
  });

  test('media that ends before startup is confirmed reaches ended, not playing', async ({ page }) => {
    const host = await mountPlayer(page, { harness: { mediaBytes: toneWav(0.005) } });
    await host.open('ep-1');

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'ended');
    await expect(status(host.view)).toHaveText('Finished playing.');
    // The late startup confirmation has had its chance to overwrite it; it must not have.
    await page.waitForTimeout(1_700);
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'ended');
  });
});

test.describe('the built player states are announced and reflow', () => {
  test('pending keeps the control focusable but inert, and a second press makes no second request', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    const inFlight = host.holdNextToolCall();

    await button(host.view).click();
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'pending');
    await expect(status(host.view)).toHaveText('Checking access…');
    await expect(button(host.view)).toHaveAttribute('aria-disabled', 'true');
    await expect(button(host.view)).toHaveAttribute('aria-busy', 'true');
    // Playwright treats aria-disabled as "not actionable" and would wait forever; a real user can
    // still press the button, so force the press to exercise the duplicate-activation path.
    await button(host.view).click({ force: true });
    await button(host.view).click({ force: true });
    inFlight.release();

    await expect(status(host.view)).toContainText('Playing');
    expect(host.calls.filter((call) => call.params.name === PLAY)).toHaveLength(1);
  });

  test('the status is a polite live region and the page is the only thing that speaks it', async ({ page }) => {
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob });
    await host.open('ep-1');
    await expect(status(host.view)).toHaveAttribute('role', 'status');
    await expect(status(host.view)).toHaveAttribute('aria-live', 'polite');
  });

  test('stays usable at a 320px width: no horizontal scrolling and the control is on screen', async ({ page }) => {
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob });
    await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      if (frame) frame.style.cssText = 'width:320px;height:240px;border:0';
    });
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toHaveText(DENIED);

    const overflow = await page.frames().find((frame) => frame !== page.mainFrame())?.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow?.scroll).toBeLessThanOrEqual(overflow?.client ?? 0);
    await expect(button(host.view)).toBeInViewport();
    await expect(status(host.view)).toBeInViewport();
  });

  test('reflows at 320px with the text enlarged to 200%: the long denial wraps instead of overflowing', async ({ page }) => {
    // WCAG reflow is "no horizontal scrolling at 320 CSS px", the width of a 1280px window at 400%
    // zoom, so the narrow frame above is the zoom check. This adds the other axis: larger text.
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob });
    await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      if (frame) frame.style.cssText = 'width:320px;height:480px;border:0';
    });
    await host.open('ep-1');
    await host.view.locator('html').evaluate((root) => void (root.style.fontSize = '200%'));
    await button(host.view).click();
    await expect(status(host.view)).toHaveText(DENIED);

    const overflow = await page.frames().find((frame) => frame !== page.mainFrame())?.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow?.scroll).toBeLessThanOrEqual(overflow?.client ?? 0);
    await expect(button(host.view)).toBeInViewport();
  });
});

/** Every request the page and its frames make to a media path or to the stand-in destination. */
function watchNetwork(page: Page): { readonly urls: () => string[] } {
  const urls: string[] = [];
  page.on('request', (request) => void urls.push(request.url()));
  return { urls: () => [...urls] };
}

const mediaRequests = (urls: readonly string[]) => urls.filter((url) => url.includes('/playback/media/'));

test.describe('revocation and expiry through the built player', () => {
  test('access revoked after the grant: the player stops, says access expired, keeps focus on the control and recovers on a deliberate press', async ({ page }) => {
    let revoke = true;
    const host = await mountPlayer(page, {
      afterGrant: () => {
        if (!revoke) return;
        revoke = false;
        host.harness.playback.setEntitled(DEV_ACCOUNTS.alice, []);
      },
    });
    await host.open('ep-1');

    await page.keyboard.press('Tab');
    await expect(button(host.view)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'expired');
    await expect(status(host.view)).toHaveText('Playback access expired. Press Play to ask for access again.');
    await expect(status(host.view)).toHaveAttribute('aria-live', 'polite'); // announced through the live region
    await expect(button(host.view)).toBeFocused(); // a keyboard user is not stranded
    expect(await silent(page)).toBe(true);
    expect(host.harness.playback.mediaReads).toEqual([]); // the service delivered no protected bytes

    // Retry is deliberate and fresh: the server now says no, and the view shows safe denial.
    await page.keyboard.press('Enter');
    await expect(status(host.view)).toHaveText(DENIED);
    expect(host.calls.filter((call) => call.params.name === PLAY)).toHaveLength(2);
    expect(host.harness.playback.mediaReads).toEqual([]);

    host.harness.playback.setEntitled(DEV_ACCOUNTS.alice, ['ep-1']);
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']);
  });

  test('a media service that is down is announced as a failed audio, not as expiry, and offers a fresh Play', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    host.harness.playback.failReadsWith('storage down');

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'media-failed');
    await expect(status(host.view)).toHaveText('The audio could not be played.');
    await expect(status(host.view)).not.toContainText('expired');
    expect(await silent(page)).toBe(true);

    host.harness.playback.failReadsWith(undefined);
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    expect(host.calls.filter((call) => call.params.name === PLAY)).toHaveLength(2);
  });

  test('does not retry by itself after expiry: one Play, one media request, however long it waits', async ({ page }) => {
    const network = watchNetwork(page);
    const host = await mountPlayer(page, { afterGrant: () => host.harness.playback.setEntitled(DEV_ACCOUNTS.alice, []) });
    await host.open('ep-1');

    await button(host.view).click();
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'expired');
    await page.waitForTimeout(1_500);

    expect(host.calls.filter((call) => call.params.name === PLAY)).toHaveLength(1);
    expect(mediaRequests(network.urls()).filter((url) => !url.endsWith('/playback/mcp'))).toHaveLength(1);
    expect(host.harness.playback.entitlementChecks).toHaveLength(2); // Play, then the single acquisition
  });
});

test.describe('where the built player may send the capability', () => {
  test('a media URL on an undeclared origin is blocked by the resource policy: nothing arrives there, nothing plays', async ({ page }) => {
    const { startRecorder } = await import('../src/playback/playback-fixture.js');
    const elsewhere = await startRecorder();
    try {
      const host = await mountPlayer(page, {
        tamperGrant: (grant) => ({ ...grant, mediaUrl: `${elsewhere.origin}/playback/media/ep-1` }),
      });
      await host.open('ep-1');

      await button(host.view).click();

      await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'media-failed');
      expect(elsewhere.requests).toEqual([]); // not even a preflight reached the undeclared destination
      expect(host.harness.playback.mediaReads).toEqual([]);
      expect(await silent(page)).toBe(true);
    } finally {
      await elsewhere.close();
    }
  });

  test('the capability and the proof travel only to the declared media origin', async ({ page }) => {
    const sent: { url: string; headers: Record<string, string> }[] = [];
    page.on('request', (request) => {
      const headers = request.headers();
      if ('x-saga-capability' in headers || 'x-saga-proof' in headers) sent.push({ url: request.url(), headers });
    });
    const host = await mountPlayer(page);
    await host.open('ep-1');

    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');

    const declared = new URL(host.harness.listener.url).origin;
    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) expect(new URL(request.url).origin).toBe(declared);
    expect(sent.every((request) => request.headers['x-saga-capability'] === lastGrant(host).capability)).toBe(true);
  });
});

test.describe('nothing is fetched or disclosed after a refusal', () => {
  test('a denied Play makes no media request at all, and the capability is nowhere the model can see', async ({ page }) => {
    const network = watchNetwork(page);
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob });
    await host.open('ep-1');

    await button(host.view).click();
    await expect(status(host.view)).toHaveText(DENIED);
    await page.waitForTimeout(500);

    expect(mediaRequests(network.urls())).toEqual([]);
    expect(host.harness.playback.mediaReads).toEqual([]);
    const modelVisible = JSON.stringify(host.calls.map((call) => ({ content: (call.result as { content?: unknown }).content, structuredContent: (call.result as { structuredContent?: unknown }).structuredContent })));
    expect(modelVisible).not.toMatch(/capability/i);
  });

  test('after an entitled Play the capability is only in the view-only result, never in model-visible fields or the static resource', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    const { capability } = lastGrant(host);

    const modelVisible = JSON.stringify(host.calls.map((call) => ({ content: (call.result as { content?: unknown }).content, structuredContent: (call.result as { structuredContent?: unknown }).structuredContent })));
    expect(modelVisible).not.toContain(capability);
    const resource = await rpcOverHttp(host.harness.listener.playbackUrl, DEV_TOKENS.alice, { jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'ui://saga-a2ui/playback-view.html' } });
    expect(JSON.stringify(resource.body)).not.toContain(capability);
  });
});
