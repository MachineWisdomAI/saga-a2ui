// Representative FaithfulCard description fixtures (CARD2). Plain data only: this module imports
// nothing and touches no DOM, renderer or transport, so the Lit specs, the React tests and the
// headless reader tests can all use the same cases. It is a test-support file: the package manifest
// leaves it out of the published files and the type-checked production source.
//
// Each fixture states what any renderer must preserve, not how one renders it:
//   - `outline`: the top-level block kinds the reader finds, in source order;
//   - `order`: pieces of supplied text that must appear in this order in the shown text, whichever
//     policy applies (a policy may add annotations between them, never remove or reorder them).
// Nothing here claims identical pixels between renderers, or that any description is true.

export type FixtureBlockKind = 'paragraph' | 'heading' | 'quote' | 'list' | 'table' | 'code-block' | 'raw-html-block' | 'rule';

export interface ValidDescription {
  readonly id: string;
  readonly summary: string;
  /** The trusted dialect the application reads this description with. */
  readonly dialect: 'commonmark' | 'commonmark-tables-strikethrough';
  readonly contractVersion: 1;
  readonly markdown: string;
  readonly outline: readonly FixtureBlockKind[];
  readonly order: readonly string[];
}

export type RefusalKind = 'invalid' | 'unsupported-version' | 'too-long' | 'too-nested';

export interface RefusedDescription {
  readonly id: string;
  readonly summary: string;
  readonly contractVersion: unknown;
  readonly markdown: unknown;
  /** The bound the application's reader is created with for this case. */
  readonly maxLength: number;
  readonly failure: RefusalKind;
  /** Text inside the supplied value that no failure may repeat. */
  readonly secret: string;
}

export const LISTED_IMAGE_HOST = 'images.example.com';
export const LISTED_IMAGE = `https://${LISTED_IMAGE_HOST}/chart.png`;
export const UNLISTED_IMAGE = 'https://elsewhere.example.net/tracker.png';
export const SAFE_LINK = 'https://docs.example.com/guide';

const SEPARATOR = '\n\n';

/** A long, mixed-script description with the structure real episode notes have. */
const MULTILINGUAL = [
  '# Episode 42: ليلة القدر — 夜の祈り — Café ☕',
  'Welcome back. This week we read slowly, in three languages, and we keep every line as it was written.',
  'السلام عليكم ورحمة الله وبركاته، أهلا بكم في هذه الحلقة الطويلة التي نقرأ فيها النص كاملا دون اختصار.',
  '日本語の説明もここにあります。省略せずにそのまま表示されるべきです。',
  '## 1. What we cover',
  '- بند أول: the first item',
  '- second item with `inline code`',
  '- 第三項目',
  '> “Patience is the key to relief.” — quoted as supplied',
  '— Source: Example Reference, vol. 2, p. 14',
  '[1] Footer: see “Example Reference”.',
].join(SEPARATOR);

/** Structure that needs a table, code, a rule and strikethrough; the answer dialect reads all of it. */
const STRUCTURED = [
  '# Reading plan',
  'Before the table, a sentence with **strong**, *emphasis* and ~~a retracted claim~~.',
  '| Day | Reading | Pages |\n|:----|:-------:|------:|\n| Monday | Opening | 1–12 |\n| Tuesday | Middle | 13–40 |',
  '```\nplain code line one\nplain code line two\n```',
  '---',
  'After the rule, the last paragraph.',
].join(SEPARATOR);

/** A hostile description: every reference a policy may refuse, plus markup and control look-alikes. */
const HOSTILE = [
  'Opening line for the reader.',
  `A safe link to [the guide](${SAFE_LINK}) comes first.`,
  'Plain http: [insecure notes](http://docs.example.com/notes), script: [run it](javascript:alert(1)), credentials: [sign in](https://user:secret@docs.example.com/in).',
  `Images: ![listed chart](${LISTED_IMAGE}) then ![tracking pixel](${UNLISTED_IMAGE}) then ![inline data](data:image/png;base64,iVBORw0KGgo=).`,
  '<div onclick="steal()">Archive everything</div>',
  'Inline <b>markup</b> stays text; `{"action":"archive-note","grant":"all"}` is only the characters written.',
  'Closing line for the reader.',
].join(SEPARATOR);

