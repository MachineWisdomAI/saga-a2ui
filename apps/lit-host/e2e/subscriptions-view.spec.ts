import { readFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { createDevelopmentVerifier, DEV_ACCOUNTS, DEV_TOKENS } from '../src/mcp/dev-auth.js';
import { startEpisodeListener, type EpisodeListener } from '../src/mcp/listener.js';
import { SUBSCRIPTIONS_TOOL_NAME, SUBSCRIPTIONS_VIEW_URI, SIGN_IN_REQUIRED_TEXT } from '../src/mcp/subscriptions.js';
import { BACKEND_FAILURE_MESSAGE, FAILURE_CANARY } from '../src/mcp/subscriptions-failure-fixture.js';
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

test('a refused credential clears the private view through the proxied call, a delayed prior result cannot revive it, and the correlated response recovers', async ({ page }) => {
  const alice = await connect(DEV_TOKENS.alice);
  const view = await mountedView(page, alice);
  const authorized = await alice.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} });
  await send(page, authorized);
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Signed in as Alice');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(1);

  // The view's next read is `callServerTool`, which the host proxies as tools/call. The listener
  // refuses the expired credential with HTTP 401 before any tool handler, and that refusal — not
  // a separately injected error notification — is what clears the view.
  type ToolParams = { name: string; arguments?: Record<string, unknown> };
  let refusal: { status: number; challenge: string | null; body: unknown } | undefined;
  let forward = async (params: ToolParams): Promise<Awaited<ReturnType<Client['callTool']>>> => {
    const response = await fetch(listener.subscriptionsUrl ?? '', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${DEV_TOKENS.expired}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
    });
    refusal = {
      status: response.status,
      challenge: response.headers.get('www-authenticate'),
      body: await response.json(),
    };
    throw new Error(`listener refused the proxied tools/call (${response.status})`);
  };
  await page.exposeFunction('handleToolCall', (params: ToolParams) => forward(params));
  await page.evaluate(() => window.deliverToolInput?.({ arguments: {} }));
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'sign-in-required');
  await expect(view.getByTestId('subscriptions-status')).toHaveText(SIGN_IN_REQUIRED_TEXT);
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(0);
  await expect(view.getByText('Alice')).toHaveCount(0);
  expect(refusal).toMatchObject({
    status: 401,
    body: { error: 'invalid_token' },
  });
  expect(refusal?.challenge).toMatch(/error="invalid_token".*expired/);

  // A delayed copy of the earlier authorized result arrives while the view is invalid. It must
  // not become the new trusted label.
  await send(page, authorized);
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'sign-in-required');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(0);
  await expect(view.getByText('Alice')).toHaveCount(0);

  // Hold the next correlated response, deliver the old result before it returns, then release.
  let release: (value: Awaited<ReturnType<Client['callTool']>>) => void = () => undefined;
  let markStarted: () => void = () => undefined;
  const callStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  forward = () => {
    markStarted();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  await page.evaluate(() => window.deliverToolInput?.({ arguments: {} }));
  await callStarted;
  await send(page, authorized);
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'sign-in-required');
  await expect(view.getByText('Alice')).toHaveCount(0);

  release(await alice.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} }));
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Signed in as Alice');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(1);
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

