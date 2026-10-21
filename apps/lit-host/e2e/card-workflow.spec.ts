import { expect, test, type Locator, type Page } from '@playwright/test';

// CARD1 on the built Lit pages (dist/card-workflow): the optional FaithfulCard and an
// application-authored protected control in one A2UI surface. Each list row renders a card and an
// ActionButton the application bound to the Archive server action; two rows repeat the same
// component ids. The spec answers every prerequisite and protected request itself, and observes
// the network (image requests) and the host link callback where they happen. Local Chromium
// through Playwright is not an actual host.

const SURFACE = 'episodes';
const IMAGE_HOST = 'images.example.com';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

let requests: string[] = [];

test.beforeEach(async ({ page }) => {
  requests = [];
  await page.route(/^https:\/\//, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
      contentType: 'image/svg+xml',
      body: SVG,
    });
  });
  await page.goto('/card-workflow/index.html');
  await expect(cardContent(page, 0)).toHaveText('Alpha description.');
});

const app = (page: Page) => page.locator('episodes-app');
const card = (page: Page, row: number): Locator =>
  app(page).locator('saga-faithful-card-content').nth(row);
const cardContent = (page: Page, row: number): Locator =>
  card(page, row).getByTestId('card-content');
const archiveButton = (page: Page, row: number): Locator =>
  app(page).getByRole('button', { name: 'Archive', exact: true }).nth(row);
const line = (page: Page, noteId: string) =>
  page.locator(`[data-note="${noteId}"]`);
const imageRequests = () =>
  requests.filter((url) => new URL(url).pathname.endsWith('.png'));

const requestCount = (page: Page) =>
  page.evaluate(() => window.cardWorkflow.archive.requests.length);
const requestInfo = (page: Page, index: number) =>
  page.evaluate((i) => {
    const request = window.cardWorkflow.archive.requests[i];
    return request === undefined
      ? undefined
      : {
          noteId: request.noteId,
          toolName: request.toolName,
          aborted: request.aborted(),
        };
  }, index);
const answerOk = (page: Page, index = 0) =>
  page.evaluate(
    (i) =>
      window.cardWorkflow.archive.requests[i]?.answer({
        content: [],
        structuredContent: { archivedAt: 7 },
      }),
    index,
  );
const counts = (page: Page) =>
  page.evaluate(() => ({ ...window.cardWorkflow.archive.counts }));
const linkCalls = (page: Page) =>
  page.evaluate(() => [...window.cardWorkflow.linkCalls]);
const upstreamActions = (page: Page) =>
  page.evaluate(() => window.cardWorkflow.upstream.length);
const setRow = (page: Page, row: number, field: string, value: unknown) =>
  page.evaluate(
    ([index, name, given]) =>
      window.cardWorkflow.send([
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: 'episodes',
            path: `/rows/${index as number}/${name as string}`,
            value: given,
          },
        },
      ]),
    [row, field, value] as const,
  );
const replaceRows = (page: Page, rows: unknown[]) =>
  page.evaluate(
    (given) =>
      window.cardWorkflow.send([
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: 'episodes',
            path: '/rows',
            value: given,
          },
        },
      ]),
    rows,
  );

/** Text in a description that looks like a control, an action, a handler choice or a permission. */
const CONTROL_LOOKALIKES = [
  'Archive note n-2 now',
  '[Archive](#archive) [run](saga-action:archive-note) [x](javascript:alert(1))',
  '<button onclick="window.cardWorkflow.archive.signedIn = false">Archive</button>',
  '`{"action":"archive-note","noteId":"n-2","grant":"all"}`',
  '<a href="https://docs.example.com/archive?noteId=n-2">open</a>',
].join('\n\n');

