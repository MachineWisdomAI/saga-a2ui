import { expect, test, type ElementHandle } from '@playwright/test';
import { LISTED_IMAGE_HOST, SAFE_LINK } from '../../../packages/components/src/faithful-card/description-fixtures.test-support.js';
import { card, imageRequests, linkCalls, mount, nextFrame, openCardPage, set } from './faithful-card-harness.js';

// CARD2, two instances: cards with different trusted policies on one page, one description updated,
// one view disposed. Each instance's consent, host callback and controls belong to that instance
// alone. A control kept from an earlier render (a handle a test, a script or a screen reader's
// cached tree still holds) cannot navigate, load an image or bring old content back, and ending one
// view leaves the other as it was. Consent has one owner, the image-consent scope of each view; this
// spec observes it at the network and callback boundary and does not reimplement it.
//
// A control is "kept" only if its element left the page when the content changed (the next content
// has no link or no image), because the card reuses an element whose template position survives:
// that element is then the current control for the new content, not an obsolete one.

const IMAGE_A = `https://${LISTED_IMAGE_HOST}/a-chart.png`;
const IMAGE_B = `https://${LISTED_IMAGE_HOST}/b-chart.png`;
const IMAGE_B2 = `https://${LISTED_IMAGE_HOST}/b-next.png`;
const GUIDE_A = `${SAFE_LINK}?card=a`;
const GUIDE_B = `${SAFE_LINK}?card=b`;

test.beforeEach(async ({ page }) => {
  await openCardPage(page);
});

const press = (handle: ElementHandle | null) => handle?.evaluate((button) => (button as HTMLElement).click());

