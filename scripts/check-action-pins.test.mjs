import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { check, scan, violation } from './check-action-pins.mjs';

const SHA = '11d5960a326750d5838078e36cf38b85af677262';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const checker = fileURLToPath(
  new URL('./check-action-pins.mjs', import.meta.url),
);

const indent = (text, spaces) =>
  text
    .split('\n')
    .map((line) => (line ? ' '.repeat(spaces) + line : line))
    .join('\n');
const findings = (text) => scan('workflow.yml', text);
const steps = (items) => `jobs:\n  build:\n    steps:\n${indent(items, 6)}`;
const job = (body) => `jobs:\n  build:\n${indent(body, 4)}`;
const action = (items) =>
  `runs:\n  using: composite\n  steps:\n${indent(items, 4)}`;
const count = (text) => findings(text).length;

test('rejects mutable references in steps and reusable-workflow jobs', () => {
  for (const ref of [
    'actions/checkout@v4',
    'actions/checkout@v4.4.0',
    'actions/checkout@main',
    `actions/checkout@${SHA.slice(0, 7)}`,
    `actions/checkout@${SHA.toUpperCase()}`,
    `actions/checkout@${SHA}0`,
    'actions/checkout',
    'owner/repo/path/to/action@v1',
    'owner/repo/.github/workflows/build.yml@v2',
    'docker://alpine:3.20',
    'docker://alpine@sha256:abc',
  ]) {
    assert.equal(count(steps(`- uses: ${ref}\n`)), 1, ref);
    assert.equal(count(job(`uses: ${ref}\n`)), 1, ref);
  }
});

test('accepts immutable and repository-owned local references', () => {
  for (const ref of [
    `actions/checkout@${SHA} # v4`,
    `owner/repo/path/to/action@${SHA}`,
    `owner/repo/.github/workflows/build.yml@${SHA}`,
    `docker://alpine@${DIGEST}`,
    './.github/actions/local',
    './.github/workflows/reusable.yml',
  ]) {
    assert.deepEqual(findings(steps(`- uses: ${ref}\n`)), [], ref);
    assert.deepEqual(findings(job(`uses: ${ref}\n`)), [], ref);
  }
});

test('only the repository-owned dot-slash form is local', () => {
  for (const ref of [
    '../shared/action',
    './../shared/action',
    './a/../../shared/action',
    './..',
    '.',
    '/abs/path',
    '.github/actions/local',
  ])
    assert.equal(count(steps(`- uses: ${ref}\n`)), 1, ref);
  assert.equal(violation('./.github/actions/x'), null);
});

test('recognizes every YAML shape of a uses key', () => {
  for (const item of [
    '- uses: actions/checkout@v4',
    '- name: x\n  uses: actions/checkout@v4',
    "- uses: 'actions/checkout@v4'",
    '- uses: "actions/checkout@v4"',
    '- uses: actions/checkout@v4 # pinned elsewhere',
    "- 'uses': actions/checkout@v4",
    '- uses:\n    actions/checkout@v4',
    "- uses:\n\n    # note\n    'actions/checkout@v4'",
    '- uses: !!str actions/checkout@v4',
    '- &pin uses: actions/checkout@v4',
    '- uses: &ref actions/checkout@v4',
    '- !!str uses: actions/checkout@v4',
    '- "uses": "actions/checkout@v4"',
    '- "u\\x73es": "actions/checkout@v4"',
    '- "us\\u0065s": "actions/checkout@v4"',
    '- "us\\\n   es": "actions/checkout@v4"',
    '- uses: "actions/checkout@v\\x34"',
  ])
    assert.equal(count(steps(`${item}\n`)), 1, item);
});

test('rejects flow mapping and JSON shapes', () => {
  for (const text of [
    'jobs:\n  a:\n    steps:\n      - { uses: actions/checkout@v4 }\n',
    'jobs:\n  a:\n    steps: [{ uses: actions/checkout@v4 }]\n',
    'jobs:\n  a:\n    steps: [{uses: actions/checkout@v4, name: x}]\n',
    'jobs: { build: { uses: owner/repo/.github/workflows/build.yml@v2 } }\n',
    "jobs: { build: { 'uses': 'owner/repo/.github/workflows/build.yml@v2' } }\n",
    '{"jobs": {"build": {"steps": [{"uses": "actions/checkout@v4"}]}}}\n',
    '{"jobs":{"b":{"steps":[{"uses":"actions/checkout@v4"}]}}}\n',
    'jobs:\n  a:\n    steps:\n      - {\n          name: x,\n          uses: actions/checkout@v4,\n        }\n',
    'jobs:\n  a:\n    steps: [ uses: actions/checkout@v4 ]\n',
    'jobs: { a: { steps: [ { ? uses : actions/checkout@v4 } ] } }\n',
    // Root-level fragments, as a checker caller may pass them.
    'steps:\n  - { uses: actions/checkout@v4 }\n',
    'steps: [{ uses: actions/checkout@v4 }]\n',
    '- { uses: actions/checkout@v4 }\n',
    '- uses: actions/checkout@v4\n',
  ])
    assert.equal(count(text), 1, text);
});

