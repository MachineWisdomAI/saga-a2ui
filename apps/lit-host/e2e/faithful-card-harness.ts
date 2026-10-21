import { expect, type Locator, type Page } from '@playwright/test';
import type { FixtureBlockKind } from '../../../packages/components/src/faithful-card/description-fixtures.test-support.js';
import type { CardOptions } from './faithful-card/main.js';

// Helpers shared by the CARD2 specs that drive the optional Lit FaithfulCard page
// (e2e/faithful-card/). Every request to an https address is answered locally by the page route,
// so nothing depends on the internet, and each card's host callback records what it received.

export const IMAGE_HOST = 'images.example.com';
export const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

/** The https requests the browser made, recorded by the route installed in `openCardPage`. */
export const requests: string[] = [];
export const imageRequests = (): string[] =>
  requests.filter((url) => /\.(png|svg)$/.test(new URL(url).pathname));

export async function openCardPage(page: Page): Promise<void> {
  requests.length = 0;
  await page.route(/^https:\/\//, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
      contentType: 'image/svg+xml',
      body: SVG,
    });
  });
  await page.goto('/faithful-card/index.html');
  await expect(page.locator('card-app').getByTestId('card-content')).toHaveText(
    'Waiting.',
  );
}

export const mount = (page: Page, id: string, options: CardOptions) =>
  page.evaluate(
    ([cardId, settings]) =>
      window.mountCard?.(cardId as string, settings as CardOptions),
    [id, options] as const,
  );
export const set = (
  page: Page,
  id: string,
  markdown: unknown,
  contractVersion?: unknown,
) =>
  page.evaluate(
    ([cardId, text, version]) =>
      window.cards?.[cardId as string]?.set(text, version),
    [id, markdown, contractVersion] as const,
  );
export const card = (page: Page, id: string): Locator =>
  page.locator(`[data-card-id="${id}"]`);
export const linkCalls = (page: Page, id: string) =>
  page.evaluate((cardId) => [...(window.cards?.[cardId]?.linkCalls ?? [])], id);
export const nextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
  );

/** The text a reader gets: what the card shows, annotations included. */
export const shownText = (view: Locator): Promise<string> =>
  view.evaluate((element) => (element as HTMLElement).innerText);

/** What the card shows for each top-level block, named as the renderer-neutral fixture outline names it. */
export const outlineOf = (view: {
  getByTestId(id: string): Locator;
}): Promise<FixtureBlockKind[]> =>
  view.getByTestId('card-content').evaluate((root) =>
    Array.from(root.children, (child) => {
      const tag = child.tagName.toLowerCase();
      if (/^h[3-6]$/.test(tag)) return 'heading';
      if (tag === 'blockquote') return 'quote';
      if (tag === 'ul' || tag === 'ol') return 'list';
      if (tag === 'pre') return 'code-block';
      if (tag === 'hr') return 'rule';
      if (child.classList.contains('table-scroll')) return 'table';
      if (child.classList.contains('source-block')) return 'raw-html-block';
      return 'paragraph';
    }),
  );

/** Positions of each piece in `text`, failing unless they appear in the given order. */
export function expectInOrder(
  text: string,
  pieces: readonly string[],
  label: string,
): void {
  let from = 0;
  for (const piece of pieces) {
    const at = text.indexOf(piece, from);
    expect(
      at,
      `${label}: "${piece}" after position ${from}`,
    ).toBeGreaterThanOrEqual(from);
    from = at + piece.length;
  }
}