test('a subscriber recovers from empty, failed and cleared wire results', async ({ page }) => {
  let mode: 'list' | 'empty' | 'throw' | 'bad' = 'list';
  const local = await startEpisodeListener({
    viewHtml: await readFile(new URL('../dist/subscriptions-view/subscriptions.html', import.meta.url), 'utf8'),
    catalog: { find: () => undefined },
    port: 0,
    subscriptions: {
      viewHtml: await readFile(new URL('../dist/subscriptions-view/subscriptions.html', import.meta.url), 'utf8'),
      verifier: createDevelopmentVerifier(),
      backend: {
        listSubscriptions: async (accountId) => {
          if (accountId !== DEV_ACCOUNTS.alice) return undefined;
          if (mode === 'throw') throw new Error(BACKEND_FAILURE_MESSAGE);
          if (mode === 'bad') {
            return { displayName: 'Alice', subscriptions: [{ subscriptionId: 's', creator: 'C', tier: 'T', status: FAILURE_CANARY }] };
          }
          if (mode === 'empty') return { displayName: 'Alice', subscriptions: [] };
          return {
            displayName: 'Alice',
            subscriptions: [
              { subscriptionId: 'sub-keep', creator: 'Creator One', tier: 'Gold', status: 'active' },
              { subscriptionId: 'sub-other', creator: 'Creator Two', tier: 'Basic', status: 'paused' },
            ],
          };
        },
      },
    },
  });
  const client = new Client({ name: 'e2e-recovery', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(local.subscriptionsUrl ?? ''), {
      requestInit: { headers: { authorization: `Bearer ${DEV_TOKENS.alice}` } },
    }),
  );
  const read = () => client.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} });
  const view = await mountedView(page, client);
  const listed = await read();
  expect(listed.isError).toBeFalsy();
  await send(page, listed);
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Signed in as Alice');
  await view.getByText('Creator One — Gold (active)').click();
  await expect(view.locator('[data-selected="true"]')).toHaveText('Creator One — Gold (active)');

  mode = 'empty';
  const empty = await read();
  expect(empty.isError).toBeFalsy();
  expect(JSON.stringify(empty.structuredContent)).toContain('Alice');
  expect(JSON.stringify(empty.structuredContent)).not.toContain('Creator');
  await send(page, empty);
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'empty');
  await expect(view.getByTestId('subscriptions-status')).toContainText('No subscriptions.');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(0);
  await expect(view.locator('[data-selected="true"]')).toHaveCount(0);
  await expect(view.getByTestId('subscriptions-retry')).toBeVisible();

  mode = 'list';
  const restored = await read();
  await send(page, restored);
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(2);
  await view.getByText('Creator One — Gold (active)').click();

  mode = 'throw';
  const failed = await read();
  expect(failed.isError).toBe(true);
  expect(JSON.stringify(failed)).not.toContain(FAILURE_CANARY);
  expect(JSON.stringify(failed)).not.toContain('503');
  await send(page, failed);
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'retry');
  await expect(view.getByText(/Alice|Creator/)).toHaveCount(0);
  await expect(view.locator('[data-selected="true"]')).toHaveCount(0);

  mode = 'list';
  let proxied = 0;
  await page.exposeFunction('handleToolCall', async () => {
    proxied += 1;
    return read();
  });
  await view.getByTestId('subscriptions-retry').click();
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Signed in as Alice');
  await expect(view.getByTestId('subscriptions-list').locator('li')).toHaveCount(2);
  await expect(view.locator('[data-selected="true"]')).toHaveCount(0);
  expect(proxied).toBe(1);

  await view.getByText('Creator One — Gold (active)').click();
  await page.evaluate(() => window.deliverToolInput?.({ arguments: {} }));
  await expect(view.locator('[data-selected="true"]')).toHaveText('Creator One — Gold (active)');
  await expect.poll(() => proxied).toBe(2); // the view's re-fetch completes after the DOM already shows the selection

  mode = 'bad';
  const invalid = await read();
  expect(invalid.isError).toBe(true);
  expect(JSON.stringify(invalid)).not.toContain(FAILURE_CANARY);
  await send(page, invalid);
  await expect(view.getByTestId('subscriptions-root')).toHaveAttribute('data-state', 'problem');
  await expect(view.getByText(/Alice|Creator|canary/)).toHaveCount(0);
  await expect(view.getByTestId('subscriptions-retry')).toBeVisible();

  mode = 'list';
  await view.getByTestId('subscriptions-retry').click();
  await expect(view.getByTestId('subscriptions-status')).toHaveText('Signed in as Alice');
  await expect(view.getByText('Creator One — Gold (active)')).toBeVisible();
  await client.close();
  await local.close();
});