test('rejects explicit-key shapes, including block-scalar keys', () => {
  for (const item of [
    '- ? uses\n  : actions/checkout@v4',
    "- ? 'uses'\n  : actions/checkout@v4",
    '- ? "uses"\n  : actions/checkout@v4',
    '- ? |-\n    uses\n  : actions/checkout@v4',
    '- ? |\n    uses\n  : actions/checkout@v4',
    '- ? |+\n    uses\n\n  : actions/checkout@v4',
    '- ? >-\n    uses\n  : actions/checkout@v4',
    '- ? >\n    uses\n  : actions/checkout@v4',
    '- ? |2\n     uses\n  : actions/checkout@v4',
    '- ? !!str |-\n    uses\n  : actions/checkout@v4',
    '- ? &k |-\n    uses\n  : actions/checkout@v4',
    '- name: x\n  ? |-\n    uses\n  : actions/checkout@v4',
    '- ? |-\n    uses\n  : actions/checkout@v4\n  name: x',
  ])
    assert.equal(count(steps(`${item}\n`)), 1, item);
  const repro = 'steps:\n  - ? |-\n      uses\n    : actions/checkout@v4\n';
  assert.equal(count(repro), 1);
  assert.equal(count(`jobs:\n  b:\n${indent(repro, 4)}`), 1);
  assert.equal(
    count(job('? |-\n  uses\n: owner/repo/.github/workflows/a.yml@v1\n')),
    1,
  );
  assert.equal(
    scan('action.yml', action('- ? |-\n    uses\n  : actions/checkout@v4\n'))
      .length,
    1,
  );
});

test('reads an executable uses key after a block scalar that has properties on the preceding line', () => {
  // Reviewed reproduction: an anchor on the line before the block-scalar
  // marker hid every later key, including this executable `uses`.
  const anchored =
    'jobs:\n  b:\n    steps:\n      - name: &label\n          |-\n            checkout\n        uses: actions/checkout@v4\n';
  assert.deepEqual(
    findings(anchored).map(({ line, ref }) => [line, ref]),
    [[7, 'actions/checkout@v4']],
  );
  for (const properties of ['&label', '!!str', '!!str &label', '&label !!str'])
    for (const marker of ['|-', '|', '>-', '>', '|+']) {
      const text = `jobs:\n  b:\n    steps:\n      - name: ${properties}\n          ${marker}\n            checkout\n        uses: actions/checkout@v4\n`;
      assert.deepEqual(
        findings(text).map(({ line, ref }) => [line, ref]),
        [[7, 'actions/checkout@v4']],
        text,
      );
    }
  for (const text of [
    // The same class as an explicit key and as a mapping value.
    'jobs:\n  b:\n    steps:\n      - ? !!str\n          |-\n            note\n        : x\n        uses: actions/checkout@v4\n',
    'jobs:\n  b:\n    steps:\n      - run: &cmd\n          >-\n            echo\n        uses: actions/checkout@v4\n',
    'jobs:\n  b:\n    steps:\n      - name: !!str\n          |-\n            checkout\n        uses: actions/checkout@v4\n',
    'jobs:\n  b:\n    steps:\n      - name: &a\n          |-\n            checkout\n        uses: &b actions/checkout@v4\n',
  ])
    assert.equal(count(text), 1, text);
  // Pinned stays clean, and block text is never read as a key.
  assert.deepEqual(
    findings(
      `jobs:\n  b:\n    steps:\n      - name: &label\n          |-\n            uses: actions/checkout@v4\n        uses: actions/checkout@${SHA}\n`,
    ),
    [],
  );
});

