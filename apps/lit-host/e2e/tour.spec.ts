import fs from 'node:fs';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import {
  buildTour,
  prepareTour,
  writeTour,
} from '../../../scripts/build-tour.js';
import {
  createWorkDirectory,
  repoRoot,
} from '../../../scripts/packed-consumer.js';

// TOUR1, the browser half: the static tour as a visitor uses it. The page under test is the one
// `scripts/build-tour.ts` produces from packed candidate tarballs outside the repository, served by
// a bare static file server (the tour has no backend of its own). Every notes view is the real one
// that build embeds, mounted by the tour's local stand-in host in a sandboxed frame, so the real
// action runtime and renderer run; only the server's answers are the page's local simulation.
//
// What this proves is the tour: its reading order, its scenarios in both offered renderers, its
// keyboard, narrow-screen and theme behavior, its accessibility tree, and that it touches no
// network. It does not prove any server enforces anything, and the stand-in host is not an actual
// assistant host (ChatGPT, Claude, Alexa+). The headless half, which compares the simulated server
// with the notes application's real one and checks every source link, is scripts/tour.test.ts.

const BANNER = 'Synthetic example — server checks simulated';
const RENDERERS = [
  { id: 'lit', label: 'Lit' },
  { id: 'react', label: 'React (bounded evidence)' },
] as const;

let work: string;
let download: string;
let server: Server;
let origin: string;
let manifest: {
  sourceCommit: string;
  sourceLinks: { id: string; path: string; start: number; end: number }[];
};

test.beforeAll(async () => {
  test.setTimeout(300_000);
  work = createWorkDirectory('saga-tour-spec-');
  // Vite's build sets NODE_ENV=production in the process that runs it when none is set; Playwright reuses this worker, so the variable is put back.
  const previous = process.env.NODE_ENV;
  try {
    const buildDirectory = path.join(work, 'build');
    fs.mkdirSync(buildDirectory);
    download = path.join(work, 'download');
    manifest = writeTour(
      await buildTour(prepareTour(buildDirectory)),
      download,
    ) as typeof manifest;
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  const page = fs.readFileSync(path.join(download, 'index.html'));
  server = http.createServer(
    (_req, res) =>
      void res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(page),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) =>
    server === undefined ? resolve() : void server.close(() => resolve()),
  );
  if (work !== undefined) fs.rmSync(work, { recursive: true, force: true });
});

interface Tour {
  readonly page: Page;
  readonly view: FrameLocator;
  /** Every request the page and its frames made. */
  readonly requests: string[];
}

/** Opens the tour, refusing every request that is not to the tour's own origin, and waits for its first scenario's view. */
async function openTour(
  page: Page,
  options: { renderer?: (typeof RENDERERS)[number]['id'] } = {},
): Promise<Tour> {
  const requests: string[] = [];
  page.on('request', (request) => void requests.push(request.url()));
  await page.route(
    (url) => url.origin !== new URL(origin).origin,
    (route) =>
      /^(data|about|blob):/.test(route.request().url())
        ? route.continue()
        : route.abort(),
  );
  await page.goto(origin);
  const view = page.frameLocator('iframe[title="MCP App view (notes)"]');
  await expect(view.getByTestId('view-status')).toHaveText('Your notes');
  const tour: Tour = { page, view, requests };
  if (options.renderer !== undefined && options.renderer !== 'lit')
    await chooseRenderer(tour, options.renderer);
  return tour;
}

