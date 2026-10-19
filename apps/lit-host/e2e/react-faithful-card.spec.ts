import { expect, test, type Locator, type Page } from '@playwright/test';

// The built React consumer (dist/react-faithful-card): a real React 19 root in a real browser,
// `A2uiSurface` from the published @a2ui/react, the application's own catalog (Column and Text plus
// the optional FaithfulCard entry), the public `@saga-a2ui/react/faithful-card` exports and its
// explicitly imported stylesheet. React is the development build and the root is wrapped in Strict
// Mode. Every assertion goes through what a reader or the application can observe: the rendered
// document, computed styles, the keyboard, the host callback and the network. This is local
// Chromium evidence for the React card; it is not evidence for any named host or installed package.

const SURFACE = 'cards';

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/react-faithful-card/index.html${query}`);
  await expect(page.getByTestId('card-content').first()).toBeVisible();
}

const requests = (page: Page) => page.evaluate(() => window.reactFaithfulCard.requests);
const send = (page: Page, input: unknown) => page.evaluate((payload) => window.reactFaithfulCard.send(payload), input);
const card = (page: Page, which: 'first' | 'second'): Locator => page.getByTestId('card-root').nth(which === 'first' ? 0 : 1);
const data = (path: string, value: unknown) => [{ version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path, value } }];
const style = (locator: Locator, property: string) => locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

test('records the exact runtime the qualification ran on', async ({ page, browser, browserName }, testInfo) => {
  await open(page);
  const identities = await page.evaluate(() => window.reactFaithfulCard.identities);
  const recorded = { ...identities, browser: `${browserName} ${browser.version()}`, playwright: testInfo.config.version };
  await testInfo.attach('identities.json', { body: JSON.stringify(recorded, null, 2), contentType: 'application/json' });
  console.log(`react-faithful-card identities: ${JSON.stringify(recorded)}`);

  expect(identities).toMatchObject({
    '@a2ui/react': '0.13.0',
    '@a2ui/web_core': '0.13.0',
    react: '19.3.1',
    'react-dom': '19.3.1',
    reactBuild: 'development',
    runtimeReact: '19.3.1',
    runtimeReactDom: '19.3.1',
  });
});

test.describe('typography and the exported stylesheet', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('inherits the page by default and changes at once when a token is set', async ({ page }) => {
    const paragraph = card(page, 'first').locator('p').first();
    // No token set: the card takes the page's font and size.
    expect(await style(paragraph, 'font-size')).toBe('17px');
    expect(await style(paragraph, 'font-family')).toContain('Georgia');
    expect(await style(paragraph, 'line-height')).toBe('23.8px');

    await card(page, 'first').evaluate((element) => {
      element.style.setProperty('--saga-card-font-size', '22px');
      element.style.setProperty('--saga-card-line-height', '1.8');
      element.style.setProperty('--saga-card-font-family', 'Verdana, sans-serif');
      element.style.setProperty('--saga-card-text-color', 'rgb(10, 20, 30)');
    });
    expect(await style(paragraph, 'font-size')).toBe('22px');
    expect(await style(paragraph, 'line-height')).toBe('39.6px');
    expect(await style(paragraph, 'font-family')).toContain('Verdana');
    expect(await style(paragraph, 'color')).toBe('rgb(10, 20, 30)');
    // The other card on the page is untouched: tokens belong to the element they are set on.
    expect(await style(card(page, 'second').locator('p').first(), 'font-size')).toBe('17px');
  });

  test('colours links, hostnames, quotes, tables and code from the existing tokens', async ({ page }) => {
    const first = card(page, 'first');
    await first.evaluate((element) => {
      element.style.setProperty('--saga-card-accent-color', 'rgb(0, 128, 0)');
      element.style.setProperty('--saga-card-muted-color', 'rgb(90, 90, 90)');
      element.style.setProperty('--saga-card-border-color', 'rgb(1, 2, 3)');
      element.style.setProperty('--saga-card-code-background', 'rgb(250, 240, 230)');
    });
    expect(await style(first.getByTestId('md-link'), 'color')).toBe('rgb(0, 128, 0)');
    expect(await style(first.getByTestId('md-link-host'), 'color')).toBe('rgb(90, 90, 90)');
    expect(await style(first.locator('blockquote'), 'border-inline-start-color')).toBe('rgb(0, 128, 0)');
    expect(await style(first.locator('th').first(), 'border-top-color')).toBe('rgb(1, 2, 3)');
    expect(await style(first.locator('p code'), 'background-color')).toBe('rgb(250, 240, 230)');
    expect(await style(first.locator('pre'), 'background-color')).toBe('rgb(250, 240, 230)');
    expect(await style(first.locator('pre code'), 'background-color')).toBe('rgba(0, 0, 0, 0)');
  });

  test('keeps the card within its reading width, which a token changes', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const first = card(page, 'first');
    const wide = await first.boundingBox();
    // The default is 70 characters of the card's own font: far narrower than the 1400-pixel window.
    expect(wide!.width).toBeLessThan(1000);
    expect(wide!.width).toBeGreaterThan(400);
    expect(await style(first, 'max-inline-size')).not.toBe('none');

    await first.evaluate((element) => element.style.setProperty('--saga-card-reading-width', '320px'));
    const narrowed = await first.boundingBox();
    expect(narrowed!.width).toBeCloseTo(320, 0);
    await first.evaluate((element) => element.style.setProperty('--saga-card-reading-width', '900px'));
    expect((await first.boundingBox())!.width).toBeCloseTo(900, 0);
  });

  test('stays inside a narrow screen: the page never scrolls sideways and a wide table scrolls in its own region', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const region = card(page, 'first').getByTestId('md-table');
    const metrics = await region.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth, overflowX: getComputedStyle(element).overflowX }));
    expect(metrics.overflowX).toBe('auto');
    expect(metrics.scroll).toBeGreaterThan(metrics.client);
    // The long unbroken identifier wraps instead of widening the card.
    const box = await card(page, 'first').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320 + 0.5);
  });

  test('styles only the card: the page’s own elements keep the browser’s and the page’s styling', async ({ page }) => {
    const outside = page.locator('.page-owned');
    // Same element types as the card's, outside it.
    expect(await style(outside.getByTestId('page-quote'), 'border-inline-start-width')).toBe('0px');
    expect(await style(outside.getByTestId('page-quote'), 'margin-inline-start')).toBe('40px');
    expect(await style(outside.getByTestId('page-table'), 'border-collapse')).toBe('separate');
    expect(await style(outside.getByTestId('page-pre'), 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await style(outside.getByTestId('page-button'), 'text-decoration-line')).toBe('none');
    expect(await style(outside.getByTestId('page-paragraph'), 'font-size')).toBe('17px');
    // The same element types inside the card are styled.
    const first = card(page, 'first');
    expect(await style(first.locator('blockquote'), 'border-inline-start-width')).toBe('3px');
    expect(await style(first.locator('table'), 'border-collapse')).toBe('collapse');
    expect(await style(first.getByTestId('md-link'), 'text-decoration-line')).toBe('underline');
    // A token set on the card does not reach the page.
    await first.evaluate((element) => element.style.setProperty('--saga-card-font-size', '30px'));
    expect(await style(outside.getByTestId('page-paragraph'), 'font-size')).toBe('17px');
  });
});

test.describe('Standard links in a browser', () => {
  test('discloses the hostname, asks the host once, and never navigates', async ({ page, context }) => {
    await open(page);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => navigations.push(frame.url()));
    const popups: string[] = [];
    context.on('page', (popup) => popups.push(popup.url()));
    const link = card(page, 'first').getByTestId('md-link');
    await expect(link).toHaveText('guide (docs.example.com)');
    await expect(link).toHaveAccessibleName('guide (docs.example.com)');
    expect(await requests(page)).toEqual([]);

    await link.click();
    await expect(card(page, 'first').getByTestId('md-link-status')).toHaveText('The host was asked to open this link.');
    expect(await requests(page)).toEqual(['https://docs.example.com/guide?a=1']);
    expect(navigations).toEqual([]);
    expect(popups).toEqual([]);
    expect(page.url()).toContain('/react-faithful-card/index.html');
  });

  for (const answer of ['denied', 'unavailable', 'failed'] as const) {
    test(`leaves a link the host ${answer === 'unavailable' ? 'cannot open' : answer} readable and inert, with no navigation fallback`, async ({ page, context }) => {
      await open(page, `?host=${answer}`);
      const popups: string[] = [];
      context.on('page', (popup) => popups.push(popup.url()));
      let navigated = false;
      page.on('framenavigated', () => (navigated = true));
      await card(page, 'first').getByTestId('md-link').click();
      const status = card(page, 'first').getByTestId('md-link-status');
      await expect(status).toHaveAttribute('data-outcome', answer);
      await expect(status).toContainText('Destination: https://docs.example.com/guide?a=1');
      expect(await page.locator('#root a, #root [href]').count()).toBe(0);
      expect(navigated).toBe(false);
      expect(popups).toEqual([]);
    });
  }

  test('works from the keyboard: Tab reaches the link and the table region, Enter and Space press the link', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await open(page);
    const first = card(page, 'first');
    await page.keyboard.press('Tab'); // page-owned button
    await page.keyboard.press('Tab');
    await expect(first.getByTestId('md-link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(first.getByTestId('md-link-status')).toHaveAttribute('data-outcome', 'opened');
    await page.keyboard.press('Space');
    await expect.poll(async () => (await requests(page)).length).toBe(2);
    await page.keyboard.press('Tab');
    await expect(first.getByTestId('md-table')).toBeFocused();
    // On a narrow screen the focused region answers the keyboard by scrolling, not the page.
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => first.getByTestId('md-table').evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  test('requests images from nowhere: an image reference stays inert text', async ({ page }) => {
    const imageRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('images.example.com')) imageRequests.push(request.url());
    });
    await open(page);
    await expect(card(page, 'first').getByTestId('md-image-blocked')).toHaveText('[Image not loaded: chart]');
    expect(await page.locator('img, picture, source').count()).toBe(0);
    expect(imageRequests).toEqual([]);
  });
});

test.describe('Strict in a browser', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, '?level=strict');
  });

  test('keeps the link and image behind placeholders, reveals them as inert source, and asks nothing of the host', async ({ page }) => {
    const first = card(page, 'first');
    await expect(first.getByTestId('md-link-inert')).toHaveText('guide [Link blocked]');
    await expect(first.getByTestId('md-image-blocked')).toHaveText('[Image blocked: chart]');
    await first.getByTestId('source-toggle').click();
    await expect(first.getByTestId('source-toggle')).toHaveText('Hide source');
    await expect(first.getByTestId('md-link-inert')).toHaveText('[guide](https://docs.example.com/guide?a=1)');
    await expect(first.getByTestId('md-image-blocked')).toHaveText('![chart](https://images.example.com/chart.png)');
    await first.getByTestId('md-link-inert').click();
    expect(await requests(page)).toEqual([]);
    expect(await page.locator('#root :is(img, a, [href], [data-testid="md-link"])').count()).toBe(0);
    // Reveal applies to one card only.
    await expect(card(page, 'second').getByTestId('md-link-inert')).toHaveAttribute('data-presentation', 'placeholder');
  });

  test('the source control is a real button reached and pressed from the keyboard', async ({ page }) => {
    await page.keyboard.press('Tab'); // page-owned button
    await page.keyboard.press('Tab');
    const toggle = card(page, 'first').getByTestId('source-toggle');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveText('Hide source');
    await expect(toggle).toBeFocused();
  });
});

test.describe('A2UI replacement, failure, disposal and several cards in a browser', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('replaces content in place, refuses what is not valid, and recovers', async ({ page }) => {
    const first = card(page, 'first');
    await send(page, data('/first/markdown', 'Replacement **answer**'));
    await expect(first.locator('p')).toHaveText('Replacement answer');
    await expect(first.getByTestId('md-link')).toHaveCount(0);

    await send(page, data('/first/markdown', 'x'.repeat(20_001)));
    await expect(page.getByTestId('card-failure')).toHaveAttribute('data-reason', 'too-long');
    await expect(page.getByTestId('card-failure')).toHaveAttribute('role', 'alert');
    await expect(page.locator('body')).not.toContainText('Replacement answer');

    await send(page, data('/first/version', 2));
    await expect(page.getByTestId('card-failure')).toHaveAttribute('data-reason', 'unsupported-version');
    await send(page, data('/first/version', 1));
    await send(page, data('/first/markdown', 'Recovered'));
    await expect(page.getByTestId('card-failure')).toHaveCount(0);
    await expect(card(page, 'first').locator('p')).toHaveText('Recovered');
  });

  test('keeps the two cards independent through data updates and outcomes', async ({ page }) => {
    await card(page, 'second').getByTestId('md-link').click();
    await expect(card(page, 'second').getByTestId('md-link-status')).toHaveAttribute('data-outcome', 'opened');
    await send(page, data('/first/markdown', 'Only text now'));
    await expect(card(page, 'second').getByTestId('md-link-status')).toHaveAttribute('data-outcome', 'opened');
    await send(page, data('/second', 'Second replaced'));
    await expect(card(page, 'second').getByTestId('md-link-status')).toHaveCount(0);
    expect(await requests(page)).toEqual(['https://docs.example.com/second']);
  });

  test('does not show a host answer for content that has since been replaced', async ({ page }) => {
    await open(page, '?host=pending');
    await card(page, 'second').getByTestId('md-link').click();
    expect(await requests(page)).toEqual(['https://docs.example.com/second']);
    await send(page, data('/second', 'A [new](https://docs.example.com/new) one'));
    await page.evaluate(() => window.reactFaithfulCard.pending[0]!('opened'));
    await expect(card(page, 'second').getByTestId('md-link-status')).not.toHaveAttribute('data-outcome', /./);
    await expect(card(page, 'second').getByTestId('md-link-status')).toHaveText('');
  });

  test('replacing the component retires the old card and its control; unmounting removes the cards', async ({ page }) => {
    const replaced = await send(page, [
      { version: 'v0.9', updateComponents: { surfaceId: SURFACE, components: [{ id: 'second', component: 'Text', text: 'plain now' }] } },
    ]);
    expect(replaced).toEqual({ ok: true });
    await expect(page.getByTestId('app-text')).toHaveText('plain now');
    await expect(page.getByTestId('card-root')).toHaveCount(1);

    await page.evaluate(() => window.reactFaithfulCard.unmount());
    await expect(page.getByTestId('card-root')).toHaveCount(0);
    expect(await requests(page)).toEqual([]);
    // A new mount starts the same surface afresh.
    await page.evaluate(() => window.reactFaithfulCard.mount());
    await expect(page.getByTestId('card-root')).toHaveCount(1);
  });

  test('refuses a card that tries to supply its own settings', async ({ page }) => {
    for (const extra of [{ dialect: 'commonmark' }, { maxLength: 5 }, { action: { event: { name: 'x' } } }]) {
      const result = (await send(page, [
        {
          version: 'v0.9',
          updateComponents: { surfaceId: SURFACE, components: [{ id: 'second', component: 'FaithfulCard', contractVersion: 1, markdown: 'x', ...extra }] },
        },
      ])) as { ok: boolean };
      expect(result.ok, JSON.stringify(extra)).toBe(false);
    }
    await expect(card(page, 'second').getByTestId('md-link')).toHaveCount(1);
  });
});
