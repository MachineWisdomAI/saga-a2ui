import fs from 'node:fs';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import {
  buildInstalledHost,
  startInstalledListener,
  type BuiltInstalledHost,
  type RunningInstalledListener,
} from '../../../scripts/build-installed-lit-host.js';
import { createWorkDirectory } from '../../../scripts/packed-consumer.js';
import { DEV_TOKENS } from '../src/mcp/dev-auth.js';
import { rpcOverHttp } from '../src/playback/playback-fixture.js';
import type { HostedResource } from './host-fixture/host.js';

// PACK1 (#154), the browser half of the joined path: the player view that the application's own
// listener serves, running as its own Node process outside the repository from the packed SDK
// packages (scripts/build-installed-lit-host.ts), mounted in the sandboxed iframe of the local host
// fixture. Every proxied `tools/call`, with its `_meta`, goes over real HTTP to that process, and the
// built player fetches the protected bytes from it with a fresh proof. Audio is real Web Audio in
// Chromium; the assertion is that the audio clock advanced, not that anything was heard.
//
// The synthetic backend is the application's, with the development-only verifier's fixed tokens: a
// header token, not an OAuth flow, and no DCR. The local host fixture is not an actual chat host. The
// exhaustive controller cases (pending, gesture, expiry, replay, 320px reflow) stay with
// playback-view.spec.ts against the in-process listener and are not repeated here.

const EPISODE = 'ep-001';
const OPENER = 'get_playable_episode';
const PLAY = 'play_episode';
const DENIED =
  'Playback denied: this account does not have access to this episode.';
const UNCONFIRMED =
  'Playback could not be confirmed. Open this episode again to try playing it.';
const MEDIA_PATH = `/playback/media/${EPISODE}`;

test.describe.configure({ mode: 'serial' });

let work: string;
let built: BuiltInstalledHost;
let listener: RunningInstalledListener;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  work = createWorkDirectory('saga-installed-listener-spec-');
  // Vite's build sets NODE_ENV=production in the process that runs it when none is set. Playwright
  // reuses this worker for the next spec files, and the development-only verifier they construct
  // refuses to exist in a production environment, so the variable is put back.
  const previous = process.env.NODE_ENV;
  try {
    built = await buildInstalledHost(work);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  listener = await startInstalledListener(built);
});

test.afterAll(async () => {
  await listener?.stop();
  if (work !== undefined) fs.rmSync(work, { recursive: true, force: true });
});

interface MountedHost {
  readonly view: FrameLocator;
  readonly calls: {
    params: {
      name: string;
      arguments?: unknown;
      _meta?: Record<string, unknown>;
    };
    result: { isError?: boolean; _meta?: Record<string, unknown> };
  }[];
  /** Requests the page and its frames made to the listener's media path, with the status each was answered with. */
  readonly mediaResponses: number[];
  /** Every origin the page and its frames contacted. */
  readonly origins: Set<string>;
  useToken(token: string | undefined): void;
  open(episodeId: string): Promise<void>;
}

async function mountPlayer(
  page: Page,
  options: { token?: string; dropMeta?: boolean } = {},
): Promise<MountedHost> {
  let token: string | undefined = options.token ?? DEV_TOKENS.alice;
  const calls: MountedHost['calls'] = [];
  const mediaResponses: number[] = [];
  const origins = new Set<string>();

  page.on('request', (request) => {
    if (/^https?:/.test(request.url()))
      origins.add(new URL(request.url()).origin);
  });
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === MEDIA_PATH &&
      response.request().method() === 'GET'
    )
      mediaResponses.push(response.status());
  });
  // Records the audio contexts the view creates, in every frame, so the audio clock is observable.
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const created: AudioContext[] = [];
    (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts =
      created;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args);
        created.push(this);
      }
    };
  });

  const post = (body: unknown) =>
    rpcOverHttp(listener.playbackUrl, token, body);
  await page.exposeFunction(
    'handleToolCall',
    async (params: MountedHost['calls'][number]['params']) => {
      const sent = options.dropMeta
        ? { name: params.name, arguments: params.arguments }
        : params;
      const response = await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: sent,
      });
      if (response.status === 401 || response.status === 403)
        throw new Error(`listener refused (${response.status})`);
      const result = (
        response.body as { result: MountedHost['calls'][number]['result'] }
      ).result;
      calls.push({ params, result });
      return result;
    },
  );

  // The resource the host mounts is what the listener serves, read over the wire as the host reads it.
  const resource = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/read',
    params: { uri: 'ui://saga-a2ui/playback-view.html' },
  });
  const content = (
    resource.body as {
      result: {
        contents: {
          text: string;
          _meta: { ui: { csp: HostedResource['csp'] } };
        }[];
      };
    }
  ).result.contents[0];
  if (!content) throw new Error('resources/read returned no contents');
  expect(content._meta.ui.csp.connectDomains).toEqual([listener.origin]);
  await page.goto('/host-fixture/index.html');
  await page.evaluate((hosted) => window.mountView?.(hosted), {
    html: content.text,
    csp: content._meta.ui.csp,
  });

  return {
    view: page.frameLocator('iframe[title="MCP App view"]'),
    calls,
    mediaResponses,
    origins,
    useToken: (next) => void (token = next),
    // The host mounts the view by running the model-visible opener and delivering its real result.
    async open(episodeId) {
      const opened = await post({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: OPENER, arguments: { episodeId } },
      });
      await page.evaluate(
        (result) => window.deliverToolResult?.(result),
        (opened.body as { result: never }).result,
      );
    },
  };
}

