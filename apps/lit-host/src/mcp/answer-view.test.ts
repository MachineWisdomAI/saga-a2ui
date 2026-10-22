import { describe, expect, it } from 'vitest';
import { ANSWER_UNAVAILABLE_TEXT } from './answer.js';
import { createAnswerView, type AnswerViewState } from './answer-view.js';

// What the answer view decides about each notification it is given. Delivery order, holding early
// notifications and ending are the stack's (packages/*-mcp-stack tests); the page that composes
// them is exercised in a real browser by e2e/answer-view.spec.ts. The observable result here is the
// sequence of states the view asks to show.

const answerResult = (question: string, answer: string) => ({
  content: [{ type: 'text' as const, text: answer }],
  structuredContent: { question, answer },
});
const failureResult = (text: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text }],
});
const asked = (question: unknown) => ({ arguments: { question } });

function harness() {
  const states: AnswerViewState[] = [];
  return {
    view: createAnswerView((state) => void states.push(state)),
    states,
    last: () => states.at(-1),
  };
}

const answered = (question: string, answer: string): AnswerViewState => ({
  kind: 'answer',
  result: { question, answer },
});

describe('binding an answer to its question', () => {
  it('shows an answer with the question it carries when no input was seen first', () => {
    const h = harness();
    h.view.onToolResult(answerResult('Early?', 'Yes.'));
    expect(h.states).toEqual([answered('Early?', 'Yes.')]);
  });

  it('waits on the asked question, then shows its answer', () => {
    const h = harness();
    h.view.onToolInput(asked('Why?'));
    expect(h.last()).toEqual({ kind: 'waiting', question: 'Why?' });
    h.view.onToolResult(answerResult('Why?', 'Because.'));
    expect(h.last()).toEqual(answered('Why?', 'Because.'));
  });

  it('ignores an answer to a different question and keeps waiting for the one asked', () => {
    const h = harness();
    h.view.onToolInput(asked('First?'));
    h.view.onToolResult(answerResult('First?', 'One.'));
    expect(h.last()).toEqual(answered('First?', 'One.'));
    h.view.onToolInput(asked('Second?'));
    expect(h.last()).toEqual({ kind: 'waiting', question: 'Second?' });

    // A late delivery of the first answer must not replace what is being waited for.
    h.view.onToolResult(answerResult('First?', 'One.'));
    expect(h.last()).toEqual({ kind: 'waiting', question: 'Second?' });

    h.view.onToolResult(answerResult('Second?', 'Two.'));
    expect(h.last()).toEqual(answered('Second?', 'Two.'));
  });

  it('compares the question exactly, not after trimming or case folding', () => {
    const h = harness();
    h.view.onToolInput(asked('Why?'));
    h.view.onToolResult(answerResult('why?', 'Lower.'));
    h.view.onToolResult(answerResult('Why? ', 'Padded.'));
    expect(h.states).toEqual([{ kind: 'waiting', question: 'Why?' }]);
  });

  it('clears the previous answer as soon as a different question starts', () => {
    const h = harness();
    h.view.onToolResult(answerResult('Old?', 'Old answer.'));
    expect(h.last()).toEqual(answered('Old?', 'Old answer.'));
    h.view.onToolInput(asked('New?'));
    expect(h.last()).toEqual({ kind: 'waiting', question: 'New?' });
  });

  it('keeps an answer shown when the input for that same question arrives after it', () => {
    const h = harness();
    h.view.onToolResult(answerResult('Same?', 'Yes.'));
    h.view.onToolInput(asked('Same?'));
    expect(h.states).toEqual([answered('Same?', 'Yes.')]);
  });
});

describe('repeated deliveries', () => {
  it('shows a repeated identical answer once', () => {
    const h = harness();
    h.view.onToolInput(asked('Again?'));
    h.view.onToolResult(answerResult('Again?', 'Once.'));
    h.view.onToolResult(answerResult('Again?', 'Once.'));
    expect(h.states.filter((state) => state.kind === 'answer')).toEqual([
      answered('Again?', 'Once.'),
    ]);
  });

  it('replaces an answer with a different answer to the same question', () => {
    const h = harness();
    h.view.onToolResult(answerResult('Q?', 'First.'));
    h.view.onToolResult(answerResult('Q?', 'Second.'));
    expect(h.last()).toEqual(answered('Q?', 'Second.'));
  });
});

describe('failures', () => {
  it('shows a known safe failure text verbatim, drops the answer, and recovers on the next valid answer', () => {
    const h = harness();
    h.view.onToolResult(answerResult('Q?', 'Shown.'));
    h.view.onToolResult(failureResult(ANSWER_UNAVAILABLE_TEXT));
    expect(h.last()).toEqual({
      kind: 'problem',
      message: ANSWER_UNAVAILABLE_TEXT,
    });
    h.view.onToolResult(answerResult('Q?', 'Recovered.'));
    expect(h.last()).toEqual(answered('Q?', 'Recovered.'));
  });

  it('never shows failure text it does not recognise', () => {
    const h = harness();
    h.view.onToolResult(failureResult('database exploded: canary-secret'));
    expect(h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.states)).not.toContain('canary-secret');
  });

  it.each([
    [
      'no structured content',
      { content: [{ type: 'text' as const, text: 'x' }] },
    ],
    [
      'an undeclared field',
      {
        content: [],
        structuredContent: {
          question: 'Q?',
          answer: 'A.',
          extra: 'canary-extra',
        },
      },
    ],
    [
      'an empty answer',
      { content: [], structuredContent: { question: 'Q?', answer: '' } },
    ],
  ])('treats %s as a problem and shows none of it', (_name, result) => {
    const h = harness();
    h.view.onToolResult(answerResult('Q?', 'Shown.'));
    h.view.onToolResult(result);
    expect(h.last()?.kind).toBe('problem');
    expect(JSON.stringify(h.last())).not.toContain('canary-extra');
  });

  it.each([
    ['a missing question', { arguments: {} }],
    ['a non-string question', asked(7)],
    ['an empty question', asked('')],
  ])(
    'treats an input with %s as a problem and clears what was shown',
    (_name, input) => {
      const h = harness();
      h.view.onToolResult(answerResult('Q?', 'Shown.'));
      expect(h.last()).toEqual(answered('Q?', 'Shown.'));
      h.view.onToolInput(input);
      expect(h.last()?.kind).toBe('problem');
    },
  );
});