const scenarios = (page: Page) => page.getByTestId('scenarios');
async function chooseScenario(
  { page, view }: Tour,
  title: RegExp | string,
): Promise<void> {
  await scenarios(page).getByRole('radio', { name: title }).check();
  await expect(page.getByTestId('scenario-title')).toHaveText(title);
  await expect(page.getByTestId('tour-notice')).toHaveText(
    'The scenario started and its view is open below.',
  );
  await expect(view.getByTestId('view-status')).not.toHaveText(
    'Waiting for your notes…',
  );
}
async function chooseRenderer(
  { page, view }: Tour,
  renderer: (typeof RENDERERS)[number]['id'],
): Promise<void> {
  await page
    .getByTestId('renderers')
    .getByRole('radio', {
      name: RENDERERS.find((one) => one.id === renderer)?.label,
    })
    .check();
  await expect(page.getByTestId('tour-log')).toContainText(
    `(${renderer === 'lit' ? 'Lit' : 'React'}) in a sandboxed frame`,
  );
  await expect(view.getByTestId('view-status')).toHaveText(/./);
}

const archiveButton = ({ view }: Tour, row: number) =>
  view.getByRole('button', { name: 'Archive', exact: true }).nth(row);
const statusLine = ({ view }: Tour, row: number) =>
  view.getByTestId('line-status').nth(row);
const titles = ({ view }: Tour) => view.getByTestId('line-title');
const backendState = ({ page }: Tour, name: string) =>
  page
    .getByTestId('server-state')
    .locator('dt', { hasText: new RegExp(`^${name}$`) })
    .locator('xpath=following-sibling::dd[1]');
const control = ({ page }: Tour, name: string) =>
  page.getByTestId('controls').getByRole('button', { name, exact: true });

