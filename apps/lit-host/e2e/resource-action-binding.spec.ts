import { expect, test, type Page } from '@playwright/test';

// ACT5 on the built Lit consumer (dist/action-consumer, `?scenario=resource`): a Play-style action
// over an application-owned player. The real Lit adapter, real DOM clicks and the real mount
// teardown; the page's owner records every call it receives and which leases are audible, and the
// test chooses when each start answers. Local Chromium through Playwright is not an actual host,
// and this is not the current player's lease feasibility: the owner here is a fixture.

test.beforeEach(async ({ page }) => {
  await page.goto('/action-consumer/index.html?scenario=resource');
  await expect(play(page)).toBeVisible();
  await expect(lookup(page)).toBeVisible();
});

const app = (page: Page) => page.locator('[data-app="one"]');
const play = (page: Page) => app(page).getByRole('button', { name: 'Play' });
const lookup = (page: Page) => app(page).getByRole('button', { name: 'Lookup' });
const phase = (page: Page) => page.locator('[data-phase="one"]');
const message = (page: Page) => page.locator('[data-message="one"]');
const owner = (page: Page) => page.evaluate(() => window.actionConsumer.player.snapshot());
const log = (page: Page) => page.evaluate(() => window.actionConsumer.log);
const answerStart = (page: Page, answer: 'started' | 'blocked') =>
  page.evaluate((given) => window.actionConsumer.player.pendingStarts.shift()?.(given), answer);
const unmount = (page: Page) => app(page).evaluate((element) => element.remove());
const endsOf = (calls: string[], lease: number) => calls.filter((call) => call === `end:${lease}`).length;

test.describe('a lease taken in the event turn and handed to its owner', () => {
  test('is taken in the click’s own call stack, kept by the owner after success, and outlives disposal of the binding', async ({ page }) => {
    // Read inside the click's own task: nothing can have been awaited yet.
    const inClick = await play(page).evaluate((button) => {
      (button as HTMLElement).click();
      return window.actionConsumer.player.snapshot();
    });
    expect(inClick.calls).toEqual(['begin:1', 'start:1']);
    await expect(phase(page)).toHaveText('running');

    await answerStart(page, 'started');

    await expect(message(page)).toHaveText('playing');
    await expect(phase(page)).toHaveText('idle');
    expect(await owner(page)).toEqual({ calls: ['begin:1', 'start:1', 'keep:1'], audible: [1], kept: [1] });

    // Disposing the binding is not the owner's teardown: the retained lease keeps playing.
    await unmount(page);
    await expect(phase(page)).toHaveText('disposed');
    expect(await owner(page)).toEqual({ calls: ['begin:1', 'start:1', 'keep:1'], audible: [1], kept: [1] });

    await page.evaluate(() => window.actionConsumer.player.endCurrent());
    expect((await owner(page)).audible).toEqual([]);
  });

  test('a blocked start is reported as needing a gesture, and the scope gives back the lease it still owned', async ({ page }) => {
    await play(page).click();
    await answerStart(page, 'blocked');

    await expect(message(page)).toHaveText('gesture needed');
    await expect(phase(page)).toHaveText('idle');
    expect(await owner(page)).toEqual({ calls: ['begin:1', 'start:1', 'end:1'], audible: [], kept: [] });
  });

  test('a success-hook failure after a blocked start reports failure, never playing, and spares a newer owner’s lease', async ({ page }) => {
    await page.evaluate(() => {
      window.actionConsumer.player.failNextPresentation = true;
    });
    await play(page).click();
    // Another part of the application takes the single player while the start is pending.
    const newer = await page.evaluate(() => window.actionConsumer.player.takeOver());
    await answerStart(page, 'blocked');

    await expect(message(page)).toHaveText('failed');
    await expect(phase(page)).toHaveText('idle');
    const state = await owner(page);
    expect(newer).toBe(2);
    // The old lease was ended by exactly its own token, twice (hook and scope); the newer one plays on.
    expect(endsOf(state.calls, 1)).toBe(2);
    expect(endsOf(state.calls, 2)).toBe(0);
    expect(state.audible).toEqual([2]);
    expect(state.kept).toEqual([]);
  });

  test('a success-hook failure after a started, transferred start leaves the lease with its owner, under the chosen policy', async ({ page }) => {
    await page.evaluate(() => {
      window.actionConsumer.player.failNextPresentation = true;
    });
    await play(page).click();
    await answerStart(page, 'started');

    await expect(message(page)).toHaveText('playing, but the view failed');
    await unmount(page);
    expect(await owner(page)).toEqual({ calls: ['begin:1', 'start:1', 'keep:1'], audible: [1], kept: [1] });
  });
});

test.describe('cancellation around the transfer', () => {
  test('before the transfer, the canceled hook ends exactly the lease and the scope repeats it harmlessly', async ({ page }) => {
    await play(page).click();
    await unmount(page);

    await expect.poll(async () => (await log(page)).length).toBe(1);
    expect(await log(page)).toEqual([{ app: 'one', action: 'play-canceled', stage: 'running', lease: 1 }]);
    const state = await owner(page);
    expect(endsOf(state.calls, 1)).toBe(2);
    expect(state.audible).toEqual([]);
    expect(state.calls).not.toContain('keep:1');
  });

  test('after the transfer but before the runtime observes the handler’s answer, the canceled hook ends exactly that lease', async ({ page }) => {
    await page.evaluate(() => {
      window.actionConsumer.player.holdAfterTransfer = true;
    });
    await play(page).click();
    await answerStart(page, 'started');
    await expect.poll(() => page.evaluate(() => window.actionConsumer.player.pendingAnswers.length)).toBe(1);
    expect((await owner(page)).kept).toEqual([1]);

    await unmount(page);
    await expect.poll(async () => (await log(page)).length).toBe(1);
    expect(await log(page)).toEqual([{ app: 'one', action: 'play-canceled', stage: 'running', lease: 1 }]);

    // The scope did not release it again (it had been transferred): only the hook's end ran.
    const state = await owner(page);
    expect(endsOf(state.calls, 1)).toBe(1);
    expect(state.audible).toEqual([]);

    // The handler answers late. That is a late settlement; nothing is presented as playing.
    await page.evaluate(() => window.actionConsumer.player.pendingAnswers.shift()?.());
    await expect(message(page)).toHaveText('');
    expect(await log(page)).toHaveLength(1);
  });
});

test.describe('a lease acquired after the event turn', () => {
  test('arrives when the owner lets it, is held by the scope, and is released when the invocation ends', async ({ page }) => {
    await lookup(page).click();
    expect(await page.evaluate(() => window.actionConsumer.player.pendingAcquires.length)).toBe(1);
    expect((await owner(page)).calls).toEqual([]);

    await page.evaluate(() => window.actionConsumer.player.pendingAcquires.shift()?.());

    await expect(message(page)).toHaveText('looked up with lease 1');
    expect(await owner(page)).toEqual({ calls: ['begin:1', 'end:1'], audible: [], kept: [] });
    expect(await log(page)).toEqual([{ app: 'one', action: 'lookup-held', lease: 1 }]);
  });
});
