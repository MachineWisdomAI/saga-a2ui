import { expect, test } from '@playwright/test';
import { sagaSend } from './ingress.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('panel-title')).toHaveText('Sample title');
});

test('a partial update keeps the existing component type and shows the new title', async ({
  page,
}) => {
  await sagaSend(page, [
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'fixture',
        components: [{ id: 'root', title: 'Partial title' }],
      },
    },
  ]);
  await expect(page.getByTestId('failure')).toHaveCount(0);
  await expect(page.getByTestId('panel-title')).toHaveText('Partial title');
});

test('an unsupported component is rejected inside the message-list wrapper too', async ({
  page,
}) => {
  await sagaSend(page, {
    messages: [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'fixture',
          components: [
            { id: 'root', component: 'UnsupportedPanel', title: 'Bad' },
          ],
        },
      },
    ],
  });
  await expect(page.getByTestId('failure')).toBeVisible();
  await expect(page.getByTestId('panel-title')).toHaveCount(0);
});

test('removing the app releases the ingress hook; re-adding it shows one clean surface', async ({
  page,
}) => {
  const app = await page.locator('saga-app').elementHandle();
  if (!app) throw new Error('saga-app is not mounted');

  await app.evaluate((el) => el.remove());
  expect(await page.evaluate(() => typeof window.sagaSend)).toBe('undefined');

  await page.evaluate((el) => document.body.append(el), app);
  await expect(page.getByTestId('failure')).toHaveCount(0);
  await expect(page.getByTestId('panel-title')).toHaveText('Sample title');
  await expect(page.locator('a2ui-surface')).toHaveCount(1);

  await sagaSend(page, [
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'fixture',
        path: '/title',
        value: 'After reconnect',
      },
    },
  ]);
  await expect(page.getByTestId('panel-title')).toHaveText('After reconnect');
});