test.describe('reading order, limits and links', () => {
  test('puts “Synthetic example — server checks simulated” first, before anything a visitor can read or press', async ({
    page,
  }) => {
    await openTour(page);
    const first = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) =>
            node.textContent?.trim()
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT,
        },
      );
      const text = walker.nextNode()?.textContent?.trim();
      const interactive = document.querySelector(
        'a, button, input, select, iframe',
      );
      const banner = document.querySelector('[data-testid="synthetic-banner"]');
      return {
        text,
        bannerBeforeInteractive:
          banner !== null &&
          interactive !== null &&
          Boolean(
            banner.compareDocumentPosition(interactive) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        top: banner?.getBoundingClientRect().top,
      };
    });
    expect(first).toEqual({
      text: BANNER,
      bannerBeforeInteractive: true,
      top: 0,
    });
    // The accessibility tree reads it first as well, as a note a screen reader meets before the heading.
    const tree = await page.locator('body').ariaSnapshot();
    expect(tree.split('\n')[0]).toContain(BANNER);
  });

  test('says what is real and what is simulated, and keeps each simulation limit beside the interaction it limits', async ({
    page,
  }) => {
    await openTour(page);
    const boundary = page.getByTestId('simulation-boundary');
    await expect(boundary).toContainText('Real here: the notes view');
    await expect(boundary).toContainText(
      'Simulated here: who is asking, the session check, the server’s decision and its backend',
    );
    const detail = page.getByTestId('scenario-detail');
    for (const sentence of [
      'A simulated session check does not authenticate anyone.',
      'A simulated denial does not prove that any server enforces anything.',
      'Local cancellation does not prove that a remote effect was undone.',
    ]) {
      await expect(detail.getByText(sentence)).toBeVisible();
    }
    await expect(page.getByTestId('scenario-limit')).toContainText(
      'Simulation limit:',
    );
    await expect(page.getByTestId('tour-limits')).toContainText(
      'No protected media, no Patreon access and no playback',
    );
  });

  test('offers only the renderer previews that work, explains React’s bounded evidence, and promises no Lynx', async ({
    page,
  }) => {
    await openTour(page);
    const labels = await page
      .getByTestId('renderers')
      .getByRole('radio')
      .evaluateAll((inputs) =>
        inputs.map((input) =>
          (input as HTMLInputElement).labels?.[0]?.textContent?.trim(),
        ),
      );
    expect(labels).toEqual(RENDERERS.map((one) => one.label));
    await chooseRenderer(
      {
        page,
        view: page.frameLocator('iframe[title="MCP App view (notes)"]'),
        requests: [],
      },
      'react',
    );
    await expect(page.getByTestId('renderer-evidence')).toContainText(
      'not renderer parity with Lit',
    );
    await expect(page.getByTestId('renderer-evidence')).toContainText(
      'not the React starter',
    );
    expect(await page.locator('body').innerText()).not.toMatch(/lynx/i);
  });

  test('links every scenario to the matching source at the built commit, and to the setup and action guides', async ({
    page,
  }) => {
    await openTour(page);
    const repository = 'https://github.com/MachineWisdomAI/saga-a2ui/blob/';
    const allowed = await page
      .getByTestId('scenario-links')
      .getByRole('link')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
      );
    expect(allowed.length).toBeGreaterThanOrEqual(6);
    for (const href of allowed)
      expect(
        href.startsWith(`${repository}${manifest.sourceCommit}/`),
        href,
      ).toBe(true);
    expect(
      allowed.some((href) =>
        href.includes(
          '/docs/getting-started.md#component-definition-template-and-instance',
        ),
      ),
    ).toBe(true);
    expect(
      allowed.some((href) =>
        href.includes('/docs/actions.md#trace-one-press-allowed-and-denied'),
      ),
    ).toBe(true);
    expect(
      allowed.some((href) =>
        /examples\/pack1-consumer\/src\/notes-actions\.ts#L\d+-L\d+$/.test(
          href,
        ),
      ),
    ).toBe(true);

    // Every link of the page opens a new tab without handing it this page, and names a real file of this commit.
    const links = await page
      .locator('main a[href^="http"]')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: (anchor as HTMLAnchorElement).href,
          rel: anchor.getAttribute('rel'),
          target: anchor.getAttribute('target'),
        })),
      );
    for (const { href, rel, target } of links) {
      expect(rel, href).toContain('noopener');
      expect(target, href).toBe('_blank');
      const file = href
        .slice(`${repository}${manifest.sourceCommit}/`.length)
        .replace(/#.*$/, '');
      expect(fs.existsSync(path.join(repoRoot, file)), file).toBe(true);
    }

    // The Archive definition, its asynchronous prerequisite, its direct attachment and its cleanup are each linked from the page.
    for (const id of [
      'definition',
      'prerequisite',
      'attachment-lit',
      'attachment-react',
      'ownership',
      'cleanup-success',
      'cleanup-canceled',
      'holds',
    ]) {
      await expect(page.locator(`#source-${id} a`)).toHaveCount(1);
    }
    await expect(page.getByTestId('source-identity')).toContainText(
      'unpublished',
    );
  });

  test('touches no network: nothing but the page itself is requested, and no credential is anywhere in it', async ({
    page,
  }) => {
    const { requests } = await openTour(page);
    await archiveButton(
      {
        page,
        view: page.frameLocator('iframe[title="MCP App view (notes)"]'),
        requests,
      },
      0,
    ).click();
    await expect(page.getByTestId('tour-log')).toContainText(
      'view called archive_note',
    );
    const outside = requests.filter(
      (url) => !url.startsWith(origin) && !/^(data|about|blob):/.test(url),
    );
    expect(outside).toEqual([]);
    const html = fs.readFileSync(path.join(download, 'index.html'), 'utf8');
    expect(html).not.toMatch(
      /dev-only-token|not-a-demo-credential|acct-synthetic/,
    ); // the demonstration's development credentials and accounts are not part of this page
  });
});

