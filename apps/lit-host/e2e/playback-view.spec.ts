import { readFile } from 'node:fs/promises';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { createContentPolicy, type ContentPolicy } from '@saga-a2ui/components/faithful-card';
import { embedPolicy } from '../src/content/embedded-policy.js';
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
import { builtUrl } from './built-artifacts.js';
import type { HostedResource } from './host-fixture/host.js';

// End to end: the real listener with real bearer credentials, the controlled media service, and
// the BUILT player view in the sandboxed iframe of the local host fixture. The host fixture's
// tool handler plays the host: it forwards each proxied tools/call, including its `_meta`, over
// real HTTP. Audio is real Web Audio in Chromium; a wrapper records the contexts the view creates
// so a test can observe the audio clock. This is not evidence for any actual chat host.

const builtView = builtUrl('playback-view/playback.html');
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
  /** Replaces the whole Play answer the host resolves with, after the server handled the call (and may have issued a capability). */
  readonly rewriteAnswer?: (result: Record<string, unknown>) => Record<string, unknown>;
  /** Advertises the host's `openLinks` capability and receives each `ui/open-link` request. Absent: the host offers none. */
  readonly openLink?: (url: string) => Promise<{ isError?: boolean }>;
  /** Serves the player with this trusted content policy embedded, as the episode view is. Absent: none (the deployed shape). */
  readonly contentPolicy?: ContentPolicy;
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

  const { openLink } = options;
  if (openLink) await page.exposeFunction('handleOpenLink', (params: { url: string }) => openLink(params.url));

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
    if (params.name === PLAY && options.rewriteAnswer) return options.rewriteAnswer(result as Record<string, unknown>);
    if (params.name === PLAY && !(result as { isError?: boolean }).isError) options.afterGrant?.();
    const grant = result._meta?.['saga-a2ui/playback'];
    if (params.name !== PLAY || !grant || !options.tamperGrant) return result;
    return { ...result, _meta: { ...result._meta, 'saga-a2ui/playback': options.tamperGrant(grant as Record<string, unknown>) } };
  });

  const resource = await post({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://saga-a2ui/playback-view.html' } });
  const content = (resource.body as { result: { contents: { text: string; _meta: { ui: { csp: HostedResource['csp'] } } }[] } }).result.contents[0];
  if (!content) throw new Error('resources/read returned no contents');
  // A resource that carries a trusted content policy, as the episode view does: the document embeds
  // the policy's restrictions and the host is told the origins it declares.
  const { contentPolicy } = options;
  const hosted = contentPolicy
    ? {
        html: embedPolicy(content.text, contentPolicy),
        csp: { ...content._meta.ui.csp, resourceDomains: contentPolicy.resource.resourceDomains },
      }
    : { html: content.text, csp: content._meta.ui.csp };
  await page.goto('/host-fixture/index.html');
  await page.evaluate((resource) => window.mountView?.(resource), hosted);

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

const UNCONFIRMED = 'Playback could not be confirmed. Open this episode again to try playing it.';

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
    // One check authorizing the Play and one more when the service was asked for the bytes.
    const alice = { accountId: DEV_ACCOUNTS.alice, episodeId: 'ep-1' };
    expect(host.harness.playback.entitlementChecks).toEqual([alice, alice]);
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

  test('a refused host call is unconfirmed, not a denial or a sign-in claim, and invites no retry', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    host.useToken(DEV_TOKENS.expired);

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'unavailable');
    await expect(status(host.view)).toHaveText(UNCONFIRMED);
    await expect(status(host.view)).not.toContainText('denied');
    await expect(status(host.view)).not.toContainText('Sign in');
    expect(host.harness.playback.entitlementChecks).toEqual([]);
    expect(host.harness.playback.mediaReads).toEqual([]);
    // Nothing the user can press remains, so keyboard focus moves to the announced status.
    await expect(button(host.view)).toHaveCount(0);
    await expect(status(host.view)).toBeFocused();
    await expect(status(host.view)).toHaveAttribute('aria-live', 'polite');
  });

  test('a generic tool error is unconfirmed too: no Play or Try again, focus on the status, and nothing retries', async ({ page }) => {
    // The server issued a capability for the good request; only the answer the view receives is a generic failure.
    const host = await mountPlayer(page, {
      rewriteAnswer: () => ({ isError: true, content: [{ type: 'text', text: 'Playback is unavailable.' }] }),
    });
    await host.open('ep-1');

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'unavailable');
    await expect(status(host.view)).toHaveText(UNCONFIRMED);
    await expect(button(host.view)).toHaveCount(0);
    await expect(status(host.view)).toBeFocused();
    await expect(status(host.view)).toHaveAttribute('aria-live', 'polite');
    await page.waitForTimeout(150);
    expect(host.calls.filter((call) => call.params.name === PLAY)).toHaveLength(1);
    expect(host.harness.playback.mediaReads).toEqual([]);
    expect(await silent(page)).toBe(true);
  });

  test('opening the episode again is the recovery from an unconfirmed attempt', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    host.useToken(DEV_TOKENS.expired);
    await button(host.view).click();
    await expect(status(host.view)).toHaveText(UNCONFIRMED);

    host.useToken(DEV_TOKENS.alice);
    await host.open('ep-1');
    await expect(status(host.view)).toContainText('Ready to play The protected episode');
    await button(host.view).click();

    await expect(status(host.view)).toContainText('Playing The protected episode');
    expect(host.calls.filter((call) => call.params.name === PLAY)).toHaveLength(1);
  });

  test('a host call that never answers ends at the attempt bound, aborts nothing else and recovers by opening again', async ({ page }) => {
    await page.clock.install();
    const host = await mountPlayer(page);
    await host.open('ep-1');
    const never = host.holdNextToolCall();

    await button(host.view).click();
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'pending');
    await page.clock.fastForward(29_000);
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'pending'); // not yet
    await page.clock.fastForward(2_000);

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'unavailable');
    await expect(status(host.view)).toHaveText(UNCONFIRMED);
    never.release(); // the host answers long after the view gave up
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'unavailable');
    expect(host.harness.playback.mediaReads).toEqual([]);

    await host.open('ep-1');
    await expect(status(host.view)).toContainText('Ready to play');
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
    // First Play and its acquisition, then the replayed Play, which is refused before any media.
    expect(host.harness.playback.entitlementChecks).toHaveLength(3);
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
    // The denied Play, then the granted Play and its acquisition.
    expect(host.harness.playback.entitlementChecks).toHaveLength(3);
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
    // The expired capability is refused before any entitlement lookup, so the checks are the first
    // Play, the second Play and the second Play's acquisition.
    expect(host.harness.playback.entitlementChecks).toHaveLength(3);
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
    // The one Play and its acquisition; resuming is not a new authorization.
    expect(host.harness.playback.entitlementChecks).toHaveLength(2);
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