const status = (view: FrameLocator) => view.getByTestId('play-status');
const button = (view: FrameLocator) => view.getByTestId('play-button');

/** The audio clock of every context the view created: proof that sound is (or is not) being produced. */
async function audioClocks(
  page: Page,
): Promise<{ state: string; time: number }[]> {
  const perFrame = await Promise.all(
    page.frames().map(
      (frame) =>
        frame
          .evaluate(() =>
            (
              (window as unknown as { __audioContexts?: AudioContext[] })
                .__audioContexts ?? []
            ).map((context) => ({
              state: context.state,
              time: context.currentTime,
            })),
          )
          .catch(() => []), // a frame that is mid-navigation has no contexts to report
    ),
  );
  return perFrame.flat();
}

const silent = async (page: Page) =>
  (await audioClocks(page)).every((context) => context.state !== 'running');

test.describe('the player served by the installed listener, run outside the repository', () => {
  test('plays for the entitled user: a direct protected Play, then the bytes with a fresh proof, and the audio clock advances', async ({
    page,
    baseURL,
  }) => {
    const host = await mountPlayer(page);
    await host.open(EPISODE);
    await expect(status(host.view)).toContainText(
      'Ready to play The first synthetic episode',
    );
    await expect(host.view.getByTestId('play-root')).toHaveAttribute(
      'data-state',
      'ready',
    );

    await button(host.view).click();

    await expect(status(host.view)).toContainText(
      'Playing The first synthetic episode',
    );
    const [first] = await audioClocks(page);
    expect(first?.state).toBe('running');
    await expect
      .poll(
        async () =>
          ((await audioClocks(page))[0]?.time ?? 0) > (first?.time ?? 0),
      )
      .toBe(true);

    // The view made one Play call whose arguments were only the episode, with the recipient key as call metadata.
    const plays = host.calls.filter((call) => call.params.name === PLAY);
    expect(plays).toHaveLength(1);
    expect(plays[0]?.params.arguments).toEqual({ episodeId: EPISODE });
    expect(Object.keys(plays[0]?.params._meta ?? {})).toContain(
      'saga-a2ui/recipient-key',
    );
    // The private grant reached the view through `_meta`; the model-visible text carries no capability.
    const grant = plays[0]?.result._meta?.['saga-a2ui/playback'] as
      { capability: string } | undefined;
    expect(grant?.capability).toBeTruthy();
    expect(
      JSON.stringify((plays[0]?.result as { content?: unknown }).content),
    ).not.toContain(grant?.capability ?? '');
    // The protected bytes came from the listener process, once, after the grant.
    expect(host.mediaResponses).toEqual([200]);
    // Nothing else left the page: its own server (the host fixture) and the listener are the only origins.
    expect([...host.origins].sort()).toEqual(
      [new URL(baseURL ?? '').origin, listener.origin].sort(),
    );
  });

  test('says denied for a user without access, plays nothing and never reaches the media path', async ({
    page,
  }) => {
    const host = await mountPlayer(page, { token: DEV_TOKENS.bob });
    await host.open(EPISODE);

    await button(host.view).click();

    await expect(status(host.view)).toHaveText(DENIED);
    await expect(host.view.getByTestId('play-root')).toHaveAttribute(
      'data-state',
      'denied',
    );
    expect(await silent(page)).toBe(true);
    expect(
      host.calls.filter((call) => call.params.name === PLAY)[0]?.result._meta?.[
        'saga-a2ui/playback'
      ],
    ).toBeUndefined();
    expect(host.mediaResponses).toEqual([]);
  });

  test('changed authority: a credential the listener refuses is unconfirmed (not a denial), and opening again as the entitled user recovers', async ({
    page,
  }) => {
    const host = await mountPlayer(page);
    await host.open(EPISODE);
    host.useToken(DEV_TOKENS.expired);

    await button(host.view).click();

    await expect(host.view.getByTestId('play-root')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    await expect(status(host.view)).toHaveText(UNCONFIRMED);
    await expect(status(host.view)).not.toContainText('denied');
    expect(host.mediaResponses).toEqual([]);

    host.useToken(DEV_TOKENS.alice);
    await host.open(EPISODE);
    await expect(status(host.view)).toContainText('Ready to play');
    await button(host.view).click();
    await expect(status(host.view)).toContainText(
      'Playing The first synthetic episode',
    );
    expect(host.mediaResponses).toEqual([200]);
  });

  test('a host that drops the call metadata gets an unsupported view: no capability is issued and no media is requested', async ({
    page,
  }) => {
    const host = await mountPlayer(page, { dropMeta: true });
    await host.open(EPISODE);

    await button(host.view).click();

    await expect(status(host.view)).toHaveText(
      'Playback is not supported here.',
    );
    await expect(host.view.getByTestId('play-root')).toHaveAttribute(
      'data-state',
      'unsupported',
    );
    expect(host.mediaResponses).toEqual([]);
    expect(await silent(page)).toBe(true);
  });
});
