import { readFile } from 'node:fs/promises';
import {
  createContentPolicy,
  embedContentPolicy,
  resourcePermissionsOf,
} from '@saga-a2ui/components/faithful-card';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { builtUrl } from './built-artifacts.js';
import {
  PROBE_ERROR_TEXT,
  PROBE_TEXTS,
  PROBE_UNSUPPORTED,
} from './card-app-stack/texts.js';
import type { HostedResource } from './host-fixture/host.js';

// The card application stacks in a real browser: `startFaithfulCardApp` of the React stack and of the
// Lit stack, each in a probe page mounted in the local host fixture's sandboxed iframe and driven
// over a real AppBridge. The probe appends one line per application callback, so the specification
// reads the order in which the callbacks ran, and the page itself shows what a reader would see.
// Both stacks run the same scenarios. The host fixture is not evidence of any actual host.

const HOST = 'local-host-fixture';
const STACKS = ['react', 'lit'] as const;

const answer = (text: string, question?: string) => ({
  content: [{ type: 'text' as const, text: 'result' }],
  structuredContent: {
    answer: text,
    ...(question === undefined ? {} : { question }),
  },
});
const invalidPolicy =
  '<script id="saga-content-policy" type="application/json">{"level":"nope"}</script>';

interface Mounted {
  readonly frame: Frame;
  readonly lines: () => Promise<string[]>;
  readonly status: () => Promise<string | null>;
  readonly cardText: () => Promise<string>;
  readonly click: (testId: string) => Promise<void>;
}