test('accepts every shape of an immutable reference', () => {
  for (const text of [
    steps(`- { uses: actions/checkout@${SHA} }\n`),
    steps(`- ? |-\n    uses\n  : actions/checkout@${SHA}\n`),
    steps(`- ? uses\n  : actions/checkout@${SHA}\n`),
    steps(`- uses:\n    actions/checkout@${SHA}\n`),
    steps(`- uses: !!str actions/checkout@${SHA} # v4\n`),
    `jobs:\n  a:\n    steps: [{uses: 'actions/checkout@${SHA}'}]\n`,
    `{"jobs": {"a": {"steps": [{"uses": "actions/checkout@${SHA}"}]}}}\n`,
    'jobs: { b: { uses: ./.github/workflows/x.yml } }\n',
  ])
    assert.deepEqual(findings(text), [], text);
});

test('a uses key outside an executable location is not an action', () => {
  // An input or environment variable may be named `uses`; quoting or renaming
  // it must never be needed.
  for (const text of [
    'with: { uses: harmless }\n',
    'env: { uses: harmless }\n',
    'env:\n  uses: harmless\n',
    "env:\n  'uses': harmless\n",
    'with:\n  ? |-\n    uses\n  : harmless\n',
    steps(`- uses: actions/checkout@${SHA}\n  with: { uses: harmless }\n`),
    steps(`- uses: actions/checkout@${SHA}\n  with:\n    uses: harmless\n`),
    steps(
      `- uses: actions/checkout@${SHA}\n  with:\n    'uses': v4\n    "uses": v4\n`,
    ),
    steps('- run: echo\n  env:\n    uses: harmless\n'),
    steps(
      '- run: echo\n  env:\n    ? |-\n      uses\n    : actions/checkout@v4\n',
    ),
    steps(
      '- name: x\n  with:\n    steps:\n      - uses: actions/checkout@v4\n',
    ),
    job('env: { uses: harmless }\nsteps:\n  - run: echo\n'),
    job('with: { uses: actions/checkout@v4 }\nsteps:\n  - run: echo\n'),
    job(
      'strategy:\n  matrix:\n    include:\n      - uses: v4\n    uses: [a, b]\nsteps:\n  - run: echo\n',
    ),
    job(
      'outputs:\n  uses: ${{ steps.x.outputs.uses }}\nsteps:\n  - run: echo\n',
    ),
    'inputs:\n  uses:\n    description: an input named uses\n    default: v4\n',
    'defaults: { run: { uses: x } }\n',
    'name: uses\non: push\n',
  ])
    assert.deepEqual(findings(text), [], text);
  assert.deepEqual(
    scan(
      'action.yml',
      'inputs:\n  uses:\n    description: x\nruns:\n  using: composite\n  steps:\n    - run: echo\n      env:\n        uses: harmless\n',
    ),
    [],
  );
});

test('composite actions are checked where their steps are', () => {
  assert.equal(
    scan('action.yml', action('- uses: actions/cache@v4\n')).length,
    1,
  );
  assert.equal(
    scan('action.yml', action('- { uses: actions/cache@v4 }\n')).length,
    1,
  );
  assert.equal(
    scan('action.yml', 'runs: { steps: [{ uses: ../shared/action }] }\n')
      .length,
    1,
  );
  assert.deepEqual(
    scan('action.yml', action(`- uses: actions/cache@${SHA}\n`)),
    [],
  );
});

test('rejects references it cannot resolve statically', () => {
  for (const item of [
    '- uses: *pin',
    '- uses:',
    '- uses: |\n    actions/checkout@v4',
    '- uses: >-\n    actions/checkout@v4',
    '- uses: [actions/checkout@v4]',
    '- uses: { a: b }',
    '- uses:\n    name: actions/checkout@v4',
    '- uses:\n  - actions/checkout@v4',
    "- uses: ''",
    '- uses: 4',
    '- uses: true',
    '- *key : actions/checkout@v4',
    '- uses: "unterminated',
    '- uses: "bad \\q escape"',
  ])
    assert.ok(count(steps(`${item}\n`)) >= 1, item);
  for (const text of ['{ uses: [\n', 'jobs: { a: { uses: [ }\n'])
    assert.ok(count(text) >= 1, text);
});

