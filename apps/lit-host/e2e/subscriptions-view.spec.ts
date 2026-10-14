import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { createDevelopmentVerifier, DEV_ACCOUNTS, DEV_TOKENS } from '../src/mcp/dev-auth.js';
import { startEpisodeListener, type EpisodeListener } from '../src/mcp/listener.js';
import { SUBSCRIPTIONS_TOOL_NAME, SUBSCRIPTIONS_VIEW_URI } from '../src/mcp/subscriptions.js';
import type { HostedResource } from './host-fixture/host.js';

// End to end: real listener with real bearer credentials -> real tools/call and resources/read ->
// the built subscriptions view in a sandboxed iframe -> visible authorized / unauthorized states.

let listener: EpisodeListener;

test.beforeAll(async () => {
  const viewHtml = await readFile(new URL('../dist/subscriptions-view/subscriptions.html', import.meta.url), 'utf8');
  listener = await startEpisodeListener({
    viewHtml,
    catalog: { find: () => undefined },
    port: 0,
    subscriptions: {
      viewHtml,
      verifier: createDevelopmentVerifier(),
      backend: {
        listSubscriptions: async (accountId) =>
          ({
            [DEV_ACCOUNTS.alice]: {
              displayName: 'Alice',
              subscriptions: [{ subscriptionId: 'a1', creator: 'Creator One', tier: 'Gold', status: 'active' }],
            },
            [DEV_ACCOUNTS.bob]: {
              displayName: 'Bob',
              subscriptions: [{ subscriptionId: 'b1', creator: 'Creator <b>Three</b>', tier: 'Silver', status: 'paused' }],
            },
          })[accountId],
      },
    },
  });
});

test.afterAll(async () => {
  await listener.close();
});

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'e2e-host', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(listener.subscriptionsUrl ?? ''), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function mountedView(page: Page, client: Client): Promise<FrameLocator> {
  const { contents } = await client.readResource({ uri: SUBSCRIPTIONS_VIEW_URI });
  const [content] = contents;
  if (!content || !('text' in content)) throw new Error('resources/read returned no text');
  const ui = (content._meta as { ui: { csp: HostedResource['csp'] } }).ui;
  await page.goto('/host-fixture/index.html');
  await page.evaluate((resource) => window.mountView?.(resource), { html: content.text, csp: ui.csp });
  return page.frameLocator('iframe[title="MCP App view"]');
}

const send = (page: Page, payload: unknown) =>
  page.evaluate((result) => window.deliverToolResult?.(result), payload as never);

test('each signed-in user sees only their own subscriptions', async ({ page }) => {
  const alice = await connect(DEV_TOKENS.alice);
  const view = await mountedView(page, alice);
  await send(page, await alice.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} }));
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Signed in as Alice');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveText(['Creator One — Gold (active)']);
  await expect(view.getByText('Creator <b>Three</b>')).toHaveCount(0);

  const bob = await connect(DEV_TOKENS.bob);
  const bobView = await mountedView(page, bob);
  await send(page, await bob.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: { accountId: DEV_ACCOUNTS.alice } }));
  await expect(bobView.getByTestId('subscriptions-status')).toHaveText('Signed in as Bob');
  // Markup in a value stays visible text.
  await expect(bobView.getByTestId('subscriptions-list').locator('li')).toHaveText([
    'Creator <b>Three</b> — Silver (paused)',
  ]);
  await expect(bobView.locator('b')).toHaveCount(0);
  await expect(bobView.getByText('Creator One')).toHaveCount(0);
  await alice.close();
  await bob.close();
});

test('a changed sign-in clears the private view and it stays cleared', async ({ page }) => {
  const alice = await connect(DEV_TOKENS.alice);
  const bob = await connect(DEV_TOKENS.bob);
  const view = await mountedView(page, alice);
  await send(page, await alice.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} }));
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(1);

  await send(page, await bob.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} }));
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'problem');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(0);
  await expect(view.getByText(/Alice|Bob|Creator/)).toHaveCount(0);

  await send(page, await alice.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} }));
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'problem');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(0);
  await alice.close();
  await bob.close();
});

test('an unauthorized result shows sign-in required and removes private data', async ({ page }) => {
  const alice = await connect(DEV_TOKENS.alice);
  const view = await mountedView(page, alice);
  await send(page, await alice.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} }));
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Signed in as Alice');

  await send(page, { isError: true, content: [{ type: 'text', text: 'Sign in to see your subscriptions.' }] });
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'sign-in-required');
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Sign in to see your subscriptions.');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(0);
  await expect(view.getByText('Alice')).toHaveCount(0);
  await alice.close();
});

test('credentials that cannot sign a user in are refused over HTTP with challenges', async () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const attempt = (authorization?: string) =>
    fetch(listener.subscriptionsUrl ?? '', {
      method: 'POST',
      headers: authorization ? { ...headers, authorization } : headers,
      body,
    });

  for (const authorization of [undefined, 'Bearer ???', `Bearer ${DEV_TOKENS.expired}`]) {
    const response = await attempt(authorization);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer /);
  }
  const service = await attempt(`Bearer ${DEV_TOKENS.service}`);
  expect(service.status).toBe(403);
  expect(service.headers.get('www-authenticate')).toMatch(/insufficient_scope/);
});
