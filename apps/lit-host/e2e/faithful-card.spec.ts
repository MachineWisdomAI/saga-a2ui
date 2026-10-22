import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CardOptions } from './faithful-card/main.js';

// The optional Lit FaithfulCard, built from the workspace sources and mounted several times in one
// document (see faithful-card/main.ts). Effects are observed where they happen: every https request
// reaches the browser's network layer (answered locally, so nothing depends on the internet), and
// every link goes to a per-card host callback that records what it received.

const IMAGE_HOST = 'images.example.com';
const IMAGE = `https://${IMAGE_HOST}/ok.png`;
const IMAGE_B = `https://${IMAGE_HOST}/b.png`; // each card gets its own address: the browser caches an address it has already loaded
const IMAGE_C = `https://${IMAGE_HOST}/c.png`;
const IMAGE_D = `https://${IMAGE_HOST}/d.png`;
const LINK = 'https://docs.example.com/guide';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';

let requests: string[] = [];

test.beforeEach(async ({ page }) => {
  requests = [];
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
});

const mount = (page: Page, id: string, options: CardOptions) =>
  page.evaluate(
    ([cardId, settings]) =>
      window.mountCard?.(cardId as string, settings as CardOptions),
    [id, options] as const,
  );
const set = (
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
const card = (page: Page, id: string): Locator =>
  page.locator(`[data-card-id="${id}"]`);
const linkCalls = (page: Page, id: string) =>
  page.evaluate((cardId) => [...(window.cards?.[cardId]?.linkCalls ?? [])], id);
const imageRequests = () =>
  requests.filter((url) => new URL(url).pathname.endsWith('.png'));

const ANSWER = {
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 50_000,
} as const;
const TABLE_SOURCE =
  '| Name | Qty |\n|:-----|----:|\n| Dates | 3 |\n| Figs | ~~12~~ 14 |';

test.describe('optional catalog setup', () => {
  test('repeating setup is harmless; a different constructor on either tag fails and keeps the first definition', async ({
    page,
  }) => {
    expect(await page.evaluate(() => window.registerAgain?.())).toBe(
      'repeated',
    );
    expect(
      await page.evaluate(() =>
        window.defineConflicting?.('saga-faithful-card'),
      ),
    ).toBe('conflict');
    expect(
      await page.evaluate(() =>
        window.defineConflicting?.('saga-faithful-card-content'),
      ),
    ).toBe('conflict');
    expect(
      await page.evaluate(() =>
        window.defineConflicting?.('unrelated-card-tag'),
      ),
    ).toBe('defined');
    expect(await page.evaluate(() => window.firstDefinitionsKept?.())).toBe(
      true,
    );
    // The first definitions still render.
    await expect(
      page.locator('card-app').getByTestId('card-content'),
    ).toHaveText('Waiting.');
  });
});

test.describe('one implementation, two trusted dialects', () => {
  test('the answer dialect renders tables and strikethrough in source order; CommonMark keeps them as readable text', async ({
    page,
  }) => {
    await mount(page, 'answer', {
      ...ANSWER,
      markdown: `Before.\n\n${TABLE_SOURCE}\n\nAfter.`,
    });
    await mount(page, 'episode', {
      dialect: 'commonmark',
      markdown: `Before.\n\n${TABLE_SOURCE}\n\nAfter.`,
    });

    const table = card(page, 'answer').getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Qty']);
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table.getByRole('cell')).toHaveText([
      'Dates',
      '3',
      'Figs',
      '12 14',
    ]);
    await expect(table.locator('s')).toHaveText('12');
    expect(
      await table
        .getByRole('columnheader')
        .nth(1)
        .evaluate((cell) => getComputedStyle(cell).textAlign),
    ).toBe('right');
    const order = await card(page, 'answer')
      .getByTestId('card-content')
      .evaluate((root) =>
        Array.from(
          root.children,
          (child) =>
            child.tagName.toLowerCase() +
            (child.className ? `.${child.className}` : ''),
        ),
      );
    expect(order).toEqual(['p', 'div.saga-card-table-scroll', 'p']);

    // The episode consumer's CommonMark reads the same text without a table or a struck span.
    await expect(card(page, 'episode').getByRole('table')).toHaveCount(0);
    await expect(card(page, 'episode').locator('s')).toHaveCount(0);
    await expect(
      card(page, 'episode').getByTestId('card-content'),
    ).toContainText('| Name | Qty |');
    await expect(
      card(page, 'episode').getByTestId('card-content'),
    ).toContainText('~~12~~ 14 |');
  });

  test('headings, breaks, emphasis, lists, quotes and code keep their meaning and order', async ({
    page,
  }) => {
    const source = [
      '# Title',
      '',
      'Line one  ',
      'line two with *emphasis* and **strong** and `code`',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '```',
      'fenced',
      '```',
    ].join('\n');
    await mount(page, 'answer', { ...ANSWER, markdown: source });
    const content = card(page, 'answer').getByTestId('card-content');
    await expect(content.getByRole('heading', { level: 3 })).toHaveText(
      'Title',
    );
    await expect(content.locator('p').first().locator('br')).toHaveCount(1);
    await expect(content.locator('em')).toHaveText('emphasis');
    await expect(content.locator('strong')).toHaveText('strong');
    await expect(content.getByRole('listitem')).toHaveText(['first', 'second']);
    await expect(content.locator('blockquote')).toHaveText('quoted');
    await expect(content.locator('pre code')).toHaveText('fenced\n');
    const kinds = await content.evaluate((root) =>
      Array.from(root.children, (child) => child.tagName.toLowerCase()),
    );
    expect(kinds).toEqual(['h3', 'p', 'ol', 'blockquote', 'pre']);
  });

  test('numbered headings, attribution-like text and a footer are shown exactly as supplied, in place', async ({
    page,
  }) => {
    const lines = [
      '## 1. First point',
      'Body.',
      '## 2. Second point',
      '— Source: Example Reference, vol. 2, p. 14',
      '[1] Footer: see "Example Reference".',
    ];
    await mount(page, 'answer', { ...ANSWER, markdown: lines.join('\n\n') });
    const texts = await card(page, 'answer')
      .getByTestId('card-content')
      .evaluate((root) =>
        Array.from(root.children, (child) => child.textContent),
      );
    expect(texts).toEqual(lines.map((line) => line.replace(/^## /, '')));
  });

  test('Arabic and Unicode text keep their order and read right to left where the text does', async ({
    page,
  }) => {
    await mount(page, 'answer', {
      ...ANSWER,
      markdown:
        'السلام عليكم ورحمة الله\n\nHello — café ☕ 日本語\n\n- بند أول\n- item two',
    });
    const content = card(page, 'answer').getByTestId('card-content');
    const direction = (locator: Locator) =>
      locator.evaluate((element) => getComputedStyle(element).direction);
    await expect(content.locator('p').first()).toHaveText(
      'السلام عليكم ورحمة الله',
    );
    expect(await direction(content.locator('p').first())).toBe('rtl');
    expect(await direction(content.locator('p').nth(1))).toBe('ltr');
    expect(await direction(content.getByRole('listitem').first())).toBe('rtl');
    expect(await direction(content.getByRole('listitem').nth(1))).toBe('ltr');
    await expect(content.locator('p').nth(1)).toHaveText(
      'Hello — café ☕ 日本語',
    );
  });

  test('a long answer is shown whole under its own bound, and only that card is bounded by it', async ({
    page,
  }) => {
    const paragraphs = Array.from(
      { length: 300 },
      (_unused, index) => `Paragraph ${index}: ${'word '.repeat(20).trim()}`,
    );
    const source = paragraphs.join('\n\n');
    expect(source.length).toBeGreaterThan(2000);
    await mount(page, 'answer', { ...ANSWER, markdown: source });
    await mount(page, 'episode', {
      dialect: 'commonmark',
      maxLength: 2000,
      markdown: source,
    });
    await expect(card(page, 'answer').locator('p')).toHaveCount(300);
    await expect(card(page, 'answer').locator('p').first()).toHaveText(
      paragraphs[0] as string,
    );
    await expect(card(page, 'answer').locator('p').last()).toHaveText(
      paragraphs[299] as string,
    );
    await expect(
      card(page, 'episode').getByTestId('card-failure'),
    ).toHaveAttribute('data-reason', 'too-long');
    await expect(card(page, 'episode').getByTestId('card-content')).toHaveCount(
      0,
    );
  });
});

test.describe('invalid input clears stale content and recovery follows', () => {
  test('oversize, unsupported-version, invalid and nested input each fail explicitly without private text; a valid replacement recovers', async ({
    page,
  }) => {
    await mount(page, 'a', {
      ...ANSWER,
      maxLength: 100,
      markdown: 'Current answer.',
    });
    const view = card(page, 'a');
    await expect(view.getByTestId('card-content')).toHaveText(
      'Current answer.',
    );

    for (const [value, version, reason] of [
      ['secret '.repeat(30), 1, 'too-long'],
      ['secret answer', 2, 'unsupported-version'],
      ['secret answer', '1', 'unsupported-version'],
      [{ secret: 'answer' }, 1, 'invalid'],
      ['> '.repeat(20) + 'secret', 1, 'too-nested'],
    ] as const) {
      await set(page, 'a', value, version);
      await expect(view.getByTestId('card-failure')).toHaveAttribute(
        'data-reason',
        reason,
      );
      await expect(view.getByTestId('card-failure')).toHaveAttribute(
        'role',
        'alert',
      );
      await expect(view.getByTestId('card-content')).toHaveCount(0);
      expect(await view.innerText()).not.toContain('Current answer.');
      expect(await view.innerText()).not.toMatch(
        /secret answer|\[object Object\]/,
      );

      await set(page, 'a', 'Recovered answer.');
      await expect(view.getByTestId('card-failure')).toHaveCount(0);
      await expect(view.getByTestId('card-content')).toHaveText(
        'Recovered answer.',
      );
    }
  });

  test('a card in a page with no view shows nothing of its content', async ({
    page,
  }) => {
    await page.evaluate(() => {
      const orphan = document.createElement(
        'saga-faithful-card-content',
      ) as HTMLElement & { contractVersion: unknown; markdown: unknown };
      orphan.dataset.orphan = '';
      orphan.contractVersion = 1;
      orphan.markdown = 'private text';
      document.body.append(orphan);
    });
    const orphan = page.locator('[data-orphan]');
    await expect(orphan.getByTestId('card-failure')).toHaveAttribute(
      'data-reason',
      'no-view',
    );
    expect(await orphan.innerText()).not.toContain('private text');
  });
});

test.describe('the catalog-bound card', () => {
  const send = (page: Page, value: unknown) =>
    page.evaluate(
      (payload) =>
        window.cardApp?.()?.ingest([
          {
            version: 'v0.9',
            updateDataModel: { surfaceId: 'card', value: payload },
          },
        ]),
      value,
    );

  test('binds its two values to the data model; a replacement clears the old content, a refusal clears it too, and a valid value recovers', async ({
    page,
  }) => {
    const content = page.locator('card-app').getByTestId('card-content');
    expect(
      await send(page, { contractVersion: 1, markdown: 'First answer.' }),
    ).toEqual({ ok: true });
    await expect(content).toHaveText('First answer.');
    await send(page, { contractVersion: 1, markdown: TABLE_SOURCE });
    await expect(page.locator('card-app').getByRole('table')).toHaveCount(1);
    await expect(
      page.locator('card-app').getByText('First answer.'),
    ).toHaveCount(0);

    await send(page, { contractVersion: 7, markdown: 'private answer' });
    await expect(
      page.locator('card-app').getByTestId('card-failure'),
    ).toHaveAttribute('data-reason', 'unsupported-version');
    await expect(page.locator('card-app').getByRole('table')).toHaveCount(0);
    expect(await page.locator('card-app').innerText()).not.toContain(
      'private answer',
    );

    await send(page, { contractVersion: 1, markdown: 'Recovered.' });
    await expect(content).toHaveText('Recovered.');
  });

  test('a value that is not a valid property type is refused by the catalog before the card sees it', async ({
    page,
  }) => {
    const result = await page.evaluate(() =>
      window.cardApp?.()?.ingest([
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'card',
            components: [
              {
                id: 'root',
                component: 'FaithfulCard',
                contractVersion: 1,
                markdown: 'x',
                dialect: 'commonmark',
              },
            ],
          },
        },
      ]),
    );
    expect(result).toMatchObject({ ok: false, failure: { kind: 'rejected' } });
  });

  test('disconnecting and reconnecting starts fresh and shows nothing from the retired session', async ({
    page,
  }) => {
    await send(page, { contractVersion: 1, markdown: 'Old private answer.' });
    await expect(
      page.locator('card-app').getByTestId('card-content'),
    ).toHaveText('Old private answer.');
    const handle = await page.locator('card-app').elementHandle();
    if (!handle) throw new Error('card-app is not mounted');
    await handle.evaluate((element) => element.remove());
    await expect(
      page
        .getByTestId('card-content')
        .filter({ hasText: 'Old private answer.' }),
    ).toHaveCount(0);
    await page.evaluate((element) => document.body.append(element), handle);
    await expect(
      page.locator('card-app').getByTestId('card-content'),
    ).toHaveText('Waiting.');
  });
});

test.describe('Standard and Strict effects, observed', () => {
  const withEverything = (alt: string, image = IMAGE) =>
    `Read [the guide](${LINK}) and see ![${alt}](${image}).`;

  test('Standard shows the host before activation and sends the validated URL through its own callback only', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'standard',
      imageHosts: [IMAGE_HOST],
      markdown: withEverything('chart'),
    });
    const link = card(page, 'a').getByRole('button', { name: /the guide/ });
    await expect(link).toContainText('(docs.example.com)');
    await link.click();
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveText('');
    expect(await linkCalls(page, 'a')).toEqual([LINK]);
    await expect(card(page, 'a').getByTestId('md-image')).toHaveCount(1);
    await expect.poll(imageRequests).toEqual([IMAGE]);
  });

  test('Strict keeps links inert and requests no image until the reader consents', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'strict',
      imageHosts: [IMAGE_HOST],
      markdown: withEverything('chart'),
    });
    const view = card(page, 'a');
    await expect(view.getByTestId('md-link-inert')).toContainText(
      '[Link blocked]',
    );
    await expect(view.getByTestId('md-image-blocked')).toContainText(
      '[Image blocked: chart]',
    );
    await view.getByRole('button', { name: 'Reveal source' }).click();
    await expect(view.getByTestId('md-image-blocked')).toContainText(
      `![chart](${IMAGE})`,
    );
    await page.waitForTimeout(150);
    expect(imageRequests()).toEqual([]);
    expect(await linkCalls(page, 'a')).toEqual([]);

    await view.getByRole('button', { name: 'Show images' }).click();
    await expect(view.getByTestId('md-image')).toHaveCount(1);
    await expect(view.getByTestId('images-status')).toHaveText('Images shown.');
    await expect.poll(imageRequests).toEqual([IMAGE]);
    expect(await linkCalls(page, 'a')).toEqual([]);
    await view.getByRole('button', { name: 'Hide images' }).click();
    await expect(view.getByTestId('md-image')).toHaveCount(0);
  });

  test('without demonstrated enforcement every image stays inert, even after Show images', async ({
    page,
  }) => {
    await mount(page, 'std', {
      level: 'standard',
      imageHosts: [IMAGE_HOST],
      enforcement: 'unestablished',
      markdown: withEverything('chart'),
    });
    await mount(page, 'strict', {
      level: 'strict',
      imageHosts: [IMAGE_HOST],
      enforcement: 'unestablished',
      markdown: withEverything('chart'),
    });
    await expect(card(page, 'std').getByTestId('md-image')).toHaveCount(0);
    await expect(
      card(page, 'std').getByTestId('md-image-blocked'),
    ).toHaveAttribute('data-reason', 'enforcement-unestablished');
    await expect(
      card(page, 'strict').getByRole('button', { name: 'Show images' }),
    ).toBeDisabled();
    await expect(
      card(page, 'strict').getByTestId('images-unavailable'),
    ).toBeVisible();
    await page.waitForTimeout(150);
    expect(imageRequests()).toEqual([]);
  });

  test('two cards in one page keep their own policy, callback and consent while one is replaced and the other disposed', async ({
    page,
  }) => {
    await mount(page, 'standard', {
      level: 'standard',
      imageHosts: [IMAGE_HOST],
      links: 'opened',
      markdown: withEverything('standard chart'),
    });
    await mount(page, 'strict', {
      level: 'strict',
      imageHosts: [IMAGE_HOST],
      links: 'denied',
      markdown: withEverything('strict chart', IMAGE_B),
    });
    const standard = card(page, 'standard');
    const strict = card(page, 'strict');

    // Standard loads its listed image; the Strict card beside it neither loads it nor calls its host.
    await expect(standard.getByTestId('md-image')).toHaveCount(1);
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    await standard.getByRole('button', { name: /the guide/ }).click();
    await expect(standard.getByTestId('md-link-status')).toHaveText('');
    expect(await linkCalls(page, 'standard')).toEqual([LINK]);
    expect(await linkCalls(page, 'strict')).toEqual([]);
    await expect.poll(imageRequests).toEqual([IMAGE]);

    // Consent belongs to the Strict card; Standard neither needs nor inherits it.
    await strict.getByRole('button', { name: 'Show images' }).click();
    await expect(strict.getByTestId('md-image')).toHaveCount(1);
    await expect.poll(imageRequests).toEqual([IMAGE, IMAGE_B]);

    // Replacing the Standard card's content leaves the Strict card's image and consent alone.
    await set(
      page,
      'standard',
      `Replaced ![new](${IMAGE_C}) [other](${LINK}?x=1)`,
    );
    await expect(standard.getByTestId('md-link')).toContainText('other');
    await expect(strict.getByTestId('md-image')).toHaveCount(1);
    await expect(
      strict.getByRole('button', { name: 'Hide images' }),
    ).toBeVisible();

    // Replacing the Strict card's content revokes its consent without touching the Standard card.
    await set(page, 'strict', `Next answer ![again](${IMAGE_D})`);
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    await expect(
      strict.getByRole('button', { name: 'Show images' }),
    ).toBeVisible();
    await expect(standard.getByTestId('md-image')).toHaveCount(1);
    await strict.getByRole('button', { name: 'Show images' }).click();
    await expect(strict.getByTestId('md-image')).toHaveCount(1);

    // Disposing the Strict card ends its consent. Putting it back shows no stale image or consent.
    const before = imageRequests().length;
    await page.evaluate(() => window.cards?.strict?.remove());
    await expect(strict).toHaveCount(0);
    await expect(standard.getByTestId('md-image')).toHaveCount(1);
    await expect(standard.getByTestId('md-link')).toBeVisible();
    await page.evaluate(() => window.cards?.strict?.reattach());
    await expect(strict.getByTestId('md-image')).toHaveCount(0);
    await expect(
      strict.getByRole('button', { name: 'Show images' }),
    ).toBeVisible();
    await page.waitForTimeout(150);
    expect(imageRequests().length).toBe(before);
    expect(await linkCalls(page, 'standard')).toEqual([LINK]);
    expect(await linkCalls(page, 'strict')).toEqual([]);
  });

  test('every retirement signal the view observes removes images and cannot be undone by an old control', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'strict',
      imageHosts: [IMAGE_HOST],
      markdown: withEverything('chart'),
    });
    await mount(page, 'b', {
      level: 'strict',
      imageHosts: [IMAGE_HOST],
      markdown: withEverything('chart'),
    });
    for (const id of ['a', 'b'])
      await card(page, id).getByRole('button', { name: 'Show images' }).click();
    await expect(page.getByTestId('md-image')).toHaveCount(2);

    // A new selection in view a revokes the consent made in it; view b keeps its own.
    await page.evaluate(() => window.cards?.a?.view.consent.revokeAll());
    await expect(card(page, 'a').getByTestId('md-image')).toHaveCount(0);
    await expect(card(page, 'b').getByTestId('md-image')).toHaveCount(1);
    await card(page, 'a').getByRole('button', { name: 'Show images' }).click(); // fresh consent in a live view
    await expect(card(page, 'a').getByTestId('md-image')).toHaveCount(1);

    // Teardown of view a ends its consent for good: the control cannot grant again.
    await page.evaluate(() => window.cards?.a?.view.consent.retire());
    await expect(card(page, 'a').getByTestId('md-image')).toHaveCount(0);
    await expect(
      card(page, 'a').getByRole('button', { name: 'Show images' }),
    ).toBeDisabled();
    await expect(
      card(page, 'a').getByTestId('images-unavailable'),
    ).toHaveAttribute('data-reason', 'view-ended');
    await expect(card(page, 'b').getByTestId('md-image')).toHaveCount(1);
  });
});