test.describe('the unconfirmed state reflows with a long title', () => {
  const LONG_TITLE = 'An exceptionally long episode title that keeps going and going so that it must wrap at narrow widths ' + 'x'.repeat(10);

  test('wraps at 320px with 200% text, keeps the title and status readable and focus on the status', async ({ page }) => {
    const host = await mountPlayer(page, {
      harness: { episodes: [{ id: 'ep-1', title: LONG_TITLE.slice(0, 120), description: 'Public.' }] },
    });
    await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      if (frame) frame.style.cssText = 'width:320px;height:480px;border:0';
    });
    await host.open('ep-1');
    await host.view.locator('html').evaluate((root) => void (root.style.fontSize = '200%'));
    host.useToken(DEV_TOKENS.expired);
    await button(host.view).click();
    await expect(status(host.view)).toHaveText(UNCONFIRMED);

    const overflow = await page.frames().find((frame) => frame !== page.mainFrame())?.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow?.scroll).toBeLessThanOrEqual(overflow?.client ?? 0);
    await expect(status(host.view)).toBeInViewport();
    await expect(status(host.view)).toBeFocused();
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

// Host teardown (STATE1) in the built page. The fixture asks the view to tear down and leaves the
// iframe in place, so a control that is still rendered can be pressed. In a real host the page may
// disappear instead; what this shows is that nothing the view does afterwards depends on that.
test.describe('the built player after host teardown', () => {
  test('is silent at once, and a still-rendered Pause or Play control does nothing', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing');
    const requests = host.calls.length;

    await page.evaluate(() => window.teardownView?.());
    await expect.poll(() => silent(page)).toBe(true);
    await button(host.view).click(); // Pause, still rendered
    await button(host.view).click();
    await page.waitForTimeout(300);

    expect(await audioClocks(page)).toHaveLength(1); // no new context was prepared
    expect(await silent(page)).toBe(true);
    expect(host.calls).toHaveLength(requests);
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']);
    await expect(status(host.view)).toContainText('Playing'); // nothing was presented after teardown
  });

  test('presses on a ready Play control after teardown make no request and unlock no audio', async ({ page }) => {
    const host = await mountPlayer(page);
    await host.open('ep-1');
    await expect(status(host.view)).toContainText('Ready to play');

    await page.evaluate(() => window.teardownView?.());
    await button(host.view).click();
    await page.waitForTimeout(300);

    expect(host.calls).toEqual([]);
    expect(await audioClocks(page)).toEqual([]);
    expect(host.harness.playback.entitlementChecks).toEqual([]);
    expect(host.harness.playback.mediaReads).toEqual([]);
  });
});

