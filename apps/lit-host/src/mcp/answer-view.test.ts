import { App } from '@modelcontextprotocol/ext-apps';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ANSWER_UNAVAILABLE_TEXT } from './answer.js';
import { connectAnswerView, type AnswerViewConnection, type AnswerViewState } from './answer-view.js';

// The answer view's delivery rules, exercised with a real `App` and `AppBridge` joined by an
// in-memory transport. The observable result is the sequence of states the view asks to show.

const answerResult = (question: string, answer: string) => ({
  content: [{ type: 'text' as const, text: answer }],
  structuredContent: { question, answer },
});
const failureResult = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });

interface Harness {
  readonly bridge: AppBridge;
  readonly states: AnswerViewState[];
  last(): AnswerViewState | undefined;
  connect(onInitialized?: (bridge: AppBridge) => void): Promise<AnswerViewConnection>;
}

const toClean: { app: App; bridge: AppBridge }[] = [];

function harness(): Harness {
  const app = new App({ name: 'test-answer-view', version: '0.0.0' }, {}, { autoResize: false });
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {});
  toClean.push({ app, bridge });
  const states: AnswerViewState[] = [];
  return {
    bridge,
    states,
    last: () => states.at(-1),
    async connect(onInitialized) {
      const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
      bridge.oninitialized = () => onInitialized?.(bridge);
      await bridge.connect(hostSide);
      return connectAnswerView({ app, transport: viewSide, show: (state) => states.push(state) });
    },
  };
}

afterEach(async () => {
  for (const { app, bridge } of toClean.splice(0)) {
    await app.close().catch(() => undefined);
    await bridge.close().catch(() => undefined);
  }
});

const answered = (question: string, answer: string): AnswerViewState => ({ kind: 'answer', result: { question, answer } });

describe('binding an answer to its question', () => {
  it('shows an answer with the question it carries when no input was seen first', async () => {
    const h = harness();
    await h.connect((bridge) => void bridge.sendToolResult(answerResult('Early?', 'Yes.')));
    await expect.poll(() => h.last()).toEqual(answered('Early?', 'Yes.'));
    expect(h.states).toHaveLength(1);
  });

  it('waits on the asked question, then shows its answer', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolInput({ arguments: { question: 'Why?' } });
    await expect.poll(() => h.last()).toEqual({ kind: 'waiting', question: 'Why?' });
    await h.bridge.sendToolResult(answerResult('Why?', 'Because.'));
    await expect.poll(() => h.last()).toEqual(answered('Why?', 'Because.'));
  });

  it('ignores an answer to a different question and keeps waiting for the one asked', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolInput({ arguments: { question: 'First?' } });
    await h.bridge.sendToolResult(answerResult('First?', 'One.'));
    await expect.poll(() => h.last()).toEqual(answered('First?', 'One.'));
    await h.bridge.sendToolInput({ arguments: { question: 'Second?' } });
    await expect.poll(() => h.last()).toEqual({ kind: 'waiting', question: 'Second?' });

    // A late delivery of the first answer must not replace what is being waited for.
    await h.bridge.sendToolResult(answerResult('First?', 'One.'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.last()).toEqual({ kind: 'waiting', question: 'Second?' });

    await h.bridge.sendToolResult(answerResult('Second?', 'Two.'));
    await expect.poll(() => h.last()).toEqual(answered('Second?', 'Two.'));
  });

  it('compares the question exactly, not after trimming or case folding', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolInput({ arguments: { question: 'Why?' } });
    await h.bridge.sendToolResult(answerResult('why?', 'Lower.'));
    await h.bridge.sendToolResult(answerResult('Why? ', 'Padded.'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.last()).toEqual({ kind: 'waiting', question: 'Why?' });
  });

  it('clears the previous answer as soon as a different question starts', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(answerResult('Old?', 'Old answer.'));
    await expect.poll(() => h.last()).toEqual(answered('Old?', 'Old answer.'));
    await h.bridge.sendToolInput({ arguments: { question: 'New?' } });
    await expect.poll(() => h.last()).toEqual({ kind: 'waiting', question: 'New?' });
  });

  it('keeps an answer shown when the input for that same question arrives after it', async () => {
    const h = harness();
    await h.connect((bridge) => void bridge.sendToolResult(answerResult('Same?', 'Yes.')));
    await expect.poll(() => h.last()).toEqual(answered('Same?', 'Yes.'));
    await h.bridge.sendToolInput({ arguments: { question: 'Same?' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.last()).toEqual(answered('Same?', 'Yes.'));
  });
});

