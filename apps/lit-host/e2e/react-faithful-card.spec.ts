import { expect, test, type Locator, type Page } from '@playwright/test';

// The built React consumer (dist/react-faithful-card): a real React 19 root in a real browser,
// `A2uiSurface` from the published @a2ui/react, the application's own catalog (Column and Text plus
// the optional FaithfulCard entry), the public `@saga-a2ui/react/faithful-card` exports and its
// explicitly imported stylesheet. React is the development build and the root is wrapped in Strict
// Mode. Every assertion goes through what a reader or the application can observe: the rendered
// document, computed styles, the keyboard, the host callback and the network. This is local
// Chromium evidence for the React card; it is not evidence for any named host or installed package.

const SURFACE = 'cards';
const SECOND_SURFACE = 'cards-b';

// Every HTTPS request the page makes is answered here, so none reaches a real server and the spec
// sees exactly which ones the browser sent. A request the page's Content-Security-Policy blocks is
// never sent and never appears. `redirect.png` answers with a redirect to a host the policy does not
// list, to observe that the browser enforces the policy on the redirect target too.
const IMAGE_BODY = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>';
const REDIRECT_TARGET = 'https://elsewhere.example.net/landed.png';
const sent = new WeakMap<Page, string[]>();

async function serveHttps(page: Page): Promise<void> {
  if (sent.has(page)) return;
  const urls: string[] = [];
  sent.set(page, urls);
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { violations: string[] }).violations = violations;
    document.addEventListener('securitypolicyviolation', (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  await page.route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    urls.push(url);
    if (new URL(url).pathname === '/redirect.png') {
      await route.fulfill({ status: 302, headers: { location: REDIRECT_TARGET } });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'cache-control': 'no-store' }, body: IMAGE_BODY });
  });
}

async function open(page: Page, query = ''): Promise<void> {
  await serveHttps(page);
  await page.goto(`/react-faithful-card/index.html${query}`);
  await expect(page.getByTestId('card-content').first()).toBeVisible();
}

/** The HTTPS requests the browser sent so far. */
const sentUrls = (page: Page): string[] => [...(sent.get(page) ?? [])];
const violations = (page: Page) => page.evaluate(() => (window as unknown as { violations: string[] }).violations);
/** Lets any request a change would have started be sent before the spec says none was. */
async function quiet(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const CHART = 'https://images.example.com/chart.png';
const OTHER = 'https://images.example.com/other.png';
const THIRD = 'https://images.example.com/third.png';
const REDIRECT = 'https://images.example.com/redirect.png';

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
    await expect(card(page, 'first').getByTestId('md-link-status')).toHaveText('');
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

});

