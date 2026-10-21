import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Client } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import {
  startTestHost,
  type TestHost,
} from '../../../packages/mcp/src/server/http-host.test-support.js';
import type { HostedResource } from './host-fixture/host.js';

// The installed second consumer (examples/answer-consumer) as an MCP host receives it. The page
// under test is the one the consumer's own server serves over a real MCP connection: its
// `tools/call` and `resources/read` go through a real client, the served bytes are mounted in the
// sandboxed iframe of the local host fixture, and the result the server returned is delivered over
// the fixture's real AppBridge. Nothing here talks to the page except that bridge. The page and
// the server were built by scripts/build-answer-consumer.ts from the packed SDK packages alone.
// The local host fixture is not evidence of any actual assistant host.

const builtPage = new URL('../dist/answer-consumer/mcp.html', import.meta.url);
const builtServer = new URL(
  '../dist/answer-consumer-server/server.mjs',
  import.meta.url,
);
const TOOL = 'answer_question';

/** Every question the consumer's server was asked: the only provider call there is. */
const asked: string[] = [];
let pageBytes: Buffer;
let host: TestHost;
let client: Client;

test.beforeAll(async () => {
  pageBytes = await readFile(builtPage);
  const { createAnswerServer } = (await import(
    pathToFileURL(builtServer.pathname).href
  )) as {
    createAnswerServer: (
      html: string,
      answer: (question: string) => Promise<{ markdown: string }>,
    ) => McpServer;
  };
  host = await startTestHost({
    jsonResponse: true,
    buildServer: () =>
      createAnswerServer(pageBytes.toString('utf8'), async (question) => {
        asked.push(question);
        if (question.includes('fail'))
          throw new Error('The answer service is unavailable.');
        return {
          markdown: `# Served answer ${asked.length}\n\nThe server was asked: **${question}**`,
        };
      }),
  });
  client = await host.connect();
});

test.afterAll(async () => {
  await host.close();
});

test.beforeEach(() => {
  asked.length = 0;
});

async function servedResource(): Promise<HostedResource & { uri: string }> {
  const { tools } = await client.listTools();
  const uri = (
    tools.find((tool) => tool.name === TOOL)?._meta as
      { ui: { resourceUri: string } } | undefined
  )?.ui.resourceUri;
  if (uri === undefined)
    throw new Error('answer_question is not linked to a view');
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  if (!content || !('text' in content))
    throw new Error('resources/read returned no text');
  return {
    uri,
    html: content.text,
    csp: (content._meta as { ui: { csp: HostedResource['csp'] } }).ui.csp,
  };
}

async function mount(
  page: Page,
  options?: { resultDuringInitialization?: unknown },
): Promise<FrameLocator> {
  await page.goto('/host-fixture/index.html');
  const { html, csp } = await servedResource();
  await page.evaluate(
    ([resource, mountOptions]) =>
      window.mountView?.(resource, mountOptions as never),
    [{ html, csp }, options] as const,
  );
  return page.frameLocator('iframe[title="MCP App view"]');
}

const call = (question: string) =>
  client.callTool({ name: TOOL, arguments: { question } });
const deliver = (page: Page, result: unknown) =>
  page.evaluate(
    (payload) => window.deliverToolResult?.(payload as never),
    result,
  );
const card = (view: FrameLocator) => view.getByTestId('card-content');

test('the tool is linked to the exact built page, served byte for byte under a closed policy', async () => {
  const served = await servedResource();
  const result = await call('anything');
  expect((result._meta as { ui: { resourceUri: string } }).ui.resourceUri).toBe(
    served.uri,
  );
  expect(Buffer.from(served.html, 'utf8').equals(pageBytes)).toBe(true);
  expect(served.csp).toEqual({
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
    baseUriDomains: [],
  });
  // It is the page that receives host results, not the standalone question form.
  expect(served.html).toContain('<answer-view>');
});