for (const renderer of RENDERERS) {
  test.describe(`scenarios in the ${renderer.label} preview`, () => {
    test('allowed: Alice archives her own note, and the application takes over the hold', async ({
      page,
    }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await expect(titles(tour)).toHaveText(['Alpha', 'Beta', 'Gamma']); // only her notes: Bob’s Delta is absent
      await archiveButton(tour, 0).click();
      await expect(statusLine(tour, 0)).toHaveText('Archived at 1001');
      await expect(backendState(tour, 'Backend calls')).toHaveText(
        '1 session check(s) · 1 archive request(s)',
      );
      await expect(backendState(tour, 'Archived notes')).toHaveText('n-1');
      await expect(tour.view.getByTestId('holds-confirmed')).toHaveText('n-1');
      await expect(tour.view.getByTestId('holds-pending')).toHaveText('');
    });

    test('refused before anything is sent: the session check says signed out, and no archive request exists', async ({
      page,
    }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Refused before anything is sent/);
      await archiveButton(tour, 0).click();
      await expect(statusLine(tour, 0)).toHaveText(
        'Not archived: sign-in-required',
      );
      await expect(backendState(tour, 'Backend calls')).toHaveText(
        '1 session check(s) · 0 archive request(s)',
      );
      await expect(backendState(tour, 'Archived notes')).toHaveText('none');
      await expect(tour.view.getByTestId('holds-pending')).toHaveText(''); // the hold was given back
      await expect(tour.view.getByTestId('holds-confirmed')).toHaveText('');
    });

    test('denied by the simulated server after a valid session check, which declared that nothing changed', async ({
      page,
    }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Denied by the server/);
      await archiveButton(tour, 0).click();
      await expect(statusLine(tour, 0)).toHaveText(
        'The server declined; nothing changed',
      );
      await expect(backendState(tour, 'Backend calls')).toHaveText(
        '1 session check(s) · 1 archive request(s)',
      );
      await expect(backendState(tour, 'Archived notes')).toHaveText('none');
      await expect(page.getByTestId('tour-log')).toContainText(
        'declared: nothing changed',
      );
      await expect(page.getByTestId('scenario-limit')).toContainText(
        'does not prove that any real server enforces permission',
      );
    });

    test('Bob sees and archives only his own note', async ({ page }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Browse as Bob/);
      await expect(titles(tour)).toHaveText(['Delta']);
      expect(await tour.view.locator('body').innerText()).not.toMatch(
        /Alpha|Beta|Gamma|DEMO-PRIVATE-FIELD-CANARY/,
      );
      await archiveButton(tour, 0).click();
      await expect(statusLine(tour, 0)).toHaveText('Archived at 1001');
    });

    test('a request that names nobody is refused before any backend is asked; choosing Alice and reopening lists her notes', async ({
      page,
    }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Refused: the request names nobody/);
      await expect(tour.view.getByTestId('view-status')).toHaveText(
        'Your notes could not be shown.',
      );
      await expect(titles(tour)).toHaveCount(0);
      await expect(backendState(tour, 'Backend calls')).toHaveText(
        '0 session check(s) · 0 archive request(s)',
      );
      await page
        .getByTestId('people')
        .getByRole('radio', { name: 'Alice (simulated)' })
        .check();
      await page.getByTestId('open-view').click();
      await expect(titles(tour)).toHaveText(['Alpha', 'Beta', 'Gamma']);
    });

    test('unknown outcome: the backend applied the archive and then failed, so the view says unknown and nothing retries', async ({
      page,
    }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Unknown outcome/);
      await archiveButton(tour, 0).click();
      await expect(statusLine(tour, 0)).toHaveText('Archive status unknown');
      await expect(backendState(tour, 'Archived notes')).toHaveText('n-1'); // it was applied, which the view could not know
      await page.waitForTimeout(300);
      await expect(backendState(tour, 'Backend calls')).toHaveText(
        '1 session check(s) · 1 archive request(s)',
      );
      await expect(tour.view.getByTestId('holds-confirmed')).toHaveText(''); // not confirmed, so never handed over
    });

    test('two rows, one definition: each attachment keeps its own state, request and result', async ({
      page,
    }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Two rows, one definition/);
      await archiveButton(tour, 0).click();
      await archiveButton(tour, 1).click();
      await expect(backendState(tour, 'Archives at the backend')).toHaveText(
        'held (2 waiting)',
      );
      await expect(tour.view.getByTestId('holds-pending')).toHaveText(
        'n-1,n-2',
      );
      await expect(statusLine(tour, 0)).toHaveText('');
      await expect(statusLine(tour, 1)).toHaveText('');
      await control(tour, 'Release held archives').click();
      await expect(statusLine(tour, 0)).toHaveText(/^Archived at \d+$/);
      await expect(statusLine(tour, 1)).toHaveText(/^Archived at \d+$/);
      await expect(tour.view.getByTestId('holds-pending')).toHaveText('');
      await expect(tour.view.getByTestId('holds-confirmed')).toHaveText(
        'n-1,n-2',
      );
      await expect(backendState(tour, 'Backend calls')).toHaveText(
        '2 session check(s) · 2 archive request(s)',
      );
    });

    test('obsolete completion: the row shows another note when the answer arrives, so nothing is written on it and the hold is given back', async ({
      page,
    }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Obsolete completion/);
      await archiveButton(tour, 0).click();
      await expect(tour.view.getByTestId('holds-pending')).toHaveText('n-1');
      await control(tour, 'List the notes in the opposite order').click();
      await page.getByTestId('refresh-view').click();
      await expect(titles(tour)).toHaveText(['Gamma', 'Beta', 'Alpha']);
      await control(tour, 'Release held archives').click();
      await expect(backendState(tour, 'Archived notes')).toHaveText('n-1'); // the server applied it: cancellation stopped nothing
      await expect(tour.view.getByTestId('holds-pending')).toHaveText('');
      await expect(tour.view.getByTestId('holds-confirmed')).toHaveText(''); // handed over for good only after a confirmation the press was still waiting for
      for (const row of [0, 1, 2])
        await expect(statusLine(tour, row)).toHaveText('');
    });

    test('closing the view is not undoing the archive', async ({ page }) => {
      const tour = await openTour(page, { renderer: renderer.id });
      await chooseScenario(tour, /^Closing the view is not undoing/);
      await archiveButton(tour, 0).click();
      await expect(tour.view.getByTestId('holds-pending')).toHaveText('n-1');
      await page.getByTestId('close-view').click();
      await expect(page.locator('iframe')).toHaveCount(0);
      await control(tour, 'Release held archives').click();
      await expect(backendState(tour, 'Archived notes')).toHaveText('n-1');
      await page.getByTestId('open-view').click();
      await expect(titles(tour)).toHaveText(['Beta', 'Gamma']);
    });
  });
}

