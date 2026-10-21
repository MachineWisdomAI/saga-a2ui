import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import {
  buildDemo,
  prepareDemo,
  startDownload,
  writeDownload,
  type RunningDemoProcess,
} from '../../../scripts/build-demo.js';
import { createWorkDirectory } from '../../../scripts/packed-consumer.js';

// DEMO1, the browser half: the full allowed, denied, expired and recovery workflow of the standalone
// demonstration, driven through its own host page. The process under test is the downloaded build
// (scripts/build-demo.ts): its server bundle and five pages, installed from the packed candidate
// tarballs outside the repository, started as its own Node process. Every view is the one that
// process serves, mounted by the demonstration host in a sandboxed iframe; every call a view makes
// goes through the host page's forwarding to that process over real HTTP. Audio is real Web Audio in
// Chromium (the assertion is that the audio clock advanced, not that anything was heard).
//
// Local-only: the sign-in choices are the demonstration's fixed development credentials. Nothing
// here is an OAuth flow, an actual host (ChatGPT, Claude, Alexa+) or remote-host audio.

const IMAGE_HOST = 'images.example.com';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
const DENIED =
  'Playback denied: this account does not have access to this episode.';
const UNCONFIRMED =
  'Playback could not be confirmed. Open this episode again to try playing it.';

test.describe.configure({ mode: 'serial' });

let work: string;
let download: string;
let running: RunningDemoProcess | undefined;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  work = createWorkDirectory('saga-demo-spec-');
  // Vite's build sets NODE_ENV=production in the process that runs it when none is set; the process
  // under test refuses that, and Playwright reuses this worker, so the variable is put back.
  const previous = process.env.NODE_ENV;
  try {
    const buildDirectory = path.join(work, 'build');
    fs.mkdirSync(buildDirectory);
    download = path.join(work, 'download');
    writeDownload(await buildDemo(prepareDemo(buildDirectory)), download);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test.afterAll(() => {
  if (work !== undefined) fs.rmSync(work, { recursive: true, force: true });
});

// A fresh process for each test: the demonstration's synthetic business is in memory, and a note
// archived in one case must not be missing from the next.
test.beforeEach(async () => {
  running = await startDownload(download, { SAGA_DEMO_IMAGE_HOST: IMAGE_HOST });
});
test.afterEach(async () => {
  await running?.stop();
  running = undefined;
});

const frameOf = (page: Page, slot: string): FrameLocator =>
  page.frameLocator(`iframe[title="MCP App view (${slot})"]`);
const logText = (page: Page) => page.getByTestId('host-log').innerText();
/** How many host log lines mention `text`: a view's call to a tool is one line. */
const logged = async (page: Page, text: string) =>
  (await logText(page)).split('\n').filter((line) => line.includes(text))
    .length;

interface Hosted {
  readonly page: Page;
  /** Requests the page and its frames made to the media path, with the status each was answered with. */
  readonly media: number[];
  /** Requests for the description image, which this spec answers locally. */
  readonly images: string[];
}

async function openHost(page: Page): Promise<Hosted> {
  const media: number[] = [];
  const images: string[] = [];
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname.startsWith('/playback/media/') &&
      response.request().method() === 'GET'
    )
      media.push(response.status());
  });
  await page.route(`https://${IMAGE_HOST}/**`, (route) => {
    images.push(route.request().url());
    return route.fulfill({ contentType: 'image/svg+xml', body: SVG });
  });
  // Records the audio contexts a view creates, in every frame, so the audio clock is observable.
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
  await page.goto(running?.hostUrl ?? '');
  await expect(page.getByTestId('local-only-banner')).toContainText(
    'LOCAL DEMONSTRATION ONLY',
  );
  return { page, media, images };
}

const signInAs = (page: Page, label: string) =>
  page.getByRole('radio', { name: label, exact: true }).check();
const open = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).click();
/** Presses one of the host page's demonstration controls by the words on its button. */
const control = (page: Page, name: string) =>
  page.locator(`[data-control="${name.replaceAll(' ', '-')}"]`).click();
const reuse = (page: Page, on: boolean) =>
  page.getByTestId('reuse').setChecked(on);