test.describe('Standard images under the built Content-Security-Policy', () => {
  test('the document carries exactly the policy the content policy derives', async ({ page }) => {
    await open(page);
    const { documentPolicies, derivedPolicy } = await page.evaluate(() => window.reactFaithfulCard);
    expect(documentPolicies).toEqual([derivedPolicy]);
    // The listed host extends the level's embedded baseline (data: in both, blob: in Standard only).
    expect(derivedPolicy).toMatch(/img-src [^;]*https:\/\/images\.example\.com(;|$)/);
    expect(derivedPolicy).toContain("default-src 'none'");
  });

  test('loads an exactly listed HTTPS image without consent, and sends nothing for the references that stay inert', async ({ page }) => {
    await open(page);
    const first = card(page, 'first');
    const second = card(page, 'second');
    await expect(first.locator('img')).toHaveAttribute('src', CHART);
    await expect(second.locator('img[alt="other"]')).toHaveAttribute('src', OTHER);
    await expect.poll(() => sentUrls(page).filter((url) => url.endsWith('.png')).sort()).toEqual([CHART, OTHER, REDIRECT].sort());
    await expect(second.getByTestId('md-image-blocked')).toHaveCount(5);
    await quiet(page);

    // Data, blob, unlisted-host and plain-http references are text in their place and were never requested.
    const reasons = await second.getByTestId('md-image-blocked').evaluateAll((all) => all.map((one) => one.getAttribute('data-reason')));
    expect(reasons).toEqual(['not-https', 'not-https', 'host-not-allowed', 'not-https', 'load-failed']);
    expect(sentUrls(page).sort()).toEqual([CHART, OTHER, REDIRECT].sort());
    expect(await second.locator('img').count()).toBe(1);
    expect(await page.getByTestId('card-controls').count()).toBe(0);
    expect(await requests(page)).toEqual([]);
  });

  test('enforces the policy on a redirect: a listed image that redirects elsewhere is blocked before it is requested and shown as text', async ({ page }) => {
    await open(page);
    const redirected = card(page, 'second').getByTestId('md-image-blocked').last();
    await expect(redirected).toHaveAttribute('data-reason', 'load-failed');
    await expect(redirected).toHaveText('[Image not loaded: redirected]');
    expect(sentUrls(page)).toContain(REDIRECT);
    expect(sentUrls(page)).not.toContain(REDIRECT_TARGET);
    // The browser reports a blocked redirect against the request that was redirected, not its target.
    expect(await violations(page)).toEqual([`img-src ${REDIRECT}`]);
  });

  test('the browser, not only the card, refuses an image from an unlisted origin', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.src = 'https://elsewhere.example.net/injected.png';
      document.body.append(image);
    });
    await expect.poll(() => violations(page)).toContain('img-src https://elsewhere.example.net/injected.png');
    await quiet(page);
    expect(sentUrls(page)).not.toContain('https://elsewhere.example.net/injected.png');
  });

  test('keeps every image inert when the document does not carry the derived restrictions', async ({ page }) => {
    await open(page, '?csp=absent');
    expect(await page.evaluate(() => window.reactFaithfulCard.documentPolicies)).toEqual([]);
    await expect(card(page, 'first').getByTestId('md-image-blocked')).toHaveAttribute('data-reason', 'enforcement-unestablished');
    expect(await page.locator('#root img').count()).toBe(0);
    await quiet(page);
    expect(sentUrls(page)).toEqual([]);
  });
});

