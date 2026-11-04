import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { builtUrl } from './built-artifacts.js';
import type { HostedResource } from './host-fixture/host.js';

// The own-catalog entry `startA2uiView` of the React stack and of the Lit stack in a real browser,
// each in a probe page mounted in the local host fixture's sandboxed iframe and driven over a real
// AppBridge. The probe appends one line per application callback and per registration the page
// makes on its event target, so the specification reads the order in which they happened: that the
// view is gone before its connection closes, that the `pagehide` listener is removed however the
// application's own callbacks behave, and that nothing runs twice. Both stacks run the same
// scenarios. The host fixture is not evidence of any actual host.

const STACKS = ['react', 'lit'] as const;
const withThrowingCallbacks = (html: string): string =>
  html.replace('<head>', '<head><meta name="probe-throwing" content="" />');

for (const stack of STACKS) {
  test.describe(`startA2uiView of the ${stack} stack`, () => {
    let probe: string;
    test.beforeAll(async () => {
      probe = await readFile(builtUrl(`view-stack/${stack}.html`), 'utf8');
    });

    async function mount(
      page: Page,
      transform: (html: string) => string = (html) => html,
    ) {
      await page.goto('/host-fixture/index.html');
      const hosted: HostedResource = {
        html: transform(probe),
        csp: { connectDomains: [], resourceDomains: [] },
      };
      await page.evaluate((resource) => window.mountView?.(resource), hosted);
      const handle = await page
        .locator('iframe[title="MCP App view"]')
        .elementHandle();
      const frame = await handle?.contentFrame();
      if (!frame) throw new Error('the probe did not mount');
      const view = page.frameLocator('iframe[title="MCP App view"]');
      return {
        lines: () => view.getByTestId('log').locator('li').allInnerTexts(),
        shown: () =>
          view.getByTestId('root').evaluate((r) => r.children.length),
        click: (testId: string) => view.getByTestId(testId).click(),
        pageGoesAway: () =>
          frame.evaluate(() => dispatchEvent(new Event('pagehide'))),
        label: () => view.getByTestId('line').textContent({ timeout: 2000 }),
      };
    }
    type Mounted = Awaited<ReturnType<typeof mount>>;

    /** The log stays what it is: nothing the view retained runs again. */
    async function stays(mounted: Mounted): Promise<void> {
      const before = await mounted.lines();
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await mounted.lines()).toEqual(before);
    }

    test('a view disposed during the readiness work is removed before its connection closes, and the container starts again', async ({
      page,
    }) => {
      const view = await mount(page);
      await expect.poll(view.lines).toEqual(['pagehide:+']);
      await expect.poll(view.shown).toBe(1); // on screen while it is starting

      await view.click('dispose');
      await expect.poll(view.lines).toEqual(
        expect.arrayContaining([
          'readiness-aborted',
          'pagehide:-',
          'teardown',
          'close:0', // nothing was left on screen when the connection closed
          'not-ready:disposed',
          'dispose-settled',
        ]),
      );
      const lines = await view.lines();
      expect(lines.indexOf('teardown')).toBeLessThan(lines.indexOf('close:0'));
      expect(lines.filter((line) => line === 'teardown')).toHaveLength(1);
      expect(await view.shown()).toBe(0);

      await view.pageGoesAway(); // a retained listener would end the view again
      await stays(view);

      await view.click('start-again'); // the container is free
      await expect.poll(view.lines).toContain('start-again:started');
      await expect.poll(view.lines).toContain('again:ready');
      await expect.poll(view.label).toBe('Waiting');
    });

    for (const state of ['starting', 'ready'] as const) {
      test(`a ${state} view whose teardown and error callbacks throw is still ended once, removes its pagehide listener and frees the container`, async ({
        page,
      }) => {
        const view = await mount(page, withThrowingCallbacks);
        if (state === 'ready') {
          await view.click('release-ready');
          await expect.poll(view.lines).toContain('ready');
        }
        await view.click('dispose');
        await expect.poll(view.lines).toContain('dispose-settled');
        const lines = await view.lines();
        expect(lines).toContain('pagehide:-');
        expect(lines.filter((line) => line === 'teardown')).toHaveLength(1);
        expect(lines.indexOf('teardown')).toBeLessThan(
          lines.indexOf('close:0'),
        );
        expect(await view.shown()).toBe(0);

        await view.pageGoesAway();
        await stays(view);

        await view.click('start-again');
        await expect.poll(view.lines).toContain('again:ready');
        await expect.poll(view.label).toBe('Waiting');
      });
    }

    test('the page going away while the view is starting removes it before the connection closes and removes the listener', async ({
      page,
    }) => {
      const view = await mount(page);
      await view.pageGoesAway();
      await expect
        .poll(view.lines)
        .toEqual(expect.arrayContaining(['pagehide:-', 'teardown', 'close:0']));
      expect(await view.shown()).toBe(0);
      await view.pageGoesAway();
      await stays(view);
    });

    test('a readiness failure is reported as ready and leaves nothing on screen', async ({
      page,
    }) => {
      const view = await mount(page);
      await view.click('fail-ready');
      await expect.poll(view.lines).toContain('not-ready:ready');
      await expect.poll(view.shown).toBe(0);
      await view.click('dispose');
      await expect.poll(view.lines).toContain('dispose-settled');
      await view.click('start-again');
      await expect.poll(view.lines).toContain('again:ready');
    });

    test('a handshake that fails is reported as connect, apart from a readiness failure, and leaves nothing on screen', async ({
      page,
    }) => {
      // Opened by itself, not in a host: no host answers the view's handshake.
      await page.goto(`/view-stack/${stack}.html`);
      const log = page.getByTestId('log').locator('li');
      await expect
        .poll(() => log.allInnerTexts(), { timeout: 15_000 })
        .toContain('not-ready:connect');
      expect(await log.allInnerTexts()).not.toContain('not-ready:ready');
      await expect
        .poll(() => page.getByTestId('root').evaluate((r) => r.children.length))
        .toBe(0);
      await page.getByTestId('dispose').click();
      await expect.poll(() => log.allInnerTexts()).toContain('dispose-settled');
      await page.getByTestId('start-again').click();
      await expect
        .poll(() => log.allInnerTexts())
        .toContain('start-again:started');
    });
  });
}
