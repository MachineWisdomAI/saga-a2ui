import { expect, test, type Page } from '@playwright/test';

const SURFACE = 'fixture';
const send = (page: Page, messages: unknown) =>
  page.evaluate((m) => (window as unknown as { sagaSend: (m: unknown) => string | undefined }).sagaSend(m), messages);

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
  await send(page, [
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
  await send(page, [
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/title', value: markup } },
    { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/description', value: markup } },
  ]);
  await expect(page.getByTestId('panel-title')).toHaveText(markup);
  await expect(page.getByTestId('panel-description')).toHaveText(markup);
  await expect(page.locator('saga-panel img, saga-panel script, saga-panel b')).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test.describe('invalid or unsupported fixture data fails safely', () => {
  const cases: Record<string, unknown> = {
    'unknown catalog': [
      { version: 'v0.9', createSurface: { surfaceId: 'other', catalogId: 'https://example.invalid/catalog' } },
    ],
    'malformed message': [{ version: 'v0.9', notAMessage: {} }],
    'unsupported component with markup': [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE,
          components: [{ id: 'root', component: '<img src=x onerror="window.__pwned=1">' }],
        },
      },
    ],
    'wrong property type': [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE,
          components: [{ id: 'root', component: 'SagaPanel', title: 42 }],
        },
      },
    ],
  };

  for (const [name, messages] of Object.entries(cases)) {
    test(name, async ({ page }) => {
      const failure = await send(page, messages);
      expect(failure).toBeTruthy();
      await expect(page.getByTestId('failure')).toBeVisible();
      await expect(page.getByTestId('failure')).toContainText('Could not render this content');
      await expect(page.locator('saga-app img')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    });
  }

  test('failure clears after valid data', async ({ page }) => {
    await send(page, [{ version: 'v0.9', notAMessage: {} }]);
    await expect(page.getByTestId('failure')).toBeVisible();
    await send(page, [
      { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/title', value: 'Recovered' } },
    ]);
    await expect(page.getByTestId('failure')).toHaveCount(0);
    await expect(page.getByTestId('panel-title')).toHaveText('Recovered');
  });
});