async function audioClocks(
  page: Page,
): Promise<{ state: string; time: number }[]> {
  const perFrame = await Promise.all(
    page.frames().map((frame) =>
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
        .catch(() => []),
    ),
  );
  return perFrame.flat();
}
const silent = async (page: Page) =>
  (await audioClocks(page)).every((context) => context.state !== 'running');

test.describe('browse and the sign-in states', () => {
  test('each user sees only their own subscriptions, and a refused credential opens nothing', async ({
    page,
  }) => {
    await openHost(page);
    await open(page, 'Browse my subscriptions');
    const view = frameOf(page, 'subscriptions');
    await expect(view.getByTestId('subscriptions-status')).toHaveText(
      'Signed in as Alice (synthetic)',
    );
    await expect(
      view.getByTestId('subscriptions-list').locator('li'),
    ).toHaveText([
      'Synthetic Creator One — Gold (active)',
      'Synthetic Creator Two — Basic (paused)',
    ]);

    await signInAs(page, 'Bob');
    await open(page, 'Browse my subscriptions');
    await expect(view.getByTestId('subscriptions-status')).toHaveText(
      'Signed in as Bob (synthetic)',
    );
    await expect(
      view.getByTestId('subscriptions-list').locator('li'),
    ).toHaveText(['Synthetic Creator Three — Silver (active)']);

    // Refused at HTTP, before any tool: nothing is mounted or delivered, and the host log says why.
    await page.getByRole('button', { name: 'Close all views' }).click();
    for (const [label, status] of [
      ['Expired credential', 401],
      ['Unknown credential', 401],
      ['Signed out', 401],
      ['Service credential', 403],
    ] as const) {
      await signInAs(page, label);
      await open(page, 'Browse my subscriptions');
      await expect(page.getByTestId('host-notice')).toContainText(
        'The server refused this credential',
      );
      await expect(page.locator('iframe')).toHaveCount(0);
      await expect(page.getByTestId('host-log')).toContainText(
        `${label}: refused with HTTP ${status}`,
      );
    }
  });

  test('a changed sign-in clears the private view and keeps it cleared until a fresh view recovers', async ({
    page,
  }) => {
    await openHost(page);
    await open(page, 'Browse my subscriptions');
    const view = frameOf(page, 'subscriptions');
    await expect(
      view.getByTestId('subscriptions-list').locator('li'),
    ).toHaveCount(2);

    // The host delivers Bob's result to the view Alice opened.
    await signInAs(page, 'Bob');
    await reuse(page, true);
    await open(page, 'Browse my subscriptions');
    await expect(view.getByTestId('subscriptions-root')).toHaveAttribute(
      'data-state',
      'problem',
    );
    await expect(
      view.getByTestId('subscriptions-list').locator('li'),
    ).toHaveCount(0);
    await expect(view.getByText(/Alice|Bob|Creator/)).toHaveCount(0);

    // Going back to Alice does not revive the cleared view.
    await signInAs(page, 'Alice');
    await open(page, 'Browse my subscriptions');
    await expect(view.getByTestId('subscriptions-root')).toHaveAttribute(
      'data-state',
      'problem',
    );

    // A fresh view pins its own sign-in and recovers.
    await reuse(page, false);
    await open(page, 'Browse my subscriptions');
    await expect(view.getByTestId('subscriptions-status')).toHaveText(
      'Signed in as Alice (synthetic)',
    );
  });
});