for (const stack of STACKS) {
  test.describe(`the ${stack} stack`, () => {
    let page: string;
    test.beforeAll(async () => {
      page = await readFile(builtUrl(`card-app-stack/${stack}.html`), 'utf8');
    });

    async function mount(
      pageUnderTest: Page,
      options: Parameters<NonNullable<Window['mountView']>>[1] = {},
      transform: (html: string) => string = (html) => html,
      awaitHandshake = true,
      resourceDomains: readonly string[] = [],
    ): Promise<Mounted> {
      await pageUnderTest.goto('/host-fixture/index.html');
      const resource: HostedResource = {
        html: transform(page),
        csp: { connectDomains: [], resourceDomains: [...resourceDomains] },
      };
      const arg = { hosted: resource, mountOptions: options } as never as {
        hosted: HostedResource;
        mountOptions: unknown;
      };
      const mounting = pageUnderTest
        .evaluate(
          ({ hosted, mountOptions }) =>
            window.mountView?.(hosted, mountOptions as never),
          arg,
        )
        // A view that never connects leaves this pending; the test ending is not its failure.
        .catch((error: unknown) => {
          if (awaitHandshake) throw error;
        });
      if (awaitHandshake) await mounting;
      else await pageUnderTest.waitForSelector('iframe[title="MCP App view"]');
      const handle = await pageUnderTest
        .locator('iframe[title="MCP App view"]')
        .elementHandle();
      const frame = await handle?.contentFrame();
      if (!frame) throw new Error('the probe did not mount');
      const view = pageUnderTest.frameLocator('iframe[title="MCP App view"]');
      return {
        frame,
        lines: () => view.getByTestId('log').locator('li').allInnerTexts(),
        status: () => view.getByTestId('status').textContent({ timeout: 2000 }),
        cardText: async () =>
          (
            (await view
              .getByTestId('card-content')
              .textContent({ timeout: 2000 })
              .catch(() => '')) ?? ''
          ).trim(),
        click: (testId) => view.getByTestId(testId).click(),
      };
    }

    /** The log has settled: it equals `expected` and stays that way. */
    async function settledAs(
      mounted: Mounted,
      expected: string[],
    ): Promise<void> {
      await expect.poll(mounted.lines).toEqual(expected);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await mounted.lines()).toEqual(expected);
    }

    test('applies the negotiated theme before the first result, which waits for the readiness work', async ({
      page: browser,
    }) => {
      const view = await mount(browser, {
        hostContext: { theme: 'dark' },
        resultDuringInitialization: answer('early'),
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await view.lines()).toEqual([]); // handshake done, readiness work not: nothing shown yet
      await expect.poll(view.status).toBe(PROBE_TEXTS.waiting);

      await view.click('release-ready');
      await settledAs(view, [
        `context:dark:${HOST}`,
        'result:early:theme=dark',
        'ready',
      ]);
      await expect.poll(view.cardText).toContain('early');
    });

    test('applies each later host-context change and shows each later result', async ({
      page: browser,
    }) => {
      const view = await mount(browser, { hostContext: { theme: 'dark' } });
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');

      await browser.evaluate(() =>
        window.changeHostContext?.({ theme: 'light' }),
      );
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('next'),
      );
      await settledAs(view, [
        `context:dark:${HOST}`,
        'ready',
        `context:light:${HOST}`,
        'result:next:theme=light',
      ]);
    });

    test('disposing during the readiness work drops the held result, ignores a late outcome and frees the container', async ({
      page: browser,
    }) => {
      const view = await mount(browser, {
        resultDuringInitialization: answer('held'),
      });
      await view.click('dispose');
      const expected = [
        'readiness-aborted',
        'not-ready:disposed',
        'dispose-settled',
      ];
      await settledAs(view, expected);
      await view.click('release-ready'); // the readiness work succeeds, too late
      await settledAs(view, expected);
      expect(await view.frame.locator('[data-testid="root"] > *').count()).toBe(
        0,
      );

      await view.click('start-again');
      // The fixture host delivers its held result again at the new handshake.
      await expect
        .poll(view.lines)
        .toEqual(
          expect.arrayContaining(['start-again:started', 'again:ready']),
        );
    });

    test('a readiness failure that arrives after disposal reports nothing new', async ({
      page: browser,
    }) => {
      const view = await mount(browser);
      await view.click('dispose');
      await expect.poll(view.lines).toContain('dispose-settled');
      await view.click('fail-ready');
      await settledAs(view, [
        'readiness-aborted',
        'not-ready:disposed',
        'dispose-settled',
      ]);
    });

    test('a host teardown request during the readiness work ends the view and shows nothing afterwards', async ({
      page: browser,
    }) => {
      const view = await mount(browser, {
        resultDuringInitialization: answer('held'),
      });
      await browser.evaluate(() => window.teardownView?.());
      const expected = ['readiness-aborted', 'not-ready:disposed'];
      await settledAs(view, expected);
      await view.click('release-ready');
      await settledAs(view, expected);
      expect(await view.frame.locator('[data-testid="root"] > *').count()).toBe(
        0,
      );
    });

    test('a readiness failure shows its own text, distinct from the connection failure, and never the held result', async ({
      page: browser,
    }) => {
      const view = await mount(browser, {
        resultDuringInitialization: answer('held'),
      });
      await view.click('fail-ready');
      await settledAs(view, ['readiness-aborted', 'not-ready:ready']);
      await expect.poll(view.status).toBe(PROBE_TEXTS.readyFailure);
      expect(PROBE_TEXTS.readyFailure).not.toBe(PROBE_TEXTS.connectFailure);
      expect(await view.cardText()).toBe('');
    });

    test('an invalid embedded policy fails closed with its own text and never connects to the host', async ({
      page: browser,
    }) => {
      const view = await mount(
        browser,
        {},
        (html) => html.replace('<head>', `<head>${invalidPolicy}`),
        false,
      );
      await expect.poll(view.status).toBe(PROBE_TEXTS.policyFailure);
      await expect.poll(view.lines).toEqual(['not-ready:policy']);
      expect(await browser.evaluate(() => window.handshakes?.())).toBe(0);
      expect(await view.cardText()).toBe('');
    });

    test('an unsupported result or an error clears the answer, shows the problem text, and the next valid result recovers', async ({
      page: browser,
    }) => {
      const view = await mount(browser);
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('First'),
      );
      await expect.poll(view.cardText).toContain('First');

      await browser.evaluate(() =>
        window.deliverToolResult?.({
          content: [{ type: 'text', text: 'x' }],
          structuredContent: { unexpected: true },
        }),
      );
      await expect.poll(view.status).toBe(PROBE_TEXTS.problem);
      expect(await view.cardText()).toBe('');

      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Second'),
      );
      await expect.poll(view.cardText).toContain('Second');

      await browser.evaluate(() =>
        window.deliverToolResult?.({
          content: [{ type: 'text', text: 'x' }],
          structuredContent: { answer: 'ignored' },
          isError: true,
        }),
      );
      await expect.poll(view.status).toBe(PROBE_TEXTS.problem);
      expect(await view.cardText()).toBe('');
    });

    test('a throwing result map is reported, clears the answer and shows the problem text', async ({
      page: browser,
    }) => {
      const view = await mount(browser);
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Shown'),
      );
      await expect.poll(view.cardText).toContain('Shown');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('throw'),
      );
      await expect.poll(view.lines).toContain('error:result:map rejected');
      await expect.poll(view.status).toBe(PROBE_TEXTS.problem);
      expect(await view.cardText()).toBe('');
    });

    test('an equal answer delivered again is a new presentation, not an update in place', async ({
      page: browser,
    }) => {
      const view = await mount(browser);
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Same'),
      );
      await expect.poll(view.cardText).toContain('Same');
      await view.frame.evaluate(() => {
        const card = (function find(root: ParentNode): Element | null {
          const found = root.querySelector('[data-testid="card-root"]');
          if (found) return found;
          for (const element of root.querySelectorAll('*')) {
            const inside = element.shadowRoot && find(element.shadowRoot);
            if (inside) return inside;
          }
          return null;
        })(document);
        (card as unknown as { firstPresentation: boolean }).firstPresentation =
          true;
      });
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Same'),
      );
      await expect.poll(() => view.lines()).toContain('result:Same:theme=-');
      await expect
        .poll(() =>
          view.frame.evaluate(() => {
            const card = (function find(root: ParentNode): Element | null {
              const found = root.querySelector('[data-testid="card-root"]');
              if (found) return found;
              for (const element of root.querySelectorAll('*')) {
                const inside = element.shadowRoot && find(element.shadowRoot);
                if (inside) return inside;
              }
              return null;
            })(document);
            return card === null
              ? 'none'
              : (card as unknown as { firstPresentation?: boolean })
                    .firstPresentation === true
                ? 'same card'
                : 'new card';
          }),
        )
        .toBe('new card');
    });

    test('an equal answer delivered again ends the reader’s image consent', async ({
      page: browser,
    }) => {
      const created = createContentPolicy({
        level: 'strict',
        imageHosts: ['images.example.com'],
      });
      if (!created.ok) throw new Error(created.failure.message);
      await browser.route(/^https:\/\//, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>',
        }),
      );
      const view = await mount(
        browser,
        {},
        (html) => embedContentPolicy(html, created.policy),
        true,
        resourcePermissionsOf(created.policy).resourceDomains,
      );
      const frame = browser.frameLocator('iframe[title="MCP App view"]');
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      const withImage = answer('![chart](https://images.example.com/c.png)');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        withImage,
      );
      await frame.getByRole('button', { name: 'Show images' }).click();
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toBeVisible();

      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        withImage,
      );
      await expect(
        frame.getByRole('button', { name: 'Show images' }),
      ).toBeVisible();
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toHaveCount(0);
    });

    // The application's own reading of the whole result, through the same stack entry: the probe
    // page asks for it with a marker in its head (a stand-in for an application that passes
    // `classifyResult`). The wording and the protocol are the probe's, never the stack's.
    const classified = (html: string): string =>
      html.replace('</head>', '<meta name="probe-classify" content=""></head>');
    const envelope = (answer: string, question = 'Is it so?') => ({
      content: [{ type: 'text' as const, text: 'ignored' }],
      structuredContent: { version: 1, question, answer },
    });
    const FENCED = '```\nfirst line\n  second line\n```\n';

    test('reads the whole result by the application’s protocol, rejects with its wording and recovers', async ({
      page: browser,
    }) => {
      const view = await mount(browser, {}, classified);
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      const deliver = (
        result: Parameters<NonNullable<Window['deliverToolResult']>>[0],
      ) => browser.evaluate((one) => window.deliverToolResult?.(one), result);
      const heading = () =>
        browser
          .frameLocator('iframe[title="MCP App view"]')
          .getByTestId('heading')
          .textContent({ timeout: 2000 });

      await deliver(envelope('It is so.'));
      await expect.poll(view.cardText).toContain('It is so.');
      expect(await heading()).toBe('Is it so?');

      // No structured content: the first text block, exactly, under an empty heading.
      await deliver({ content: [{ type: 'text', text: FENCED }] });
      await expect
        .poll(async () =>
          view.frame.evaluate(() =>
            (function find(root: ParentNode): string | null {
              const found = root.querySelector('[data-testid="card-content"]');
              if (found) return found.textContent;
              for (const element of root.querySelectorAll('*')) {
                const inside = element.shadowRoot && find(element.shadowRoot);
                if (inside !== null && inside !== undefined) return inside;
              }
              return null;
            })(document),
          ),
        )
        .toContain('first line\n  second line');
      expect(await heading()).toBe('');

      // Neither structured content nor usable text: the application's wording, not the definition's.
      await deliver({ content: [] });
      await expect.poll(view.status).toBe(PROBE_UNSUPPORTED);
      expect(PROBE_UNSUPPORTED).not.toBe(PROBE_TEXTS.problem);
      expect(await view.cardText()).toBe('');

      // Present but malformed structured content is rejected even with fallback text beside it,
      // an empty answer included; each is followed by a valid result that recovers.
      for (const malformed of [
        { version: 2, question: 'q', answer: 'a' },
        { version: 1, answer: 'a' },
        { version: 1, question: 'q' },
        { version: 1, question: 'q', answer: '' },
        { version: 1, question: 7, answer: 'a' },
        { version: 1, question: 'q', answer: 7 },
        { unexpected: true },
        {},
      ]) {
        await deliver(envelope('Back.'));
        await expect.poll(view.cardText).toContain('Back.');
        await deliver({
          content: [{ type: 'text', text: 'Usable fallback text' }],
          structuredContent: malformed,
        });
        await expect.poll(view.status).toBe(PROBE_UNSUPPORTED);
        expect(await view.cardText()).toBe('');
      }

      // An error result reaches the application whole, beside valid structured content: it is
      // rejected carrying its own text, which is the problem shown, with no card. Without usable
      // text the application's unsupported wording is shown instead.
      await deliver(envelope('Shown before the error.'));
      await expect.poll(view.cardText).toContain('Shown before the error.');
      await deliver({
        content: [{ type: 'text', text: PROBE_ERROR_TEXT }],
        structuredContent: { version: 1, question: 'q', answer: 'valid' },
        isError: true,
      });
      await expect.poll(view.status).toBe(PROBE_ERROR_TEXT);
      expect(PROBE_ERROR_TEXT).not.toBe(PROBE_UNSUPPORTED);
      expect(PROBE_ERROR_TEXT).not.toBe(PROBE_TEXTS.problem);
      expect(await view.cardText()).toBe('');
      await deliver({ content: [], isError: true });
      await expect.poll(view.status).toBe(PROBE_UNSUPPORTED);
      expect(await view.cardText()).toBe('');

      // The next valid result recovers.
      await deliver(envelope('Recovered.'));
      await expect.poll(view.cardText).toContain('Recovered.');
    });

    test('under the application’s reading, an equal answer delivered again ends image consent', async ({
      page: browser,
    }) => {
      const created = createContentPolicy({
        level: 'strict',
        imageHosts: ['images.example.com'],
      });
      if (!created.ok) throw new Error(created.failure.message);
      await browser.route(/^https:\/\//, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>',
        }),
      );
      const view = await mount(
        browser,
        {},
        (html) => embedContentPolicy(classified(html), created.policy),
        true,
        resourcePermissionsOf(created.policy).resourceDomains,
      );
      const frame = browser.frameLocator('iframe[title="MCP App view"]');
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');

      const same = envelope('![chart](https://images.example.com/c.png)');
      await browser.evaluate((one) => window.deliverToolResult?.(one), same);
      await frame.getByRole('button', { name: 'Show images' }).click();
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toBeVisible();

      await browser.evaluate((one) => window.deliverToolResult?.(one), same);
      await expect(
        frame.getByRole('button', { name: 'Show images' }),
      ).toBeVisible();
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toHaveCount(0);
    });

    test('under the application’s reading, a reader that throws after consent, and a result that cannot be mapped, each clear the card and consent, report phase result and let the next valid result recover', async ({
      page: browser,
    }) => {
      const created = createContentPolicy({
        level: 'strict',
        imageHosts: ['images.example.com'],
      });
      if (!created.ok) throw new Error(created.failure.message);
      await browser.route(/^https:\/\//, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>',
        }),
      );
      const view = await mount(
        browser,
        {},
        (html) => embedContentPolicy(classified(html), created.policy),
        true,
        resourcePermissionsOf(created.policy).resourceDomains,
      );
      const frame = browser.frameLocator('iframe[title="MCP App view"]');
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      const deliver = (result: unknown) =>
        browser.evaluate(
          (one) => window.deliverToolResult?.(one as never),
          result,
        );

      const withImage = envelope('![chart](https://images.example.com/c.png)');
      await deliver(withImage);
      await frame.getByRole('button', { name: 'Show images' }).click();
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toBeVisible();

      // The reader throws after consent was given: the answer and its consent are gone.
      await deliver({ content: [{ type: 'text', text: 'throw' }] });
      await expect.poll(view.lines).toContain('error:result:reader rejected');
      await expect.poll(view.status).toBe(PROBE_TEXTS.problem);
      expect(await view.cardText()).toBe('');
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toHaveCount(0);

      // The next valid result recovers, and consent was not carried over to it.
      await deliver(withImage);
      await expect(
        frame.getByRole('button', { name: 'Show images' }),
      ).toBeVisible();
      await frame.getByRole('button', { name: 'Show images' }).click();
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toBeVisible();

      // A result the delivery cannot map is the same failure: reported, cleared, then recovered.
      await deliver({ content: 'not a list of blocks' });
      await expect
        .poll(view.lines)
        .toContain('error:result:The tool result has no content list.');
      await expect.poll(view.status).toBe(PROBE_TEXTS.problem);
      expect(await view.cardText()).toBe('');
      await expect(
        frame.getByRole('button', { name: 'Hide images' }),
      ).toHaveCount(0);
      await deliver(envelope('Recovered.'));
      await expect.poll(view.cardText).toContain('Recovered.');
    });

    test('under the application’s reading, an equal answer delivered again retires the previous link outcome', async ({
      page: browser,
    }) => {
      await browser.goto('/host-fixture/index.html');
      await browser.evaluate(() => {
        window.handleOpenLink = async () => ({ isError: true });
      });
      const resource: HostedResource = {
        html: classified(page),
        csp: { connectDomains: [], resourceDomains: [] },
      };
      await browser.evaluate((hosted) => window.mountView?.(hosted), resource);
      const frame = browser.frameLocator('iframe[title="MCP App view"]');
      await frame.getByTestId('release-ready').click();
      await expect
        .poll(() => frame.getByTestId('log').locator('li').allInnerTexts())
        .toContain('ready');

      const same = envelope(
        'Read [the guide](https://docs.example.com/guide).',
      );
      await browser.evaluate((one) => window.deliverToolResult?.(one), same);
      await frame.getByRole('button', { name: /the guide/ }).click();
      await expect(frame.locator('.saga-card-link-status')).toContainText(
        'The host did not open this link.',
      );

      await browser.evaluate((one) => window.deliverToolResult?.(one), same);
      await expect(
        frame.getByRole('button', { name: /the guide/ }),
      ).toBeVisible();
      await expect(frame.locator('.saga-card-link-status')).toHaveText('');
    });

    test('maps the reading profile of a device host onto the application’s tokens without a transform or an overflow', async ({
      page: browser,
    }) => {
      const view = await mount(browser, {
        hostContext: { deviceClass: 'echo_show_15' } as never,
      });
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer(`${'A line of the answer that wraps. '.repeat(40)}`),
      );
      await expect.poll(view.cardText).toContain('A line of the answer');
      const measured = await view.frame.evaluate(() => {
        const find = (root: ParentNode): Element | null => {
          const found = root.querySelector('[data-testid="card-content"]');
          if (found) return found;
          for (const element of root.querySelectorAll('*')) {
            const inside = element.shadowRoot && find(element.shadowRoot);
            if (inside) return inside;
          }
          return null;
        };
        const content = find(document);
        const transforms: string[] = [];
        for (
          let node: Element | null = content;
          node !== null;
          node =
            node.parentElement ??
            (node.getRootNode() as ShadowRoot).host ??
            null
        )
          transforms.push(getComputedStyle(node).transform);
        return {
          profile: document.documentElement.dataset.readingProfile,
          fontSize: content ? getComputedStyle(content).fontSize : '',
          transforms,
          overflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      expect(measured.profile).toBe('device');
      expect(measured.fontSize).toBe('25.6px'); // 1.6 × the page's 16px
      expect(measured.transforms.every((value) => value === 'none')).toBe(true);
      expect(measured.overflow).toBeLessThanOrEqual(0);
    });

    test('keeps the ordinary size on a host that reads as a desktop', async ({
      page: browser,
    }) => {
      const view = await mount(browser, { hostContext: { theme: 'light' } });
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Plain answer'),
      );
      await expect.poll(view.cardText).toContain('Plain answer');
      expect(
        await view.frame.evaluate(() => [
          document.documentElement.dataset.readingProfile,
          getComputedStyle(document.documentElement).fontSize,
        ]),
      ).toEqual(['desktop', '16px']);
    });
    test('refuses a second start on a running container and leaves the first intact; a start after dispose succeeds', async ({
      page: browser,
    }) => {
      const view = await mount(browser);
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('First view'),
      );
      await expect.poll(view.cardText).toContain('First view');

      await view.click('start-again');
      await expect.poll(view.lines).toContain('start-again:container-busy');
      expect(await view.cardText()).toContain('First view');

      await view.click('dispose');
      await expect.poll(view.lines).toContain('dispose-settled');
      await view.click('start-again');
      await expect
        .poll(view.lines)
        .toEqual(
          expect.arrayContaining(['start-again:started', 'again:ready']),
        );
    });

    test('a host-context callback that changes the page and then throws: reported, the change stays, teardown cleanup is intact', async ({
      page: browser,
    }) => {
      const view = await mount(browser, { hostContext: { theme: 'light' } });
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');

      await browser.evaluate(() =>
        window.changeHostContext?.({ userAgent: 'mutate-then-throw' }),
      );
      await expect
        .poll(view.lines)
        .toContain('error:host-context:theme broke halfway');
      expect(
        await view.frame.evaluate(() =>
          document.documentElement.style.getPropertyValue('--probe-ink'),
        ),
      ).toBe('white'); // the stack does not roll the application's change back

      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Still works'),
      );
      await expect.poll(view.cardText).toContain('Still works');

      await browser.evaluate(() => window.teardownView?.());
      await expect
        .poll(() => view.frame.locator('[data-testid="root"] > *').count())
        .toBe(0);
      await view.click('start-again'); // the container is free: cleanup was not skipped
      await expect.poll(view.lines).toContain('start-again:started');
    });

    test('pagehide ends a ready view once and removes it', async ({
      page: browser,
    }) => {
      const view = await mount(browser);
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('On screen'),
      );
      await expect.poll(view.cardText).toContain('On screen');
      await view.frame.evaluate(() => dispatchEvent(new Event('pagehide')));
      await expect
        .poll(() => view.frame.locator('[data-testid="root"] > *').count())
        .toBe(0);
    });

    test('owns its sizing: one size per change, none for an equal answer, none after the view ends', async ({
      page: browser,
    }) => {
      const view = await mount(browser);
      await view.click('release-ready');
      await expect.poll(view.lines).toContain('ready');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Short'),
      );
      await expect.poll(view.cardText).toContain('Short');
      await expect
        .poll(() => browser.evaluate(() => window.sizeChanges?.().length ?? 0))
        .toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const sizes = async () =>
        (await browser.evaluate(() => window.sizeChanges?.())) ?? [];
      const afterShort = await sizes();
      expect(new Set(afterShort.map((size) => JSON.stringify(size))).size).toBe(
        afterShort.length,
      ); // no size was sent twice in a row

      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer('Short'),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await sizes()).toEqual(afterShort); // an equal answer is an equal size

      const longAnswer = Array.from(
        { length: 30 },
        (_, index) => `Paragraph ${index}.`,
      ).join('\n\n');
      await browser.evaluate(
        (result) => window.deliverToolResult?.(result),
        answer(longAnswer),
      );
      await expect
        .poll(async () => (await sizes()).length)
        .toBeGreaterThan(afterShort.length);
      const last = (await sizes()).at(-1);
      expect(last?.height).toBeGreaterThan(afterShort.at(-1)?.height ?? 0);

      await browser.evaluate(() => window.teardownView?.());
      await expect
        .poll(() => view.frame.locator('[data-testid="root"] > *').count())
        .toBe(0);
      const ended = await sizes();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await sizes()).toEqual(ended);
    });
  });
}
