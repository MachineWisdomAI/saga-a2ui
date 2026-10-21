import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  LISTED_IMAGE,
  LISTED_IMAGE_HOST,
  REFUSED_DESCRIPTIONS,
  SAFE_LINK,
  UNLISTED_IMAGE,
  VALID_DESCRIPTIONS,
  type ValidDescription,
} from '../../../packages/components/src/faithful-card/description-fixtures.test-support.js';
import {
  card,
  expectInOrder,
  imageRequests,
  linkCalls,
  mount,
  openCardPage,
  outlineOf,
  requests,
  set,
  shownText,
} from './faithful-card-harness.js';

// CARD2, reading: representative full descriptions through the optional Lit FaithfulCard's real
// registration and its A2UI catalog binding, under Standard and Strict. The cases are the
// renderer-neutral fixtures of the components package (description-fixtures.test-support.ts), so the
// same descriptions can qualify another renderer. Local Chromium through Playwright; nothing here
// claims identical pixels across renderers, that a description is true, or how a host narrates it.

test.beforeEach(async ({ page }) => {
  await openCardPage(page);
});

const fixture = (id: string): ValidDescription => {
  const found = VALID_DESCRIPTIONS.find((one) => one.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

/** Strict hides blocked source behind a placeholder until the reader asks; ask, when there is something to ask for. */
async function revealIfOffered(view: Locator): Promise<void> {
  const toggle = view.getByRole('button', { name: 'Reveal source' });
  if ((await toggle.count()) > 0) await toggle.click();
}

const MODES = [
  {
    level: 'standard',
    options: { level: 'standard', imageHosts: [LISTED_IMAGE_HOST] },
  },
  {
    level: 'strict',
    options: { level: 'strict', imageHosts: [LISTED_IMAGE_HOST] },
  },
] as const;

test.describe('representative descriptions keep their structure and order under both modes', () => {
  for (const mode of MODES) {
    for (const description of VALID_DESCRIPTIONS) {
      test(`${description.id} under ${mode.level}`, async ({ page }) => {
        await mount(page, 'a', {
          ...mode.options,
          dialect: description.dialect,
          maxLength: 50_000,
          markdown: description.markdown,
        });
        const view = card(page, 'a');
        await expect(view.getByTestId('card-content')).toBeVisible();
        await expect(view.getByTestId('card-failure')).toHaveCount(0);

        // The structure the renderer-neutral fixture states, in source order.
        expect(await outlineOf(view)).toEqual(description.outline);

        // Every supplied piece is there in order. Strict keeps blocked markup behind a placeholder until revealed.
        await revealIfOffered(view);
        expectInOrder(
          await shownText(view),
          description.order,
          `${description.id} under ${mode.level}`,
        );
        await expect(view.getByTestId('card-content')).toBeVisible();

        // Long, multilingual and hostile text alike never makes the page scroll sideways.
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      });
    }
  }

  test('the multilingual description reads each script in its own direction and loses nothing', async ({
    page,
  }) => {
    const description = fixture('multilingual-long');
    await mount(page, 'a', {
      level: 'standard',
      dialect: description.dialect,
      maxLength: 50_000,
      markdown: description.markdown,
    });
    const content = card(page, 'a').getByTestId('card-content');
    const direction = (text: string) =>
      content
        .locator('p, li, h3, h4')
        .filter({ hasText: text })
        .first()
        .evaluate((element) => getComputedStyle(element).direction);
    expect(await direction('السلام عليكم')).toBe('rtl');
    expect(await direction('Welcome back')).toBe('ltr');
    expect(await direction('日本語の説明')).toBe('ltr');
    expect(await direction('بند أول')).toBe('rtl');
    // Numbering, attribution and the footer are the characters supplied, in place.
    await expect(content.getByRole('heading', { level: 4 })).toHaveText(
      '1. What we cover',
    );
    await expect(content.locator('p').nth(-2)).toHaveText(
      '— Source: Example Reference, vol. 2, p. 14',
    );
    await expect(content.locator('p').last()).toHaveText(
      '[1] Footer: see “Example Reference”.',
    );
  });
});

test.describe('results the card refuses leave nothing behind', () => {
  for (const refused of REFUSED_DESCRIPTIONS) {
    test(`${refused.id}: refused as ${refused.failure}, with neither the old nor the refused text, and a valid result recovers`, async ({
      page,
    }) => {
      await mount(page, 'a', {
        level: 'strict',
        dialect: 'commonmark',
        maxLength: refused.maxLength,
        markdown: 'Current answer text.',
      });
      const view = card(page, 'a');
      await expect(view.getByTestId('card-content')).toHaveText(
        'Current answer text.',
      );

      await set(page, 'a', refused.markdown, refused.contractVersion);
      await expect(view.getByTestId('card-failure')).toHaveAttribute(
        'data-reason',
        refused.failure,
      );
      await expect(view.getByTestId('card-failure')).toHaveAttribute(
        'role',
        'alert',
      );
      await expect(view.getByTestId('card-content')).toHaveCount(0);
      const text = await view.innerText();
      expect(text).not.toContain('Current answer text.');
      expect(text).not.toContain(refused.secret);
      expect(text).not.toContain('[object Object]');

      await set(page, 'a', 'Recovered answer text.');
      await expect(view.getByTestId('card-failure')).toHaveCount(0);
      await expect(view.getByTestId('card-content')).toHaveText(
        'Recovered answer text.',
      );
    });
  }

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

  test('through the catalog binding, a version or shape the contract does not read clears the card, and the next valid result shows', async ({
    page,
  }) => {
    const description = fixture('structured');
    const app = page.locator('card-app');
    expect(
      await send(page, { contractVersion: 1, markdown: description.markdown }),
    ).toEqual({ ok: true });
    await expect(app.getByRole('table')).toHaveCount(1);

    for (const refused of REFUSED_DESCRIPTIONS.filter(
      (one) =>
        one.failure === 'unsupported-version' || one.failure === 'invalid',
    )) {
      if (refused.markdown === undefined) continue; // JSON data cannot carry an absent value
      await send(page, {
        contractVersion: refused.contractVersion,
        markdown: refused.markdown,
      });
      await expect(app.getByTestId('card-failure'), refused.id).toHaveAttribute(
        'data-reason',
        refused.failure,
      );
      await expect(app.getByTestId('card-failure')).toHaveAttribute(
        'role',
        'alert',
      );
      await expect(app.getByRole('table')).toHaveCount(0);
      const text = await app.innerText();
      expect(text).not.toContain('Reading plan');
      expect(text).not.toContain(refused.secret);

      expect(
        await send(page, {
          contractVersion: 1,
          markdown: description.markdown,
        }),
      ).toEqual({ ok: true });
      await expect(app.getByRole('table')).toHaveCount(1);
      await expect(app.getByTestId('card-failure')).toHaveCount(0);
    }
  });

  test('a description the application bound refuses is not partly shown: the oversize and the nested descriptions show an alert only', async ({
    page,
  }) => {
    const oversize = REFUSED_DESCRIPTIONS.find(
      (one) => one.failure === 'too-long',
    );
    const nested = REFUSED_DESCRIPTIONS.find(
      (one) => one.failure === 'too-nested',
    );
    if (!oversize || !nested) throw new Error('missing refused fixtures');
    await mount(page, 'big', {
      level: 'standard',
      maxLength: oversize.maxLength,
      markdown: oversize.markdown as string,
    });
    await mount(page, 'deep', {
      level: 'standard',
      maxLength: nested.maxLength,
      markdown: nested.markdown as string,
    });
    await expect(card(page, 'big').getByTestId('card-failure')).toHaveAttribute(
      'data-reason',
      'too-long',
    );
    await expect(
      card(page, 'deep').getByTestId('card-failure'),
    ).toHaveAttribute('data-reason', 'too-nested');
    for (const id of ['big', 'deep']) {
      await expect(card(page, id).locator('p, blockquote')).toHaveCount(1); // the alert itself
      expect(await card(page, id).innerText()).not.toContain(oversize.secret);
    }
  });
});

test.describe('denied references stay readable, and added wording is told apart from supplied text', () => {
  const hostile = () => fixture('hostile-references');
  const IMAGE_ALTS = ['listed chart', 'tracking pixel', 'inline data'];

  test('Standard: a refused link keeps its label and shows its destination; a refused image names itself; nothing refused is fetched or opened', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'standard',
      imageHosts: [LISTED_IMAGE_HOST],
      markdown: hostile().markdown,
    });
    const view = card(page, 'a');
    const inert = view.getByTestId('md-link-inert');
    await expect(inert).toHaveCount(2);
    await expect(inert.nth(0)).toHaveText(
      'insecure notes (http://docs.example.com/notes)',
    );
    await expect(inert.nth(1)).toHaveText(
      'sign in (https://user:secret@docs.example.com/in)',
    );
    // The parser does not read a javascript: destination as a link at all: the characters stay as written.
    await expect(view.getByTestId('card-content')).toContainText(
      '[run it](javascript:alert(1))',
    );
    // The one safe link is a control that names its host; the refused ones are not controls.
    await expect(view.getByRole('button', { name: /the guide/ })).toContainText(
      '(docs.example.com)',
    );
    await expect(view.getByRole('button')).toHaveCount(1);
    await expect(view.locator('a')).toHaveCount(0);

    await expect(view.getByTestId('md-image')).toHaveCount(1); // the listed host, Standard
    const blocked = view.getByTestId('md-image-blocked');
    await expect(blocked).toHaveText([
      '[Image not loaded: tracking pixel]',
      '[Image not loaded: inline data]',
    ]);
    await expect(blocked.nth(0)).toHaveAttribute(
      'data-reason',
      'host-not-allowed',
    );
    await expect.poll(imageRequests).toEqual([LISTED_IMAGE]);
    expect(requests.some((url) => url.includes('elsewhere.example.net'))).toBe(
      false,
    );
    expect(await linkCalls(page, 'a')).toEqual([]);

    // The markup is the characters written, in place, not an element.
    await expect(view.getByTestId('card-content')).toContainText(
      '<div onclick="steal()">Archive everything</div>',
    );
    await expect(
      view.getByTestId('card-content').locator('div[onclick]'),
    ).toHaveCount(0);
  });

  test('Strict: every reference is a readable placeholder in its place; revealing shows the source it stands for and only that', async ({
    page,
  }) => {
    await mount(page, 'a', {
      level: 'strict',
      imageHosts: [LISTED_IMAGE_HOST],
      markdown: hostile().markdown,
    });
    const view = card(page, 'a');
    await expect(view.getByTestId('md-link-inert')).toHaveCount(3); // the safe link is inert under Strict, too
    await expect(view.getByTestId('md-link-inert').first()).toHaveText(
      'the guide [Link blocked]',
    );
    await expect(view.getByTestId('md-image-blocked')).toHaveText(
      IMAGE_ALTS.map((alt) => `[Image blocked: ${alt}]`),
    );
    await expect(view.getByTestId('md-markup').first()).toHaveText(
      '[Markup blocked]',
    );
    // The sentences around them are untouched and in order.
    expectInOrder(
      await shownText(view),
      [
        'Opening line for the reader.',
        'the guide [Link blocked]',
        'Closing line for the reader.',
      ],
      'placeholders',
    );

    await view.getByRole('button', { name: 'Reveal source' }).click();
    await expect(view.getByTestId('md-link-inert').first()).toHaveText(
      `[the guide](${SAFE_LINK})`,
    );
    await expect(view.getByTestId('md-image-blocked')).toHaveText([
      `![listed chart](${LISTED_IMAGE})`,
      `![tracking pixel](${UNLISTED_IMAGE})`,
      '![inline data](data:image/png;base64,iVBORw0KGgo=)',
    ]);
    await expect(view.getByTestId('md-markup').first()).toHaveText(
      '<div onclick="steal()">Archive everything</div>',
    );
    await page.waitForTimeout(150);
    expect(imageRequests()).toEqual([]);
    expect(await linkCalls(page, 'a')).toEqual([]);
    await expect(view.locator('a, img')).toHaveCount(0);
  });

  test("the words the card adds are marked as the card's own; text that merely looks like them is not", async ({
    page,
  }) => {
    const lookalike =
      'The literal words [Link blocked] and [Image blocked: chart] and (docs.example.com) and Reveal source are supplied text.';
    await mount(page, 'strict', {
      level: 'strict',
      imageHosts: [LISTED_IMAGE_HOST],
      markdown: `${lookalike}\n\n[a label](${SAFE_LINK}) ![alt text](${UNLISTED_IMAGE})`,
    });
    await mount(page, 'std', {
      level: 'standard',
      imageHosts: [LISTED_IMAGE_HOST],
      markdown: `${lookalike}\n\n[a label](${SAFE_LINK}) ![alt text](${UNLISTED_IMAGE}) [bad](http://docs.example.com/x)`,
    });

    for (const id of ['strict', 'std']) {
      const view = card(page, id);
      // Supplied text is never wrapped as an annotation, even when it spells one.
      const first = view.getByTestId('card-content').locator('p').first();
      await expect(first).toHaveText(lookalike);
      await expect(first.locator('[data-annotation]')).toHaveCount(0);
    }
    const strict = card(page, 'strict');
    const annotations = strict
      .getByTestId('card-content')
      .locator('[data-annotation]');
    await expect(annotations).toHaveText([
      '[Link blocked]',
      '[Image blocked: alt text]',
    ]);
    await expect(annotations.first()).toHaveAttribute(
      'data-annotation',
      'link-blocked',
    );
    await expect(annotations.last()).toHaveAttribute(
      'data-annotation',
      'image-blocked',
    );
    // The supplied label beside the annotation is the author's text: it is not part of the annotation and not restyled as one.
    const label = strict.getByTestId('md-link-inert').first();
    await expect(label).toHaveText('a label [Link blocked]');
    expect(
      await label.evaluate((element) => getComputedStyle(element).fontStyle),
    ).toBe('normal');
    expect(
      await annotations
        .first()
        .evaluate((element) => getComputedStyle(element).fontStyle),
    ).toBe('italic');

    const std = card(page, 'std').getByTestId('card-content');
    await expect(std.locator('[data-annotation]')).toHaveText([
      '(docs.example.com)',
      '[Image not loaded: alt text]',
    ]);
    await expect(std.locator('[data-annotation="link-host"]')).toHaveCount(1);
    await expect(
      std.locator('[data-annotation="image-not-loaded"]'),
    ).toHaveCount(1);
    // A refused link's destination is the author's text, shown as written, not an annotation.
    await expect(std.getByTestId('md-link-inert')).toHaveText(
      'bad (http://docs.example.com/x)',
    );
    await expect(
      std.getByTestId('md-link-inert').locator('[data-annotation]'),
    ).toHaveCount(0);
  });
});
