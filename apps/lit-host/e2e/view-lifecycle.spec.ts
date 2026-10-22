import { readFile } from 'node:fs/promises';
import { expect, test, type Frame, type Page } from '@playwright/test';
import { builtUrl } from './built-artifacts.js';
import type { HostedResource } from './host-fixture/host.js';

// The view lifecycle in a real browser: `runToolResultView` in a probe page, mounted in the local
// host fixture's sandboxed iframe and driven over a real AppBridge. The probe appends one line per
// callback, so the specification reads the order in which the caller's callbacks ran. The host
// fixture is not evidence of any actual host.

const HOST = 'local-host-fixture';
const text = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
});

let resource: HostedResource;
test.beforeAll(async () => {
  resource = {
    html: await readFile(builtUrl('view-lifecycle/index.html'), 'utf8'),
    csp: { connectDomains: [], resourceDomains: [] },
  };
});

interface Mounted {
  readonly frame: Frame;
  readonly lines: () => Promise<string[]>;
  readonly releaseReady: () => Promise<void>;
  readonly failReady: () => Promise<void>;
}

async function mount(
  page: Page,
  options: Parameters<NonNullable<Window['mountView']>>[1] = {},
): Promise<Mounted> {
  await page.goto('/host-fixture/index.html');
  // The options hold only JSON values; the declared parameter type is too deep for inference.
  const arg = { hosted: resource, mountOptions: options } as never as {
    hosted: HostedResource;
    mountOptions: unknown;
  };
  await page.evaluate(
    ({ hosted, mountOptions }) =>
      window.mountView?.(hosted, mountOptions as never),
    arg,
  );
  const handle = await page
    .locator('iframe[title="MCP App view"]')
    .elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('the probe did not mount');
  const view = page.frameLocator('iframe[title="MCP App view"]');
  return {
    frame,
    lines: () => view.getByTestId('log').locator('li').allInnerTexts(),
    releaseReady: () => view.getByTestId('release-ready').click(),
    failReady: () => view.getByTestId('fail-ready').click(),
  };
}

/** The log has settled: it equals `expected` and stays that way. */
async function settledAs(mounted: Mounted, expected: string[]): Promise<void> {
  await expect.poll(mounted.lines).toEqual(expected);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(await mounted.lines()).toEqual(expected);
}

test('applies the negotiated theme before the first result, which waits for the readiness work', async ({
  page,
}) => {
  const view = await mount(page, {
    hostContext: { theme: 'dark' },
    resultDuringInitialization: text('early'),
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(await view.lines()).toEqual([]); // handshake done, readiness work not: nothing shown yet

  await view.releaseReady();
  await settledAs(view, [
    `context:dark:${HOST}`,
    'result:early:theme=dark',
    'ready',
  ]);
});

test('applies each later host-context change and shows each later result', async ({
  page,
}) => {
  const view = await mount(page, { hostContext: { theme: 'dark' } });
  await view.releaseReady();
  await expect.poll(view.lines).toContain('ready');

  await page.evaluate(() => window.changeHostContext?.({ theme: 'light' }));
  await page.evaluate(
    (result) => window.deliverToolResult?.(result),
    text('next'),
  );
  await settledAs(view, [
    `context:dark:${HOST}`,
    'ready',
    `context:light:${HOST}`,
    'result:next:theme=light',
  ]);
});

test('disposing during the readiness work drops the held result and ignores a late outcome', async ({
  page,
}) => {
  const view = await mount(page, { resultDuringInitialization: text('held') });
  await page
    .frameLocator('iframe[title="MCP App view"]')
    .getByTestId('dispose')
    .click();
  await settledAs(view, [
    'readiness-aborted',
    'teardown',
    'failure:disposed',
    'not-ready:disposed',
    'dispose-settled',
  ]);

  await view.releaseReady(); // the readiness work succeeds, too late
  await settledAs(view, [
    'readiness-aborted',
    'teardown',
    'failure:disposed',
    'not-ready:disposed',
    'dispose-settled',
  ]);
});

test('a readiness failure that arrives after disposal reports nothing new', async ({
  page,
}) => {
  const view = await mount(page);
  await page
    .frameLocator('iframe[title="MCP App view"]')
    .getByTestId('dispose')
    .click();
  await expect.poll(view.lines).toContain('dispose-settled');
  await view.failReady();
  await settledAs(view, [
    'readiness-aborted',
    'teardown',
    'failure:disposed',
    'not-ready:disposed',
    'dispose-settled',
  ]);
});

test('a host teardown request during the readiness work ends the view the same way', async ({
  page,
}) => {
  const view = await mount(page, { resultDuringInitialization: text('held') });
  await page.evaluate(() => window.teardownView?.());
  await settledAs(view, [
    'readiness-aborted',
    'teardown',
    'failure:disposed',
    'not-ready:disposed',
  ]);
  await view.releaseReady();
  await settledAs(view, [
    'readiness-aborted',
    'teardown',
    'failure:disposed',
    'not-ready:disposed',
  ]);
});

test('a readiness failure is its own kind, ends the view and never shows the held result', async ({
  page,
}) => {
  const view = await mount(page, { resultDuringInitialization: text('held') });
  await view.failReady();
  await settledAs(view, [
    'readiness-aborted',
    'teardown',
    'failure:ready',
    'not-ready:ready',
  ]);
});

test('a result callback that throws after ready is reported, and the next result is shown', async ({
  page,
}) => {
  const view = await mount(page);
  await view.releaseReady();
  await expect.poll(view.lines).toContain('ready');

  await page.evaluate(
    (result) => window.deliverToolResult?.(result),
    text('throw'),
  );
  await page.evaluate(
    (result) => window.deliverToolResult?.(result),
    text('after'),
  );
  await settledAs(view, [
    `context:-:${HOST}`,
    'ready',
    'error:result:result rejected',
    'result:after:theme=-',
  ]);
});

test('a host-context callback that changes the page and then throws: reported, the change stays, teardown cleanup is intact', async ({
  page,
}) => {
  const view = await mount(page, { hostContext: { theme: 'light' } });
  await view.releaseReady();
  await expect.poll(view.lines).toContain('ready');

  await page.evaluate(() =>
    window.changeHostContext?.({ userAgent: 'mutate-then-throw' }),
  );
  await expect
    .poll(view.lines)
    .toContain('error:host-context:theme broke halfway');
  expect(
    await view.frame.evaluate(() =>
      document.documentElement.style.getPropertyValue('--probe-ink'),
    ),
  ).toBe('white'); // the runner does not roll the application's change back

  await page.evaluate(() => window.teardownView?.());
  await page
    .evaluate((result) => window.deliverToolResult?.(result), text('late'))
    .catch(() => undefined);
  await settledAs(view, [
    `context:light:${HOST}`,
    'ready',
    `context:light:${HOST}`,
    'error:host-context:theme broke halfway',
    'readiness-aborted', // the signal aborts whenever the view ends, ready or not
    'teardown',
  ]);
});

test('pagehide runs the teardown once, and a later dispose does not run it again', async ({
  page,
}) => {
  const view = await mount(page);
  await view.releaseReady();
  await expect.poll(view.lines).toContain('ready');

  await view.frame.evaluate(() => dispatchEvent(new Event('pagehide')));
  await expect.poll(view.lines).toContain('teardown');
  await page
    .frameLocator('iframe[title="MCP App view"]')
    .getByTestId('dispose')
    .click();
  await settledAs(view, [
    `context:-:${HOST}`,
    'ready',
    'readiness-aborted',
    'teardown',
    'dispose-settled',
  ]);
});