test.describe('two cards with different trusted policies', () => {
  test('an update to one and the disposal of the other leave each with only its own consent, callbacks and controls', async ({ page }) => {
    await mount(page, 'standard', { level: 'standard', imageHosts: [LISTED_IMAGE_HOST], markdown: `Standard: [guide](${GUIDE_A}) ![chart](${IMAGE_A})` });
    await mount(page, 'strict', { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: `Strict: [guide](${GUIDE_B}) ![chart](${IMAGE_B})` });
    const standard = card(page, 'standard');
    const strict = card(page, 'strict');

    // Standard loads its listed image and opens through its own callback; Strict neither loads nor opens before the reader acts.
    await expect(standard.getByTestId('md-image')).toHaveCount(1);
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    await standard.getByRole('button', { name: /guide/ }).click();
    await expect.poll(() => linkCalls(page, 'standard')).toEqual([GUIDE_A]);
    expect(await linkCalls(page, 'strict')).toEqual([]);

    // Give Strict the reader's consent, then keep every control of this render.
    await strict.getByRole('button', { name: 'Show images' }).click();
    await expect(strict.getByTestId('md-image')).toHaveCount(1);
    await expect.poll(imageRequests).toEqual([IMAGE_A, IMAGE_B]);
    const keptStandardLink = await standard.getByRole('button', { name: /guide/ }).elementHandle();
    const keptHide = await strict.getByRole('button', { name: 'Hide images' }).elementHandle();
    const keptReveal = await strict.getByRole('button', { name: 'Reveal source' }).elementHandle();

    // Update the Standard card to text with no link: its old control is gone from the page and asks the host for nothing.
    // Strict's consent, image and controls are untouched by it.
    await set(page, 'standard', 'Standard, updated: no link now.');
    await expect(standard.getByTestId('card-content')).toHaveText('Standard, updated: no link now.');
    await expect(standard.getByTestId('md-image')).toHaveCount(0);
    await expect(strict.getByTestId('md-image')).toHaveCount(1);
    await expect(strict.getByRole('button', { name: 'Hide images' })).toBeVisible();
    expect(await keptStandardLink?.evaluate((button) => button.isConnected)).toBe(false);
    await press(keptStandardLink);
    await nextFrame(page);
    expect(await linkCalls(page, 'standard')).toEqual([GUIDE_A]);

    // Update Strict to text with nothing to block: consent ends, its controls leave, and the kept ones are dead.
    await set(page, 'strict', 'Strict, updated: plain.');
    await expect(strict.getByTestId('card-content')).toHaveText('Strict, updated: plain.');
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    expect(await keptHide?.evaluate((button) => button.isConnected)).toBe(false);
    expect(await keptReveal?.evaluate((button) => button.isConnected)).toBe(false);
    await press(keptHide);
    await press(keptReveal);
    await nextFrame(page);
    await expect(strict.getByTestId('card-content')).toHaveText('Strict, updated: plain.');
    await expect(standard.getByTestId('card-content')).toHaveText('Standard, updated: no link now.');

    // New content with an image offers a new control. The kept ones of earlier renders still do nothing; the new one works.
    await set(page, 'strict', `Strict, later: ![next](${IMAGE_B2})`);
    await expect(strict.getByRole('button', { name: 'Show images' })).toBeVisible();
    const afterUpdate = imageRequests().length;
    await press(keptHide);
    await press(keptReveal);
    await nextFrame(page);
    await page.waitForTimeout(150);
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    await expect(strict.getByTestId('card-content')).not.toContainText('Strict: ');
    await expect(strict.getByRole('button', { name: 'Reveal source' })).toBeVisible(); // not toggled by the old control
    expect(imageRequests().length).toBe(afterUpdate);
    expect(await linkCalls(page, 'strict')).toEqual([]);

    await strict.getByRole('button', { name: 'Show images' }).click();
    await expect.poll(imageRequests).toEqual([IMAGE_A, IMAGE_B, IMAGE_B2]);
    const keptNewHide = await strict.getByRole('button', { name: 'Hide images' }).elementHandle();

    // The Standard card, which none of this touched, still opens through its own callback, now for its new link.
    await set(page, 'standard', `Standard, again: [guide](${GUIDE_A}&v=2)`);
    await standard.getByRole('button', { name: /guide/ }).click();
    await expect.poll(() => linkCalls(page, 'standard')).toEqual([GUIDE_A, `${GUIDE_A}&v=2`]);

    // Dispose the Strict view. Its kept controls do nothing; Standard keeps its content and callback.
    await page.evaluate(() => window.cards?.strict?.remove());
    await expect(strict).toHaveCount(0);
    const afterDispose = imageRequests().length;
    for (const kept of [keptHide, keptReveal, keptNewHide]) await press(kept);
    await nextFrame(page);
    await page.waitForTimeout(150);
    expect(imageRequests().length).toBe(afterDispose);
    expect(await linkCalls(page, 'strict')).toEqual([]);
    await expect(standard.getByTestId('card-content')).toContainText('Standard, again');
    await expect(standard.getByTestId('md-link')).toBeVisible();

    // Putting Strict back starts fresh with its latest content: no consent, no image, no stale text, and the kept controls stay dead.
    await page.evaluate(() => window.cards?.strict?.reattach());
    await expect(strict.getByTestId('card-content')).toContainText('Strict, later');
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    await expect(strict.getByRole('button', { name: 'Show images' })).toBeVisible();
    for (const kept of [keptHide, keptReveal, keptNewHide]) await press(kept);
    await nextFrame(page);
    await page.waitForTimeout(150);
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    expect(imageRequests().length).toBe(afterDispose);
    await expect(strict.getByTestId('card-content')).not.toContainText('Strict: ');
  });

  test('a host answer to a link of one card is shown to that card\'s own content only, across an update of it and the disposal of the other', async ({ page }) => {
    await mount(page, 'a', { level: 'standard', links: 'pending', markdown: `[guide](${GUIDE_A})` });
    await mount(page, 'b', { level: 'standard', links: 'pending', markdown: `[guide](${GUIDE_B})` });
    const a = card(page, 'a');
    const b = card(page, 'b');
    await a.getByRole('button', { name: /guide/ }).click();
    await b.getByRole('button', { name: /guide/ }).click();
    await expect.poll(() => linkCalls(page, 'a')).toEqual([GUIDE_A]);
    await expect.poll(() => linkCalls(page, 'b')).toEqual([GUIDE_B]);

    // A's description changes and B's view is disposed while both answers are pending.
    await set(page, 'a', `Updated [guide](${GUIDE_A}&v=2)`);
    await expect(a.getByTestId('card-content')).toContainText('Updated');
    await page.evaluate(() => window.cards?.b?.remove());
    await page.evaluate(() => {
      window.cards?.a?.settle('opened');
      window.cards?.b?.settle('denied');
    });
    await nextFrame(page);
    await expect(a.getByTestId('md-link-status')).toHaveText(''); // the answer was for the old content
    await page.evaluate(() => window.cards?.b?.reattach());
    await expect(b.getByTestId('md-link-status')).toHaveText(''); // and the disposed card was not told

    // Each card still works for itself, once, through its own callback.
    await a.getByRole('button', { name: /guide/ }).click();
    await expect.poll(() => linkCalls(page, 'a')).toEqual([GUIDE_A, `${GUIDE_A}&v=2`]);
    await page.evaluate(() => window.cards?.a?.settle('opened'));
    await expect(a.getByTestId('md-link-status')).toHaveText('The host was asked to open this link.');
    expect(await linkCalls(page, 'b')).toEqual([GUIDE_B]);
    await expect(b.getByTestId('md-link-status')).toHaveText('');
  });

  test('retiring one view\'s consent scope ends only that card\'s Show images, for good, and never reaches the other', async ({ page }) => {
    await mount(page, 'first', { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: `![one](${IMAGE_A})` });
    await mount(page, 'second', { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: `![two](${IMAGE_B})` });
    const first = card(page, 'first');
    const second = card(page, 'second');
    await first.getByRole('button', { name: 'Show images' }).click();
    await second.getByRole('button', { name: 'Show images' }).click();
    await expect.poll(imageRequests).toEqual([IMAGE_A, IMAGE_B]);

    await page.evaluate(() => window.cards?.first?.view.consent.retire());
    await expect(first.getByTestId('md-image')).toHaveCount(0);
    await expect(first.getByRole('button', { name: 'Show images' })).toBeDisabled();
    await expect(second.getByTestId('md-image')).toHaveCount(1);
    await expect(second.getByRole('button', { name: 'Hide images' })).toBeEnabled();

    // New content in the retired view cannot be consented to, by its control or by script; the other view still can.
    await set(page, 'first', `![again](${IMAGE_B2})`);
    await expect(first.getByRole('button', { name: 'Show images' })).toBeDisabled();
    await first.getByRole('button', { name: 'Show images' }).evaluate((button) => (button as HTMLElement).click());
    await set(page, 'second', `![again](${IMAGE_B2})`);
    await second.getByRole('button', { name: 'Show images' }).click();
    await expect(second.getByTestId('md-image')).toHaveCount(1);
    await page.waitForTimeout(150);
    await expect(first.getByTestId('md-image')).toHaveCount(0);
    expect(imageRequests().filter((url) => url === IMAGE_B2).length).toBe(1); // loaded once, by the second card only
  });
});