describe('repeated and late deliveries', () => {
  it('shows a repeated identical answer once', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolInput({ arguments: { question: 'Again?' } });
    await h.bridge.sendToolResult(answerResult('Again?', 'Once.'));
    await h.bridge.sendToolResult(answerResult('Again?', 'Once.'));
    await expect.poll(() => h.last()).toEqual(answered('Again?', 'Once.'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.states.filter((state) => state.kind === 'answer')).toHaveLength(1);
  });

  it('replaces an answer with a different answer to the same question', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(answerResult('Q?', 'First.'));
    await h.bridge.sendToolResult(answerResult('Q?', 'Second.'));
    await expect.poll(() => h.last()).toEqual(answered('Q?', 'Second.'));
  });

  it('ignores deliveries after the view is disposed', async () => {
    const h = harness();
    const view = await h.connect();
    await h.bridge.sendToolResult(answerResult('Q?', 'Shown.'));
    await expect.poll(() => h.last()).toEqual(answered('Q?', 'Shown.'));
    view.dispose();
    await h.bridge.sendToolResult(answerResult('Q?', 'Late.')).catch(() => undefined);
    await h.bridge.sendToolInput({ arguments: { question: 'Later?' } }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.states).toEqual([answered('Q?', 'Shown.')]);
  });

  it('ignores deliveries after the host asks the view to tear down', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.teardownResource({});
    await h.bridge.sendToolResult(answerResult('Q?', 'Late.')).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.states).toEqual([]);
  });
});

describe('failures', () => {
  it('shows a known safe failure text verbatim, drops the answer, and recovers on the next valid answer', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(answerResult('Q?', 'Shown.'));
    await expect.poll(() => h.last()).toEqual(answered('Q?', 'Shown.'));
    await h.bridge.sendToolResult(failureResult(ANSWER_UNAVAILABLE_TEXT));
    await expect.poll(() => h.last()).toEqual({ kind: 'problem', message: ANSWER_UNAVAILABLE_TEXT });
    await h.bridge.sendToolResult(answerResult('Q?', 'Recovered.'));
    await expect.poll(() => h.last()).toEqual(answered('Q?', 'Recovered.'));
  });

  it('never shows failure text it does not recognise', async () => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(failureResult('database exploded: canary-secret'));
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.states)).not.toContain('canary-secret');
  });

  it.each([
    ['no structured content', { content: [{ type: 'text' as const, text: 'x' }] }],
    ['an undeclared field', { content: [], structuredContent: { question: 'Q?', answer: 'A.', extra: 'canary-extra' } }],
    ['an empty answer', { content: [], structuredContent: { question: 'Q?', answer: '' } }],
  ])('treats %s as a problem and shows none of it', async (_name, result) => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(answerResult('Q?', 'Shown.'));
    await h.bridge.sendToolResult(result);
    await expect.poll(() => h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).not.toContain('canary-extra');
  });

  it.each([
    ['a missing question', { arguments: {} }],
    ['a non-string question', { arguments: { question: 7 } }],
    ['an empty question', { arguments: { question: '' } }],
  ])('treats an input with %s as a problem and clears what was shown', async (_name, input) => {
    const h = harness();
    await h.connect();
    await h.bridge.sendToolResult(answerResult('Q?', 'Shown.'));
    await expect.poll(() => h.last()).toEqual(answered('Q?', 'Shown.'));
    await h.bridge.sendToolInput(input);
    await expect.poll(() => h.last()?.kind).toBe('problem');
  });
});
