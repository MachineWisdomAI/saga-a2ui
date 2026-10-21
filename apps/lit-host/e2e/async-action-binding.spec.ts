import { expect, test, type Page } from '@playwright/test';

// ACT4 on the built Lit consumer (dist/action-consumer, `?scenario=async`): a Save-style local
// action with ordered prerequisites that the test answers, and a row action carrying a subject.
// The real Lit adapter, the real data model and real DOM clicks; the runtime's admission and
// currentness are observed through what the page shows and what the application's hooks did. Local
// Chromium through Playwright is not an actual host.

const SURFACE = 'actions';

test.beforeEach(async ({ page }) => {
  await page.goto('/action-consumer/index.html?scenario=async');
  await expect(buttons(page, 'one', 'Save draft')).toBeVisible();
  await expect(buttons(page, 'one', 'Stage')).toHaveCount(2);
});

const app = (page: Page, name: 'one' | 'two') =>
  page.locator(`[data-app="${name}"]`);
const buttons = (page: Page, name: 'one' | 'two', label: string) =>
  app(page, name).getByRole('button', { name: label });
const phase = (page: Page, name: 'one' | 'two') =>
  page.locator(`[data-phase="${name}"]`);
const message = (page: Page, name: 'one' | 'two') =>
  page.locator(`[data-message="${name}"]`);
const log = (page: Page) => page.evaluate(() => window.actionConsumer.log);
const send = (page: Page, name: string, input: unknown) =>
  page.evaluate(
    ([target, payload]) =>
      window.actionConsumer.send(target as string, payload),
    [name, input] as const,
  );
const answer = (page: Page, value: 'signed-in' | 'signed-out') =>
  page.evaluate(
    (given) => window.actionConsumer.pendingSessions.shift()?.(given),
    value,
  );
const pendingSessions = (page: Page) =>
  page.evaluate(() => window.actionConsumer.pendingSessions.length);
const releaseRow = (page: Page, noteId: string) =>
  page.evaluate((id) => {
    const index = window.actionConsumer.pendingRows.findIndex(
      (entry) => entry.noteId === id,
    );
    window.actionConsumer.pendingRows.splice(index, 1)[0]?.release();
  }, noteId);
const rows = (...ids: string[]) => [
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE,
      path: '/rows',
      value: ids.map((id) => ({ id, title: id.toUpperCase() })),
    },
  },
];

test.describe('a Save-style local action', () => {
  test('waits for the pending session, then runs its handler with the provided values, and the binding state follows', async ({
    page,
  }) => {
    await buttons(page, 'one', 'Save draft').click();

    await expect(phase(page, 'one')).toHaveText('running');
    expect(await pendingSessions(page)).toBe(1);
    expect(await log(page)).toEqual([]);

    await answer(page, 'signed-in');

    await expect(phase(page, 'one')).toHaveText('idle');
    await expect(message(page, 'one')).toHaveText('saved by u-1 (5)');
    expect(await log(page)).toEqual([
      { app: 'one', action: 'save-draft', user: 'u-1', length: 5 },
    ]);
    const states = await page.evaluate(() =>
      window.actionConsumer.phases
        .filter((entry) => entry.startsWith('one|save-draft|'))
        .map((entry) => entry.split('|').at(-1)),
    );
    expect(states).toEqual(['running', 'settling', 'idle']);
  });

  test('a refusal stops the handler, and the failure hook tells the user why', async ({
    page,
  }) => {
    await buttons(page, 'one', 'Save draft').click();
    await answer(page, 'signed-out');

    await expect(message(page, 'one')).toHaveText('refused: sign-in-required');
    await expect(phase(page, 'one')).toHaveText('idle');
    expect(await log(page)).toEqual([]);
  });

  test('prerequisites run in order: the second one sees the input and can refuse after the first proceeded', async ({
    page,
  }) => {
    await send(page, 'one', [
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: SURFACE, path: '/draft', value: '' },
      },
    ]);
    await buttons(page, 'one', 'Save draft').click();
    expect(await pendingSessions(page)).toBe(1);

    await answer(page, 'signed-in');

    await expect(message(page, 'one')).toHaveText('refused: empty-draft');
    expect(await log(page)).toEqual([]);
  });

  test('a second press while the first is pending is ignored: one invocation, one session request', async ({
    page,
  }) => {
    const control = buttons(page, 'one', 'Save draft');
    await control.click();
    await control.click();

    expect(await pendingSessions(page)).toBe(1);
    await answer(page, 'signed-in');
    await expect(phase(page, 'one')).toHaveText('idle');
    expect(await log(page)).toEqual([
      { app: 'one', action: 'save-draft', user: 'u-1', length: 5 },
    ]);
  });

  test('a mount that goes away before the continuation cancels the invocation; the late answer starts nothing', async ({
    page,
  }) => {
    await buttons(page, 'one', 'Save draft').click();
    await expect(phase(page, 'one')).toHaveText('running');

    await app(page, 'one').evaluate((element) => element.remove());
    await answer(page, 'signed-in');

    expect(await log(page)).toEqual([
      {
        app: 'one',
        action: 'save-draft-canceled',
        cause: 'disposed',
        stage: 'prerequisites',
      },
    ]);
    await expect(phase(page, 'one')).toHaveText('disposed');
  });
});

test.describe('a row action with a subject', () => {
  test('the data change that puts another item at the position cancels the in-flight work with no further press', async ({
    page,
  }) => {
    const first = buttons(page, 'one', 'Stage').first();
    const element = await first.elementHandle();
    await first.click();
    await buttons(page, 'one', 'Stage').nth(1).click();

    await send(page, 'one', rows('n-9', 'n-2'));

    await expect(message(page, 'one')).toHaveText(
      'canceled n-1: subject-changed',
    );
    // The element was not replaced: the position kept its instance, and only the subject told them apart.
    expect(await element?.evaluate((node) => node.isConnected)).toBe(true);
    await releaseRow(page, 'n-1');
    await expect(message(page, 'one')).toHaveText(
      'canceled n-1: subject-changed',
    );

    // The other row was untouched, and the replacement item runs on a fresh press.
    await releaseRow(page, 'n-2');
    await expect(message(page, 'one')).toHaveText('staged n-2');
    await first.click();
    expect(
      (await log(page))
        .filter((entry) => entry.action === 'stage-started')
        .map((entry) => entry.noteId),
    ).toEqual(['n-1', 'n-2', 'n-9']);
  });

  test('an A, B, A inside one update is not seen; a row that disappears is disposed', async ({
    page,
  }) => {
    await buttons(page, 'one', 'Stage').first().click();

    await send(page, 'one', [...rows('n-9', 'n-2'), ...rows('n-1', 'n-2')]);
    await expect(phase(page, 'one')).toHaveText('');
    await releaseRow(page, 'n-1');
    await expect(message(page, 'one')).toHaveText('staged n-1');

    await buttons(page, 'one', 'Stage').nth(1).click();
    await send(page, 'one', rows('n-1'));

    // Either cause is correct: the data model told the runtime before Lit retired the element, so the
    // subject may be read as changed first. What must hold is that the work is canceled and the binding goes.
    await expect(message(page, 'one')).toHaveText(
      /^canceled n-2: (subject-changed|disposed)$/,
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.actionConsumer.bindings
            .filter((b) => b.app === 'one' && b.dataPath === '/rows/1')
            .map((b) => b.binding.state.phase),
        ),
      )
      .toEqual(['disposed']);
    const settled = await message(page, 'one').textContent();
    await releaseRow(page, 'n-2');
    await expect(message(page, 'one')).toHaveText(settled ?? '');
  });
});