test.describe('a link control belongs to the card revision it was rendered for', () => {
  const OLD_LINK = 'https://docs.example.com/old';
  const linkButton = (page: Page, id: string) =>
    card(page, id).getByRole('button', { name: /old link/ });

  test('a retained button asks the host for nothing after the content is replaced, and the new content is untouched', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'standard',
      markdown: `[old link](${OLD_LINK})`,
    });
    const retained = await linkButton(page, 'a').elementHandle();
    await set(page, 'a', 'New answer');
    await expect(card(page, 'a').getByTestId('card-content')).toHaveText(
      'New answer',
    );
    await retained?.evaluate((button) => (button as HTMLElement).click());
    // The click has been dispatched and handled synchronously; allow the (absent) async work to settle.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => resolve(undefined)),
        ),
    );
    expect(await linkCalls(page, 'a')).toEqual([]);
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveCount(0);
  });

  test('a button clicked in the same task that replaces the content asks the host for nothing', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'standard',
      markdown: `[old link](${OLD_LINK})`,
    });
    await expect(linkButton(page, 'a')).toBeVisible();
    await page.evaluate(() => {
      const handle = window.cards?.a;
      const button = handle?.element.querySelector<HTMLElement>(
        '[data-testid="md-link"]',
      );
      handle?.set('New answer');
      button?.click(); // the card has not re-rendered yet
    });
    await expect(card(page, 'a').getByTestId('card-content')).toHaveText(
      'New answer',
    );
    expect(await linkCalls(page, 'a')).toEqual([]);
  });

  test('a retained button of a removed card asks the host for nothing, and a re-added card starts clean', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'standard',
      markdown: `[old link](${OLD_LINK})`,
    });
    const retained = await linkButton(page, 'a').elementHandle();
    await page.evaluate(() => window.cards?.a?.remove());
    await expect(card(page, 'a')).toHaveCount(0);
    await retained?.evaluate((button) => (button as HTMLElement).click());
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => resolve(undefined)),
        ),
    );
    expect(await linkCalls(page, 'a')).toEqual([]);
    await page.evaluate(() => window.cards?.a?.reattach());
    await expect(linkButton(page, 'a')).toBeVisible();
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveText('');
    expect(await linkCalls(page, 'a')).toEqual([]);
  });

  test('a current link still works, and a delayed answer is shown only to the content that asked', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'standard',
      links: 'pending',
      markdown: `[old link](${OLD_LINK})`,
    });
    // A current link: the host is asked once and its (delayed) answer is announced.
    await linkButton(page, 'a').click();
    await expect.poll(() => linkCalls(page, 'a')).toEqual([OLD_LINK]);
    await page.evaluate(() => window.cards?.a?.settle('opened'));
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveText('');

    // A delayed answer to a link of replaced content is dropped: the same-position link of the new content shows nothing.
    await set(page, 'a', `[old link](${OLD_LINK}) again`);
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveText('');
    await linkButton(page, 'a').click();
    await expect.poll(async () => (await linkCalls(page, 'a')).length).toBe(2);
    await set(page, 'a', `[old link](${OLD_LINK}) replaced`);
    await expect(card(page, 'a').getByTestId('card-content')).toContainText(
      'replaced',
    );
    await page.evaluate(() => window.cards?.a?.settle('opened'));
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => resolve(undefined)),
        ),
    );
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveText('');

    // A delayed answer that arrives after the card was removed is dropped, too.
    await linkButton(page, 'a').click();
    await expect.poll(async () => (await linkCalls(page, 'a')).length).toBe(3);
    await page.evaluate(() => window.cards?.a?.remove());
    await page.evaluate(() => window.cards?.a?.settle('opened'));
    await page.evaluate(() => window.cards?.a?.reattach());
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveText('');
  });
});

