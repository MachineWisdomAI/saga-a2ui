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
  toneWav,
  type PlaybackHarness,
  type PlaybackHarnessOptions,
} from '../src/playback/playback-fixture.js';
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
}

interface MountedHost {
  readonly view: FrameLocator;
  readonly harness: PlaybackHarness;
  /** The proxied calls the host forwarded, with the exact result the listener returned. */
  readonly calls: { params: { name: string; arguments?: unknown; _meta?: Record<string, unknown> }; result: { _meta?: Record<string, unknown> } }[];
  useToken(token: string | undefined): void;
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
    const sent = options.dropMeta ? { name: params.name, arguments: params.arguments } : params;
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: sent });
    if (response.status === 401 || response.status === 403) throw new Error(`listener refused (${response.status})`);
    const result = (response.body as { result: MountedHost['calls'][number]['result'] }).result;
    calls.push({ params, result });
    return result;
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
const audioClocks = (page: Page) =>
  page.frames().flatMap((frame) => [frame]).length >= 0
    ? Promise.all(
        page.frames().map((frame) =>
          frame
            .evaluate(() =>
              ((window as unknown as { __audioContexts?: AudioContext[] }).__audioContexts ?? []).map((context) => ({
                state: context.state,
                time: context.currentTime,
              })),
            )
            .catch(() => []),
        ),
      ).then((perFrame) => perFrame.flat())
    : Promise.resolve([]);

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