test('the first host-delivered result and each replacement reach the shared card, with no second provider call', async ({
  page,
}) => {
  const view = await mount(page);
  await expect(view.getByTestId('answer-status')).toHaveText(
    'Waiting for the answer…',
  );
  await expect(card(view)).toHaveText(''); // nothing to show before the host delivers a result
  await expect(view.locator('form, input')).toHaveCount(0);

  const first = await call('first question');
  expect(first.isError).toBeFalsy();
  await deliver(page, first);
  await expect(view.getByTestId('answer-status')).toHaveText('Answer');
  await expect(
    card(view).getByRole('heading', { name: 'Served answer 1' }),
  ).toBeVisible();
  await expect(card(view)).toContainText(
    'The server was asked: first question',
  );

  const second = await call('second question');
  await deliver(page, second);
  await expect(
    card(view).getByRole('heading', { name: 'Served answer 2' }),
  ).toBeVisible();
  await expect(card(view)).toContainText(
    'The server was asked: second question',
  );
  await expect(view.getByText('first question')).toHaveCount(0);
  await expect(view.locator('saga-faithful-card')).toHaveCount(1);

  // Two tool calls, two server-side answers: delivering them to the page made no further call, and
  // nothing the standalone page's synthetic provider would write appears.
  expect(asked).toEqual(['first question', 'second question']);
  await expect(view.getByText('Dates and figs')).toHaveCount(0);
});

test('a result delivered while the view is still initializing renders once, and a later one replaces it', async ({
  page,
}) => {
  const early = await call('early question');
  const view = await mount(page, { resultDuringInitialization: early });
  await expect(card(view)).toContainText(
    'The server was asked: early question',
  );
  await expect(view.locator('saga-faithful-card')).toHaveCount(1);

  await deliver(page, await call('later question'));
  await expect(card(view)).toContainText(
    'The server was asked: later question',
  );
  await expect(view.getByText('early question')).toHaveCount(0);
  await expect(view.locator('saga-faithful-card')).toHaveCount(1);
});

for (const [name, bad] of [
  ["the server's failure result", undefined],
  [
    'a result outside the published output',
    { content: [], structuredContent: { contractVersion: 2, markdown: 'x' } },
  ],
  [
    'a result with no structured content',
    { content: [{ type: 'text', text: 'plain' }] },
  ],
] as const) {
  test(`${name} clears the shown answer and says so, and a valid result recovers`, async ({
    page,
  }) => {
    const view = await mount(page);
    await deliver(page, await call('prior question'));
    await expect(card(view)).toContainText('prior question');

    const failure = bad ?? (await call('please fail'));
    if (bad === undefined)
      expect((failure as { isError?: boolean }).isError).toBe(true);
    await deliver(page, failure);
    await expect(view.getByTestId('answer-status')).toHaveText(
      'The answer could not be shown.',
    );
    await expect(card(view)).toHaveText('');
    await expect(view.getByText('prior question')).toHaveCount(0);

    await deliver(page, await call('recovered question'));
    await expect(view.getByTestId('answer-status')).toHaveText('Answer');
    await expect(card(view)).toContainText('recovered question');
  });
}

test('after host teardown a late result changes nothing', async ({ page }) => {
  const view = await mount(page);
  await deliver(page, await call('before teardown'));
  await expect(card(view)).toContainText('before teardown');

  await page.evaluate(() => window.teardownView?.());
  const late = await call('after teardown');
  await deliver(page, late).catch(() => undefined);
  await deliver(page, { isError: true, content: [] }).catch(() => undefined);
  await page.waitForTimeout(300);
  await expect(card(view)).toContainText('before teardown');
  await expect(view.getByText('after teardown')).toHaveCount(0);
  await expect(view.getByTestId('answer-status')).toHaveText('Answer');
});

test('remounting the page delivers each result once', async ({ page }) => {
  await mount(page);
  const view = await mount(page); // replaces the first iframe and bridge
  await deliver(page, await call('after remount'));
  await expect(card(view)).toContainText('after remount');
  await expect(view.locator('saga-faithful-card')).toHaveCount(1);
});

test('a link in the answer leaves only as a request to the host, which decides', async ({
  page,
}) => {
  const opened: string[] = [];
  await page.goto('/host-fixture/index.html');
  await page.exposeFunction(
    'recordOpen',
    (url: string) => void opened.push(url),
  );
  await page.evaluate(() => {
    window.handleOpenLink = async ({ url }) => {
      await (
        window as unknown as { recordOpen: (url: string) => Promise<void> }
      ).recordOpen(url);
      return {};
    };
  });
  const { html, csp } = await servedResource();
  await page.evaluate((resource) => window.mountView?.(resource), {
    html,
    csp,
  });
  const view = page.frameLocator('iframe[title="MCP App view"]');

  await deliver(page, {
    content: [],
    structuredContent: {
      contractVersion: 1,
      markdown: 'Read [the guide](https://docs.example.com/guide).',
    },
  });
  const link = card(view).getByRole('button', { name: /the guide/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect.poll(() => opened).toEqual(['https://docs.example.com/guide']);
});
