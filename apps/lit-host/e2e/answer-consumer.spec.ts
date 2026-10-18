import { expect, test, type Page } from '@playwright/test';

// The built external consumer (examples/answer-consumer), loaded in a real browser. It was built by
// scripts/build-answer-consumer.ts against the packed SDK packages alone, so everything it renders
// went through public package exports. Effects are observed at the network layer: every https
// request is answered locally and recorded, and the page's own Content-Security-Policy is the one
// the consumer ships.

const IMAGE = 'https://images.example.com/chart.png';
const GUIDE = 'https://docs.example.com/guide';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

let requests: string[] = [];

test.beforeEach(async ({ page }) => {
  requests = [];
  await page.context().route(/^https:\/\//, async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.endsWith('.png')) {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG, headers: { 'cache-control': 'no-store' } });
    } else {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>guide</title>' });
    }
  });
});

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/answer-consumer/index.html${query}`);
  await expect(page.getByTestId('answer-status')).toHaveText('Ask a question.');
}

async function ask(page: Page, question: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Question' }).fill(question);
  await page.getByRole('button', { name: 'Ask' }).click();
}

const card = (page: Page) => page.getByTestId('card-content');

test('renders a synthetic answer in order: headings, emphasis, strikethrough, a table, a quote, attribution and footer', async ({ page }) => {
  await open(page);
  await ask(page, 'Which is better, dates or figs?');
  await expect(page.getByTestId('answer-status')).toHaveText('Answer');

  const children = await card(page).evaluate((root) => Array.from(root.children, (child) => ({ tag: child.tagName.toLowerCase(), text: (child.tagName === 'DIV' ? Array.from(child.querySelectorAll('th, td'), (cell) => cell.textContent).join(' | ') : child.textContent)?.replace(/\s+/g, ' ').trim() })));
  expect(children.map((child) => child.tag)).toEqual(['h4', 'p', 'p', 'h4', 'div', 'blockquote', 'p', 'p']);
  expect(children.map((child) => child.text)).toEqual([
    '1. Short answer',
    'You asked: Which is better, dates or figs?',
    'Dates and figs are both fruit, but only figs are pictured and both keep well.',
    '2. Details',
    'Item | Quantity | Note | Dates | 3 | fresh | Figs | 12 | dried, old new',
    'A quoted sentence from a source.',
    '— Source: Example Reference, vol. 2, p. 14',
    '[1] Footer note: see "Example Reference".',
  ]);
  await expect(card(page).locator('strong')).toHaveText('fruit');
  await expect(card(page).locator('s')).toHaveText(['but only figs are pictured', 'old']);
  await expect(card(page).getByRole('columnheader')).toHaveText(['Item', 'Quantity', 'Note']);
  expect(await card(page).getByRole('columnheader').nth(1).evaluate((cell) => getComputedStyle(cell).textAlign)).toBe('right');
});

test('the same build shows different branding through the card\'s CSS properties', async ({ page }) => {
  const look = async (query: string) => {
    await open(page, query);
    await ask(page, 'branding');
    await expect(page.getByTestId('answer-status')).toHaveText('Answer');
    const paragraph = card(page).locator('p').first();
    const heading = page.getByRole('heading', { level: 1 });
    return {
      brand: await heading.textContent(),
      font: await paragraph.evaluate((element) => getComputedStyle(element).fontFamily),
      color: await paragraph.evaluate((element) => getComputedStyle(element).color),
      accent: await heading.evaluate((element) => getComputedStyle(element).color),
    };
  };
  const nur = await look('?brand=nur');
  const harbor = await look('?brand=harbor');
  expect(nur.brand).toBe('Nur Library');
  expect(harbor.brand).toBe('Harbor Notes');
  expect(nur.font).toContain('Georgia');
  expect(harbor.font).toContain('Helvetica');
  expect(nur.color).not.toBe(harbor.color);
  expect(nur.accent).not.toBe(harbor.accent);
});

test('a different typed answer function composes into the same card', async ({ page }) => {
  await open(page, '?answers=brief');
  await ask(page, 'Short one');
  await expect(card(page)).toHaveText('Short one — a brief reply.');
  await expect(card(page).locator('strong')).toHaveText('Short one');
  await expect(card(page).getByRole('table')).toHaveCount(0);
});

test('Arabic and Unicode answers keep their order and read right to left; a long answer is shown whole', async ({ page }) => {
  await open(page);
  await ask(page, 'arabic');
  await expect(page.getByTestId('answer-status')).toHaveText('Answer');
  const arabic = card(page).getByText('السلام عليكم ورحمة الله — هذا نص عربي يجب أن يبقى بترتيبه.');
  await expect(arabic).toBeVisible();
  expect(await arabic.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
  await expect(card(page).getByRole('listitem')).toHaveText(['بند أول', 'بند ثان']);
  expect(await card(page).evaluate((root) => root.lastElementChild?.tagName.toLowerCase())).toBe('ul');

  await ask(page, 'long');
  await expect(card(page).locator('p', { hasText: /^Paragraph 299:/ })).toBeVisible();
  await expect(card(page).locator('p', { hasText: /^Paragraph \d+:/ })).toHaveCount(300);
  await expect(card(page).locator('p', { hasText: /^Paragraph 0:/ })).toBeVisible();
});

test('an oversize answer fails explicitly and clears the old one; a failing backend clears it too; a valid answer recovers', async ({ page }) => {
  await open(page);
  await ask(page, 'first question');
  await expect(card(page)).toContainText('You asked: first question');

  await ask(page, 'oversize');
  await expect(page.getByTestId('card-failure')).toHaveAttribute('data-reason', 'too-long');
  await expect(page.getByTestId('card-failure')).toContainText('60000 characters; the limit is 50000');
  await expect(page.getByText('first question')).toHaveCount(0);

  await ask(page, 'second question');
  await expect(page.getByTestId('card-failure')).toHaveCount(0);
  await expect(card(page)).toContainText('You asked: second question');

  await ask(page, 'please fail');
  await expect(page.getByTestId('answer-status')).toHaveText('The answer could not be loaded.');
  await expect(card(page)).toHaveText('');
  await expect(page.getByText('second question')).toHaveCount(0);

  await ask(page, 'third question');
  await expect(card(page)).toContainText('You asked: third question');
});

test('Standard: the shipped Content-Security-Policy lets the one listed host load images, and a link goes only to the host', async ({ page }) => {
  await open(page);
  await ask(page, 'images');
  await expect(card(page).getByTestId('md-image')).toHaveCount(1);
  await expect.poll(() => requests.filter((url) => url.endsWith('.png'))).toEqual([IMAGE]);

  const link = card(page).getByRole('button', { name: /the guide/ });
  await expect(link).toContainText('(docs.example.com)');
  const popup = page.waitForEvent('popup');
  await link.click();
  expect(await (await popup).evaluate(() => 'popped')).toBe('popped');
  await expect(card(page).getByTestId('md-link-status')).toHaveText('The host was asked to open this link.');
  await expect.poll(() => requests).toContain(GUIDE);
});

test('Strict: links stay inert and no image is requested until the reader chooses Show images', async ({ page }) => {
  await open(page, '?level=strict');
  await ask(page, 'images');
  await expect(card(page).getByTestId('md-link-inert')).toContainText('[Link blocked]');
  await expect(card(page).getByTestId('md-image-blocked')).toContainText('[Image blocked: A chart]');
  await page.waitForTimeout(200);
  expect(requests.filter((url) => url.endsWith('.png') || url === GUIDE)).toEqual([]);

  await page.getByRole('button', { name: 'Show images' }).click();
  await expect(card(page).getByTestId('md-image')).toHaveCount(1);
  await expect.poll(() => requests.filter((url) => url.endsWith('.png'))).toEqual([IMAGE]);
  expect(requests).not.toContain(GUIDE);

  // A new answer needs fresh consent.
  await ask(page, 'images again');
  await expect(card(page).getByTestId('md-image')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show images' })).toBeVisible();
});

test.describe('on a narrow screen', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the page does not scroll sideways and the table scrolls inside its own keyboard-focusable region', async ({ page }) => {
    await open(page);
    await ask(page, 'narrow');
    await expect(card(page).getByRole('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const region = card(page).getByRole('region', { name: 'Table 1' });
    await region.focus();
    await expect(region).toBeFocused();
  });
});
