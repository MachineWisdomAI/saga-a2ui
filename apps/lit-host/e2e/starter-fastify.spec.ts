import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import type { Listener, ListenerOptions } from '../../../templates/lit-fastify/server/listener.js';
import type { HostedResource } from './host-fixture/host.js';

// The `lit-mcp` starter on Fastify (templates/lit-fastify), in a real browser. The page under test is
// the one the starter's own build produced from packed SDK tarballs (scripts/build-starter-fastify.ts)
// and the one its server serves over a real MCP connection. It is mounted in the sandboxed
// iframe of the local host fixture under the CSP the server declared, and every result reaches it
// over the fixture's real AppBridge. The local host fixture is not evidence of any actual
// assistant host. The identities below belong to this specification; the starter has none.

interface Entry {
  startListener(options: ListenerOptions): Promise<Listener>;
  readonly ACCOUNT_SCOPE: string;
}

const starterDist = new URL('../dist/starter-fastify/', import.meta.url);
const ACCOUNT = 'browser-spec-account';
const OTHER_ACCOUNT = 'browser-spec-other-account';
const MISMATCH_TEXT = 'This could not be shown: the view and its server are from different builds. Reopen it; if this continues, update the server and the view together.';
const PROBLEM_TEXT = 'This could not be shown.';
const CLOSED_TEXT = 'This view was closed.';

let bytes: Buffer;
let listener: Listener;
let client: Client;

/** Both overlapping requests must be inside the policy at once before either is answered. */
let together: { arrived: number; release: () => void; settled: Promise<void> } | undefined;

test.beforeAll(async () => {
  bytes = await readFile(new URL('index.html', starterDist));
  const entry = (await import(pathToFileURL(new URL('qualification-server.mjs', starterDist).pathname).href)) as Entry;
  const accounts: Record<string, string> = { t: ACCOUNT, u: OTHER_ACCOUNT };
  listener = await entry.startListener({
    html: bytes.toString('utf8'),
    verifier: {
      async verifyAccessToken(token): Promise<AuthInfo> {
        const accountId = accounts[token];
        if (accountId === undefined) throw new Error('unknown credential');
        return { token, clientId: 'browser-spec', scopes: [entry.ACCOUNT_SCOPE], expiresAt: 9_999_999_999, extra: { accountId } };
      },
    },
    authorize: async () => {
      const gate = together;
      if (gate === undefined) return true;
      gate.arrived += 1;
      if (gate.arrived === 2) gate.release();
      await gate.settled;
      return true;
    },
    port: 0,
  });
  client = new Client({ name: 'starter-fastify-browser-spec', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(listener.accountUrl), { requestInit: { headers: { Authorization: 'Bearer t' } } }));
});

test.afterAll(async () => {
  await client.close();
  await listener.close();
});

async function servedResource(): Promise<HostedResource & { uri: string }> {
  const { tools } = await client.listTools();
  const uri = (tools.find((tool) => tool.name === 'get_account')?._meta as { ui: { resourceUri: string } } | undefined)?.ui.resourceUri;
  if (uri === undefined) throw new Error('get_account is not linked to a view');
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  if (!content || !('text' in content)) throw new Error('resources/read returned no text');
  return { uri, html: content.text, csp: (content._meta as { ui: { csp: HostedResource['csp'] } }).ui.csp };
}

const accountResult = () => client.callTool({ name: 'get_account', arguments: {} });
const deliver = (page: Page, result: unknown) => page.evaluate((payload) => window.deliverToolResult?.(payload as never), result);

/** Mounts the page the server serves in the host fixture. */
async function open(page: Page, options: { deliver?: boolean } = {}): Promise<{ view: FrameLocator; requests: string[] }> {
  const requests: string[] = [];
  page.on('request', (request) => void requests.push(request.url()));
  await page.goto('/host-fixture/index.html');
  const { html, csp } = await servedResource();
  await page.evaluate((resource) => window.mountView?.(resource), { html, csp });
  const view = page.frameLocator('iframe[title="MCP App view"]');
  if (options.deliver !== false) {
    await deliver(page, await accountResult());
    await expect(view.getByTestId('view-status')).toHaveText('Ready');
  }
  return { view, requests };
}

const note = (view: FrameLocator) => view.getByTestId('note');
const clear = (view: FrameLocator) => view.getByRole('button', { name: 'Clear the note' });

test('serves the built page byte for byte, linked from the result, under a closed policy', async () => {
  const served = await servedResource();
  const result = await accountResult();
  expect((result._meta as { ui: { resourceUri: string } }).ui.resourceUri).toBe(served.uri);
  expect(served.uri).toBe(`ui://sha256/${createHash('sha256').update(bytes).digest('hex')}.html`);
  expect(Buffer.from(served.html, 'utf8').equals(bytes)).toBe(true);
  expect(served.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] });
});

