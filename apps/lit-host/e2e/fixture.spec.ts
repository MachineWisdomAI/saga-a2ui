import { expect, test } from '@playwright/test';
import { sagaSend } from './ingress.js';

const SURFACE = 'fixture';

declare global {
  interface Window {
    __pwned?: number;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('renders the initial fixture through the A2UI processor', async ({ page }) => {
  await expect(page.getByTestId('panel-title')).toHaveText('Sample title');
  await expect(page.getByTestId('panel-description')).toHaveText(
    'A synthetic description shown as plain text.',
  );
  await expect(page.getByTestId('failure')).toHaveCount(0);
});

test('updated data changes the visible title without recreating the app or surface', async ({ page }) => {
  const app = await page.locator('saga-app').elementHandle();
  const panel = await page.locator('saga-panel').elementHandle();
  await sagaSend(page, [
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/title', value: 'Updated sample title' } },
  ]);
  await expect(page.getByTestId('panel-title')).toHaveText('Updated sample title');
  await expect(page.getByTestId('panel-description')).toHaveText(
    'A synthetic description shown as plain text.',
  );
  expect(await page.locator('saga-app').elementHandle().then((h) => h!.evaluate((a, b) => a === b, app))).toBe(true);
  expect(await page.locator('saga-panel').elementHandle().then((h) => h!.evaluate((a, b) => a === b, panel))).toBe(true);
});

test('supplied markup is shown as inert text and never executed', async ({ page }) => {
  const markup = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script><b>bold</b>';
  await sagaSend(page, [
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/title', value: markup } },
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/description', value: markup } },
  ]);
  await expect(page.getByTestId('panel-title')).toHaveText(markup);
  await expect(page.getByTestId('panel-description')).toHaveText(markup);
  await expect(page.locator('saga-panel img, saga-panel script, saga-panel b')).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

// Which inputs are rejected, and why, is covered headlessly (protocol.test.ts). The browser
// checks only that a rejection becomes visible, inert text and that the app recovers.
test.describe('rejected input is presented safely', () => {
  test('failure text is inert and the previous content stays', async ({ page }) => {
    const result = await sagaSend(page, [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE,
          components: [{ id: 'root', component: '<img src=x onerror="window.__pwned=1">' }],
        },
      },
    ]);
    expect(result?.ok).toBe(false);
    await expect(page.getByTestId('failure')).toBeVisible();
    await expect(page.getByTestId('failure')).toContainText('Could not render this content');
    await expect(page.locator('saga-app img')).toHaveCount(0);
    await expect(page.getByTestId('panel-title')).toHaveText('Sample title');
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('malformed input reports a typed failure', async ({ page }) => {
    const result = await sagaSend(page, [{ version: 'v0.9', notAMessage: {} }]);
    expect(result).toMatchObject({ ok: false, failure: { kind: 'malformed' } });
    await expect(page.getByTestId('failure')).toBeVisible();
  });

  test('failure clears after valid data', async ({ page }) => {
    await sagaSend(page, [{ version: 'v0.9', notAMessage: {} }]);
    await expect(page.getByTestId('failure')).toBeVisible();
    await sagaSend(page, [
      { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/title', value: 'Recovered' } },
    ]);
    await expect(page.getByTestId('failure')).toHaveCount(0);
    await expect(page.getByTestId('panel-title')).toHaveText('Recovered');
  });
});