test.describe('descriptions at both content levels', () => {
  test('Standard reads Markdown and sends links to the host; Strict keeps everything inert until the reader chooses Show images', async ({
    page,
  }) => {
    const { images } = await openHost(page);
    const view = frameOf(page, 'episode');

    // Standard: formatting, a link that only the host opens, and an image from the one allowed host.
    await open(page, 'Show description');
    const content = view.getByTestId('card-content');
    await expect(content.locator('strong')).toHaveText('synthetic');
    await expect(content).toContainText('<b>Raw markup</b>');
    await view
      .getByRole('button', { name: 'show notes (docs.example.com)' })
      .click();
    await expect(page.getByTestId('host-log')).toContainText(
      'asked the host to open https://docs.example.com/notes',
    );
    await expect(view.getByTestId('md-image')).toHaveCount(1);
    await expect
      .poll(() => images)
      .toEqual([`https://${IMAGE_HOST}/cover.png`]);

    // Strict: the same description, but every link, image and piece of markup is a blocked fragment.
    images.length = 0;
    await page.getByRole('radio', { name: 'Strict' }).check();
    await open(page, 'Show description');
    await expect(content.getByTestId('md-link-inert')).toHaveText(
      /\[Link blocked\]/,
    );
    await expect(content.getByTestId('md-image-blocked')).toHaveText(
      '[Image blocked: cover art]',
    );
    await expect(content.getByTestId('md-markup').first()).toHaveText(
      '[Markup blocked]',
    );
    await expect(content.locator('a, img')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(images).toEqual([]);

    // The reader's choice loads the permitted image, and only then.
    await view.getByRole('button', { name: 'Show images' }).click();
    await expect(view.getByTestId('md-image')).toHaveCount(1);
    expect(images).toEqual([`https://${IMAGE_HOST}/cover.png`]);

    // A new result is a new selection, even for the same episode: consent is revoked and asked for again.
    await reuse(page, true);
    await open(page, 'Show description');
    await expect(view.getByTestId('md-image')).toHaveCount(0);
    await expect(
      view.getByRole('button', { name: 'Show images' }),
    ).toBeVisible();

    // The host closing the view retires the consent for good.
    await view.getByRole('button', { name: 'Show images' }).click();
    await expect(view.getByTestId('md-image')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close all views' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
  });
});

test.describe('protected Play', () => {
  const root = (view: FrameLocator) => view.getByTestId('play-root');
  const status = (view: FrameLocator) => view.getByTestId('play-status');
  const press = (view: FrameLocator) => view.getByTestId('play-button').click();

  test('plays for the entitled user, with the audio clock advancing and one protected read', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await expect(status(view)).toContainText(
      'Ready to play The first synthetic episode',
    );
    await press(view);
    await expect(status(view)).toContainText(
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
    expect(media).toEqual([200]);
    // The view's Play call carried the episode only; the model-visible host log never names a capability.
    expect(
      await logged(page, 'view called play_episode as Alice: HTTP 200'),
    ).toBe(1);
  });

  test('says denied for a user without access, plays nothing and never reaches the media path', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await signInAs(page, 'Bob');
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await press(view);
    await expect(status(view)).toHaveText(DENIED);
    await expect(root(view)).toHaveAttribute('data-state', 'denied');
    expect(await silent(page)).toBe(true);
    expect(media).toEqual([]);
  });

  test('an episode no account may play always ends in the same safe denial', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await page.getByTestId('episode').selectOption('ep-002');
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await press(view);
    await expect(status(view)).toHaveText(DENIED);
    expect(media).toEqual([]);
  });

  test('access revoked before Play is a denial, and restoring it recovers on the next press', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await expect(status(view)).toContainText('Ready to play');
    await control(page, 'revoke-play-access');
    await press(view);
    await expect(root(view)).toHaveAttribute('data-state', 'denied');
    expect(media).toEqual([]);

    await control(page, 'restore-play-access');
    await open(page, 'Open the player');
    await press(view);
    await expect(status(view)).toContainText(
      'Playing The first synthetic episode',
    );
    expect(media).toEqual([200]);
  });

  test('access revoked after the grant but before the bytes shows expired, keeps no media, and a new press is a brand-new Play', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await expect(status(view)).toContainText('Ready to play');
    await control(page, 'revoke play access after next grant');
    await press(view);
    await expect(root(view)).toHaveAttribute('data-state', 'expired');
    await expect(view.getByTestId('play-button')).toBeFocused();
    expect(media).toEqual([403]);
    expect(await silent(page)).toBe(true);

    // The entitlement changed, so the new Play is refused on its own fresh check; it reuses nothing.
    await press(view);
    await expect(root(view)).toHaveAttribute('data-state', 'denied');
    expect(media).toEqual([403]);
    expect(
      await logged(page, 'view called play_episode as Alice: HTTP 200'),
    ).toBe(2);

    await control(page, 'restore-play-access');
    await open(page, 'Open the player');
    await press(view);
    await expect(status(view)).toContainText(
      'Playing The first synthetic episode',
    );
    expect(media).toEqual([403, 200]);
  });

  test('an expired credential is unconfirmed, not a denial, and opening again as the entitled user recovers', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await expect(status(view)).toContainText('Ready to play');

    await signInAs(page, 'Expired credential');
    await press(view);
    await expect(root(view)).toHaveAttribute('data-state', 'unavailable');
    await expect(status(view)).toHaveText(UNCONFIRMED);
    await expect(status(view)).not.toContainText('denied');
    await expect(page.getByTestId('host-log')).toContainText(
      'refused with HTTP 401',
    );
    expect(media).toEqual([]);

    await signInAs(page, 'Alice');
    await open(page, 'Open the player');
    await expect(status(view)).toContainText('Ready to play');
    await press(view);
    await expect(status(view)).toContainText(
      'Playing The first synthetic episode',
    );
    expect(media).toEqual([200]);
  });

  test('losing the sign-in label retires the player until a fresh view: no control, no request, no audio', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await expect(status(view)).toContainText('Ready to play');

    // The host opens the player for another sign-in inside the same view.
    await signInAs(page, 'Bob');
    await reuse(page, true);
    await open(page, 'Open the player');
    await expect(root(view)).toHaveAttribute('data-state', 'session-changed');
    await expect(status(view)).toHaveText(
      'Your session changed. Open a new view or reload to continue.',
    );
    await expect(view.getByTestId('play-button')).toHaveCount(0);

    // Neither the old nor the new label brings it back.
    await signInAs(page, 'Alice');
    await open(page, 'Open the player');
    await expect(root(view)).toHaveAttribute('data-state', 'session-changed');
    expect(await logged(page, 'view called play_episode')).toBe(0);
    expect(media).toEqual([]);
    expect(await silent(page)).toBe(true);

    // A fresh view pins its own label and plays.
    await reuse(page, false);
    await open(page, 'Open the player');
    await expect(status(view)).toContainText('Ready to play');
    await press(view);
    await expect(status(view)).toContainText(
      'Playing The first synthetic episode',
    );
    expect(media).toEqual([200]);
  });

  test('closing the view stops the player and a retained control does nothing', async ({
    page,
  }) => {
    const { media } = await openHost(page);
    await open(page, 'Open the player');
    const view = frameOf(page, 'player');
    await press(view);
    await expect(status(view)).toContainText('Playing');
    await page.getByRole('button', { name: 'Close all views' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect.poll(() => silent(page)).toBe(true);
    expect(media).toEqual([200]);
  });
});

