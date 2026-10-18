import { expect, test, type Page } from '@playwright/test';

// ACT4 on the built React consumer (dist/react-action-consumer, `?scenario=async`): a real React 19
// root in Strict Mode (the development build), the published `A2uiSurface`, and the real
// `ActionButton`. A Save-style action waits for a session the test answers; a row action carries a
// subject. The runtime's admission and currentness are observed through what the page shows and what
// the application's hooks did. Local Chromium through Playwright is not an actual host.

const SURFACE = 'actions';

test.beforeEach(async ({ page }) => {
  await page.goto('/react-action-consumer/index.html?scenario=async');
  await expect(button(page, 'Save draft')).toBeVisible();
  await expect(button(page, 'Stage')).toHaveCount(2);
});

const button = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });
const phase = (page: Page) => page.locator('[data-phase]');
const message = (page: Page) => page.locator('[data-message]');
const log = (page: Page) => page.evaluate(() => window.reactActionConsumer.log);
const send = (page: Page, input: unknown) => page.evaluate((payload) => window.reactActionConsumer.send(payload), input);
const answer = (page: Page, value: 'signed-in' | 'signed-out') =>
  page.evaluate((given) => window.reactActionConsumer.pendingSessions.shift()?.(given), value);
const pendingSessions = (page: Page) => page.evaluate(() => window.reactActionConsumer.pendingSessions.length);
const releaseRow = (page: Page, noteId: string) =>
  page.evaluate((id) => {
    const index = window.reactActionConsumer.pendingRows.findIndex((entry) => entry.noteId === id);
    window.reactActionConsumer.pendingRows.splice(index, 1)[0]?.release();
  }, noteId);
const rows = (...ids: string[]) => [
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/rows', value: ids.map((id) => ({ id, title: id.toUpperCase() })) } },
];

test.describe('a Save-style local action', () => {
  test('waits for the pending session, then runs its handler with the provided value; the binding state follows', async ({ page }) => {
    await button(page, 'Save draft').click();

    await expect(phase(page)).toHaveText('running');
    expect(await pendingSessions(page)).toBe(1);
    expect(await log(page)).toEqual([]);

    await answer(page, 'signed-in');

    await expect(phase(page)).toHaveText('idle');
    await expect(message(page)).toHaveText('saved by u-1');
    expect(await log(page)).toEqual([{ action: 'save-draft', user: 'u-1', length: 5 }]);
  });

  test('a refusal stops the handler and reaches the failure hook', async ({ page }) => {
    await button(page, 'Save draft').click();
    await answer(page, 'signed-out');

    await expect(message(page)).toHaveText('refused: sign-in-required');
    await expect(phase(page)).toHaveText('idle');
    expect(await log(page)).toEqual([]);
  });

  test('unmounting before the continuation cancels the invocation; the late answer starts nothing', async ({ page }) => {
    await button(page, 'Save draft').click();
    await expect(phase(page)).toHaveText('running');

    await page.evaluate(() => window.reactActionConsumer.unmount());
    await answer(page, 'signed-in');

    expect(await log(page)).toEqual([{ action: 'save-draft-canceled', cause: 'disposed', stage: 'prerequisites' }]);
    await expect(phase(page)).toHaveText('disposed');
  });
});

test.describe('a row action with a subject', () => {
  test('the data change that puts another item at the position cancels the in-flight work with no further press', async ({ page }) => {
    const first = button(page, 'Stage').first();
    const element = await first.elementHandle();
    await first.click();
    await button(page, 'Stage').nth(1).click();

    await send(page, rows('n-9', 'n-2'));

    await expect(message(page)).toHaveText('canceled n-1: subject-changed');
    expect(await element?.evaluate((node) => node.isConnected)).toBe(true);
    await releaseRow(page, 'n-1');
    await expect(message(page)).toHaveText('canceled n-1: subject-changed');

    await releaseRow(page, 'n-2');
    await expect(message(page)).toHaveText('staged n-2');
    await first.click();
    expect((await log(page)).filter((entry) => entry.action === 'stage-started').map((entry) => entry.noteId)).toEqual(['n-1', 'n-2', 'n-9']);
  });

  test('an A, B, A inside one update is not seen; a row that disappears is disposed', async ({ page }) => {
    await button(page, 'Stage').first().click();

    await send(page, [...rows('n-9', 'n-2'), ...rows('n-1', 'n-2')]);
    await expect(message(page)).toHaveText('');
    await releaseRow(page, 'n-1');
    await expect(message(page)).toHaveText('staged n-1');

    await button(page, 'Stage').nth(1).click();
    await send(page, rows('n-1'));

    await expect(message(page)).toHaveText(/^canceled n-2: (subject-changed|disposed)$/);
    const settled = await message(page).textContent();
    await releaseRow(page, 'n-2');
    await expect(message(page)).toHaveText(settled ?? '');
  });
});