const RETIRED_TEXT = 'Your session changed. Open a new view or reload to continue.';
const BOTH = { [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'], [DEV_ACCOUNTS.bob]: ['ep-1', 'ep-2'] };

// The label the view pinned is lost for good: the built page says how to recover, offers no
// control, and an opener under the old label cannot bring the controls back. The delayed copy of an
// opener under the SAME label is not detectable and is not claimed here.
test.describe('the built player after the sign-in label is lost', () => {
  test('an opener under another label retires it, names the recovery and ignores the old label afterwards', async ({ page }) => {
    const host = await mountPlayer(page, { entitlements: BOTH });
    await host.open('ep-1');
    await expect(status(host.view)).toContainText('Ready to play The protected episode');

    host.useToken(DEV_TOKENS.bob);
    await host.open('ep-1');
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'session-changed');
    await expect(status(host.view)).toHaveText(RETIRED_TEXT);
    await expect(button(host.view)).toHaveCount(0);

    host.useToken(DEV_TOKENS.alice); // the old label is back
    await host.open('ep-1');
    await host.open('ep-2');
    await page.waitForTimeout(150);

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'session-changed');
    await expect(status(host.view)).toHaveText(RETIRED_TEXT);
    await expect(button(host.view)).toHaveCount(0);
    expect(host.calls.filter((call) => call.params.name === PLAY)).toEqual([]);
    expect(host.harness.playback.mediaReads).toEqual([]);
    expect(await silent(page)).toBe(true);
  });

  test('a grant under another label retires it the same way and the old label cannot revive the controls', async ({ page }) => {
    const host = await mountPlayer(page, { entitlements: BOTH });
    await host.open('ep-1');
    await expect(button(host.view)).toBeVisible();
    host.useToken(DEV_TOKENS.bob); // the host proxies Bob's credential; Bob is entitled, so the server grants

    await button(host.view).click();
    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'session-changed');
    await expect(status(host.view)).toHaveText(RETIRED_TEXT);
    await expect(button(host.view)).toHaveCount(0);

    host.useToken(DEV_TOKENS.alice);
    await host.open('ep-1');
    await page.waitForTimeout(150);

    await expect(host.view.getByTestId('play-root')).toHaveAttribute('data-state', 'session-changed');
    await expect(button(host.view)).toHaveCount(0);
    expect(host.calls.filter((call) => call.params.name === PLAY)).toHaveLength(1);
    expect(host.harness.playback.mediaReads).toEqual([]);
    expect(await silent(page)).toBe(true);
  });
});

