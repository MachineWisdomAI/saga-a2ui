import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { EPISODE_TOOL_NAME, EPISODE_VIEW_URI } from '../src/mcp/episode.js';
import { startEpisodeListener, type EpisodeListener } from '../src/mcp/listener.js';
import type { HostedResource } from './host-fixture/host.js';

// End to end: real MCP server over Streamable HTTP -> real tools/call and resources/read ->
// the built view in a sandboxed iframe of a local host fixture -> real AppBridge delivery.

const builtView = new URL('../dist/view/view.html', import.meta.url);
let listener: EpisodeListener;
let client: Client;

test.beforeAll(async () => {
  listener = await startEpisodeListener({
    viewHtml: await readFile(builtView, 'utf8'),
    catalog: {
      find: (id) =>
        ({
          'ep-001': { id: 'ep-001', title: 'First wire title', description: 'Plain <b>text</b> from the wire.' },
          'ep-002': { id: 'ep-002', title: 'Second wire title', description: 'Second description.' },
        })[id],
    },
    port: 0,
  });
  client = new Client({ name: 'e2e-host', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(listener.url)));
});

test.afterAll(async () => {
  await client.close();
  await listener.close();
});

async function readView(): Promise<HostedResource> {
  const { contents } = await client.readResource({ uri: EPISODE_VIEW_URI });
  const [content] = contents;
  if (!content || !('text' in content)) throw new Error('resources/read returned no text');
  const ui = (content._meta as { ui: { csp: HostedResource['csp'] } }).ui;
  return { html: content.text, csp: ui.csp };
}

async function mountedView(page: Page): Promise<FrameLocator> {
  await page.goto('/host-fixture/index.html');
  await page.evaluate((resource) => window.mountView?.(resource), await readView());
  return page.frameLocator('iframe[title="MCP App view"]');
}

async function deliver(page: Page, episodeId: string) {
  const result = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId } });
  await page.evaluate((payload) => window.deliverToolResult?.(payload), result as never);
  return result;
}

test('the tool result from the wire is the title the view renders', async ({ page }) => {
  const view = await mountedView(page);
  const result = await deliver(page, 'ep-001');

  expect(result.structuredContent).toEqual({
    episodeId: 'ep-001',
    title: 'First wire title',
    description: 'Plain <b>text</b> from the wire.',
  });
  await expect(view.getByTestId('panel-title')).toHaveText('First wire title');
  // Markup in the description stays visible text rather than becoming elements.
  await expect(view.getByTestId('panel-description')).toHaveText('Plain <b>text</b> from the wire.');
  await expect(view.locator('b')).toHaveCount(0);
});

test('changing the server result changes the visible title', async ({ page }) => {
  const view = await mountedView(page);
  await deliver(page, 'ep-001');
  await expect(view.getByTestId('panel-title')).toHaveText('First wire title');
  await deliver(page, 'ep-002');
  await expect(view.getByTestId('panel-title')).toHaveText('Second wire title');
});

test('the resource is linked from the tool and served with an empty-allowlist CSP', async ({ page }) => {
  const { tools } = await client.listTools();
  expect(tools.find((tool) => tool.name === EPISODE_TOOL_NAME)?._meta).toMatchObject({
    ui: { resourceUri: EPISODE_VIEW_URI },
  });

  const resource = await readView();
  expect(resource.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] });

  // The mounted iframe is sandboxed without same-origin access and carries a restrictive CSP.
  await mountedView(page);
  const frame = page.locator('iframe[title="MCP App view"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  const policy = await page.evaluate(() => {
    const doc = document.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
    return /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1];
  });
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
});

test('a CSP-blocked network request from the view fails', async ({ page }) => {
  const view = await mountedView(page);
  await deliver(page, 'ep-001');
  await expect(view.getByTestId('panel-title')).toHaveText('First wire title');
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  // Target the live MCP listener: only the CSP, not a dead port, can be the reason it fails.
  const violated = await frame?.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        document.addEventListener('securitypolicyviolation', (event) => resolve(event.violatedDirective));
        fetch(url, { method: 'POST' }).catch(() => undefined);
      }),
    listener.url,
  );
  expect(violated).toBe('connect-src');
});