test.describe('Strict images and consent in a browser', () => {
  test('sends no image request before consent, shows the listed images after Show images, and removes them with Hide images', async ({ page }) => {
    await open(page, '?level=strict');
    const first = card(page, 'first');
    await quiet(page);
    expect(sentUrls(page)).toEqual([]);
    expect(await page.locator('#root img').count()).toBe(0);
    await expect(first.getByTestId('images-toggle')).toHaveText('Show images');

    await first.getByTestId('images-toggle').click();
    await expect(first.locator('img')).toHaveAttribute('src', CHART);
    await expect(first.getByTestId('images-status')).toHaveText('Images shown.');
    await expect.poll(() => sentUrls(page)).toEqual([CHART]);
    // Consent is for this card only: the second card still shows placeholders and requested nothing.
    expect(await card(page, 'second').locator('img').count()).toBe(0);

    await first.getByTestId('images-toggle').click();
    await expect(first.locator('img')).toHaveCount(0);
    await expect(first.getByTestId('images-toggle')).toHaveText('Show images');
    await expect(first.getByTestId('md-image-blocked')).toHaveAttribute('data-reason', 'consent-required');
    await quiet(page);
    expect(sentUrls(page)).toEqual([CHART]);
  });

  test('works from the keyboard and keeps focus on the control', async ({ page }) => {
    await open(page, '?level=strict');
    const toggle = card(page, 'first').getByTestId('images-toggle');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveText('Hide images');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveText('Show images');
    await expect(toggle).toBeFocused();
  });

  test('never requests data, blob, unlisted or plain-http references, even with consent; a redirect off the list is blocked', async ({ page }) => {
    await open(page, '?level=strict');
    const second = card(page, 'second');
    await second.getByTestId('images-toggle').click();
    await expect.poll(() => sentUrls(page).sort()).toEqual([OTHER, REDIRECT].sort());
    await expect(second.getByTestId('md-image-blocked')).toHaveCount(5);
    await expect(second.locator('img')).toHaveCount(1);
    await quiet(page);
    expect(sentUrls(page)).not.toContain(REDIRECT_TARGET);
    // The browser reports a blocked redirect against the request that was redirected, not its target.
    expect(await violations(page)).toEqual([`img-src ${REDIRECT}`]);
    const reasons = await second.getByTestId('md-image-blocked').evaluateAll((all) => all.map((one) => one.getAttribute('data-reason')));
    expect(reasons).toEqual(['not-https', 'not-https', 'host-not-allowed', 'not-https', 'load-failed']);
  });

  test('revealing the source grants nothing: no image, no request, no host call', async ({ page }) => {
    await open(page, '?level=strict');
    const first = card(page, 'first');
    await first.getByTestId('source-toggle').click();
    await first.getByTestId('md-image-blocked').click();
    await first.getByTestId('md-link-inert').click();
    await quiet(page);
    expect(await page.locator('#root img').count()).toBe(0);
    expect(sentUrls(page)).toEqual([]);
    expect(await requests(page)).toEqual([]);
    await expect(first.getByTestId('images-toggle')).toHaveText('Show images');
  });

  test('is ended for the card by new content, and the next images need a new press', async ({ page }) => {
    await open(page, '?level=strict');
    const first = card(page, 'first');
    await first.getByTestId('images-toggle').click();
    await expect(first.locator('img')).toHaveCount(1);
    const second = card(page, 'second');
    await second.getByTestId('images-toggle').click();
    await expect(second.locator('img[alt="other"]')).toHaveAttribute('src', OTHER);

    await send(page, data('/first/markdown', 'Replacement with ![new](https://images.example.com/chart.png?v=2)'));
    await expect(first.locator('img')).toHaveCount(0);
    await expect(first.getByTestId('images-toggle')).toHaveText('Show images');
    // Another card of the same view keeps its consent.
    await expect(second.locator('img[alt="other"]')).toHaveAttribute('src', OTHER);
    await quiet(page);
    expect(sentUrls(page).filter((url) => url.includes('v=2'))).toEqual([]);

    await first.getByTestId('images-toggle').click();
    await expect(first.locator('img')).toHaveAttribute('src', 'https://images.example.com/chart.png?v=2');
  });

  test('is ended for every card when the application revokes the view, and a new press is a new grant; retiring ends it for good', async ({ page }) => {
    await open(page, '?level=strict');
    const first = card(page, 'first');
    const second = card(page, 'second');
    await first.getByTestId('images-toggle').click();
    await second.getByTestId('images-toggle').click();
    await expect(page.locator('#root img')).toHaveCount(2);
    const staleHide = await first.getByTestId('images-toggle').elementHandle();

    await page.evaluate(() => window.reactFaithfulCard.consent.revokeAll());
    await expect(page.locator('#root img')).toHaveCount(0);
    await expect(first.getByTestId('images-toggle')).toHaveText('Show images');
    await expect(second.getByTestId('images-toggle')).toHaveText('Show images');
    await first.getByTestId('images-toggle').click();
    await expect(first.locator('img')).toHaveCount(1);

    const before = sentUrls(page).length;
    await page.evaluate(() => window.reactFaithfulCard.consent.retire());
    await expect(page.locator('#root img')).toHaveCount(0);
    await expect(first.getByTestId('images-toggle')).toBeDisabled();
    await expect(first.getByTestId('images-unavailable')).toHaveAttribute('data-reason', 'view-ended');
    // A control the reader still holds from before cannot bring images back.
    await staleHide!.evaluate((button) => (button as HTMLButtonElement).click());
    await first.getByTestId('images-toggle').click({ force: true });
    await quiet(page);
    expect(await page.locator('#root img').count()).toBe(0);
    expect(sentUrls(page).length).toBe(before);
  });

  // The application ends the view's consent from an effect that runs before the card's own in the
  // commit of the press. A request cannot be taken back, so the browser must never be sent one.
  for (const ending of ['retire', 'revokeAll'] as const) {
    test(`sends no request for an image whose consent ${ending} ended in the same commit as the press`, async ({ page }) => {
      await open(page, `?level=strict&ends=${ending}`);
      const first = card(page, 'first');
      await first.getByTestId('images-toggle').click();
      await quiet(page);
      expect(await page.locator('#root img').count()).toBe(0);
      expect(sentUrls(page)).toEqual([]);
      await expect(first.getByTestId('images-toggle')).toHaveText('Show images');
      if (ending === 'retire') {
        await expect(first.getByTestId('images-toggle')).toBeDisabled();
        await expect(first.getByTestId('images-unavailable')).toHaveAttribute('data-reason', 'view-ended');
      } else {
        // The view is still live: a later press is a new grant, and only then is the image requested.
        await first.getByTestId('images-toggle').click();
        await expect(first.locator('img')).toHaveAttribute('src', CHART);
        await expect.poll(() => sentUrls(page)).toEqual([CHART]);
      }
    });
  }

  test('unmounting the cards ends their consent, and a new mount starts without images or requests', async ({ page }) => {
    await open(page, '?level=strict');
    await card(page, 'first').getByTestId('images-toggle').click();
    await expect(page.locator('#root img')).toHaveCount(1);
    await page.evaluate(() => window.reactFaithfulCard.unmount());
    await expect(page.getByTestId('card-root')).toHaveCount(0);
    const before = sentUrls(page).length;
    await page.evaluate(() => window.reactFaithfulCard.mount());
    await expect(page.getByTestId('card-root')).toHaveCount(2);
    await quiet(page);
    expect(await page.locator('#root img').count()).toBe(0);
    expect(sentUrls(page).length).toBe(before);
    // Unmounting released the cards' own grants; it did not retire the view's scope, which is live: the first press works.
    await card(page, 'first').getByTestId('images-toggle').click();
    await expect(page.locator('#root img')).toHaveCount(1);
  });

  test('a replaced component ends the old card’s consent and a replacement starts afresh', async ({ page }) => {
    await open(page, '?level=strict');
    await card(page, 'second').getByTestId('images-toggle').click();
    await expect(card(page, 'second').locator('img[alt="other"]')).toHaveCount(1);
    await send(page, [{ version: 'v0.9', updateComponents: { surfaceId: SURFACE, components: [{ id: 'second', component: 'Text', text: 'plain now' }] } }]);
    await expect(page.getByTestId('app-text')).toHaveText('plain now');
    await send(page, [
      { version: 'v0.9', updateComponents: { surfaceId: SURFACE, components: [{ id: 'second', component: 'FaithfulCard', contractVersion: 1, markdown: { path: '/second' } }] } },
    ]);
    await expect(card(page, 'second').getByTestId('images-toggle')).toHaveText('Show images');
    expect(await card(page, 'second').locator('img').count()).toBe(0);
  });

  test('keeps two views apart: revoking or retiring one leaves the other’s images and consent alone', async ({ page }) => {
    await open(page, '?level=strict&second=1');
    const other = page.locator('#root-b');
    await card(page, 'first').getByTestId('images-toggle').click();
    await other.getByTestId('images-toggle').click();
    await expect(page.locator('#root img')).toHaveCount(1);
    await expect(other.locator('img')).toHaveAttribute('src', THIRD);

    await page.evaluate(() => window.reactFaithfulCard.consent.revokeAll());
    await expect(page.locator('#root img')).toHaveCount(0);
    await expect(other.locator('img')).toHaveCount(1);
    await page.evaluate(() => window.reactFaithfulCard.secondConsent!.retire());
    await expect(other.locator('img')).toHaveCount(0);
    await expect(other.getByTestId('images-toggle')).toBeDisabled();
    // The first view is still live.
    await card(page, 'first').getByTestId('images-toggle').click();
    await expect(page.locator('#root img')).toHaveCount(1);
    expect(await other.locator('img').count()).toBe(0);
    // New content in the second view leaves the first view's images and consent alone.
    await page.evaluate(([surface]) => window.reactFaithfulCard.sendSecond([{ version: 'v0.9', updateDataModel: { surfaceId: surface, path: '/only', value: 'Replaced' } }]), [SECOND_SURFACE]);
    await expect(other.getByTestId('card-content')).toHaveText('Replaced');
    await expect(page.locator('#root img')).toHaveCount(1);
    await expect(card(page, 'first').getByTestId('images-toggle')).toHaveText('Hide images');
  });

  test('shows nothing and offers nothing when the document does not carry the derived restrictions', async ({ page }) => {
    await open(page, '?level=strict&csp=absent');
    const first = card(page, 'first');
    await expect(first.getByTestId('images-toggle')).toBeDisabled();
    await expect(first.getByTestId('images-unavailable')).toHaveAttribute('data-reason', 'none-qualify');
    await first.getByTestId('images-toggle').click({ force: true });
    await quiet(page);
    expect(sentUrls(page)).toEqual([]);
    expect(await page.locator('#root img').count()).toBe(0);
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