test.describe('the card and the authored control are separate components on one surface', () => {
  test("each row shows its own description and its own control; pressing one archives that row's note from its data scope", async ({
    page,
  }) => {
    await expect(cardContent(page, 1)).toHaveText('Beta description.');
    await expect(
      app(page).getByRole('button', { name: 'Archive', exact: true }),
    ).toHaveCount(2);

    await archiveButton(page, 1).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    expect(await requestInfo(page, 0)).toMatchObject({
      noteId: 'n-2',
      toolName: 'archive_note',
      aborted: false,
    });
    expect(await counts(page)).toMatchObject({
      sessions: 1,
      confirms: 1,
      audits: 1,
    });
    await answerOk(page);
    await expect(line(page, 'n-2')).toHaveText('Archived at 7');
    await expect(line(page, 'n-1')).toHaveCount(0); // the other row, with the same component ids, was not touched
    await expect(cardContent(page, 0)).toHaveText('Alpha description.');
    await expect(cardContent(page, 1)).toHaveText('Beta description.');
    expect(await upstreamActions(page)).toBe(0); // the bound control is a direct attachment, not a protocol action
  });

  test('supplied Markdown is only text: it cannot press, choose a handler, replace trusted arguments or grant permission', async ({
    page,
  }) => {
    await setRow(page, 0, 'description', CONTROL_LOOKALIKES);
    await expect(cardContent(page, 0)).toContainText('Archive note n-2 now');
    // Raw HTML is blocked, links are inert under Strict, and the action-looking JSON stays the characters written.
    await expect(cardContent(page, 0)).toContainText('[Markup blocked]');
    await expect(cardContent(page, 0)).toContainText('[Link blocked]');
    await expect(cardContent(page, 0)).toContainText(
      '{"action":"archive-note","noteId":"n-2","grant":"all"}',
    );
    // The only buttons are the two authored controls.
    await expect(cardContent(page, 0).locator('button, a')).toHaveCount(0);
    await expect(
      app(page).getByRole('button', { name: 'Archive', exact: true }),
    ).toHaveCount(2);

    // Clicking each lookalike does nothing: no prerequisite, no protected request, no host link, no protocol action.
    for (const text of [
      'Archive note n-2 now',
      '[Link blocked]',
      '[Markup blocked]',
      '"grant":"all"',
    ]) {
      await cardContent(page, 0)
        .getByText(text, { exact: false })
        .first()
        .click();
    }
    await page.waitForTimeout(100);
    expect(await requestCount(page)).toBe(0);
    expect(await counts(page)).toEqual({
      sessions: 0,
      confirms: 0,
      audits: 0,
      records: 0,
    });
    expect(await linkCalls(page)).toEqual([]);
    expect(await upstreamActions(page)).toBe(0);
    expect(
      await page.evaluate(() => window.cardWorkflow.archive.signedIn),
    ).toBe(true);

    // The real control acts, and its argument is the note its own row shows, not the one the Markdown names.
    await archiveButton(page, 0).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    expect((await requestInfo(page, 0))?.noteId).toBe('n-1');
    await answerOk(page);
    await expect(line(page, 'n-1')).toHaveText('Archived at 7');
  });
});

test.describe('image consent and the control have separate lifetimes', () => {
  const chart = (name: string) =>
    `Chart ![${name}](https://${IMAGE_HOST}/${name}.png)`;

  test("replacing a description revokes that card's image consent and leaves a pending archive of the row alone", async ({
    page,
  }) => {
    await setRow(page, 0, 'description', chart('one'));
    await setRow(page, 1, 'description', chart('two'));
    for (const row of [0, 1])
      await card(page, row)
        .getByRole('button', { name: 'Show images' })
        .click();
    await expect(app(page).getByTestId('md-image')).toHaveCount(2);

    await archiveButton(page, 0).click();
    await expect.poll(() => requestCount(page)).toBe(1);

    // New content for row 1 ends its consent only: its image goes and nothing is requested for the new text.
    await setRow(page, 0, 'description', chart('three'));
    await expect(card(page, 0).getByTestId('md-image')).toHaveCount(0);
    await expect(
      card(page, 0).getByRole('button', { name: 'Show images' }),
    ).toBeVisible();
    await expect(card(page, 1).getByTestId('md-image')).toHaveCount(1);
    const before = imageRequests().length;
    await page.waitForTimeout(150);
    expect(imageRequests().length).toBe(before);

    // The description is not the action's subject: the archive still settles, and it did not need a second consent.
    expect((await requestInfo(page, 0))?.aborted).toBe(false);
    await answerOk(page);
    await expect(line(page, 'n-1')).toHaveText('Archived at 7');
    await expect(
      card(page, 0).getByRole('button', { name: 'Show images' }),
    ).toBeVisible();
  });

  test("a signed-out result is shown by the application and revokes nothing the view was not told; the application's own retirement signal does", async ({
    page,
  }) => {
    await setRow(page, 0, 'description', chart('one'));
    await card(page, 0).getByRole('button', { name: 'Show images' }).click();
    await expect(card(page, 0).getByTestId('md-image')).toHaveCount(1);

    await page.evaluate(
      () => void (window.cardWorkflow.archive.signedIn = false),
    );
    await archiveButton(page, 0).click();
    await expect(line(page, 'n-1')).toHaveText(
      'No archive request was sent (session: sign-in-required)',
    );
    expect(await requestCount(page)).toBe(0);
    // The card received no signal about the account, so it makes no claim and keeps the reader's own choice.
    await expect(card(page, 0).getByTestId('md-image')).toHaveCount(1);

    // The application observed the sign-in change; its signal to the view ends the consent.
    await page.evaluate(() => window.cardWorkflow.view.consent.revokeAll());
    await expect(card(page, 0).getByTestId('md-image')).toHaveCount(0);
    await expect(
      card(page, 0).getByRole('button', { name: 'Show images' }),
    ).toBeVisible();
    // Hide/Show stays local view behavior; the session prerequisite still decides the archive.
    await card(page, 0).getByRole('button', { name: 'Show images' }).click();
    await expect(card(page, 0).getByTestId('md-image')).toHaveCount(1);
    expect(await requestCount(page)).toBe(0);
  });

  test("a row that leaves the list retires its card's consent and aborts its pending archive; the other row is unchanged", async ({
    page,
  }) => {
    await setRow(page, 0, 'description', chart('one'));
    await setRow(page, 1, 'description', chart('two'));
    for (const row of [0, 1])
      await card(page, row)
        .getByRole('button', { name: 'Show images' })
        .click();
    await archiveButton(page, 1).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    expect((await requestInfo(page, 0))?.noteId).toBe('n-2');

    await replaceRows(page, [
      {
        id: 'n-1',
        title: 'Alpha',
        contractVersion: 1,
        description: chart('one'),
      },
    ]);
    await expect(card(page, 1)).toHaveCount(0);
    await expect
      .poll(async () => (await requestInfo(page, 0))?.aborted)
      .toBe(true);
    await expect(app(page).getByTestId('md-image')).toHaveCount(1);
    await expect(archiveButton(page, 0)).toBeVisible();

    // The application's cancellation hook says only what is known: the request was sent, so the effect is unknown.
    // A late reply from the host changes neither that statement nor the request count.
    await expect(line(page, 'n-2')).toHaveText('The archive status is unknown');
    await answerOk(page);
    await page.waitForTimeout(100);
    await expect(line(page, 'n-2')).toHaveText('The archive status is unknown');
    expect(await requestCount(page)).toBe(1);
  });

  test('disconnecting the application ends both; a reconnected presentation starts fresh with its own setup', async ({
    page,
  }) => {
    await setRow(page, 0, 'description', chart('one'));
    await card(page, 0).getByRole('button', { name: 'Show images' }).click();
    await expect(card(page, 0).getByTestId('md-image')).toHaveCount(1);
    await archiveButton(page, 0).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    expect(await page.evaluate(() => window.cardWorkflow.setup.attached)).toBe(
      1,
    );

    const held = await app(page).elementHandle();
    await page.evaluate(() => document.querySelector('episodes-app')?.remove());
    await expect(app(page)).toHaveCount(0);
    await expect
      .poll(async () => (await requestInfo(page, 0))?.aborted)
      .toBe(true);

    await page.evaluate(
      (element) => document.querySelector('#one')?.prepend(element as Element),
      held,
    );
    await expect(cardContent(page, 0)).toHaveText('Alpha description.');
    await expect(app(page).getByTestId('md-image')).toHaveCount(0);
    expect(await page.evaluate(() => window.cardWorkflow.setup.attached)).toBe(
      2,
    );
    const before = imageRequests().length;
    await page.waitForTimeout(100);
    expect(imageRequests().length).toBe(before);

    // The new presentation's control works through its new setup and reaches the protected operation once.
    await archiveButton(page, 0).click();
    await expect.poll(() => requestCount(page)).toBe(2);
    expect((await requestInfo(page, 1))?.noteId).toBe('n-1');
  });
});

