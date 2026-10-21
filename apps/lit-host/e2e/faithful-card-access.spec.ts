import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  LISTED_IMAGE_HOST,
  SAFE_LINK,
  VALID_DESCRIPTIONS,
  type ValidDescription,
} from '../../../packages/components/src/faithful-card/description-fixtures.test-support.js';
import { describeContentFailure } from '../../../packages/components/src/faithful-card/reader.js';
import { card, linkCalls, mount, nextFrame, openCardPage } from './faithful-card-harness.js';

// CARD2, using the card: the optional Lit FaithfulCard follows the host's theme, stays operable and
// announced for keyboard and screen-reader users, reflows at 320 CSS pixels and 200% zoom, and adds
// no motion. Local Chromium through Playwright, with emulated colour scheme, reduced motion and
// zoom. Nothing here claims how an actual host narrates the card or draws it.

test.beforeEach(async ({ page }) => {
  await openCardPage(page);
});

const fixture = (id: string): ValidDescription => {
  const found = VALID_DESCRIPTIONS.find((one) => one.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

/** A host's theme as an application would write it: its own colours, and optionally the card's seven tokens. */
const hostTheme = (withTokens: boolean) => `
  :root { color-scheme: light dark; background: #ffffff; color: #1b1b1b;
    ${withTokens ? '--saga-card-text-color: #1b1b1b; --saga-card-accent-color: #0b4f9c; --saga-card-muted-color: #555555; --saga-card-border-color: #767676; --saga-card-code-background: #ececec;' : ''} }
  @media (prefers-color-scheme: dark) {
    :root { background: #121212; color: #ececec;
      ${withTokens ? '--saga-card-text-color: #ececec; --saga-card-accent-color: #8ab4f8; --saga-card-muted-color: #b9b9b9; --saga-card-border-color: #8a8a8a; --saga-card-code-background: #2a2a2a;' : ''} }
  }`;

/** WCAG contrast of every piece of readable text in `root`, against the colour it is actually drawn on. */
async function contrastReport(root: Locator): Promise<{ measured: number; low: { what: string; ratio: number }[] }> {
  return root.evaluate((element) => {
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba => {
      const found = value.match(/rgba?\(([^)]+)\)/);
      if (!found) throw new Error(`unreadable colour ${value}`);
      const parts = (found[1] as string).split(/[ ,/]+/).filter(Boolean).map(Number);
      return [parts[0] as number, parts[1] as number, parts[2] as number, parts[3] ?? 1];
    };
    const over = (top: Rgba, below: Rgba): Rgba => {
      const alpha = top[3] + below[3] * (1 - top[3]);
      const mix = (a: number, b: number) => (alpha === 0 ? 0 : (a * top[3] + b * below[3] * (1 - top[3])) / alpha);
      return [mix(top[0], below[0]), mix(top[1], below[1]), mix(top[2], below[2]), alpha];
    };
    const background = (node: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let at: Element | null = node; at; at = at.parentElement) layers.push(parse(getComputedStyle(at).backgroundColor));
      let result: Rgba = [255, 255, 255, 1];
      for (const layer of layers.reverse()) result = over(layer, result);
      return result;
    };
    const luminance = ([r, g, b]: Rgba) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const selector = 'p, h3, h4, h5, h6, li, th, td, blockquote, pre code, code, button:not([disabled]), [data-annotation], .link-destination, [role="status"], [role="alert"]';
    const low: { what: string; ratio: number }[] = [];
    let measured = 0;
    for (const node of Array.from(element.querySelectorAll(selector))) {
      const own = Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '');
      if (!own) continue;
      const style = getComputedStyle(node);
      const text = parse(style.color);
      const behind = background(node);
      const drawn = over(text, behind);
      const value = ratio(drawn, behind);
      measured += 1;
      if (value < 4.5) low.push({ what: `${node.tagName.toLowerCase()}${node.getAttribute('data-testid') ? `[${node.getAttribute('data-testid')}]` : ''} "${(node.textContent ?? '').trim().slice(0, 30)}"`, ratio: Math.round(value * 100) / 100 });
    }
    return { measured, low };
  });
}

