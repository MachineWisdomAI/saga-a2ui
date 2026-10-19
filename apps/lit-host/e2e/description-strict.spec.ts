import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  cleanupServedResources,
  IMAGE,
  IMAGE_HOST,
  imageRequests,
  open,
  serveResource,
  type Opened,
  type OpenOptions,
} from './description-harness.js';

// The Strict level, driven through the built view in the local host fixture. A blocked fragment
// is proved inert by the absence of a network request or host callback, never by its source text.

test.afterEach(cleanupServedResources);

const LINK = 'https://docs.example.com/guide';
const ORDINARY = [
  'Intro with *emphasis*.',
  '',
  `> A quotation with a [link](${LINK}).`,
  '',
  `A picture: ![chart](${IMAGE}) and <b>markup</b>.`,
].join('\n');

const strict = (options: Partial<OpenOptions> = {}): OpenOptions => ({
  level: 'strict',
  imageHosts: [IMAGE_HOST],
  description: ORDINARY,
  hostLinks: 'allow',
  ...options,
});

/** Lets any request the view would still make arrive before the absence of one is asserted. */
const settle = (page: Page) => page.waitForTimeout(300);

const sendDescription = (frame: Frame, value: string) =>
  frame.evaluate(
    (description) =>
      window.sagaSend?.({ version: 'v0.9', updateDataModel: { surfaceId: 'fixture', path: '/description', value: description } }),
    value,
  );

