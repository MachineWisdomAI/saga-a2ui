import { readFile } from 'node:fs/promises';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import {
  ANSWER_INVALID_OUTPUT_TEXT,
  ANSWER_LIMITS,
  ANSWER_TOOL_NAME,
  ANSWER_UNAVAILABLE_TEXT,
  ANSWER_VIEW_URI,
} from '../src/mcp/answer.js';
import type { AnswerBackend } from '../src/mcp/answer-server.js';
import {
  startEpisodeListener,
  type EpisodeListener,
} from '../src/mcp/listener.js';
import { builtUrl } from './built-artifacts.js';
import type { HostedResource } from './host-fixture/host.js';

// CORE3 end to end: the real listener, with a short operation limit -> a real MCP client's tools/call
// -> the built answer view in a sandboxed iframe, through the test host's AppBridge. It runs against
// the workspace build and, with SAGA_BUILT_DIR=dist-installed, the build made from the packed SDK
// packages (VIEW2's harness, reused unchanged). A stalled or misbehaving application callback must
// reach the person only as the declared safe text, whatever the response mode, and a late answer
// must change nothing. The local host fixture is not evidence of any actual host.

const CANARY = 'canary-pipeline-secret';
const OPERATION_MS = 150;

let behavior: AnswerBackend['answer'] = async () => undefined;
let asked = 0;
const backend: AnswerBackend = {
  answer(question, request) {
    asked += 1;
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
      budgets: { operationMs: OPERATION_MS, requestMs: 2_000 },
      answer: { viewHtml, backend, responseMode: mode },
    });
  }
});

test.afterAll(async () => {
  await Promise.all(
    Object.values(listeners).map((listener) => listener.close()),
  );
});

test.beforeEach(() => {
  asked = 0;
  behavior = async () => undefined;
});

async function connect(mode: 'json' | 'event-stream'): Promise<Client> {
  const client = new Client({ name: 'e2e-host', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(listeners[mode].answerUrl ?? '')),
  );
  return client;
}

async function mountedView(page: Page, client: Client): Promise<FrameLocator> {
  const { contents } = await client.readResource({ uri: ANSWER_VIEW_URI });
  const [content] = contents;
  if (!content || !('text' in content))
    throw new Error('resources/read returned no text');
  const ui = (content._meta as { ui: { csp: HostedResource['csp'] } }).ui;
  await page.goto('/host-fixture/index.html');
  await page.evaluate((resource) => window.mountView?.(resource), {
    html: content.text,
    csp: ui.csp,
  });
  return page.frameLocator('iframe[title="MCP App view"]');
}

const sendInput = (page: Page, question: string) =>
  page.evaluate(
    (arguments_) => window.deliverToolInput?.({ arguments: arguments_ }),
    { question } as never,
  );
const sendResult = (page: Page, result: unknown) =>
  page.evaluate(
    (payload) => window.deliverToolResult?.(payload),
    result as never,
  );
const callAnswer = (client: Client, question: string) =>
  client.callTool({ name: ANSWER_TOOL_NAME, arguments: { question } });

for (const mode of ['json', 'event-stream'] as const) {
  test.describe(`${mode} responses`, () => {
    test('a stalled application ends at the operation limit with the safe text, and its late answer changes nothing', async ({
      page,
    }) => {
      let release: (answer: string) => void = () => undefined;
      const late = new Promise<string>((resolve) => (release = resolve));
      behavior = () => late;
      const client = await connect(mode);
      const view = await mountedView(page, client);
      await sendInput(page, 'Slow?');
      const started = Date.now();
      const failed = await callAnswer(client, 'Slow?');
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(failed.isError).toBe(true);
      await sendResult(page, failed);
      await expect(view.getByTestId('answer-root')).toHaveAttribute(
        'data-state',
        'problem',
      );
      await expect(view.getByTestId('answer-status')).toHaveText(
        ANSWER_UNAVAILABLE_TEXT,
      );
      release(`${CANARY} late answer`);
      await page.waitForTimeout(100);
      await expect(view.getByTestId('answer-root')).toHaveAttribute(
        'data-state',
        'problem',
      );
      await expect(view.getByText(CANARY)).toHaveCount(0);
      expect(asked).toBe(1);
      await client.close();
    });

    test('an oversized answer is refused before serialization and shows only the contract-failure text', async ({
      page,
    }) => {
      behavior = async () => `${CANARY}${'x'.repeat(ANSWER_LIMITS.maxAnswer)}`;
      const client = await connect(mode);
      const view = await mountedView(page, client);
      await sendInput(page, 'Big?');
      const refused = await callAnswer(client, 'Big?');
      expect(refused.structuredContent).toBeUndefined();
      expect(JSON.stringify(refused)).not.toContain(CANARY);
      await sendResult(page, refused);
      await expect(view.getByTestId('answer-root')).toHaveAttribute(
        'data-state',
        'problem',
      );
      await expect(view.getByTestId('answer-status')).toHaveText(
        ANSWER_INVALID_OUTPUT_TEXT,
      );
      await expect(view.getByText(CANARY)).toHaveCount(0);
      await client.close();
    });

    test('a new question recovers the view after a failure, and the failed call is never retried by the server', async ({
      page,
    }) => {
      behavior = async (question) => {
        if (question === 'Fails?')
          throw new Error(`database exploded: ${CANARY}`);
        return `Answer to ${question}`;
      };
      const client = await connect(mode);
      const view = await mountedView(page, client);
      await sendInput(page, 'Fails?');
      await sendResult(page, await callAnswer(client, 'Fails?'));
      await expect(view.getByTestId('answer-root')).toHaveAttribute(
        'data-state',
        'problem',
      );
      await sendInput(page, 'Works?');
      await sendResult(page, await callAnswer(client, 'Works?'));
      await expect(view.getByTestId('answer-text')).toHaveText(
        'Answer to Works?',
      );
      await expect(view.getByText(CANARY)).toHaveCount(0);
      expect(asked).toBe(2);
      await client.close();
    });
  });
}