test('an error result clears the rendered title and explains the problem', async ({ page }) => {
  const view = await mountedView(page);
  await deliver(page, 'ep-001');
  await expect(view.getByTestId('panel-title')).toHaveText('First wire title');
  const failed = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'missing' } });
  expect(failed.isError).toBe(true);
  await page.evaluate((payload) => window.deliverToolResult?.(payload), failed as never);

  await expect(view.getByTestId('view-problem')).toBeVisible();
  await expect(view.getByTestId('panel-title')).toHaveCount(0);
  await expect(view.locator('a2ui-surface')).toHaveCount(0);
});

test.describe('result lifecycle through the bridge', () => {
  const sendRaw = (page: Page, payload: unknown) =>
    page.evaluate((result) => window.deliverToolResult?.(result), payload as never);
  const episode = (title: string) => ({
    content: [],
    structuredContent: { episodeId: 'ep-x', title, description: 'Plain text.' },
  });

  test('a result sent during initialization renders once and a later result replaces it', async ({ page }) => {
    await page.goto('/host-fixture/index.html');
    await page.evaluate(
      (args) => window.mountView?.(args.resource, { resultDuringInitialization: args.early }),
      { resource: await readView(), early: episode('Early title') },
    );
    const view = page.frameLocator('iframe[title="MCP App view"]');
    await expect(view.getByTestId('panel-title')).toHaveText('Early title');
    await expect(view.locator('a2ui-surface')).toHaveCount(1);
    await expect(view.getByTestId('panel-title')).toHaveCount(1);

    await sendRaw(page, episode('Later title'));
    await expect(view.getByTestId('panel-title')).toHaveText('Later title');
    await expect(view.locator('a2ui-surface')).toHaveCount(1);
  });

  for (const [name, bad] of [
    ['an error result', { isError: true, content: [] }],
    ['a non-episode result', { content: [], structuredContent: { surprise: true } }],
    ['a result with an undeclared field', { content: [], structuredContent: { ...episode('T').structuredContent, secret: 'x' } }],
    ['a result with no structured content', { content: [{ type: 'text', text: 'plain' }] }],
  ] as const) {
    test(`${name} clears the prior surface, shows a fallback, and a valid result recovers`, async ({ page }) => {
      const view = await mountedView(page);
      await sendRaw(page, episode('Prior title'));
      await expect(view.getByTestId('panel-title')).toHaveText('Prior title');

      await sendRaw(page, bad);
      await expect(view.getByTestId('view-problem')).toBeVisible();
      await expect(view.getByTestId('view-problem')).not.toBeEmpty();
      await expect(view.getByTestId('panel-title')).toHaveCount(0);
      await expect(view.locator('a2ui-surface')).toHaveCount(0);

      await sendRaw(page, episode('Recovered title'));
      await expect(view.getByTestId('panel-title')).toHaveText('Recovered title');
      await expect(view.getByTestId('view-problem')).toBeHidden();
      await expect(view.locator('a2ui-surface')).toHaveCount(1);
    });
  }

  test('a result arriving after host teardown is ignored', async ({ page }) => {
    const view = await mountedView(page);
    await sendRaw(page, episode('Before teardown'));
    await expect(view.getByTestId('panel-title')).toHaveText('Before teardown');

    await page.evaluate(() => window.teardownView?.());
    await sendRaw(page, episode('After teardown')).catch(() => undefined);
    await sendRaw(page, { isError: true, content: [] }).catch(() => undefined);
    await page.waitForTimeout(300);
    await expect(view.getByTestId('panel-title')).toHaveText('Before teardown');
    await expect(view.getByTestId('view-problem')).toBeHidden();
  });

  test('remounting the view delivers each result once', async ({ page }) => {
    await mountedView(page);
    const view = await mountedView(page); // replaces the first iframe and bridge
    await sendRaw(page, episode('After remount'));
    await expect(view.getByTestId('panel-title')).toHaveText('After remount');
    await expect(view.getByTestId('panel-title')).toHaveCount(1);
    await expect(view.locator('a2ui-surface')).toHaveCount(1);
  });
});
