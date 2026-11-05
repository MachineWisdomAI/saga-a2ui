import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { builtUrl } from './built-artifacts.js';
import type {
  ConversationBehavior,
  HostedResource,
} from './host-fixture/host.js';

// `ViewHost.conversation` of the React stack and of the Lit stack in a real browser. Each stack's
// probe page is mounted in the local host fixture's sandboxed iframe and asks its own
// `host.conversation` to add a message over a real AppBridge. The fixture records every
// `ui/update-model-context` and `ui/message` request in the order it received them and can
// withhold, refuse, fail or hold each kind, so the specification reads the order and the content
// of what the host heard and the outcome the view got. Both stacks run the same scenarios. The host
// fixture is not evidence of any actual host.

const STACKS = ['react', 'lit'] as const;

const CONTEXT = { text: 'The board is X.O', data: { game: { gameId: 'g1' } } };
const MESSAGE = (text: string) => ({
  kind: 'message',
  params: { role: 'user', content: [{ type: 'text', text }] },
});
const CONTEXT_REQUEST = {
  kind: 'context',
  params: {
    content: [{ type: 'text', text: CONTEXT.text }],
    structuredContent: CONTEXT.data,
  },
};

interface Behaviours {
  readonly context?: ConversationBehavior;
  readonly message?: ConversationBehavior;
}

for (const stack of STACKS) {
  test.describe(`ViewHost.conversation of the ${stack} stack`, () => {
    let probe: string;
    test.beforeAll(async () => {
      probe = await readFile(
        builtUrl(`view-conversation/${stack}.html`),
        'utf8',
      );
    });

    async function mount(page: Page, conversation?: Behaviours) {
      await page.goto('/host-fixture/index.html');
      const hosted: HostedResource = {
        html: probe,
        csp: { connectDomains: [], resourceDomains: [] },
      };
      await page.evaluate(
        ([resource, behaviours]) =>
          window.mountView?.(resource, {
            ...(behaviours === undefined ? {} : { conversation: behaviours }),
          }),
        [hosted, conversation] as const,
      );
      const handle = await page
        .locator('iframe[title="MCP App view"]')
        .elementHandle();
      const frame = await handle?.contentFrame();
      if (!frame) throw new Error('the probe did not mount');
      await frame.waitForSelector('body[data-ready="true"]');
      return {
        append: (
          text: string,
          options?: {
            context?: {
              text: string;
              data?: Record<string, unknown>;
              bestEffort?: boolean;
            };
          },
        ) =>
          frame.evaluate(
            ([message, given]) => window.appendMessage?.(message, given),
            [text, options] as const,
          ),
        heard: () => page.evaluate(() => window.conversationRequests?.()),
        release: () => page.evaluate(() => window.releaseConversation?.()),
        end: () => page.evaluate(() => window.teardownView?.()),
      };
    }

    test('adds exactly one message as the person, with no context request, when there is no context', async ({
      page,
    }) => {
      const view = await mount(page, {});
      expect(await view.append('Your move')).toEqual({ outcome: 'appended' });
      expect(await view.heard()).toEqual([MESSAGE('Your move')]);
    });

    test('sends the context update, then the message, in that order', async ({
      page,
    }) => {
      const view = await mount(page, {});
      expect(await view.append('Your move', { context: CONTEXT })).toEqual({
        outcome: 'appended',
      });
      expect(await view.heard()).toEqual([
        CONTEXT_REQUEST,
        MESSAGE('Your move'),
      ]);
    });

    test('does not send the message while the host has not answered the context', async ({
      page,
    }) => {
      const view = await mount(page, { context: 'hold' });
      const pending = view.append('Your move', { context: CONTEXT });
      await expect.poll(view.heard).toEqual([CONTEXT_REQUEST]);
      await page.waitForTimeout(150);
      expect(await view.heard()).toEqual([CONTEXT_REQUEST]);
      await view.release();
      expect(await pending).toEqual({ outcome: 'appended' });
      expect(await view.heard()).toEqual([
        CONTEXT_REQUEST,
        MESSAGE('Your move'),
      ]);
    });

    // The bridge gives `ui/update-model-context` an empty result, so the fixture's refusal is a
    // rejected request, which the view reads as `failed` (see `conversationFromApp`).
    const contextFailures = [
      ['withheld', 'withhold', 'unavailable', []],
      ['refused', 'refuse', 'failed', [CONTEXT_REQUEST]],
      ['failed', 'fail', 'failed', [CONTEXT_REQUEST]],
    ] as const;
    for (const [what, behaviour, outcome, attempted] of contextFailures) {
      test(`by default sends no message when the context is ${what}, and names the context stage`, async ({
        page,
      }) => {
        const view = await mount(page, { context: behaviour });
        expect(await view.append('Your move', { context: CONTEXT })).toEqual({
          outcome,
          stage: 'context',
        });
        expect(await view.heard()).toEqual(attempted);
      });

      test(`with best effort still sends the message when the context is ${what}, and says why it was skipped`, async ({
        page,
      }) => {
        const view = await mount(page, { context: behaviour });
        expect(
          await view.append('Your move', {
            context: { ...CONTEXT, bestEffort: true },
          }),
        ).toEqual({ outcome: 'appended', context: outcome });
        expect(await view.heard()).toEqual([
          ...attempted,
          MESSAGE('Your move'),
        ]);
      });
    }

    test('reports a refused message as denied at the message stage, and does not retry it', async ({
      page,
    }) => {
      const view = await mount(page, { message: 'refuse' });
      expect(await view.append('Your move')).toEqual({
        outcome: 'denied',
        stage: 'message',
      });
      await page.waitForTimeout(150);
      expect(await view.heard()).toEqual([MESSAGE('Your move')]);
    });

    test('reports a failing message as failed at the message stage, after the context was sent', async ({
      page,
    }) => {
      const view = await mount(page, { message: 'fail' });
      expect(await view.append('Your move', { context: CONTEXT })).toEqual({
        outcome: 'failed',
        stage: 'message',
      });
      expect(await view.heard()).toEqual([
        CONTEXT_REQUEST,
        MESSAGE('Your move'),
      ]);
    });

    test('reports the message as unavailable at the message stage, and sends nothing, when the host does not advertise it', async ({
      page,
    }) => {
      const view = await mount(page, { message: 'withhold' });
      expect(await view.append('Your move')).toEqual({
        outcome: 'unavailable',
        stage: 'message',
      });
      expect(await view.heard()).toEqual([]);
    });

    test('reports unavailable and sends nothing further once the view has ended', async ({
      page,
    }) => {
      const view = await mount(page, {});
      expect(await view.append('First')).toEqual({ outcome: 'appended' });
      await view.end();
      // The view's frame stays in place after teardown, so its page can still make the call.
      expect(await view.append('Second', { context: CONTEXT })).toEqual({
        outcome: 'unavailable',
        stage: 'context',
      });
      expect(await view.heard()).toEqual([MESSAGE('First')]);
    });

    test('ignores the late answer to a request that was outstanding when the view ended', async ({
      page,
    }) => {
      const view = await mount(page, { context: 'hold' });
      const pending = view.append('Your move', { context: CONTEXT });
      await expect.poll(view.heard).toEqual([CONTEXT_REQUEST]);
      await view.end();
      await view.release();
      expect(await pending).toEqual({
        outcome: 'unavailable',
        stage: 'context',
      });
      expect(await view.heard()).toEqual([CONTEXT_REQUEST]);
    });
  });
}