test.describe('keyboard, status and narrow width', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  const wideAnswer = [
    '# A heading that is long enough to wrap on a very narrow screen',
    '',
    `Read [the guide](${LINK}) now. ${'Unbroken'.repeat(12)}`,
    '',
    '| Column one | Column two | Column three | Column four | Column five |',
    '|---|---|---|---|---|',
    '| a long cell with many words in it | b | c | d | eeeeeeeeeeeeeeeeeeeeeeeee |',
    '',
    '```',
    'a long line of code that is wider than a phone screen could possibly show at once',
    '```',
    '',
    'مرحبا بكم في هذا الجواب الطويل الذي يجب أن يبقى مقروءا على الشاشات الضيقة',
  ].join('\n');

  test('the page never scrolls sideways, text stays readable and wide blocks scroll inside their own region', async ({
    page,
  }) => {
    await mount(page, 'a', {
      ...ANSWER,
      level: 'standard',
      markdown: wideAnswer,
    });
    await expect(card(page, 'a').getByRole('table')).toBeVisible();
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fontSize: parseFloat(
        getComputedStyle(
          document.querySelector('[data-card-id="a"] p') as Element,
        ).fontSize,
      ),
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
    expect(metrics.fontSize).toBeGreaterThanOrEqual(14);
    const region = card(page, 'a').getByRole('region', { name: 'Table 1' });
    expect(
      await region.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const code = card(page, 'a').locator('pre');
    expect(
      await code.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await code.evaluate(
        (element) => element.getBoundingClientRect().right <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await card(page, 'a')
        .locator('p')
        .last()
        .evaluate((element) => getComputedStyle(element).direction),
    ).toBe('rtl');
  });

  test('a link and a scrollable table are reachable and operable from the keyboard, and the outcome is announced', async ({
    page,
  }) => {
    await mount(page, 'a', {
      ...ANSWER,
      level: 'standard',
      links: 'denied',
      markdown: wideAnswer,
    });
    const link = card(page, 'a').getByRole('button', { name: /the guide/ });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(card(page, 'a').getByTestId('md-link-status')).toContainText(
      'The host did not open this link.',
    );
    await expect(card(page, 'a').getByTestId('md-link-status')).toHaveAttribute(
      'role',
      'status',
    );
    expect(await linkCalls(page, 'a')).toEqual([LINK]);

    await page.keyboard.press('Tab');
    const region = card(page, 'a').getByRole('region', { name: 'Table 1' });
    await expect(region).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => region.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
  });

  test('Strict controls work from the keyboard', async ({ page }) => {
    await mount(page, 'a', {
      level: 'strict',
      imageHosts: [IMAGE_HOST],
      markdown: `See [guide](${LINK}) and ![chart](${IMAGE}).`,
    });
    const view = card(page, 'a');
    await view.getByRole('button', { name: 'Reveal source' }).focus();
    await page.keyboard.press('Enter');
    await expect(
      view.getByRole('button', { name: 'Hide source' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      view.getByRole('button', { name: 'Show images' }),
    ).toBeFocused();
    await page.keyboard.press('Space');
    await expect(view.getByTestId('md-image')).toHaveCount(1);
    await expect(view.getByTestId('images-status')).toHaveText('Images shown.');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