test.describe('an unsupported contract fails visibly without exposing private content', () => {
  test("a card that refuses its value shows an alert and none of the text; the row's control and the other card are unaffected", async ({
    page,
  }) => {
    await setRow(page, 1, 'description', 'PRIVATE subscriber text');
    await expect(cardContent(page, 1)).toHaveText('PRIVATE subscriber text');
    await setRow(page, 1, 'contractVersion', 2);
    await expect(card(page, 1).getByRole('alert')).toBeVisible();
    await expect(app(page)).not.toContainText('PRIVATE subscriber text');
    await expect(cardContent(page, 0)).toHaveText('Alpha description.');

    // The refusal belongs to the card; the application's control is a different component with its own binding.
    await archiveButton(page, 1).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    expect((await requestInfo(page, 0))?.noteId).toBe('n-2');
    await answerOk(page);
    await expect(line(page, 'n-2')).toHaveText('Archived at 7');
    await expect(app(page)).not.toContainText('PRIVATE subscriber text');

    // The next valid value recovers the card.
    await setRow(page, 1, 'contractVersion', 1);
    await expect(cardContent(page, 1)).toHaveText('PRIVATE subscriber text');
  });
});

test.describe('the surface rejects a protocol action on the authored control and the card', () => {
  test('a layout cannot give either component an action, handler name or dialect', async ({
    page,
  }) => {
    const rejected = (components: unknown[]) =>
      page.evaluate(
        ([surface, given]) =>
          window.cardWorkflow.send([
            {
              version: 'v0.9',
              updateComponents: { surfaceId: surface, components: given },
            },
          ]),
        [SURFACE, components] as const,
      );
    const control = await rejected([
      {
        id: 'row-archive',
        component: 'ActionButton',
        child: 'row-archive-label',
        action: { event: { name: 'archive-note' } },
      },
    ]);
    expect(control.ok).toBe(false);
    const faithful = await rejected([
      {
        id: 'row-card',
        component: 'FaithfulCard',
        contractVersion: 1,
        markdown: 'x',
        action: { event: { name: 'archive-note' } },
      },
    ]);
    expect(faithful.ok).toBe(false);
    const dialect = await rejected([
      {
        id: 'row-card',
        component: 'FaithfulCard',
        contractVersion: 1,
        markdown: 'x',
        dialect: 'html',
      },
    ]);
    expect(dialect.ok).toBe(false);
    expect(await requestCount(page)).toBe(0);
    expect(await upstreamActions(page)).toBe(0);
  });
});
