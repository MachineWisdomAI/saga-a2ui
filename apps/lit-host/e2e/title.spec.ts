import { expect, test } from '@playwright/test';

test('built page shows the public title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'SAGA A2UI' })).toBeVisible();
});