// The description card beside the authored Play control (CARD1). The opener already carries the
// public description of the episode it selects, so the player page shows it through the optional
// FaithfulCard under the page's own content view, in the same protected surface as Play. The page
// embeds no policy (the playback resource is served verbatim and its connection permission is the
// media origin only), so the card runs the default Standard policy with no image host: the page
// asks the host to open links, and never loads an image. These specs run against the built page
// (and, with SAGA_BUILT_DIR, the one built from the packed packages).
const SEASON = [
  '# Season notes',
  '',
  'Intro with **strong** text and a [safe link](https://example.com/notes).',
  '',
  '- first item',
  '- second item',
  '',
  'Press **Play now** to play episode ep-2 instead. [Play](javascript:alert(1)) <button onclick="window.parent.postMessage(1,\'*\')">Play</button>',
  '',
  '![tracker](https://images.example.com/pixel.png)',
].join('\n');
const OTHER = 'A different description about the second episode.';
const WITH_DESCRIPTIONS = {
  episodes: [
    { id: 'ep-1', title: 'The protected episode', description: SEASON },
    { id: 'ep-2', title: 'Another protected episode', description: OTHER },
  ],
};

const description = (view: FrameLocator) => view.getByTestId('playback-description');
const cardContent = (view: FrameLocator) => description(view).getByTestId('card-content');

