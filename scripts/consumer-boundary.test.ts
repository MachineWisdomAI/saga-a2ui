import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXCLUDE,
  INCLUDE,
  REQUIRED_TEMPLATES,
  RULES,
  ScanConfigurationError,
  countsByRule,
  formatReport,
  repoRoot,
  scan,
  scanCode,
  scanMarkdown,
  selectFiles,
  unscannedTemplates,
  type IncludeEntry,
  type RuleName,
} from './consumer-boundary.js';
import { QUALIFIED_STARTERS } from './qualified-starters.js';
import { exportTemplate, templateDirectory } from './starter-template.js';

// The scan guards consumer code against duplicated SDK integration rules. These tests prove it
// reports each bad line and ignores every near-miss, that an empty or moved include entry fails
// loudly, and then that the repository's consumers have no unexempted hit. The hit counts are
// printed as evidence for the Blueprint; the verdict is the zero and the floor below.

const rulesOf = (text: string): RuleName[] =>
  scanCode('consumer.ts', text).hits.map((hit) => hit.rule);

describe('each rule reports a known-bad line', () => {
  it.each<[RuleName, string]>([
    ['wire-literal', "const open = { createSurface: { surfaceId: 'a' } };"],
    ['wire-literal', 'const next = { updateComponents: { components: [] } };'],
    ['wire-literal', 'const data = { updateDataModel: { value: {} } };'],
    ['wire-literal', "const message = { version: 'v0.9', createSurface: {} };"],
    ['wire-literal', 'const message = { version: "v0.9" };'],
    [
      'integration-import',
      "import { App } from '@modelcontextprotocol/ext-apps';",
    ],
    [
      'integration-import',
      "import { App } from '@modelcontextprotocol/ext-apps/app-bridge';",
    ],
    [
      'integration-import',
      "import { runToolResultView } from '@saga-a2ui/mcp/view';",
    ],
    ['integration-import', "import { Catalog } from '@a2ui/web_core/v0_9';"],
    ['integration-import', "import type { X } from '@a2ui/lit/v0_9';"],
    ['integration-import', "import '@a2ui/lit/v0_9';"],
    ['integration-import', "} from '@a2ui/react/v0_9';"],
    ['integration-import', "const m = await import('@a2ui/react/v0_9');"],
    [
      'integration-import',
      "const { App } = require('@modelcontextprotocol/ext-apps');",
    ],
    ['session-symbol', 'const session = createMessageSession({ catalogs });'],
    ['session-symbol', 'decoder: a2uiV0_9Decoder,'],
    ['session-symbol', 'const send = (input: unknown): IngestResult => ok;'],
  ])('%s: %s', (rule, line) => {
    expect(rulesOf(line)).toContain(rule);
  });

  it('names the file, the line and the rule of each hit, and reports counts rather than a verdict', () => {
    const scanned = scanCode(
      'templates/x/src/view.ts',
      [
        "import { App } from '@modelcontextprotocol/ext-apps';",
        'const ok = 1;',
        'const session = createMessageSession({});',
        "const open = { version: 'v0.9' };",
      ].join('\n'),
    );
    expect(scanned.hits.map((hit) => [hit.file, hit.line, hit.rule])).toEqual([
      ['templates/x/src/view.ts', 1, 'integration-import'],
      ['templates/x/src/view.ts', 3, 'session-symbol'],
      ['templates/x/src/view.ts', 4, 'wire-literal'],
    ]);
    expect(countsByRule(scanned.hits)).toEqual({
      'wire-literal': 1,
      'integration-import': 1,
      'session-symbol': 1,
    });
  });

  it('has one rule per kind of glue the ticket names, and no rule for pagehide', () => {
    expect(RULES.map((rule) => rule.name)).toEqual([
      'wire-literal',
      'integration-import',
      'session-symbol',
    ]);
    expect(
      RULES.flatMap((rule) =>
        rule.match("window.addEventListener('pagehide', () => retire());"),
      ),
    ).toEqual([]);
  });
});