test('rejects ambiguous executable structure', () => {
  // Merge keys, aliases and anchors can build an executable mapping from text
  // defined elsewhere, so the checker cannot see the result.
  for (const text of [
    steps('- <<: *base\n  name: x\n'),
    steps('- <<: { uses: actions/checkout@v4 }\n'),
    steps('- <<: [*a, *b]\n'),
    steps("- '<<': *base\n"),
    steps('- *step\n'),
    job('<<: *common\nsteps:\n  - run: echo\n'),
    job('steps: *shared\n'),
    job('steps:\n  - run: echo\n  - *tail\n'),
    'jobs:\n  build: *job\n',
    'jobs: *all\n',
    'jobs:\n  <<: *jobs\n',
    '<<: *workflow\n',
    '*jobs-key : {}\n',
    'steps: *shared\n',
    'runs: *runs\n',
    '- *step\n',
    action('- *step\n'),
  ])
    assert.ok(count(text) >= 1, text);
});

test('enforcement does not depend on key case', () => {
  for (const text of [
    steps('- Uses: actions/checkout@v4\n'),
    steps('- USES: actions/checkout@v4\n'),
    'Jobs:\n  a:\n    Steps:\n      - uses: actions/checkout@v4\n',
    'JOBS:\n  a:\n    STEPS:\n      - uses: actions/checkout@v4\n',
    'Runs:\n  Steps:\n    - uses: actions/checkout@v4\n',
  ])
    assert.equal(count(text), 1, text);
});

test('checks every document and every duplicate key', () => {
  assert.equal(
    count(
      `jobs: { a: { steps: [{ uses: actions/checkout@${SHA} }] } }\n---\njobs: { b: { steps: [{ uses: actions/checkout@v4 }] } }\n`,
    ),
    1,
  );
  assert.equal(
    count(
      'jobs:\n  a:\n    steps: []\n    steps:\n      - uses: actions/checkout@v4\n',
    ),
    1,
  );
  assert.equal(
    count(
      'jobs:\n  a:\n    uses: ./.github/workflows/x.yml\n    uses: owner/repo/a.yml@v1\n',
    ),
    1,
  );
  assert.equal(
    count(
      '--- !!map\njobs: { a: { steps: [{ uses: actions/checkout@v4 }] } }\n...\n',
    ),
    1,
  );
});

test('block-scalar text is not scanned but following keys are', () => {
  const text = [
    'jobs:',
    '  a:',
    '    steps:',
    '      - run: |',
    '          echo',
    '          uses: actions/checkout@v4',
    '',
    '          - uses: actions/checkout@v4',
    '        name: after',
    '      - run: >-',
    '          uses: actions/checkout@v4',
    '        uses: actions/setup-node@v4',
    '      - uses: actions/cache@v4',
    '',
  ].join('\n');
  assert.deepEqual(
    findings(text).map(({ line, ref }) => [line, ref]),
    [
      [12, 'actions/setup-node@v4'],
      [13, 'actions/cache@v4'],
    ],
  );
  assert.deepEqual(
    findings(
      '- |\n  uses: actions/checkout@v4\n- uses: actions/setup-node@v4\n',
    ).map(({ line }) => line),
    [3],
  );
  assert.deepEqual(
    findings(
      steps('- run: |\n    echo\n\n\n- uses: actions/setup-node@v4\n'),
    ).map(({ ref }) => ref),
    ['actions/setup-node@v4'],
  );
});

test('plain text that mentions uses is not a key', () => {
  const text = [
    'name: uses actions/checkout@v4',
    "description: 'this uses: actions/checkout@v4 internally'",
    'run: echo uses actions/checkout@v4',
    'env: { NOTE: "uses: actions/checkout@v4" }',
    '',
  ].join('\n');
  assert.deepEqual(findings(text), []);
  assert.deepEqual(
    findings(
      steps('- name: "Explain uses: actions/checkout@v4"\n  run: echo uses\n'),
    ),
    [],
  );
});

test('text the YAML parser rejects is reported, never passed', () => {
  // The same text is not a valid mapping value, so a parser that executes the
  // file cannot be assumed to read it as this checker does.
  const invalid = steps(
    '- name: Explain uses: actions/checkout@v4\n  uses: actions/checkout@v4\n',
  );
  assert.ok(count(invalid) >= 1);
  assert.match(
    findings(invalid)[0].reason,
    /could not be scanned conservatively/,
  );
  for (const text of [
    'jobs: [\n',
    'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n   bad: indent\n',
    '\tjobs: {}\n',
    'jobs: { a: { steps: [ { uses: x ] } }\n',
  ])
    assert.ok(count(text) >= 1, text);
});