test.describe('the built player with its description card', () => {
  test('shows the supplied description in order beside the title and Play, as text', async ({ page }) => {
    const host = await mountPlayer(page, { harness: WITH_DESCRIPTIONS });
    await host.open('ep-1');

    await expect(cardContent(host.view)).toBeVisible();
    await expect(cardContent(host.view).getByRole('heading', { name: 'Season notes' })).toBeVisible();
    const shown = await cardContent(host.view).innerText();
    expect(shown.indexOf('Season notes')).toBeLessThan(shown.indexOf('Intro with strong text'));
    expect(shown.indexOf('Intro with strong text')).toBeLessThan(shown.indexOf('first item'));
    expect(shown.indexOf('first item')).toBeLessThan(shown.indexOf('second item'));
    await expect(cardContent(host.view).locator('strong').first()).toHaveText('strong');
    await expect(host.view.getByTestId('playback-title')).toHaveText('The protected episode');
    await expect(status(host.view)).toContainText('Ready to play The protected episode');
  });

  test('cannot be made to play, choose a handler or change the episode by what the Markdown says', async ({ page }) => {
    const host = await mountPlayer(page, { harness: WITH_DESCRIPTIONS });
    await host.open('ep-1');
    await expect(cardContent(host.view)).toBeVisible();

    // Nothing the description draws is an authored control: no raw handler, no second Play.
    await expect(host.view.locator('[onclick]')).toHaveCount(0);
    await expect(description(host.view).getByRole('button', { name: 'Play', exact: true })).toHaveCount(0);
    await cardContent(host.view).getByText('Play now').click();
    await page.waitForTimeout(200);
    expect(host.calls.filter((call) => call.params.name === PLAY)).toEqual([]);
    expect(await audioClocks(page)).toEqual([]);

    // The one authored control plays the episode the view selected, not the one the text names.
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing The protected episode');
    const plays = host.calls.filter((call) => call.params.name === PLAY);
    expect(plays).toHaveLength(1);
    expect(plays[0]?.params.arguments).toEqual({ episodeId: 'ep-1' });
    expect(host.harness.playback.mediaReads).toEqual(['ep-1']);
  });

  test('loads no image from the description, and a link goes only through the host', async ({ page }) => {
    const requests: string[] = [];
    await page.route(/^https:\/\//, (route) => {
      requests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    });
    const opened: string[] = [];
    const host = await mountPlayer(page, {
      harness: WITH_DESCRIPTIONS,
      openLink: async (url) => {
        opened.push(url);
        return {};
      },
    });
    await host.open('ep-1');
    await expect(cardContent(host.view)).toBeVisible();
    await expect(host.view.locator('img')).toHaveCount(0);

    await cardContent(host.view).getByRole('button', { name: /safe link/ }).click();

    await expect.poll(() => opened).toEqual(['https://example.com/notes']);
    expect(requests).toEqual([]);
    expect(host.calls.filter((call) => call.params.name === PLAY)).toEqual([]);
  });

  test('replaces the description with the new selection and keeps a late grant for the old one from acting on it', async ({ page }) => {
    const host = await mountPlayer(page, { harness: WITH_DESCRIPTIONS });
    await host.open('ep-1');
    await expect(cardContent(host.view)).toContainText('Season notes');
    const held = host.holdNextToolCall();
    await button(host.view).click();

    await host.open('ep-2');
    await expect(cardContent(host.view)).toHaveText(OTHER);
    await expect(host.view.getByTestId('playback-title')).toHaveText('Another protected episode');
    await expect(description(host.view)).not.toContainText('Season notes');
    held.release(); // the old selection's grant arrives after the replacement
    await page.waitForTimeout(300);

    expect(host.harness.playback.mediaReads).toEqual([]);
    expect(await silent(page)).toBe(true);
    await expect(status(host.view)).toContainText('Ready to play Another protected episode');
    await expect(cardContent(host.view)).toHaveText(OTHER);

    // The replacement is pressed afresh and plays itself.
    await button(host.view).click();
    await expect(status(host.view)).toContainText('Playing Another protected episode');
    expect(host.harness.playback.mediaReads).toEqual(['ep-2']);
  });

  test('keeps the description of the selection, and the Play it belongs to, together through a failed Play', async ({ page }) => {
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob, harness: WITH_DESCRIPTIONS });
    await host.open('ep-1');
    await button(host.view).click();

    await expect(status(host.view)).toHaveText(DENIED);
    await expect(cardContent(host.view)).toContainText('Season notes');
    expect(host.harness.playback.mediaReads).toEqual([]);
  });

  test('shows nothing of the private description once the sign-in label is lost, and no opener brings it back', async ({ page }) => {
    const host = await mountPlayer(page, { entitlements: BOTH, harness: WITH_DESCRIPTIONS });
    await host.open('ep-1');
    await expect(cardContent(host.view)).toContainText('Season notes');

    host.useToken(DEV_TOKENS.bob);
    await host.open('ep-1');
    await expect(status(host.view)).toHaveText(RETIRED_TEXT);
    await expect(cardContent(host.view)).toHaveCount(0);
    await expect(host.view.locator('body')).not.toContainText('Season notes');

    host.useToken(DEV_TOKENS.alice);
    await host.open('ep-1');
    await host.open('ep-2');
    await page.waitForTimeout(150);

    await expect(status(host.view)).toHaveText(RETIRED_TEXT);
    await expect(host.view.locator('body')).not.toContainText('Season notes');
    await expect(host.view.locator('body')).not.toContainText(OTHER);
    expect(host.calls.filter((call) => call.params.name === PLAY)).toEqual([]);
  });

  test('is not updated by an opener that arrives after host teardown', async ({ page }) => {
    const host = await mountPlayer(page, { harness: WITH_DESCRIPTIONS });
    await host.open('ep-1');
    await expect(cardContent(host.view)).toContainText('Season notes');

    await page.evaluate(() => window.teardownView?.());
    await host.open('ep-2');
    await page.waitForTimeout(200);

    await expect(cardContent(host.view)).toContainText('Season notes');
    await expect(host.view.locator('body')).not.toContainText(OTHER);
    await expect(host.view.getByTestId('playback-title')).toHaveText('The protected episode');
  });

  test('shows no card for an episode the opener could not describe, and none before any opener', async ({ page }) => {
    const host = await mountPlayer(page, { harness: WITH_DESCRIPTIONS });
    await expect(description(host.view)).toBeAttached();
    await expect(cardContent(host.view)).toHaveCount(0);
    await expect(host.view.getByTestId('card-failure')).toHaveCount(0);

    await host.open('ep-1');
    await expect(cardContent(host.view)).toBeVisible();
  });
});

