import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Client } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import {
  REFUSED_DESCRIPTIONS,
  VALID_DESCRIPTIONS,
} from '../../../packages/components/src/faithful-card/description-fixtures.test-support.js';
import { startTestHost, type TestHost } from '../../../packages/mcp/src/server/http-host.test-support.js';
import { expectInOrder, outlineOf } from './faithful-card-harness.js';
import type { HostedResource } from './host-fixture/host.js';

// CARD2 through a real view result: the representative description fixtures are what the installed
// answer consumer's MCP server returns from real `tools/call` requests, and the result goes to the
// built page mounted in the local host fixture over its real AppBridge. The page and server were built
// by scripts/build-answer-consumer.ts from the packed SDK packages alone (registration is the page's
// own `registerFaithfulCard()`). Results the contract does not read are delivered by hand because
// the server's output schema would never produce them. The local host fixture is not evidence of any
// actual assistant host, and nothing here claims identical pixels or how a host narrates the card.

const builtPage = new URL('../dist/answer-consumer/mcp.html', import.meta.url);
const builtServer = new URL('../dist/answer-consumer-server/server.mjs', import.meta.url);
const TOOL = 'answer_question';
/** The card's own bound in this consumer (examples/answer-consumer/src/content-view.ts). */
const CONSUMER_BOUND = 50_000;

let host: TestHost;
let client: Client;

test.beforeAll(async () => {
  const pageBytes = await readFile(builtPage);
  const { createAnswerServer } = (await import(pathToFileURL(builtServer.pathname).href)) as {
    createAnswerServer: (html: string, answer: (question: string) => Promise<{ markdown: string }>) => McpServer;
  };
  host = await startTestHost({
    jsonResponse: true,
    // The question names a fixture; the server answers with that fixture's description.
    buildServer: () =>
      createAnswerServer(pageBytes.toString('utf8'), async (question) => {
        const found = VALID_DESCRIPTIONS.find((one) => one.id === question);
        if (found) return { markdown: found.markdown };
        if (question === 'oversize') return { markdown: 'x'.repeat(CONSUMER_BOUND + 1) };
        throw new Error('The answer service is unavailable.');
      }),
  });
  client = await host.connect();
});

test.afterAll(async () => {
  await host.close();
});

async function servedResource(): Promise<HostedResource & { uri: string }> {
  const { tools } = await client.listTools();
  const uri = (tools.find((tool) => tool.name === TOOL)?._meta as { ui: { resourceUri: string } } | undefined)?.ui.resourceUri;
  if (uri === undefined) throw new Error('answer_question is not linked to a view');
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  if (!content || !('text' in content)) throw new Error('resources/read returned no text');
  return { uri, html: content.text, csp: (content._meta as { ui: { csp: HostedResource['csp'] } }).ui.csp };
}

async function mountView(page: Page): Promise<FrameLocator> {
  await page.goto('/host-fixture/index.html');
  const { html, csp } = await servedResource();
  await page.evaluate((resource) => window.mountView?.(resource), { html, csp });
  return page.frameLocator('iframe[title="MCP App view"]');
}

const call = (question: string) => client.callTool({ name: TOOL, arguments: { question } });
const deliver = (page: Page, result: unknown) => page.evaluate((payload) => window.deliverToolResult?.(payload as never), result);

test.describe('descriptions the server returns reach the card whole, in their own structure and order', () => {
  test('each representative fixture, one after another, replaces the last and leaves none of it behind', async ({ page }) => {
    const view = await mountView(page);
    let previous: string | undefined;
    for (const description of VALID_DESCRIPTIONS) {
      const result = await call(description.id);
      expect(result.isError, description.id).toBeFalsy();
      await deliver(page, result);
      await expect(view.getByTestId('answer-status')).toHaveText('Answer');
      await expect(view.getByTestId('card-failure')).toHaveCount(0);
      await expect(view.getByTestId('card-content')).toContainText(description.order[0] as string);

      expect(await outlineOf(view), description.id).toEqual(description.outline);
      // The Standard consumer shows refused links and images as text in place; markup is the characters written.
      const text = await view.getByTestId('card-content').evaluate((element) => (element as HTMLElement).innerText);
      expectInOrder(text, description.order, description.id);
      if (previous !== undefined) expect(text, `${description.id} after ${previous}`).not.toContain(previous);
      previous = description.order[0];
      await expect(view.locator('saga-faithful-card')).toHaveCount(1);
    }
  });

  test('a description over this consumer\'s bound is refused by the card with an alert, shows nothing of it, and the next result recovers', async ({ page }) => {
    const view = await mountView(page);
    await deliver(page, await call('structured'));
    await expect(view.getByTestId('card-content')).toContainText('Reading plan');

    const result = await call('oversize');
    expect(result.isError).toBeFalsy();
    await deliver(page, result);
    await expect(view.getByTestId('card-failure')).toHaveAttribute('data-reason', 'too-long');
    await expect(view.getByTestId('card-failure')).toHaveAttribute('role', 'alert');
    await expect(view.getByTestId('card-content')).toHaveCount(0);
    expect(await view.locator('answer-view').innerText()).not.toMatch(/Reading plan|xxxxxxxx/);

    await deliver(page, await call('multilingual-long'));
    await expect(view.getByTestId('card-failure')).toHaveCount(0);
    await expect(view.getByTestId('card-content')).toContainText('Episode 42');
  });
});

test.describe('results outside the contract show nothing of the earlier or the refused text', () => {
  for (const refused of REFUSED_DESCRIPTIONS.filter((one) => one.failure === 'unsupported-version' || one.failure === 'invalid')) {
    test(`${refused.id}: the view says the answer could not be shown, clears the card and recovers on the next valid result`, async ({ page }) => {
      const view = await mountView(page);
      await deliver(page, await call('hostile-references'));
      await expect(view.getByTestId('card-content')).toContainText('Opening line for the reader.');

      const structuredContent = refused.markdown === undefined ? { contractVersion: refused.contractVersion } : { contractVersion: refused.contractVersion, markdown: refused.markdown };
      await deliver(page, { content: [], structuredContent });
      await expect(view.getByTestId('answer-status')).toHaveText('The answer could not be shown.');
      await expect(view.getByTestId('card-content')).toHaveText('');
      const text = await view.locator('answer-view').innerText();
      expect(text).not.toContain('Opening line for the reader.');
      expect(text).not.toContain(refused.secret);

      await deliver(page, await call('structured'));
      await expect(view.getByTestId('answer-status')).toHaveText('Answer');
      await expect(view.getByTestId('card-content')).toContainText('Reading plan');
      await expect(view.getByTestId('card-content')).not.toContainText('Opening line for the reader.');
    });
  }
});