test('shows the signed-in account from the protected result and the status from the public one', async ({ page }) => {
  const { view } = await open(page);
  await expect(view.getByRole('heading')).toHaveText(`Signed in as ${ACCOUNT}`);

  const publicClient = new Client({ name: 'starter-fastify-browser-spec-public', version: '0.0.0' });
  await publicClient.connect(new StreamableHTTPClientTransport(new URL(listener.statusUrl)));
  try {
    await deliver(page, await publicClient.callTool({ name: 'get_status', arguments: {} }));
    await expect(view.getByRole('heading')).toHaveText('The service is running');
  } finally {
    await publicClient.close();
  }
});

test('the Clear control empties the application-owned input through the action attached to that rendered control, and sends nothing', async ({ page }) => {
  const { view, requests } = await open(page);
  const before = requests.length;

  await note(view).fill('a draft the person typed');
  await clear(view).click();

  await expect(note(view)).toHaveValue('');
  await expect(note(view)).toBeFocused();
  expect(requests.slice(before)).toEqual([]);
});

test('a result from a server of another build, or a failure, renders none of it', async ({ page }) => {
  const { view } = await open(page, { deliver: false });

  await deliver(page, { content: [{ type: 'text', text: 'shown?' }], structuredContent: { accountId: ACCOUNT, schemaVersion: 2 } });
  await expect(view.getByTestId('view-status')).toHaveText(MISMATCH_TEXT);
  await expect(view.locator('body')).not.toContainText(ACCOUNT);

  await deliver(page, { isError: true, content: [{ type: 'text', text: 'This account may not see this.' }] });
  await expect(view.getByTestId('view-status')).toHaveText(PROBLEM_TEXT);
  await expect(view.getByRole('heading')).toHaveText('');

  // The view is not left broken: a result of its own server's build still shows.
  await deliver(page, await accountResult());
  await expect(view.getByTestId('view-status')).toHaveText('Ready');
  await expect(view.getByRole('heading')).toHaveText(`Signed in as ${ACCOUNT}`);
});

test('ending the view disposes its bindings: a retained Clear control no longer acts', async ({ page }) => {
  for (const ending of ['the host asks the view to tear down', 'the page goes away'] as const) {
    const { view } = await open(page);
    await note(view).fill('kept');
    const retained = await clear(view).elementHandle();

    if (ending === 'the page goes away') await view.locator('body').evaluate(() => window.dispatchEvent(new Event('pagehide')));
    else await page.evaluate(() => window.teardownView?.());
    await expect(view.getByTestId('view-status'), ending).toHaveText(CLOSED_TEXT);
    await expect(view.locator('starter-app'), ending).toHaveCount(0);

    await retained?.evaluate((button) => (button as HTMLElement).click());
    await page.waitForTimeout(150);
    await expect(note(view), ending).toHaveValue('kept');
  }
});

test('two overlapping requests for different accounts each reach their own view, and only that account is shown in it', async ({ browser }) => {
  let release!: () => void;
  together = { arrived: 0, release: () => release(), settled: new Promise<void>((resolve) => (release = resolve)) };
  const other = new Client({ name: 'starter-fastify-browser-spec-other', version: '0.0.0' });
  await other.connect(new StreamableHTTPClientTransport(new URL(listener.accountUrl), { requestInit: { headers: { Authorization: 'Bearer u' } } }));
  try {
    // Neither answer is produced until both handlers are inside the application's policy at once.
    const [mine, theirs] = await Promise.all([accountResult(), other.callTool({ name: 'get_account', arguments: {} })]);
    expect(together.arrived).toBe(2);

    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const views: FrameLocator[] = [];
      for (const [index, result] of [mine, theirs].entries()) {
        const page = pages[index] as Page;
        await page.goto('/host-fixture/index.html');
        const { html, csp } = await servedResource();
        await page.evaluate((resource) => window.mountView?.(resource), { html, csp });
        views.push(page.frameLocator('iframe[title="MCP App view"]'));
        await deliver(page, result);
      }
      await expect((views[0] as FrameLocator).getByRole('heading')).toHaveText(`Signed in as ${ACCOUNT}`);
      await expect((views[1] as FrameLocator).getByRole('heading')).toHaveText(`Signed in as ${OTHER_ACCOUNT}`);
      await expect((views[0] as FrameLocator).locator('body')).not.toContainText(OTHER_ACCOUNT);
      await expect((views[1] as FrameLocator).locator('body')).not.toContainText(ACCOUNT);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  } finally {
    together = undefined;
    await other.close();
  }
});