test.describe('light and dark follow the host, not the card', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const withTokens of [true, false]) {
      test(`${scheme}, ${withTokens ? 'with the card\'s tokens' : 'with only the host\'s own colours'}: text stays readable in Standard and Strict`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.addStyleTag({ content: hostTheme(withTokens) });
        const hostile = fixture('hostile-references');
        const mixed = fixture('structured');
        await mount(page, 'standard', { level: 'standard', imageHosts: [LISTED_IMAGE_HOST], markdown: `${hostile.markdown}\n\n---\n\n${mixed.markdown}`, dialect: 'commonmark-tables-strikethrough', maxLength: 50_000, links: 'unavailable' });
        await mount(page, 'strict', { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: `${hostile.markdown}\n\n---\n\n${mixed.markdown}`, dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 });
        for (const id of ['standard', 'strict']) await expect(card(page, id).getByTestId('card-content')).toBeVisible();
        await card(page, 'strict').getByRole('button', { name: 'Show images' }).click();
        await card(page, 'strict').getByRole('button', { name: 'Reveal source' }).click();
        await card(page, 'standard').getByRole('button', { name: /the guide/ }).click();
        await expect(card(page, 'standard').getByTestId('md-link-status')).not.toHaveText('');

        // The card's text is the host's text colour in both schemes: with a token, the token; without, what it inherits.
        const expected = scheme === 'dark' ? 'rgb(236, 236, 236)' : 'rgb(27, 27, 27)';
        for (const id of ['standard', 'strict']) {
          expect(await card(page, id).locator('p').first().evaluate((element) => getComputedStyle(element).color)).toBe(expected);
          const report = await contrastReport(card(page, id));
          expect(report.measured, id).toBeGreaterThan(10);
          expect(report.low, `${id} under ${scheme}`).toEqual([]);
        }
      });
    }
  }

  test('the card draws no colour of its own that fights the host: no fixed text or background, only the host\'s through inheritance and tokens', async ({ page }) => {
    await page.addStyleTag({ content: hostTheme(false) });
    await mount(page, 'a', { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: fixture('hostile-references').markdown });
    const own = await card(page, 'a').evaluate((root) => {
      const hostText = getComputedStyle(document.documentElement).color;
      const fixed: string[] = [];
      for (const node of Array.from(root.querySelectorAll('p, h3, li, [data-annotation], .link-destination, button'))) {
        const style = getComputedStyle(node);
        if (node.matches('button:not(.link-button)')) continue; // native controls keep the browser's own scheme-aware colours
        if (style.color !== hostText) fixed.push(`${node.tagName.toLowerCase()} ${style.color}`);
      }
      return fixed;
    });
    expect(own).toEqual([]);
  });
});

