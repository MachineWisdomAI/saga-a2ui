// The application's own answer function: the one place a real application would call its backend.
// SAGA knows nothing about it; the card receives only the Markdown the function returns.

/** What an answer function returns. The application decides what its answers contain. */
export interface Answer {
  readonly markdown: string;
}

/** Any implementation with this shape can be composed into the application. */
export type AnswerFunction = (question: string) => Promise<Answer>;

const IMAGE = 'https://images.example.com/chart.png';

/** A deterministic synthetic answer. The question's words choose extra material to exercise the card. */
export const fixtureAnswers: AnswerFunction = async (question) => {
  const lower = question.toLowerCase();
  if (lower.includes('fail'))
    throw new Error('The answer service is unavailable.');
  if (lower.includes('oversize')) return { markdown: 'word '.repeat(12_000) }; // 60,000 characters: over this application's bound
  const sections = [
    `## 1. Short answer`,
    `You asked: ${question}`,
    `Dates and figs are both **fruit**, ~~but only figs are pictured~~ and both keep well.`,
    `## 2. Details`,
    [
      '| Item | Quantity | Note |',
      '|:-----|---------:|:----:|',
      '| Dates | 3 | fresh |',
      '| Figs | 12 | dried, ~~old~~ new |',
    ].join('\n'),
    `> A quoted sentence from a source.`,
    `— Source: Example Reference, vol. 2, p. 14`,
    `[1] Footer note: see "Example Reference".`,
  ];
  if (lower.includes('arabic'))
    sections.push(
      'السلام عليكم ورحمة الله — هذا نص عربي يجب أن يبقى بترتيبه.',
      '- بند أول\n- بند ثان',
    );
  if (lower.includes('images'))
    sections.push(
      `See [the guide](https://docs.example.com/guide) and ![A chart](${IMAGE}).`,
    );
  if (lower.includes('long')) {
    for (let index = 0; index < 300; index += 1)
      sections.push(`Paragraph ${index}: ${'word '.repeat(20).trim()}`);
  }
  return { markdown: sections.join('\n\n') };
};

/** A second implementation of the same function type, to show the composition does not depend on the first. */
export const briefAnswers: AnswerFunction = async (question) => ({
  markdown: `**${question}** — a brief reply.`,
});