test('comments and unrelated text are not references', () => {
  assert.deepEqual(
    findings(
      steps(
        [
          '# uses: actions/checkout@v4',
          '# - uses: actions/checkout@v4',
          '- name: "Explain uses: actions/checkout@v4"',
          '  run: "echo \'uses: actions/checkout@v4\'"',
          `- uses: actions/checkout@${SHA} # v4, not @v4`,
          '',
        ].join('\n'),
      ),
    ),
    [],
  );
});

test('multi-line plain and quoted values are read whole', () => {
  assert.equal(count(steps('- uses: actions/checkout@v4\n    continued\n')), 1);
  assert.deepEqual(
    findings(steps(`- name: a\n    b\n  uses: actions/checkout@${SHA}\n`)),
    [],
  );
  assert.equal(
    count(steps(`- uses: "actions/checkout@${SHA}\n    more"\n`)),
    1,
  );
});

test('reports each violation with its line', () => {
  assert.deepEqual(
    findings(
      steps(`- uses: actions/checkout@${SHA}\n- uses: actions/setup-node@v4\n`),
    ),
    [
      {
        line: 5,
        ref: 'actions/setup-node@v4',
        reason:
          "uses mutable revision 'v4' instead of a full 40-character commit SHA",
      },
    ],
  );
});

function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'action-pins-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  execFileSync('git', ['add', '--', ...Object.keys(files)], { cwd: root });
  return root;
}

test('the command checks tracked workflows and composite actions only', () => {
  const root = repository({
    '.github/workflows/good.yml': steps(`- uses: actions/checkout@${SHA}\n`),
    '.github/actions/local/action.yaml':
      'runs:\n  steps:\n    - uses: actions/cache@v4\n',
    '.github/README.md': 'uses: actions/checkout@v4\n',
    'docs/example.yml': 'uses: actions/checkout@v4\n',
  });
  try {
    const { names, problems } = check(root);
    assert.deepEqual(names, [
      '.github/actions/local/action.yaml',
      '.github/workflows/good.yml',
    ]);
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /^\.github\/actions\/local\/action\.yaml:3: 'actions\/cache@v4' /,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the command rejects flow, reusable-workflow, block-key and composite forms', () => {
  const root = repository({
    '.github/workflows/flow.yml':
      'jobs:\n  a:\n    steps: [{ uses: actions/checkout@v4 }]\n',
    '.github/workflows/reusable.yaml':
      'jobs: { b: { uses: owner/repo/.github/workflows/b.yml@v2 } }\n',
    '.github/workflows/explicit.yml':
      'jobs:\n  c:\n    steps:\n      - ? uses\n        : actions/setup-node@v4\n',
    '.github/workflows/block-key.yml':
      'jobs:\n  d:\n    steps:\n      - ? |-\n          uses\n        : actions/checkout@v4\n',
    '.github/workflows/anchored-block.yml':
      'jobs:\n  b:\n    steps:\n      - name: &label\n          |-\n            checkout\n        uses: actions/checkout@v4\n',
    '.github/workflows/with-input.yml': `jobs:\n  e:\n    steps:\n      - uses: actions/cache@${SHA}\n        with: { uses: harmless }\n`,
    '.github/actions/shared/action.yml':
      'runs:\n  using: composite\n  steps:\n    - { uses: ../shared/action }\n',
    '.github/actions/pinned/action.yml': `runs:\n  steps:\n    - { uses: actions/cache@${SHA} }\n`,
  });
  try {
    const { names, problems } = check(root);
    assert.equal(names.length, 8);
    assert.deepEqual(
      problems.map((problem) => problem.split(':', 1)[0]).sort(),
      [
        '.github/actions/shared/action.yml',
        '.github/workflows/anchored-block.yml',
        '.github/workflows/block-key.yml',
        '.github/workflows/explicit.yml',
        '.github/workflows/flow.yml',
        '.github/workflows/reusable.yaml',
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('this repository pins every executable action', () => {
  const root = path.dirname(path.dirname(checker));
  const { names, problems } = check(root);
  assert.deepEqual(problems, []);
  // The control must be exercising real workflows, not an empty set.
  for (const name of ['ci.yml', 'lint.yml', 'version-policy.yml'])
    assert.ok(names.includes(`.github/workflows/${name}`), name);
  assert.equal(
    execFileSync(process.execPath, [checker], {
      cwd: root,
      encoding: 'utf8',
    }).startsWith('All executable workflow actions in '),
    true,
  );
});