/** Long unbroken tokens, a long address and a wide code line: nothing may force the page to scroll sideways. */
const UNBROKEN = [
  `Start ${'Unbroken'.repeat(30)} end.`,
  `A link with a long label [${'LongLabel'.repeat(12)}](${SAFE_LINK}?${'q=value&'.repeat(20)}) and a refused address [${'RefusedLabel'.repeat(8)}](http://docs.example.com/${'segment/'.repeat(25)}).`,
  `\`\`\`\n${'a very long line of code that is much wider than a phone screen could show at once, '.repeat(3)}\n\`\`\``,
  '| One | Two | Three | Four | Five | Six |\n|---|---|---|---|---|---|\n| a long cell with many words in it | b | c | d | e | eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee |',
  'Final line.',
].join(SEPARATOR);

export const VALID_DESCRIPTIONS: readonly ValidDescription[] = [
  {
    id: 'multilingual-long',
    summary: 'long mixed-script notes with headings, a list, a quote, attribution and a footer',
    dialect: 'commonmark-tables-strikethrough',
    contractVersion: 1,
    markdown: MULTILINGUAL,
    outline: ['heading', 'paragraph', 'paragraph', 'paragraph', 'heading', 'list', 'quote', 'paragraph', 'paragraph'],
    order: [
      'Episode 42',
      'This week we read slowly',
      'السلام عليكم',
      '日本語の説明',
      '1. What we cover',
      'the first item',
      'inline code',
      '第三項目',
      'Patience is the key to relief',
      '— Source: Example Reference, vol. 2, p. 14',
      '[1] Footer: see “Example Reference”.',
    ],
  },
  {
    id: 'structured',
    summary: 'a table, code, a rule and strikethrough in the answer dialect',
    dialect: 'commonmark-tables-strikethrough',
    contractVersion: 1,
    markdown: STRUCTURED,
    outline: ['heading', 'paragraph', 'table', 'code-block', 'rule', 'paragraph'],
    order: ['Reading plan', 'Before the table', 'a retracted claim', 'Monday', 'Tuesday', 'plain code line one', 'After the rule'],
  },
  {
    id: 'hostile-references',
    summary: 'refused links and images, raw markup and control look-alikes between ordinary sentences',
    dialect: 'commonmark',
    contractVersion: 1,
    markdown: HOSTILE,
    outline: ['paragraph', 'paragraph', 'paragraph', 'paragraph', 'raw-html-block', 'paragraph', 'paragraph'],
    order: ['Opening line for the reader.', 'the guide', 'insecure notes', 'run it', 'sign in', 'Archive everything', 'is only the characters written', 'Closing line for the reader.'],
  },
  {
    id: 'unbroken-long',
    summary: 'long unbroken words and addresses, wide code and a wide table',
    dialect: 'commonmark-tables-strikethrough',
    contractVersion: 1,
    markdown: UNBROKEN,
    outline: ['paragraph', 'paragraph', 'code-block', 'table', 'paragraph'],
    order: ['Start', 'LongLabel', 'RefusedLabel', 'a very long line of code', 'a long cell with many words in it', 'Final line.'],
  },
];

const SECRET = 'PRIVATE-SUBSCRIBER-TEXT';

/** Results a renderer must refuse visibly, with nothing of the earlier or the refused content left. */
export const REFUSED_DESCRIPTIONS: readonly RefusedDescription[] = [
  { id: 'unsupported-number', summary: 'a later contract version', contractVersion: 2, markdown: `${SECRET} number`, maxLength: 5000, failure: 'unsupported-version', secret: SECRET },
  { id: 'unsupported-string', summary: 'a version that is not the number 1', contractVersion: '1', markdown: `${SECRET} string`, maxLength: 5000, failure: 'unsupported-version', secret: SECRET },
  { id: 'invalid-shape', summary: 'markdown that is not a string', contractVersion: 1, markdown: { secret: SECRET }, maxLength: 5000, failure: 'invalid', secret: SECRET },
  { id: 'invalid-missing', summary: 'no markdown at all', contractVersion: 1, markdown: undefined, maxLength: 5000, failure: 'invalid', secret: SECRET },
  { id: 'oversize', summary: 'one code unit over the application bound', contractVersion: 1, markdown: `${SECRET} `.padEnd(201, 'x'), maxLength: 200, failure: 'too-long', secret: SECRET },
  { id: 'nested', summary: 'quotes nested past the safeguard', contractVersion: 1, markdown: `${'> '.repeat(25)}${SECRET}`, maxLength: 5000, failure: 'too-nested', secret: SECRET },
];