test.describe('the notes example: one reusable action, per-row state, visible failure and cleanup', () => {
  const rows = (view: FrameLocator) => view.getByTestId('line-title');
  const statusLine = (view: FrameLocator, row: number) =>
    view.getByTestId('line-status').nth(row);
  const archive = (view: FrameLocator, row: number) =>
    view.getByRole('button', { name: 'Archive' }).nth(row);

  test('shows each account’s own notes, marks one read locally and archives one with the hold handed to its owner', async ({
    page,
  }) => {
    await openHost(page);
    await open(page, 'Open my notes');
    const view = frameOf(page, 'notes');
    await expect(rows(view)).toHaveText(['Alpha', 'Beta', 'Gamma']);
    expect(await view.locator('body').innerText()).not.toContain(
      'DEMO-PRIVATE-FIELD-CANARY',
    );

    // A local action sends no request at all.
    await view.getByRole('button', { name: 'Mark read' }).first().click();
    await expect(view.getByTestId('read-log')).toHaveText('n-1');
    expect(await logged(page, 'view called')).toBe(0);

    // The server action: a session check (the prerequisite) first, then exactly one protected archive.
    await archive(view, 0).click();
    await expect(statusLine(view, 0)).toHaveText(/^Archived at \d+$/);
    await expect(view.getByTestId('holds-pending')).toHaveText('');
    await expect(view.getByTestId('holds-confirmed')).toHaveText('n-1');
    expect(await logged(page, 'view called check_session')).toBe(1);
    expect(await logged(page, 'view called archive_note')).toBe(1);
    await expect(statusLine(view, 1)).toHaveText('');

    await signInAs(page, 'Bob');
    await page.getByRole('button', { name: 'Close all views' }).click();
    await open(page, 'Open my notes');
    await expect(rows(view)).toHaveText(['Delta']);
  });

  test('refuses before any protected request when the session prerequisite refuses, and the held resource is given back', async ({
    page,
  }) => {
    await openHost(page);
    await open(page, 'Open my notes');
    const view = frameOf(page, 'notes');
    await expect(rows(view)).toHaveCount(3);
    await control(page, 'end notes session');

    await archive(view, 1).click();
    await expect(statusLine(view, 1)).toHaveText(
      'Not archived: sign-in-required',
    );
    expect(await logged(page, 'view called check_session')).toBe(1);
    expect(await logged(page, 'view called archive_note')).toBe(0); // the handler's protected request was never sent
    await expect(view.getByTestId('holds-pending')).toHaveText('');
    await expect(view.getByTestId('holds-confirmed')).toHaveText('');

    // The refusal was the prerequisite's, not an undo: the note is untouched, and signing back in recovers.
    await control(page, 'restore notes session');
    await archive(view, 1).click();
    await expect(statusLine(view, 1)).toHaveText(/^Archived at \d+$/);
    await expect(view.getByTestId('holds-confirmed')).toHaveText('n-2');
  });

  test('a credential the server refuses stops the action before its protected request', async ({
    page,
  }) => {
    await openHost(page);
    await open(page, 'Open my notes');
    const view = frameOf(page, 'notes');
    await expect(rows(view)).toHaveCount(3);
    await signInAs(page, 'Expired credential');
    await archive(view, 0).click();
    await expect(statusLine(view, 0)).toHaveText(/^Not archived: /);
    await expect(page.getByTestId('host-log')).toContainText(
      'refused with HTTP 401',
    );
    expect(await logged(page, 'view called archive_note')).toBe(0);
    await expect(view.getByTestId('holds-pending')).toHaveText('');
  });

  test('server-side denial stays authoritative: a withdrawn permission is declined, changes nothing and releases the hold', async ({
    page,
  }) => {
    await openHost(page);
    await open(page, 'Open my notes');
    const view = frameOf(page, 'notes');
    await expect(view.getByTestId('line-status')).toHaveCount(3);
    await control(page, 'revoke archive permission');

    await archive(view, 0).click();
    await expect(statusLine(view, 0)).toHaveText(
      'The server declined; nothing changed',
    );
    // The session check passed and the protected request was sent once: the server, not the view, said no.
    expect(await logged(page, 'view called check_session')).toBe(1);
    expect(await logged(page, 'view called archive_note')).toBe(1);
    await expect(view.getByTestId('holds-pending')).toHaveText('');
    await expect(view.getByTestId('holds-confirmed')).toHaveText('');

    await control(page, 'restore archive permission');
    await archive(view, 0).click();
    await expect(statusLine(view, 0)).toHaveText(/^Archived at \d+$/);
  });

  test('closing the view while the server is still working means the client stopped waiting; the effect is not undone', async ({
    page,
  }) => {
    await openHost(page);
    await open(page, 'Open my notes');
    const view = frameOf(page, 'notes');
    await expect(rows(view)).toHaveText(['Alpha', 'Beta', 'Gamma']);
    await control(page, 'hold archives');

    await archive(view, 2).click();
    await expect(view.getByTestId('holds-pending')).toHaveText('n-3');
    await expect(statusLine(view, 2)).toHaveText('');
    // A pending row ignores a second press: no second request is made.
    await archive(view, 2).click();

    await page.getByRole('button', { name: 'Close all views' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);

    // The server was never told to stop: once the backend answers, the archive is applied.
    await control(page, 'release archives');
    await open(page, 'Open my notes');
    await expect(rows(view)).toHaveText(['Alpha', 'Beta']);
    expect(await logged(page, 'view called archive_note')).toBe(1);
  });
});

test.describe('the local-only warning', () => {
  test('stays on the page with the credentials it is about, and the page offers no way to type one', async ({
    page,
  }) => {
    await openHost(page);
    await expect(page.getByTestId('local-only-banner')).toBeVisible();
    await expect(page.getByTestId('local-only-banner')).toContainText(
      'no password, no OAuth flow and no real account',
    );
    await expect(
      page.locator('input[type="password"], input[type="text"]'),
    ).toHaveCount(0);
    await page.getByRole('radio', { name: 'Bob' }).check();
    await expect(page.getByTestId('sign-in-effect')).toContainText(
      'Bob: A subscriber who may not play any episode.',
    );
  });
});
