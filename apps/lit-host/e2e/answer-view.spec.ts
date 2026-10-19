import { readFile } from 'node:fs/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { ANSWER_TOOL_NAME, ANSWER_UNAVAILABLE_TEXT, ANSWER_VIEW_URI } from '../src/mcp/answer.js';
import type { AnswerBackend } from '../src/mcp/answer-server.js';
import { startEpisodeListener, type EpisodeListener } from '../src/mcp/listener.js';
import { builtUrl } from './built-artifacts.js';
import type { HostedResource } from './host-fixture/host.js';

// End to end: the real listener (public answer endpoint, no credential) -> a real MCP client's
// tools/call and resources/read -> the built answer view in a sandboxed iframe, through the test
// host's real AppBridge. Both supported response modes. The local host fixture is not evidence of
// any actual host.

const CANARY = 'canary-backend-secret';

/** What the application's backend does for the next question. Each test sets its own. */
let behavior: AnswerBackend['answer'] = async () => undefined;
const questionsAsked: string[] = [];
const backend: AnswerBackend = {
  answer(question, request) {
    questionsAsked.push(question);
    return behavior(question, request);
  },
};

const listeners = {} as Record<'json' | 'event-stream', EpisodeListener>;

test.beforeAll(async () => {
  const viewHtml = await readFile(builtUrl('answer-view/answer.html'), 'utf8');
  for (const mode of ['json', 'event-stream'] as const) {
    listeners[mode] = await startEpisodeListener({
      viewHtml,
      catalog: { find: () => undefined },
      port: 0,
      answer: { viewHtml, backend, responseMode: mode },
    });
  }
});

test.afterAll(async () => {
  await Promise.all(Object.values(listeners).map((listener) => listener.close()));
});

test.beforeEach(() => {
  questionsAsked.length = 0;
  behavior = async () => undefined;
});

async function connect(mode: 'json' | 'event-stream'): Promise<Client> {
  const client = new Client({ name: 'e2e-host', version: '0.0.0' });
  // No credential of any kind: the operation is public.
  await client.connect(new StreamableHTTPClientTransport(new URL(listeners[mode].answerUrl ?? '')));
  return client;
}

async function mountedView(page: Page, client: Client): Promise<FrameLocator> {
  const { contents } = await client.readResource({ uri: ANSWER_VIEW_URI });
  const [content] = contents;
  if (!content || !('text' in content)) throw new Error('resources/read returned no text');
  const ui = (content._meta as { ui: { csp: HostedResource['csp'] } }).ui;
  await page.goto('/host-fixture/index.html');
  await page.evaluate((resource) => window.mountView?.(resource), { html: content.text, csp: ui.csp });
  return page.frameLocator('iframe[title="MCP App view"]');
}

const sendInput = (page: Page, question: unknown) =>
  page.evaluate((arguments_) => window.deliverToolInput?.({ arguments: arguments_ }), { question } as never);
const sendResult = (page: Page, result: unknown) =>
  page.evaluate((payload) => window.deliverToolResult?.(payload), result as never);
const callAnswer = (client: Client, question: string, options?: Parameters<Client['callTool']>[1]) =>
  client.callTool({ name: ANSWER_TOOL_NAME, arguments: { question } }, options);

for (const mode of ['json', 'event-stream'] as const) {
  test.describe(`${mode} responses`, () => {
    test('a delayed answer appears beside the exact question once the host delivers it, after one handler call', async ({ page }) => {
      let release: (answer: string) => void = () => undefined;
      const delayed = new Promise<string>((resolve) => (release = resolve));
      const progress: string[] = [];
      behavior = async (_question, request) => {
        await request.reportProgress({ progress: 1, total: 2, message: 'searching' });
        return delayed;
      };
      const client = await connect(mode);
      const view = await mountedView(page, client);

      await sendInput(page, 'Why is the sky blue?');
      await expect(view.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');
      await expect(view.getByTestId('answer-question')).toHaveText('Why is the sky blue?');
      await expect(view.getByTestId('answer-text')).toBeHidden();

      const call = callAnswer(client, 'Why is the sky blue?', { onprogress: (update) => void progress.push(String(update.message)) });
      await expect.poll(() => questionsAsked.length).toBe(1);
      // Still waiting while the application takes its time: nothing is shown early.
      await expect(view.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');
      release('Shorter wavelengths scatter more.');
      await sendResult(page, await call);

      await expect(view.getByTestId('answer-root')).toHaveAttribute('data-state', 'answer');
      await expect(view.getByTestId('answer-question')).toHaveText('Why is the sky blue?');
      await expect(view.getByTestId('answer-text')).toHaveText('Shorter wavelengths scatter more.');
      expect(questionsAsked).toEqual(['Why is the sky blue?']);
      if (mode === 'event-stream') expect(progress).toEqual(['searching']);
      await client.close();
    });

    test('a failing application shows only the safe failure text', async ({ page }) => {
      behavior = async () => {
        throw new Error(`database exploded: ${CANARY}`);
      };
      const client = await connect(mode);
      const view = await mountedView(page, client);
      await sendInput(page, 'Anything?');
      await sendResult(page, await callAnswer(client, 'Anything?'));
      await expect(view.getByTestId('answer-root')).toHaveAttribute('data-state', 'problem');
      await expect(view.getByTestId('answer-status')).toHaveText(ANSWER_UNAVAILABLE_TEXT);
      await expect(view.getByTestId('answer-text')).toBeHidden();
      await expect(view.getByText(CANARY)).toHaveCount(0);
      await client.close();
    });

    test('early, repeated and late deliveries leave the right answer, and teardown ends delivery', async ({ page }) => {
      behavior = async (question) => `Answer to ${question}`;
      const client = await connect(mode);
      const view = await mountedView(page, client);
      const first = await callAnswer(client, 'First?');
      const second = await callAnswer(client, 'Second?');

      // Early: the result arrives before the host announces the input.
      await sendResult(page, first);
      await expect(view.getByTestId('answer-question')).toHaveText('First?');
      await expect(view.getByTestId('answer-text')).toHaveText('Answer to First?');
      // Repeated: the same result again changes nothing and adds nothing.
      await sendResult(page, first);
      await expect(view.getByTestId('answer-text')).toHaveCount(1);
      await expect(view.getByTestId('answer-text')).toHaveText('Answer to First?');

      // A different question clears the old answer; a late copy of the old result does not revive it.
      await sendInput(page, 'Second?');
      await expect(view.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');
      await sendResult(page, first);
      await expect(view.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');
      await expect(view.getByText('Answer to First?')).toHaveCount(0);
      await sendResult(page, second);
      await expect(view.getByTestId('answer-text')).toHaveText('Answer to Second?');

      // Teardown retires the connection: a result delivered afterwards is not shown.
      await page.evaluate(() => window.teardownView?.());
      await sendResult(page, first).catch(() => undefined);
      await expect(view.getByTestId('answer-text')).toHaveText('Answer to Second?');
      expect(questionsAsked).toEqual(['First?', 'Second?']);
      await client.close();
    });

    test('markup in a question or answer stays visible text', async ({ page }) => {
      behavior = async () => '<b>bold</b> <img src=x onerror=alert(1)>';
      const client = await connect(mode);
      const view = await mountedView(page, client);
      await sendResult(page, await callAnswer(client, '<i>why</i>?'));
      await expect(view.getByTestId('answer-question')).toHaveText('<i>why</i>?');
      await expect(view.getByTestId('answer-text')).toHaveText('<b>bold</b> <img src=x onerror=alert(1)>');
      await expect(view.locator('b, i, img')).toHaveCount(0);
      await client.close();
    });
  });
}
