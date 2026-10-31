import { expect, test, type Page } from '@playwright/test';

// The React SagaAttribution in an own-catalog application's footer, qualified by rendering in local
// Chromium: its computed presentation in light and dark, right-to-left and narrow layouts, keyboard
// focus, and what the host receives. The page (e2e/attribution) has no card, no Markdown and no
// network of its own; the host is a recording fixture, not any actual host. Not evidence for an
// installed package or for any real host's link handling.

const DESTINATION = 'https://saga-ai.dev/';

async function open(page: Page, query = ''): Promise<string[]> {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto(`/attribution/index.html${query}`);
  await expect(page.locator('.saga-attribution')).toHaveCount(1);
  return requested;
}

const asked = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.asked);

test.describe('the credit in an own-catalog footer', () => {
  test('reads as one small sentence after the application, and renders with no request of its own', async ({
    page,
  }) => {
    const requested = await open(page);
    const credit = page.locator('footer .saga-attribution');
    await expect(credit).toHaveText('Built with saga a2ui');
    expect(await credit.evaluate((e) => getComputedStyle(e).fontSize)).toBe(
      '14px',
    );
    expect(await asked(page)).toEqual([]);
    // Only the page's own documents were fetched; nothing went to the destination.
    expect(requested.filter((url) => url.includes('saga-ai.dev'))).toEqual([]);
    expect(requested.every((url) => url.startsWith('http://127.0.0.1'))).toBe(
      true,
    );
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`inherits the application's colours in the ${scheme} scheme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      const [credit, link, body] = await Promise.all([
        page
          .locator('.saga-attribution')
          .evaluate((e) => getComputedStyle(e).color),
        page
          .locator('.saga-attribution-link')
          .evaluate((e) => getComputedStyle(e).color),
        page.evaluate(() => getComputedStyle(document.body).color),
      ]);
      expect(credit).toBe(body);
      expect(link).toBe(body);
      // Dark text on a light page and light text on a dark one: readable, not forced.
      const luminance = (rgb: string): number => {
        const [r = 0, g = 0, b = 0] = rgb.match(/\d+/g)!.map(Number);
        return (r + g + b) / 3;
      };
      expect(luminance(credit) < 128).toBe(scheme === 'light');
      if (scheme === 'dark')
        await page.screenshot({
          path: 'test-results/attribution-dark.png',
          fullPage: true,
        });
      else
        await page.screenshot({
          path: 'test-results/attribution-light.png',
          fullPage: true,
        });
    });
  }

  test('shows keyboard focus on the name and activates it from the keyboard', async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press('Tab');
    const link = page.locator('.saga-attribution-link');
    await expect(link).toBeFocused();
    expect(await link.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe(
      'solid',
    );
    expect(await link.evaluate((e) => getComputedStyle(e).outlineWidth)).toBe(
      '2px',
    );
    await page.keyboard.press('Enter');
    await expect.poll(() => asked(page)).toEqual([DESTINATION]);
  });

  test('asks the host for the fixed destination once per activation, and says nothing when it opens', async ({
    page,
  }) => {
    await open(page);
    await page.locator('.saga-attribution-link').click();
    await expect.poll(() => asked(page)).toEqual([DESTINATION]);
    await expect(page.locator('.saga-attribution-status')).toHaveText('');
  });

  for (const [outcome, sentence] of [
    ['denied', 'The host did not open this link.'],
    ['unavailable', 'This host cannot open links.'],
    ['failed', 'The link could not be opened.'],
  ] as const) {
    test(`tells the reader when the host answers ${outcome}, with the destination as text`, async ({
      page,
    }) => {
      await open(page, `?host=${outcome}`);
      await page.locator('.saga-attribution-link').click();
      await expect(page.locator('.saga-attribution-status')).toHaveText(
        `${sentence} Destination: ${DESTINATION}`,
      );
      await expect(page.locator('.saga-attribution-link')).toBeVisible();
    });
  }

  test('without a host is text with its destination and nothing to activate', async ({
    page,
  }) => {
    await open(page, '?host=none');
    await expect(page.locator('.saga-attribution')).toHaveText(
      `Built with saga a2ui (${DESTINATION})`,
    );
    await expect(
      page.locator('.saga-attribution button, .saga-attribution a'),
    ).toHaveCount(0);
    expect(await asked(page)).toEqual([]);
  });

  test('stays inside a narrow right-to-left layout', async ({ page }) => {
    await page.setViewportSize({ width: 240, height: 400 });
    await open(page, '?rtl&host=denied');
    await page.locator('.saga-attribution-link').click();
    await expect(page.locator('.saga-attribution-status')).toBeVisible();
    const box = await page.locator('.saga-attribution').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(240);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
