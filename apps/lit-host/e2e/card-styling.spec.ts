import { expect, test, type Locator, type Page } from '@playwright/test';

// The FaithfulCard styling contract, qualified by rendering. A branded application's stylesheet
// (e2e/card-styling/branded.ts), written against the committed surface alone, is applied to the
// card of each renderer, mounted through that renderer's public card surface, in a real browser;
// the assertions are computed styles. The expected values are the stylesheet's own numbers, so a
// renderer that dropped a committed class, element or marker would not match them. The same
// assertions run against both renderers.

const renderers = ['react', 'lit'] as const;

const ATTRIBUTION = 'This information came from ansari.chat.';
const BODY = [
  'Opening paragraph with [a link](https://docs.example.com/guide).',
  '',
  '- first',
  '- second',
  '',
  '1. one',
  '2. two',
  '',
  ATTRIBUTION,
].join('\n');

async function present(
  page: Page,
  renderer: (typeof renderers)[number],
  markdown: string,
  query = '',
): Promise<void> {
  await page.goto(`/card-styling/${renderer}.html${query}`);
  await page.waitForFunction(() => window.cardPage !== undefined);
  await page.evaluate((text) => window.cardPage?.present(text), markdown);
  await expect(page.locator('.saga-card-content')).toHaveCount(1);
}

const style = (
  locator: Locator,
  property: string,
  pseudo?: string,
): Promise<string> =>
  locator.evaluate(
    (element, [name, pseudoElement]) =>
      getComputedStyle(element, pseudoElement ?? null).getPropertyValue(
        name as string,
      ),
    [property, pseudo] as const,
  );