test.describe('focus, keyboard and announcements', () => {
  const hostile = () => fixture('hostile-references').markdown;
  const outlineOf = (locator: Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), visible: element.matches(':focus-visible') };
    });

  test('every operable thing shows a focus indicator when reached by keyboard, in both colour schemes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await mount(page, `std-${scheme}`, { level: 'standard', dialect: 'commonmark-tables-strikethrough', maxLength: 50_000, markdown: `${hostile()}\n\n| A | B | C | D | E | F | G | H |\n|---|---|---|---|---|---|---|---|\n| ${'wide cell '.repeat(14)} | b | c | d | e | f | g | h |` });
      await mount(page, `strict-${scheme}`, { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: hostile() });
    }
    for (const id of ['std-light', 'std-dark']) {
      await card(page, id).getByRole('button', { name: /the guide/ }).focus();
      await page.keyboard.press('Tab'); // leaves the link for the table region (the only other stop)
      const region = card(page, id).getByRole('region', { name: 'Table 1' });
      await expect(region).toBeFocused();
      expect(await outlineOf(region)).toMatchObject({ style: expect.not.stringMatching(/^none$/), visible: true });
      expect((await outlineOf(region)).width).toBeGreaterThan(0);
      await card(page, id).getByRole('button', { name: /the guide/ }).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      expect((await outlineOf(card(page, id).getByRole('button', { name: /the guide/ }))).width).toBeGreaterThan(0);
    }
    for (const id of ['strict-light', 'strict-dark']) {
      for (const name of ['Reveal source', 'Show images']) {
        await card(page, id).getByRole('button', { name }).focus();
        const outline = await outlineOf(card(page, id).getByRole('button', { name }));
        expect(outline.style, `${id} ${name}`).not.toBe('none');
        expect(outline.width, `${id} ${name}`).toBeGreaterThan(0);
      }
    }
  });

  test('a keyboard reader steps through Strict controls in reading order and keeps focus on the control they used', async ({ page }) => {
    await mount(page, 'a', { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: hostile() });
    const view = card(page, 'a');
    await view.getByRole('button', { name: 'Reveal source' }).focus();
    await page.keyboard.press('Space');
    await expect(view.getByRole('button', { name: 'Hide source' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(view.getByRole('button', { name: 'Show images' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(view.getByRole('button', { name: 'Hide images' })).toBeFocused();
    await expect(view.getByTestId('images-status')).toHaveText('Images shown.');
    await page.keyboard.press('Enter');
    await expect(view.getByRole('button', { name: 'Show images' })).toBeFocused();
    await expect(view.getByTestId('md-image')).toHaveCount(0);
    // Nothing in the supplied text is a stop of its own: Strict makes every link inert.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement === document.body || !document.activeElement?.closest('[data-card-id="a"] [data-testid="card-content"]'))).toBe(true);
  });

  test('status regions exist before they speak, so a screen reader hears the change; failures are alerts', async ({ page }) => {
    await mount(page, 'std', { level: 'standard', links: 'denied', markdown: `Read [the guide](${SAFE_LINK}).` });
    await mount(page, 'strict', { level: 'strict', imageHosts: [LISTED_IMAGE_HOST], markdown: `See ![chart](https://${LISTED_IMAGE_HOST}/chart.png).` });

    const status = card(page, 'std').getByTestId('md-link-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveText('');
    const before = await status.elementHandle();
    await card(page, 'std').getByRole('button', { name: /the guide/ }).click();
    await expect(status).toContainText('The host did not open this link.');
    expect(await before?.evaluate((element, current) => element === current, await status.elementHandle())).toBe(true); // the same node was updated, not replaced
    expect(await linkCalls(page, 'std')).toEqual([SAFE_LINK]);

    const images = card(page, 'strict').getByTestId('images-status');
    await expect(images).toHaveAttribute('role', 'status');
    await expect(images).toHaveText('');
    const imagesBefore = await images.elementHandle();
    await card(page, 'strict').getByRole('button', { name: 'Show images' }).click();
    await expect(images).toHaveText('Images shown.');
    expect(await imagesBefore?.evaluate((element, current) => element === current, await images.elementHandle())).toBe(true);

    await page.evaluate(() => window.cards?.std?.set('refused', 9));
    await expect(card(page, 'std').getByRole('alert')).toHaveText(describeContentFailure({ kind: 'unsupported-version' }));
  });

  test('the structure a screen reader meets: headings from level 3, a named table region, column headers, list items and quotes', async ({ page }) => {
    const description = fixture('structured');
    await mount(page, 'a', { level: 'standard', dialect: description.dialect, maxLength: 50_000, markdown: description.markdown });
    await expect(card(page, 'a').getByTestId('card-content')).toMatchAriaSnapshot(`
      - heading "Reading plan" [level=3]
      - paragraph
      - region "Table 1":
        - table:
          - rowgroup:
            - row "Day Reading Pages":
              - columnheader "Day"
              - columnheader "Reading"
              - columnheader "Pages"
          - rowgroup:
            - row "Monday Opening 1–12":
              - cell "Monday"
              - cell "Opening"
              - cell "1–12"
            - row "Tuesday Middle 13–40"
      - code: /plain code line one/
      - separator
      - paragraph: After the rule, the last paragraph.
    `);
    // Strikethrough keeps its text; deletion is not lost to a screen reader that ignores the element.
    await expect(card(page, 'a').locator('s')).toHaveText('a retracted claim');
  });
});

test.describe('narrow screens, 200% zoom and long content', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  async function zoomTo200(page: Page): Promise<void> {
    // A 640-pixel window at 200% browser zoom is 320 CSS pixels at twice the device density, and
    // text zoom doubles the text. Both are applied: layout width, density and font size.
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: false });
    await page.addStyleTag({ content: 'body { font-size: 32px; }' });
  }

  /** Everything readable stays inside the viewport, wraps instead of clipping, and scrolls only inside its own region. */
  const layoutProblems = (page: Page, id: string) =>
    page.evaluate((cardId) => {
      const problems: string[] = [];
      const width = window.innerWidth;
      if (document.documentElement.scrollWidth > width) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${width}`);
      const root = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement;
      for (const node of Array.from(root.querySelectorAll('p, h3, h4, h5, h6, li, blockquote, button, .table-scroll, pre, [role="status"]'))) {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0) continue;
        const name = `${node.tagName.toLowerCase()} "${(node.textContent ?? '').trim().slice(0, 24)}"`;
        if (rect.left < -0.5 || rect.right > width + 0.5) problems.push(`${name} leaves the viewport: ${Math.round(rect.left)}..${Math.round(rect.right)}`);
        // Wrapping text is never clipped: only a table region or a code block may be wider than itself, and they scroll.
        const scrolls = node.matches('.table-scroll, pre');
        if (!scrolls && node.scrollWidth > node.clientWidth + 1) problems.push(`${name} clips its text: ${node.scrollWidth} > ${node.clientWidth}`);
      }
      return problems;
    }, id);

  for (const zoomed of [false, true]) {
    for (const description of VALID_DESCRIPTIONS) {
      for (const level of ['standard', 'strict'] as const) {
        test(`${description.id} under ${level} at 320px${zoomed ? ' and 200% zoom' : ''} reflows without clipping or sideways page scroll`, async ({ page }) => {
          if (zoomed) await zoomTo200(page);
          await mount(page, 'a', { level, imageHosts: [LISTED_IMAGE_HOST], dialect: description.dialect, maxLength: 50_000, markdown: description.markdown });
          await expect(card(page, 'a').getByTestId('card-content')).toBeVisible();
          if (level === 'strict') {
            const reveal = card(page, 'a').getByRole('button', { name: 'Reveal source' });
            if ((await reveal.count()) > 0) await reveal.click();
          }
          expect(await layoutProblems(page, 'a')).toEqual([]);
          if (zoomed) {
            const size = await card(page, 'a').locator('p').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
            expect(size, 'the card follows the host\'s text size').toBe(32);
          }
        });
      }
    }
  }

  test('wide tables and code scroll inside their own focusable region, and the controls stay reachable at 200% zoom', async ({ page }) => {
    await zoomTo200(page);
    const description = fixture('unbroken-long');
    await mount(page, 'a', { level: 'standard', dialect: description.dialect, maxLength: 50_000, markdown: description.markdown });
    const region = card(page, 'a').getByRole('region', { name: 'Table 1' });
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const link = card(page, 'a').getByRole('button', { name: /LongLabel/ });
    await link.scrollIntoViewIfNeeded();
    await link.click();
    expect((await linkCalls(page, 'a')).length).toBe(1);
    expect(await layoutProblems(page, 'a')).toEqual([]);
  });
});

test.describe('motion', () => {
  const animated = (page: Page) =>
    page.evaluate(() => {
      const root = document.querySelector('[data-card-id="a"]') as HTMLElement;
      const moving = document.getAnimations().filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && root.contains(target);
      }).length;
      const styled = Array.from(root.querySelectorAll('*')).filter((node) => {
        const style = getComputedStyle(node);
        return style.animationName !== 'none' || style.transitionDuration.split(',').some((duration) => parseFloat(duration) > 0);
      }).length;
      const smooth = Array.from(root.querySelectorAll('*')).filter((node) => getComputedStyle(node).scrollBehavior === 'smooth').length;
      return { moving, styled, smooth };
    });

  const still = { moving: 0, styled: 0, smooth: 0 };

  for (const preference of ['reduce', 'no-preference'] as const) {
    for (const level of ['standard', 'strict'] as const) {
      test(`${level} with ${preference} motion: the card animates and transitions nothing, through every interaction`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: preference });
        const description = fixture('hostile-references');
        const table = `| A | B | C | D | E | F |\n|---|---|---|---|---|---|\n| ${'wide cell '.repeat(30)} | b | c | d | e | f |`;
        await mount(page, 'a', { level, imageHosts: [LISTED_IMAGE_HOST], dialect: 'commonmark-tables-strikethrough', maxLength: 50_000, links: 'denied', markdown: `${description.markdown}\n\n${table}` });
        const view = card(page, 'a');
        expect(await animated(page)).toEqual(still);
        if (level === 'strict') {
          await view.getByRole('button', { name: 'Reveal source' }).click();
          expect(await animated(page)).toEqual(still);
          await view.getByRole('button', { name: 'Show images' }).click();
          await expect(view.getByTestId('images-status')).toHaveText('Images shown.');
        } else {
          await view.getByRole('button', { name: /the guide/ }).click();
          await expect(view.getByTestId('md-link-status')).not.toHaveText('');
        }
        expect(await animated(page)).toEqual(still);
        const region = view.getByRole('region', { name: 'Table 1' });
        await region.focus();
        await page.keyboard.press('ArrowRight');
        await nextFrame(page);
        expect(await animated(page)).toEqual(still);
      });
    }
  }
});