describe('near-misses are not reported', () => {
  it('a pagehide listener is application behavior', () => {
    expect(
      rulesOf(
        "window.addEventListener('pagehide', () => { stopWatching(); element.remove(); });",
      ),
    ).toEqual([]);
  });

  it.each([
    'const layout = createSurfaceLayout(spec);',
    'const next = updateComponentsFor(layout);',
    "const version = 'v0.9';", // a constant, not a message field
    "import { runToolResultView } from '@saga-a2ui/mcp/server';",
    "import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';",
    "import { startA2uiView } from '@saga-a2ui/lit-mcp-stack';",
    "import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';",
    "import { sessionFactory } from './factory.js';",
  ])('%s', (line) => {
    expect(rulesOf(line)).toEqual([]);
  });

  it('prose in a comment is not code', () => {
    expect(
      rulesOf(
        [
          '// The old view called createMessageSession and a2uiV0_9Decoder here.',
          "/* import { App } from '@modelcontextprotocol/ext-apps'; */",
          '/**',
          " * createSurface: { version: 'v0.9' }",
          ' */',
          'const x = 1; // IngestResult',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('a comment marker inside a string does not hide the rest of the line', () => {
    expect(
      rulesOf("const url = 'https://example.test'; import('@a2ui/lit/v0_9');"),
    ).toEqual(['integration-import']);
  });

  it('a Markdown fence whose info string says before or historical is teaching material', () => {
    const bad = "import { App } from '@modelcontextprotocol/ext-apps';";
    for (const info of ['ts before', 'ts historical', 'tsx Before']) {
      const fenced = scanMarkdown(
        'guide.md',
        `text\n\n\`\`\`${info}\n${bad}\n\`\`\`\n`,
      );
      expect(fenced.hits, info).toEqual([]);
    }
    // The same code in an ordinary fence is reported, with its line in the file.
    const ordinary = scanMarkdown(
      'guide.md',
      `text\n\n\`\`\`ts\n${bad}\n\`\`\`\n`,
    );
    expect(ordinary.hits.map((hit) => [hit.line, hit.rule])).toEqual([
      [4, 'integration-import'],
    ]);
    // Prose outside any fence is not code.
    expect(scanMarkdown('guide.md', `${bad}\n`).hits).toEqual([]);
  });
});

describe('an exemption is one line that names its rule and gives a reason', () => {
  const line = (comment: string): string =>
    `import { Catalog } from '@a2ui/web_core/v0_9'; ${comment}`;

  it('an exempted line is counted as exempt, with its reason, and is not a hit', () => {
    const scanned = scanCode(
      'catalog.ts',
      line(
        '// saga-boundary: integration-import the app authors its own catalog',
      ),
    );
    expect(scanned.hits).toEqual([]);
    expect(scanned.problems).toEqual([]);
    expect(scanned.exempt.map((hit) => [hit.rule, hit.exemption])).toEqual([
      ['integration-import', 'the app authors its own catalog'],
    ]);
  });

  it('covers only the rule it names: another rule on the same line is still a hit', () => {
    const scanned = scanCode(
      'catalog.ts',
      "const s = createMessageSession({ catalogs: [await import('@a2ui/lit/v0_9')] }); // saga-boundary: integration-import catalog entry",
    );
    expect(scanned.hits.map((hit) => hit.rule)).toEqual(['session-symbol']);
    expect(scanned.exempt.map((hit) => hit.rule)).toEqual([
      'integration-import',
    ]);
  });

  it('an exemption naming the wrong rule leaves the hit and is itself a problem', () => {
    const scanned = scanCode(
      'catalog.ts',
      line('// saga-boundary: session-symbol wrong rule'),
    );
    expect(scanned.hits.map((hit) => hit.rule)).toEqual(['integration-import']);
    expect(scanned.problems.map((problem) => problem.message)).toEqual([
      'stale exemption: no session-symbol hit on this line',
    ]);
  });

  it.each([
    ['no reason', '// saga-boundary: integration-import'],
    ['no rule', '// saga-boundary: because'],
    ['an unknown rule', '// saga-boundary: everything the whole file needs it'],
    ['a per-file disable', '// saga-boundary: disable-file'],
  ])('%s does not exempt anything and is a problem', (_name, comment) => {
    const scanned = scanCode('catalog.ts', line(comment));
    expect(scanned.hits.map((hit) => hit.rule)).toEqual(['integration-import']);
    expect(scanned.problems).toHaveLength(1);
  });

  it('an exemption on a line with no hit is stale', () => {
    const scanned = scanCode(
      'catalog.ts',
      'const fine = 1; // saga-boundary: integration-import left behind',
    );
    expect(scanned.problems.map((problem) => problem.message)).toEqual([
      'stale exemption: no integration-import hit on this line',
    ]);
  });
});

describe('what is scanned is explicit and fails loudly when it is wrong', () => {
  let root: string;
  const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const BAD = "import { App } from '@modelcontextprotocol/ext-apps';\n";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-boundary-'));
    write('templates/lit-a/src/view.ts', BAD);
    write('templates/lit-a/src/view.test.ts', BAD);
    write('apps/host/e2e/send.spec.ts', 'const m = { createSurface: {} };\n');
    write('apps/host/src/main.ts', BAD);
    write('apps/host/src/view-main.ts', 'export {};\n');
    write('docs/2026-10-19_observations_v1.md', `\`\`\`ts\n${BAD}\`\`\`\n`);
    write('docs/guide.md', `\`\`\`ts\n${BAD}\`\`\`\n`);
    write('node_modules/x/src/index.ts', BAD);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const include: IncludeEntry[] = [
    { glob: 'templates/*/src/**/*.ts', kind: 'code' },
    { glob: 'apps/*/src/*.ts', kind: 'code' },
    { glob: 'apps/*/e2e/**/*.ts', kind: 'code' },
    { glob: 'docs/**/*.md', kind: 'markdown' },
  ];
  const exclude = [
    { glob: 'apps/host/src/main.ts', reason: 'host side' },
    { glob: 'apps/host/e2e/**', reason: 'fixtures send wire messages' },
    { glob: '**/*.test.ts', reason: 'tests' },
    { glob: 'docs/2026-*', reason: 'historical' },
  ];

  it('leaves out an excluded fixture, a test file, a host-side module and a dated observation', () => {
    const report = scan(root, include, exclude);
    expect(report.files).toEqual([
      'apps/host/src/view-main.ts',
      'docs/guide.md',
      'templates/lit-a/src/view.ts',
    ]);
    // What remains is judged: the view and the guide's fence, and nothing excluded.
    expect(report.hits.map((hit) => hit.file)).toEqual([
      'docs/guide.md',
      'templates/lit-a/src/view.ts',
    ]);
  });

  it('never reads dependencies, builds or the other worktrees', () => {
    const report = scan(root, [{ glob: '**/*.ts', kind: 'code' }], []);
    expect(report.files.some((file) => file.startsWith('node_modules/'))).toBe(
      false,
    );
  });

  it('fails when an include entry matches nothing (an empty glob or a moved directory)', () => {
    expect(() =>
      selectFiles(
        root,
        [{ glob: 'templates/*/source/**/*.ts', kind: 'code' }],
        [],
      ),
    ).toThrow(ScanConfigurationError);
    expect(() =>
      selectFiles(
        root,
        [{ glob: 'apps/lit-host/src/content/**', kind: 'code' }],
        [],
      ),
    ).toThrow(/matches no file/);
  });

  it('names a template directory that no scanned file belongs to', () => {
    const files = scan(root, include, exclude).files;
    expect(unscannedTemplates(files, ['lit-a', 'lit-b'])).toEqual(['lit-b']);
    expect(unscannedTemplates(files, ['lit-a'])).toEqual([]);
  });

  it('reports the unexempted hits in its text report', () => {
    const text = formatReport(scan(root, include, exclude));
    expect(text).toContain('files scanned: 3');
    expect(text).toContain(
      'HIT templates/lit-a/src/view.ts:1 [integration-import]',
    );
  });
});

describe('the repository consumers hold application meaning only', () => {
  const report = scan(repoRoot);
  const FLOOR = 100;

  it('reads at least the floor of files, so a glob that silently matches less cannot pass', () => {
    // The counts are the evidence recorded in the Blueprint, not a verdict.
    console.log(formatReport(report));
    console.log(
      `exempt reasons:\n${report.exempt
        .map(
          (hit) => `  ${hit.file}:${hit.line} [${hit.rule}] ${hit.exemption}`,
        )
        .join('\n')}`,
    );
    expect(report.files.length).toBeGreaterThanOrEqual(FLOOR);
  });

  it('scans every include entry and keeps every excluded file out', () => {
    for (const entry of INCLUDE)
      expect(
        () => selectFiles(repoRoot, [entry], []),
        entry.glob,
      ).not.toThrow();
    expect(
      report.files.filter((file) =>
        /(^apps\/lit-host\/(e2e|src\/saga-panel)\/|^apps\/lynx-fixture\/|\.test\.tsx?$|^docs\/2026-|^apps\/lit-host\/src\/main\.ts$)/.test(
          file,
        ),
      ),
    ).toEqual([]);
    expect(EXCLUDE.every((entry) => entry.reason.length > 20)).toBe(true);
  });

  it('asserts all five maintained templates are present and scanned', () => {
    const directories = fs
      .readdirSync(path.join(repoRoot, 'templates'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual([...REQUIRED_TEMPLATES].sort());
    expect([...QUALIFIED_STARTERS].sort()).toEqual(
      [...REQUIRED_TEMPLATES].sort(),
    );
    expect(unscannedTemplates(report.files)).toEqual([]);
    for (const name of REQUIRED_TEMPLATES)
      expect(
        report.files.filter((file) => file.startsWith(`templates/${name}/src/`))
          .length,
        name,
      ).toBeGreaterThanOrEqual(5);
  });

  it('has no unexempted hit and no malformed or stale exemption', () => {
    expect(
      report.hits.map(
        (hit) => `${hit.file}:${hit.line} [${hit.rule}] ${hit.text}`,
      ),
    ).toEqual([]);
    expect(
      report.problems.map((one) => `${one.file}:${one.line} ${one.message}`),
    ).toEqual([]);
  });

  it('gives every exemption a rule and a reason', () => {
    for (const hit of report.exempt)
      expect(
        hit.exemption?.length ?? 0,
        `${hit.file}:${hit.line}`,
      ).toBeGreaterThan(15);
  });
});

describe('the starter output produced by the qualification run', () => {
  let work: string;
  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-boundary-starters-'));
  });
  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  it.each(QUALIFIED_STARTERS)(
    '%s exports a starter whose source holds application meaning only',
    (name) => {
      const exported = exportTemplate(
        templateDirectory(name),
        path.join(work, name),
        { sdkVersion: '0.0.0-boundary' },
      );
      const report = scan(
        exported.directory,
        [{ glob: 'src/**/*.{ts,tsx}', kind: 'code' }],
        EXCLUDE,
      );
      expect(report.files.length).toBeGreaterThanOrEqual(5);
      expect(report.hits).toEqual([]);
      expect(report.problems).toEqual([]);
    },
  );
});