for (const renderer of renderers) {
  test.describe(`the branded card in the ${renderer} renderer`, () => {
    test('styles an ordinary paragraph through the card’s tokens and elements', async ({
      page,
    }) => {
      await present(page, renderer, BODY);
      const paragraph = page.locator('.saga-card-content > p').first();
      expect(await style(paragraph, 'margin-bottom')).toBe('22px');
      expect(await style(paragraph, 'font-size')).toBe('18px');
      expect(await style(paragraph, 'color')).toBe('rgb(23, 34, 53)');
      expect(await style(paragraph, 'line-height')).toBe('27px');
      expect(await style(page.locator('.saga-card'), 'padding-top')).toBe(
        '12px',
      );
      // Not marked: it is not the card’s final block.
      await expect(paragraph).not.toHaveAttribute('data-saga-closing', /.*/);
    });

    test('styles a bulleted and a numbered list through ul, ol and li', async ({
      page,
    }) => {
      await present(page, renderer, BODY);
      const bullets = page.locator('.saga-card-content > ul');
      expect(await style(bullets, 'margin-top')).toBe('18px');
      expect(await style(bullets, 'padding-left')).toBe('24px');
      const bullet = bullets.locator('> li').first();
      expect(await style(bullet, 'margin-top')).toBe('12px');
      expect(await style(bullet, 'padding-left')).toBe('4px');
      const numbered = page.locator('.saga-card-content > ol > li').first();
      expect(await style(numbered, 'position')).toBe('relative');
      expect(await style(numbered, 'padding-left')).toBe('82px');
      expect(await style(numbered, 'width', '::before')).toBe('64px');
      expect(await style(numbered, 'display', '::before')).toBe('grid');
      // The list keeps its list semantics: the generated disk shows the browser's own counter.
      expect(await style(numbered, 'content', '::before')).toBe(
        'counter(list-item)',
      );
      await expect(page.locator('.saga-card-content > ol > li')).toHaveCount(2);
    });

    test('styles a link through .saga-card-link and its tokens', async ({
      page,
    }) => {
      await present(page, renderer, BODY);
      const link = page.locator('.saga-card-link');
      await expect(link).toHaveCount(1);
      expect(await style(link, 'color')).toBe('rgb(21, 88, 62)');
      expect(await style(link, 'text-decoration-thickness')).toBe('1px');
      expect(await style(link, 'text-underline-offset')).toBe('2px');
      await expect(
        page.locator('.saga-card-link + .saga-card-link-status'),
      ).toHaveCount(1);
    });

    test('styles the closing block the application recognised, and only that', async ({
      page,
    }) => {
      await present(page, renderer, BODY);
      const closing = page.locator('[data-saga-closing="paragraph"]');
      await expect(closing).toHaveCount(1);
      await expect(closing).toHaveText(ATTRIBUTION);
      await expect(closing).toHaveAttribute('data-app-attribution', '');
      // It is the last element of the content, a direct child of it.
      await expect(
        page.locator('.saga-card-content > p[data-saga-closing]:last-child'),
      ).toHaveCount(1);
      expect(await style(closing, 'border-top-width')).toBe('1px');
      expect(await style(closing, 'font-size')).toBe('14px');
      expect(await style(closing, 'color')).toBe('rgb(85, 98, 117)');
      expect(await style(closing, 'margin-top')).toBe('23px');
    });

    test('marks a final paragraph that only looks like the attribution, and the application does not style it as one', async ({
      page,
    }) => {
      await present(page, renderer, `Body.\n\n${ATTRIBUTION} Trust me.`);
      const closing = page.locator('[data-saga-closing="paragraph"]');
      await expect(closing).toHaveCount(1);
      await expect(closing).not.toHaveAttribute('data-app-attribution', /.*/);
      // The structural marker still carries the application’s rule for any closing paragraph.
      expect(await style(closing, 'margin-bottom')).toBe('4px');
      expect(await style(closing, 'border-top-width')).toBe('0px');
      expect(await style(closing, 'font-size')).toBe('18px');
    });

    test('puts no marker on a card that ends with a list, and leaves its last paragraph an ordinary one', async ({
      page,
    }) => {
      await present(
        page,
        renderer,
        `Intro paragraph.\n\n- one\n- ${ATTRIBUTION}`,
      );
      await expect(page.locator('[data-saga-closing]')).toHaveCount(0);
      const paragraph = page.locator('.saga-card-content > p');
      expect(await style(paragraph, 'margin-bottom')).toBe('22px');
    });

    test('puts no marker on a paragraph nested in a quote, even the attribution sentence', async ({
      page,
    }) => {
      await present(
        page,
        renderer,
        `Intro paragraph.\n\n> Quoted.\n>\n> ${ATTRIBUTION}`,
      );
      await expect(page.locator('[data-saga-closing]')).toHaveCount(0);
      await expect(page.locator('[data-app-attribution]')).toHaveCount(0);
      const nested = page.locator('.saga-card-content > blockquote > p').last();
      await expect(nested).toHaveText(ATTRIBUTION);
      expect(await style(nested, 'margin-bottom')).toBe('22px');
      expect(await style(nested, 'font-size')).toBe('18px');
    });

    test('puts no marker on a paragraph nested in a list item or a table cell', async ({
      page,
    }) => {
      await present(
        page,
        renderer,
        `Intro paragraph.\n\n- ${ATTRIBUTION}\n\n  Second paragraph of the item.\n\n| a |\n| - |\n| ${ATTRIBUTION} |`,
      );
      await expect(page.locator('[data-saga-closing]')).toHaveCount(0);
    });

    test('moves the marker with the content: a new answer that ends in a paragraph gets it, and the previous one’s is gone', async ({
      page,
    }) => {
      await present(page, renderer, `One.\n\n- a\n- b`);
      await expect(page.locator('[data-saga-closing]')).toHaveCount(0);
      await page.evaluate(() => window.cardPage?.present('Two.\n\nThree.'));
      await expect(page.locator('[data-saga-closing]')).toHaveCount(1);
      await expect(page.locator('[data-saga-closing]')).toHaveText('Three.');
    });

    test('shows the SDK’s own presentation, not the application’s, when the stylesheet is absent', async ({
      page,
    }) => {
      await present(page, renderer, BODY, '?unbranded');
      const paragraph = page.locator('.saga-card-content > p').first();
      expect(await style(paragraph, 'margin-bottom')).not.toBe('22px');
      expect(await style(paragraph, 'color')).not.toBe('rgb(23, 34, 53)');
      expect(
        await style(
          page.locator('.saga-card-link'),
          'text-decoration-thickness',
        ),
      ).not.toBe('1px');
      // The structure the application relies on is the same either way.
      await expect(page.locator('[data-saga-closing="paragraph"]')).toHaveCount(
        1,
      );
    });
  });
}
