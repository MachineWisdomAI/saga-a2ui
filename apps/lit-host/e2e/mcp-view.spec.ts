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

test('an error result leaves the rendered title unchanged and explains the problem', async ({ page }) => {
  const view = await mountedView(page);
  await deliver(page, 'ep-001');
  const failed = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'missing' } });
  expect(failed.isError).toBe(true);
  await page.evaluate((payload) => window.deliverToolResult?.(payload), failed as never);

  await expect(view.getByTestId('view-problem')).toBeVisible();
  await expect(view.getByTestId('panel-title')).toHaveText('First wire title');
});