test.describe('keyboard, narrow screen, theme and accessibility', () => {
  test('Tab reaches every control of the page once each, in reading order, each with a visible focus indicator, and never traps the keyboard', async ({
    page,
  }) => {
    await openTour(page);
    // A radio group is one tab stop; every other link, button, scrollable quote and the frame has its own.
    const expected = await page.evaluate(() => {
      const groups = new Set(
        [
          ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
        ].map((radio) => radio.name),
      );
      return (
        groups.size +
        document.querySelectorAll('a[href], button, pre[tabindex], iframe')
          .length
      );
    });
    const visited: string[] = [];
    let wrapped = false;
    for (let step = 0; step < expected + 60; step += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active === null || active === document.body) return null;
        if (active.tagName === 'IFRAME')
          return {
            key: 'the notes view (its own controls are the application’s)',
            outlined: true,
          };
        const style = getComputedStyle(active);
        const key = `${active.tagName}:${active.getAttribute('data-testid') ?? active.getAttribute('data-control') ?? active.getAttribute('value') ?? active.textContent?.slice(0, 40) ?? ''}:${active.getAttribute('href') ?? ''}`;
        return {
          key,
          outlined:
            style.outlineStyle !== 'none' &&
            parseFloat(style.outlineWidth) >= 2,
        };
      });
      if (stop === null) {
        wrapped = true; // past the last control the focus leaves the page and comes back around
        break;
      }
      expect(stop.outlined, `${stop.key} shows where the focus is`).toBe(true);
      if (visited.at(-1) !== stop.key) visited.push(stop.key);
    }
    expect(wrapped).toBe(true);
    expect(visited.length).toBe(expected); // the frame's own controls count as the one stop of the frame
    expect(visited[0]).toMatch(/^INPUT:system/); // the first stop is the first control after the banner, not something buried below it
  });

  test('every control is operable from the keyboard: radios with the arrow keys, buttons with Enter and Space, a rendered row’s Archive too', async ({
    page,
  }) => {
    const tour = await openTour(page);
    await scenarios(page).getByRole('radio').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('scenario-title')).toHaveText(
      /^Refused before anything is sent/,
    );
    await expect(page.getByTestId('tour-notice')).toHaveText(
      'The scenario started and its view is open below.',
    );
    // A press on a rendered row is a keyboard press too: the real ActionButton inside the sandboxed frame.
    await archiveButton(tour, 0).focus();
    await page.keyboard.press('Enter');
    await expect(statusLine(tour, 0)).toHaveText(
      'Not archived: sign-in-required',
    );
    await control(tour, 'Restore Alice’s session').focus();
    await page.keyboard.press('Space');
    await expect(backendState(tour, 'Alice’s session')).toHaveText('signed-in');
    await archiveButton(tour, 1).focus();
    await page.keyboard.press('Space');
    await expect(statusLine(tour, 1)).toHaveText(/^Archived at \d+$/);
  });

  test('stays usable on a 320 px wide screen: nothing scrolls sideways and every control can be pressed', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const tour = await openTour(page);
    const overflow = await page.evaluate(() => ({
      page:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);
    const frame = await page.locator('iframe').boundingBox();
    expect(frame && frame.x >= 0 && frame.x + frame.width <= 320).toBe(true);
    const tooSmall = await page
      .locator('main button')
      .evaluateAll(
        (buttons) =>
          buttons.filter(
            (button) =>
              button.getBoundingClientRect().height < 24 ||
              button.getBoundingClientRect().width < 24,
          ).length,
      );
    expect(tooSmall).toBe(0);
    await archiveButton(tour, 0).click();
    await expect(statusLine(tour, 0)).toHaveText('Archived at 1001');
    // The quoted source scrolls inside its own box instead of widening the page.
    const afterOpen = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(afterOpen).toBeLessThanOrEqual(0);
  });

  for (const theme of [
    {
      name: 'the system’s light preference',
      scheme: 'light',
      choose: undefined,
    },
    { name: 'the system’s dark preference', scheme: 'dark', choose: undefined },
    {
      name: 'a chosen dark theme over a light system',
      scheme: 'light',
      choose: 'Dark',
    },
    {
      name: 'a chosen light theme over a dark system',
      scheme: 'dark',
      choose: 'Light',
    },
  ] as const) {
    test(`text stays readable under ${theme.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.scheme });
      await openTour(page);
      if (theme.choose !== undefined)
        await page
          .getByTestId('theme')
          .getByRole('radio', { name: theme.choose })
          .check();
      const dark =
        theme.choose === undefined
          ? theme.scheme === 'dark'
          : theme.choose === 'Dark';
      expect(
        await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        ),
      ).toBe(dark ? 'rgb(18, 18, 20)' : 'rgb(255, 255, 255)');

      // WCAG 2.x contrast of every visible text node against the first opaque background behind it.
      const failures = await page.evaluate(() => {
        const parse = (value: string): [number, number, number, number] => {
          const match = /rgba?\(([^)]+)\)/.exec(value);
          const parts = (match?.[1] ?? '0,0,0,0')
            .split(/[,/ ]+/)
            .filter(Boolean)
            .map(Number);
          return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
        };
        const luminance = ([r, g, b]: number[]): number => {
          const channel = (c: number): number =>
            (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          return (
            0.2126 * channel(r as number) +
            0.7152 * channel(g as number) +
            0.0722 * channel(b as number)
          );
        };
        const backgroundOf = (
          element: Element | null,
        ): [number, number, number] => {
          for (
            let current = element;
            current !== null;
            current = current.parentElement
          ) {
            const [r, g, b, a] = parse(
              getComputedStyle(current).backgroundColor,
            );
            if (a > 0.99) return [r, g, b];
          }
          return [255, 255, 255];
        };
        const found: string[] = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        for (
          let node = walker.nextNode();
          node !== null;
          node = walker.nextNode()
        ) {
          const parent = node.parentElement;
          if (
            parent === null ||
            !node.textContent?.trim() ||
            parent.closest('[hidden], script, style, iframe')
          )
            continue;
          const style = getComputedStyle(parent);
          if (style.visibility === 'hidden' || style.display === 'none')
            continue;
          const [r, g, b] = parse(style.color);
          const [br, bg, bb] = backgroundOf(parent);
          const [light, darker] = [
            Math.max(luminance([r, g, b]), luminance([br, bg, bb])),
            Math.min(luminance([r, g, b]), luminance([br, bg, bb])),
          ];
          const ratio = (light + 0.05) / (darker + 0.05);
          const large =
            parseFloat(style.fontSize) >= 24 ||
            (parseFloat(style.fontSize) >= 18.66 &&
              Number(style.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5))
            found.push(
              `${ratio.toFixed(2)} ${node.textContent.trim().slice(0, 50)}`,
            );
        }
        return found;
      });
      expect(failures).toEqual([]);
    });
  }

  test('has an accessible name for every control, ordered headings, live regions for what changes, and a titled frame', async ({
    page,
  }) => {
    await openTour(page);
    const session = await page.context().newCDPSession(page);
    const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
      nodes: {
        role?: { value: string };
        name?: { value: string };
        ignored?: boolean;
      }[];
    };
    const named = [
      'button',
      'radio',
      'link',
      'Iframe',
      'heading',
      'textbox',
      'combobox',
    ];
    const unnamed = nodes.filter(
      (node) =>
        !node.ignored &&
        named.includes(node.role?.value ?? '') &&
        (node.name?.value ?? '').trim() === '',
    );
    expect(unnamed).toEqual([]);

    const structure = await page.evaluate(() => {
      const levels = [...document.querySelectorAll('h1, h2, h3')].map(
        (heading) => Number(heading.tagName.slice(1)),
      );
      const skipped = levels.some(
        (level, index) =>
          index > 0 && level - (levels[index - 1] as number) > 1,
      );
      const ids = [...document.querySelectorAll('[id]')].map(
        (element) => element.id,
      );
      return {
        lang: document.documentElement.lang,
        h1: levels.filter((level) => level === 1).length,
        skipped,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        main: document.querySelectorAll('main').length,
        status: document
          .querySelector('[data-testid="tour-notice"]')
          ?.getAttribute('role'),
        log: document
          .querySelector('[data-testid="tour-log"]')
          ?.getAttribute('role'),
        frameTitle: document.querySelector('iframe')?.title,
        groups: [...document.querySelectorAll('fieldset')].every(
          (fieldset) => fieldset.querySelector(':scope > legend') !== null,
        ),
      };
    });
    expect(structure).toEqual({
      lang: 'en',
      h1: 1,
      skipped: false,
      duplicateIds: [],
      main: 1,
      status: 'status',
      log: 'log',
      frameTitle: 'MCP App view (notes)',
      groups: true,
    });
    await expect(page.locator('iframe')).toHaveAttribute(
      'sandbox',
      'allow-scripts',
    );
  });

  test('keeps the view’s status line a live region, so a refusal or an outcome is announced', async ({
    page,
  }) => {
    const tour = await openTour(page);
    await expect(tour.view.getByTestId('view-status')).toHaveAttribute(
      'role',
      'status',
    );
    await expect(tour.view.getByTestId('line-status').first()).toHaveAttribute(
      'role',
      'status',
    );
  });
});