// The page builds its content view from the resource the host mounted, so a resource that embeds a
// Strict policy gives its card the Show images control. Consent then has one owner (the content
// view's scope); the controller tells it when the selection ends. Embedding the policy also embeds
// its `connect-src 'none'`, which no player resource can accept (it must fetch its media), so
// these specs show only the consent boundary. Whether Play still works under such a resource is not
// claimed, and the deployed player embeds no policy.
const IMAGE_HOST = 'images.example.com';
const STRICT = (() => {
  const created = createContentPolicy({ level: 'strict', imageHosts: [IMAGE_HOST] });
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
})();
const WITH_IMAGES = {
  episodes: [
    { id: 'ep-1', title: 'The protected episode', description: `First ![one](https://${IMAGE_HOST}/one.png) description.` },
    { id: 'ep-2', title: 'Another protected episode', description: `Second ![two](https://${IMAGE_HOST}/two.png) description.` },
  ],
};

async function observeImages(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(/^https:\/\//, (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
  });
  return requests;
}

test.describe('the built player with a Strict content policy embedded in its resource', () => {
  test('loads an image only after Show images, and a new selection ends that consent before it presents', async ({ page }) => {
    const requests = await observeImages(page);
    const host = await mountPlayer(page, { harness: WITH_IMAGES, contentPolicy: STRICT });
    await host.open('ep-1');
    await expect(description(host.view).getByTestId('images-toggle')).toHaveText('Show images');
    await page.waitForTimeout(150);
    expect(requests).toEqual([]);

    await description(host.view).getByTestId('images-toggle').click();
    await expect(description(host.view).getByTestId('images-toggle')).toHaveText('Hide images');
    await expect.poll(() => requests).toEqual([`https://${IMAGE_HOST}/one.png`]);

    await host.open('ep-2'); // a new selection: what was agreed for the first does not carry over
    await expect(cardContent(host.view)).toContainText('Second');
    await expect(description(host.view).getByTestId('images-toggle')).toHaveText('Show images');
    await expect(host.view.locator('img')).toHaveCount(0);
    await page.waitForTimeout(150);
    expect(requests).toEqual([`https://${IMAGE_HOST}/one.png`]);

    await host.open('ep-2'); // the same episode again is a new selection too
    await description(host.view).getByTestId('images-toggle').click();
    await expect.poll(() => requests.at(-1)).toBe(`https://${IMAGE_HOST}/two.png`);
    await host.open('ep-2');
    await expect(description(host.view).getByTestId('images-toggle')).toHaveText('Show images');
    await expect(host.view.locator('img')).toHaveCount(0);
  });

  test('ends consent for good at host teardown: a still-rendered control grants nothing', async ({ page }) => {
    const requests = await observeImages(page);
    const host = await mountPlayer(page, { harness: WITH_IMAGES, contentPolicy: STRICT });
    await host.open('ep-1');
    await description(host.view).getByTestId('images-toggle').click();
    await expect.poll(() => requests).toHaveLength(1);

    await page.evaluate(() => window.teardownView?.());

    await expect(host.view.locator('img')).toHaveCount(0);
    await expect(description(host.view).getByTestId('images-toggle')).toBeDisabled();
    await description(host.view).getByTestId('images-toggle').click({ force: true });
    await page.waitForTimeout(200);
    await expect(host.view.locator('img')).toHaveCount(0);
    expect(requests).toHaveLength(1);
  });

  test('removes the card with its consent when the sign-in label is lost, and nothing grants after', async ({ page }) => {
    const requests = await observeImages(page);
    const host = await mountPlayer(page, { entitlements: BOTH, harness: WITH_IMAGES, contentPolicy: STRICT });
    await host.open('ep-1');
    await description(host.view).getByTestId('images-toggle').click();
    await expect.poll(() => requests).toHaveLength(1);

    host.useToken(DEV_TOKENS.bob);
    await host.open('ep-2');
    await expect(status(host.view)).toHaveText(RETIRED_TEXT);
    await expect(description(host.view).getByTestId('images-toggle')).toHaveCount(0);
    await expect(host.view.locator('img')).toHaveCount(0);

    host.useToken(DEV_TOKENS.alice);
    await host.open('ep-1');
    await page.waitForTimeout(200);
    await expect(description(host.view).getByTestId('images-toggle')).toHaveCount(0);
    expect(requests).toHaveLength(1);
  });
});