test.describe('Strict blocked fragments', () => {
  test('default to accessible placeholders in their original positions, with no request and no callback', async ({ page }) => {
    const { view, requests, openLinkCalls, navigations } = await open(page, strict());
    const content = view.getByTestId('card-content');
    await expect(content.locator('p').first()).toHaveText('Intro with emphasis.');
    // The link stays inside the quotation and the image and markup stay in the last paragraph.
    const quote = content.locator('blockquote');
    await expect(quote).toContainText('A quotation with a');
    await expect(quote.getByTestId('md-link-inert')).toHaveText(/\[Link blocked\]/);
    await expect(quote.getByTestId('md-link-inert')).toHaveAttribute('data-presentation', 'placeholder');
    const last = content.locator('p').last();
    await expect(last).toContainText('A picture:');
    await expect(last.getByTestId('md-image-blocked')).toHaveText('[Image blocked: chart]');
    await expect(last.getByTestId('md-markup').first()).toHaveText('[Markup blocked]');
    await expect(last).toContainText('markup');
    expect(await content.evaluate((element) => Array.from(element.children, (child) => child.tagName))).toEqual([
      'P',
      'BLOCKQUOTE',
      'P',
    ]);
    await expect(content.locator('a, img, button')).toHaveCount(0);
    await settle(page);
    expect(requests).toEqual([]);
    expect(openLinkCalls).toEqual([]);
    expect(navigations).toEqual([]);
  });

  test('can be revealed and hidden as inert text from the keyboard, causing no effect', async ({ page }) => {
    const { view, requests, openLinkCalls, navigations } = await open(page, strict());
    const content = view.getByTestId('card-content');
    const toggle = view.getByRole('button', { name: 'Reveal source' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(view.getByRole('button', { name: 'Hide source' })).toBeFocused();

    await expect(content).toContainText(`[link](${LINK})`);
    await expect(content).toContainText(`![chart](${IMAGE})`);
    await expect(content).toContainText('<b>');
    await expect(content.getByTestId('md-link-inert')).toHaveAttribute('data-presentation', 'source');
    await expect(content.locator('a, img, b')).toHaveCount(0);
    await content.getByTestId('md-link-inert').click();
    await settle(page);
    expect(requests).toEqual([]);
    expect(openLinkCalls).toEqual([]);
    expect(navigations).toEqual([]);

    await view.getByRole('button', { name: 'Hide source' }).focus();
    await page.keyboard.press('Space');
    await expect(view.getByRole('button', { name: 'Reveal source' })).toBeFocused();
    await expect(content.getByTestId('md-link-inert')).toHaveAttribute('data-presentation', 'placeholder');
    await expect(content).not.toContainText(LINK);
  });

  test('can start as readable inert text when the trusted application chooses it', async ({ page }) => {
    const { view, requests } = await open(page, strict({ blockedPresentation: 'inert-text' }));
    const content = view.getByTestId('card-content');
    await expect(content).toContainText(`[link](${LINK})`);
    await expect(content.getByTestId('md-image-blocked')).toHaveAttribute('data-presentation', 'source');
    await view.getByRole('button', { name: 'Hide source' }).click();
    await expect(content.getByTestId('md-image-blocked')).toHaveAttribute('data-presentation', 'placeholder');
    await expect(content).not.toContainText(IMAGE);
    expect(requests).toEqual([]);
  });

  test('offers no source control for a description with nothing to block', async ({ page }) => {
    const { view } = await open(page, strict({ description: 'Just *words*.' }));
    await expect(view.getByTestId('card-content')).toHaveText('Just words.');
    await expect(view.getByRole('button')).toHaveCount(0);
  });

  test('hostile HTML, scripts and invalid URLs stay inert before and after reveal and consent', async ({ page }) => {
    const description =
      '<script>window.__pwned = 1</script><img src="https://images.example.com/x.png" onerror="window.__pwned = 2">\n\n' +
      '[js](javascript:window.__pwned=3) [data](data:text/html,hi) [cred](https://u:p@images.example.com/)\n\n' +
      `![suffix](https://${IMAGE_HOST}.evil.test/s.png) ![sub](https://a.${IMAGE_HOST}/s.png) ` +
      `![plain](http://${IMAGE_HOST}/p.png) ![cred](https://u:p@${IMAGE_HOST}/c.png) ![port](https://${IMAGE_HOST}:8443/p.png)`;
    const { view, frame, requests, openLinkCalls } = await open(page, strict({ description }));
    const content = view.getByTestId('card-content');
    const pwned = () => frame.evaluate(() => (window as unknown as { __pwned?: number }).__pwned);

    await view.getByRole('button', { name: 'Reveal source' }).click();
    await expect(content).toContainText('<script>window.__pwned = 1</script>');
    await expect(content).toContainText('[js](javascript:window.__pwned=3)');
    await expect(view.getByTestId('images-toggle')).toBeDisabled();
    await content.getByTestId('md-link-inert').first().click();
    await settle(page);
    expect(await pwned()).toBeUndefined();
    expect(requests).toEqual([]);
    expect(openLinkCalls).toEqual([]);
    await expect(content.locator('script, a, img, b, button')).toHaveCount(0);
  });
});

test.describe('Show images', () => {
  test('requests nothing before consent, even after source reveal, and afterwards only the permitted image', async ({ page }) => {
    const description = [
      `Permitted ![ok](${IMAGE}) [link](${LINK})`,
      '',
      `![suffix](https://${IMAGE_HOST}.evil.test/s.png) ![sub](https://a.${IMAGE_HOST}/sub.png) ![port](https://${IMAGE_HOST}:8443/p.png)`,
      `![cred](https://user:pw@${IMAGE_HOST}/c.png) ![plain](http://${IMAGE_HOST}/p.png)`,
    ].join('\n');
    const { view, requests, openLinkCalls } = await open(page, strict({ description }));
    const content = view.getByTestId('card-content');
    const show = view.getByRole('button', { name: 'Show images' });

    await view.getByRole('button', { name: 'Reveal source' }).click();
    await expect(show).toBeEnabled();
    await settle(page);
    expect(requests).toEqual([]); // source reveal grants no consent

    await show.focus();
    await page.keyboard.press('Enter');
    await expect(view.getByRole('button', { name: 'Hide images' })).toBeFocused();
    const loaded = content.getByTestId('md-image');
    await expect(loaded).toHaveCount(1);
    await expect.poll(() => loaded.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    await expect(content.getByTestId('md-image-blocked')).toHaveCount(5);
    await settle(page);
    expect(requests).toEqual([IMAGE]);
    expect(imageRequests(requests)).toEqual([IMAGE]);

    // Consent to images grants no link: the link is still inert text and never reaches the host.
    await expect(content.getByTestId('md-link-inert')).toHaveCount(1);
    await content.getByTestId('md-link-inert').click();
    await settle(page);
    expect(openLinkCalls).toEqual([]);
  });

  test('is disabled with unavailable feedback, and requests nothing, when no image qualifies', async ({ page }) => {
    const { view, requests } = await open(page, strict({ description: `![elsewhere](https://other.example.net/a.png) text` }));
    const toggle = view.getByTestId('images-toggle');
    await expect(toggle).toHaveText('Show images');
    await expect(toggle).toBeDisabled();
    await expect(view.getByTestId('images-unavailable')).toContainText('cannot be shown');
    await settle(page);
    expect(requests).toEqual([]);
  });

  test('is disabled under an empty allowlist, even for an https image', async ({ page }) => {
    const { view, requests } = await open(page, strict({ imageHosts: [] }));
    await expect(view.getByTestId('images-toggle')).toBeDisabled();
    await expect(view.getByTestId('images-unavailable')).toBeVisible();
    await settle(page);
    expect(requests).toEqual([]);
  });

  test('is disabled when the document does not carry the derived restrictions', async ({ page }) => {
    const { view, requests } = await open(
      page,
      strict({ transformHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '') }),
    );
    await expect(view.getByTestId('images-toggle')).toBeDisabled();
    await expect(view.getByTestId('md-image-blocked').first()).toHaveAttribute('data-reason', 'enforcement-unestablished');
    await settle(page);
    expect(requests).toEqual([]);
  });

  test('is not offered when the description has no image', async ({ page }) => {
    const { view } = await open(page, strict({ description: `A [link](${LINK}) only.` }));
    await expect(view.getByTestId('images-toggle')).toHaveCount(0);
  });

  test('does not follow a redirect from the listed host to an undeclared one', async ({ page }) => {
    const { view, requests } = await open(page, strict({ description: `![bounce](https://${IMAGE_HOST}/redirect-out.png)` }));
    await view.getByRole('button', { name: 'Show images' }).click();
    await expect(view.getByTestId('md-image-blocked')).toHaveAttribute('data-reason', 'load-failed');
    expect(requests).toEqual([`https://${IMAGE_HOST}/redirect-out.png`]);
  });
});

test.describe('revoking consent', () => {
  async function grant(opened: Opened): Promise<void> {
    await opened.view.getByRole('button', { name: 'Show images' }).click();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(1);
    await expect.poll(() => imageRequests(opened.requests).length).toBe(1);
  }

  test('Hide images removes the image and revokes consent; it cannot undo the request already sent', async ({ page }) => {
    const opened = await open(page, strict());
    await grant(opened);
    await opened.view.getByRole('button', { name: 'Hide images' }).click();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();
    await expect(opened.view.getByTestId('md-image-blocked')).toHaveAttribute('data-reason', 'consent-required');
    await settle(page);
    expect(imageRequests(opened.requests)).toEqual([IMAGE]);
  });

  test('a late image result after Hide images cannot bring the image back', async ({ page }) => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    const opened = await open(page, strict());
    await page.route(IMAGE, async (route) => {
      asked += 1;
      await gate;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    });
    await opened.view.getByRole('button', { name: 'Show images' }).click();
    await expect.poll(() => asked).toBe(1);
    await opened.view.getByRole('button', { name: 'Hide images' }).click();
    release?.();
    await settle(page);
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();
  });

  test('a description change removes the images, and new content needs fresh consent', async ({ page }) => {
    const opened = await open(page, strict());
    await grant(opened);
    const next = `A different picture: ![chart](${IMAGE})`;
    await sendDescription(opened.frame, next);
    await expect(opened.view.getByTestId('card-content')).toContainText('A different picture');
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();
    await settle(page);
    expect(imageRequests(opened.requests)).toEqual([IMAGE]); // none for the new content

    await opened.view.getByRole('button', { name: 'Show images' }).click();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(1);
  });

  test('a new selection revokes consent even when its description is identical', async ({ page }) => {
    const opened = await open(page, strict({ description: () => ORDINARY }));
    await grant(opened);
    await opened.deliverEpisode('ep-2');
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();
    await settle(page);
    expect(imageRequests(opened.requests)).toEqual([IMAGE]);
  });

  test('host teardown removes the displayed images', async ({ page }) => {
    const opened = await open(page, strict());
    await grant(opened);
    await opened.teardown();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
  });

  test('host teardown retires consent for good: the remaining control cannot grant, and no request follows', async ({ page }) => {
    const opened = await open(page, strict({ description: `A picture: ![late](https://${IMAGE_HOST}/after-teardown.png)` }));
    const toggle = opened.view.getByTestId('images-toggle');
    await expect(toggle).toBeEnabled();
    await opened.teardown();
    await expect(toggle).toBeDisabled();
    await expect(opened.view.getByTestId('images-unavailable')).toHaveAttribute('data-reason', 'view-ended');
    // Even if the disabled state were bypassed, the retired view hands out no live grant.
    await toggle.evaluate((element) => {
      element.removeAttribute('disabled');
      (element as HTMLElement).click();
    });
    await settle(page);
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    expect(imageRequests(opened.requests)).toEqual([]);
  });

  test('a legitimate selection change still allows fresh consent in a live view', async ({ page }) => {
    const opened = await open(page, strict({ description: () => ORDINARY }));
    await opened.deliverEpisode('ep-2');
    await opened.view.getByRole('button', { name: 'Show images' }).click();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(1);
    await expect.poll(() => imageRequests(opened.requests)).toEqual([IMAGE]);
  });

  test('a control kept from a replaced description cannot grant consent for the replacement', async ({ page }) => {
    const replacement = `https://${IMAGE_HOST}/replacement.png`;
    const opened = await open(page, strict());
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();
    const retained = await opened.view.getByTestId('images-toggle').elementHandle();
    if (retained === null) throw new Error('the Show images control was not rendered');
    await sendDescription(opened.frame, 'Plain text, no picture');
    await expect(opened.view.getByTestId('images-toggle')).toHaveCount(0);
    expect(await retained.evaluate((element) => element.isConnected)).toBe(false);
    await sendDescription(opened.frame, `Another picture: ![next](${replacement})`);
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();

    await retained.evaluate((element) => (element as HTMLElement).click());
    await settle(page);
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    expect(imageRequests(opened.requests)).toEqual([]); // the replacement was never consented to

    // Its own fresh control still works.
    await opened.view.getByRole('button', { name: 'Show images' }).click();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(1);
    await expect.poll(() => imageRequests(opened.requests)).toEqual([replacement]);
  });

  test('a replaced view starts without consent, and the old view cannot lend its own', async ({ page }) => {
    const opened = await open(page, strict());
    await grant(opened);
    await page.evaluate((resource) => window.mountView?.(resource), opened.resource);
    await opened.deliverEpisode('ep-1');
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    await settle(page);
    expect(imageRequests(opened.requests)).toEqual([IMAGE]); // the replacement made no request
  });

  test('a result with a problem removes the images, and the next valid one needs fresh consent', async ({ page }) => {
    const opened = await open(page, strict());
    await grant(opened);
    await page.evaluate(() => window.deliverToolResult?.({ content: [], isError: true }));
    await expect(opened.view.getByTestId('view-problem')).toBeVisible();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
    await opened.deliverEpisode('ep-1');
    await expect(opened.view.getByRole('button', { name: 'Show images' })).toBeVisible();
    await expect(opened.view.getByTestId('md-image')).toHaveCount(0);
  });
});

test.describe('concurrent views', () => {
  async function secondPage(page: Page): Promise<Page> {
    return page.context().newPage();
  }

  test('one Strict view cannot inherit, keep or lose another one\'s consent', async ({ page }) => {
    const a = await open(page, strict());
    const b = await open(await secondPage(page), strict());
    await a.view.getByRole('button', { name: 'Show images' }).click();
    await expect(a.view.getByTestId('md-image')).toHaveCount(1);
    await settle(page);
    expect(b.requests).toEqual([]);
    await expect(b.view.getByTestId('md-image')).toHaveCount(0);
    await expect(b.view.getByRole('button', { name: 'Show images' })).toBeVisible();

    await b.view.getByRole('button', { name: 'Show images' }).click();
    await expect(b.view.getByTestId('md-image')).toHaveCount(1);
    await sendDescription(a.frame, 'Replaced, no picture');
    await expect(a.view.getByTestId('md-image')).toHaveCount(0);
    await settle(page);
    await expect(b.view.getByTestId('md-image')).toHaveCount(1);
    await a.teardown();
    await expect(b.view.getByTestId('md-image')).toHaveCount(1);
  });

  test('Standard and Strict views keep their own policy and callback while updates and disposal interleave', async ({ page }) => {
    const standard = await open(page, strict({ level: 'standard' }));
    const stricter = await open(await secondPage(page), strict());

    // Standard loads its listed image and sends the link through its host callback.
    await expect(standard.view.getByTestId('md-image')).toHaveCount(1);
    await standard.view.getByRole('button', { name: /link/ }).click();
    await expect.poll(() => standard.openLinkCalls).toEqual([LINK]);
    // The Strict view beside it neither loads the image nor calls its host.
    await expect(stricter.view.getByTestId('md-image')).toHaveCount(0);
    expect(stricter.requests).toEqual([]);
    expect(stricter.openLinkCalls).toEqual([]);

    await sendDescription(standard.frame, `Standard update ![chart](${IMAGE}) [link](${LINK})`);
    await sendDescription(stricter.frame, `Strict update ![chart](${IMAGE}) [link](${LINK})`);
    await expect(standard.view.getByTestId('md-image')).toHaveCount(1);
    await expect(stricter.view.getByTestId('md-image')).toHaveCount(0);
    await stricter.view.getByRole('button', { name: 'Show images' }).click();
    await expect(stricter.view.getByTestId('md-image')).toHaveCount(1);

    await standard.teardown();
    await expect(stricter.view.getByTestId('md-image')).toHaveCount(1);
    await expect(stricter.view.getByTestId('md-link-inert')).toHaveCount(1);
    await stricter.teardown();
    await expect(standard.view.getByRole('button', { name: /link/ })).toBeVisible();
  });
});

test.describe('the built resource', () => {
  test('carries the Strict policy it was built from, under its own identity, with the same declared metadata', async ({ page }) => {
    const standard = await serveResource({ description: 'x', imageHosts: [IMAGE_HOST] });
    const strictResource = await serveResource({ description: 'x', imageHosts: [IMAGE_HOST], level: 'strict' });
    expect(strictResource.resource.csp).toEqual(standard.resource.csp);
    expect(strictResource.resource.html).not.toBe(standard.resource.html);

    const { frame } = await open(page, { description: 'x', imageHosts: [IMAGE_HOST], level: 'strict' });
    const embedded = await frame.evaluate(() => document.getElementById('saga-content-policy')?.textContent);
    expect(JSON.parse(embedded ?? 'null')).toEqual({
      level: 'strict',
      imageHosts: [IMAGE_HOST],
      fontOrigins: [],
      blockedPresentation: 'placeholder',
    });
  });

  test('an invalid embedded presentation fails before anything is mounted', async ({ page }) => {
    const { view, requests } = await open(page, {
      ...strict(),
      expectStart: false,
      transformHtml: (html) => html.replace('"blockedPresentation":"placeholder"', '"blockedPresentation":"collapsed"'),
    });
    await expect(view.getByTestId('view-problem')).toContainText('This view cannot start');
    await expect(view.locator('a2ui-surface')).toHaveCount(0);
    await settle(page);
    expect(requests).toEqual([]);
  });

  test('keeps images, scripts and the other resource kinds as restricted as Standard', async ({ page }) => {
    const { frame, requests } = await open(page, strict({ description: 'text' }));
    const violations = await frame.evaluate(
      (host) =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          document.addEventListener('securitypolicyviolation', (event) => seen.push(event.effectiveDirective));
          const script = document.createElement('script');
          script.src = `https://${host}/probe.js`;
          document.head.append(script);
          const audio = document.createElement('audio');
          audio.src = `https://${host}/probe.mp3`;
          document.body.append(audio);
          audio.load();
          fetch(`https://${host}/data.json`).catch(() => undefined);
          setTimeout(() => resolve(seen), 800);
        }),
      IMAGE_HOST,
    );
    expect([...new Set(violations)].sort()).toEqual(['connect-src', 'media-src', 'script-src-elem']);
    expect(requests).toEqual([]);
  });
});
