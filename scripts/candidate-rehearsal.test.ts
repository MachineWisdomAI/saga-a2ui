import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REHEARSED_TITLES,
  REHEARSAL_STATEMENT,
  STAGES,
  observedCases,
  rehearsalSummary,
  rehearseTransition,
  type BrowserRunner,
  type ObservedCase,
} from './candidate-rehearsal.js';
import { sha256Hex } from './candidate-identity.js';
import { SDK_PACKAGES } from './release-candidate.js';
import {
  candidateVersion,
  createWorkDirectory,
  packSdkPackages,
  repoRoot,
  type PackedPackage,
} from './packed-consumer.js';

// PACK2: the update and rollback rehearsal. The tarballs are real `npm pack` output and the
// consumers are really installed from them, built and connected to; only the browser run is replaced
// here by a recorder (the real run is `npm run candidate:rehearse`, in CI), so these cases check what
// the rehearsal installs, rebuilds, pairs and refuses, and which cases it requires to have run.

/** What the own-catalog Lit consumer installs: the Lit stack brings its declared siblings along. */
const LIT_STACK_SET = ['core', 'lit', 'components', 'mcp', 'lit-mcp-stack'];

const work = createWorkDirectory('saga-rehearsal-test-');
// The rebuilt server bundles leave third-party packages external, so they must sit inside the repository to resolve them.
const out = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'rehearsal-test');
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
});

describe('the update and rollback rehearsal', () => {
  let a: PackedPackage[];
  let b: PackedPackage[];

  beforeAll(() => {
    a = packSdkPackages(
      path.join(work, 'a'),
      SDK_PACKAGES,
      path.join(work, 'a', 'packages'),
      candidateVersion('a'.repeat(40), false),
    );
    b = packSdkPackages(
      path.join(work, 'b'),
      SDK_PACKAGES,
      path.join(work, 'b', 'packages'),
      candidateVersion('b'.repeat(40), false),
    );
  }, 120_000);

  const passing = (
    consumers: readonly string[],
    skip: (consumer: string, title: string) => boolean = () => false,
  ): ObservedCase[] =>
    consumers.flatMap((consumer) =>
      REHEARSED_TITLES.filter((title) => !skip(consumer, title)).map(
        (title) => ({ consumer, title, status: 'passed' }),
      ),
    );

  it('installs, updates and restores built applications, runs the cases against each rebuild, and records what ran', async () => {
    const seen: {
      root: string;
      titles: readonly string[];
      page: string;
      server: string;
    }[] = [];
    const browser: BrowserRunner = (root, titles) => {
      seen.push({
        root,
        titles,
        page: sha256Hex(fs.readFileSync(path.join(root, 'own', 'own.html'))),
        server: sha256Hex(
          fs.readFileSync(path.join(root, 'own', 'server.mjs')),
        ),
      });
      return passing(['own']);
    };
    const record = await rehearseTransition({
      a,
      b,
      outDir: path.join(out, 'whole'),
      browser,
      consumers: ['own'],
    });

    expect(
      record.stages.map(
        (stage) => `${stage.name}:${stage.candidate}:${stage.version}`,
      ),
    ).toEqual(
      STAGES.map(
        (stage) =>
          `${stage.name}:${stage.candidate}:${stage.candidate === 'A' ? a[0]!.version : b[0]!.version}`,
      ),
    );
    // Each stage was installed from that candidate's own tarballs, and rebuilt from that install.
    const digests = (
      packed: readonly PackedPackage[],
      names: readonly string[],
    ) =>
      Object.fromEntries(
        packed
          .filter((one) => names.includes(one.name))
          .map((one) => [one.name, one.sha256]),
      );
    expect(
      record.stages.map((stage) => stage.consumers.own!.installedTarballSha256),
    ).toEqual([
      digests(a, LIT_STACK_SET),
      digests(b, LIT_STACK_SET),
      digests(a, LIT_STACK_SET),
    ]);
    expect(
      record.stages.map((stage) => stage.consumers.own!.installedPackages),
    ).toEqual([
      [...LIT_STACK_SET].sort(),
      [...LIT_STACK_SET].sort(),
      [...LIT_STACK_SET].sort(),
    ]);
    // The browser ran once per stage, against that stage's own rebuilt files, with the carried PACK1 cases.
    expect(seen.map((one) => path.basename(one.root))).toEqual([
      '1-install',
      '2-update',
      '3-rollback',
    ]);
    for (const [index, one] of seen.entries()) {
      expect(one.titles).toEqual(REHEARSED_TITLES);
      expect(one.page).toBe(record.stages[index]!.consumers.own!.page.sha256);
      expect(one.server).toBe(
        record.stages[index]!.consumers.own!.server.sha256,
      );
      expect(record.stages[index]!.consumers.own!.served).toMatchObject({
        isTheBuiltPage: true,
        uri: record.stages[index]!.consumers.own!.page.uri,
      });
      expect(record.stages[index]!.observed).toHaveLength(
        REHEARSED_TITLES.length,
      );
    }
    // The rollback restored the first install's view and server; the update, built from the same source, did not change the view.
    expect(record.transitions.own).toEqual({
      pageChangedByUpdate: false,
      pageRestoredByRollback: true,
      serverRestoredByRollback: true,
    });
    expect(record.statement).toMatch(
      /differ only in version.*not a difference between two versions of the code.*no registry release was involved/,
    );
    expect(record.statement).not.toMatch(/no published release exists/i);
    expect(rehearsalSummary(record)).toContain(
      `rollback restored the view exactly`,
    );
  }, 240_000);

  it('refuses a stage in which a rehearsed case failed or was not run, naming the stage and the case', async () => {
    const failing = REHEARSED_TITLES[3]!;
    const skipped = REHEARSED_TITLES[6]!;
    await expect(
      rehearseTransition({
        a,
        b,
        outDir: path.join(out, 'failing'),
        consumers: ['own'],
        browser: (root) =>
          root.endsWith('2-update')
            ? passing(['own']).map((one) =>
                one.title === failing ? { ...one, status: 'failed' } : one,
              )
            : passing(['own']),
      }),
    ).rejects.toThrow(
      new RegExp(
        `The update stage: "${failing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" failed for the own consumer`,
      ),
    );
    await expect(
      rehearseTransition({
        a,
        b,
        outDir: path.join(out, 'skipped'),
        consumers: ['own'],
        browser: () =>
          passing(['own'], (_consumer, title) => title === skipped),
      }),
    ).rejects.toThrow(
      /The install stage did not run ".*" once for the own consumer \(it ran 0 time/,
    );
  }, 240_000);

  it('refuses to build from a half-updated install, with the tarball to reinstall', async () => {
    const half = [
      a.find((one) => one.name === 'core')!,
      ...b.filter((one) => one.name !== 'core'),
    ];
    await expect(
      rehearseTransition({
        a,
        b: half,
        outDir: path.join(out, 'half'),
        consumers: ['own'],
        browser: () => passing(['own']),
      }),
    ).rejects.toThrow(
      /The update install of the own consumer is not candidate B:\n.*version-mismatch.*Reinstall @saga-a2ui\/lit from candidate tarball/s,
    );
  }, 240_000);
});

describe('the statement a rehearsal records', () => {
  // `rehearsal.json` stores the statement and the `CANDIDATE.md` section prints it, so both are read
  // from one record that needs no installs.
  const record = {
    format: 1 as const,
    statement: REHEARSAL_STATEMENT,
    candidates: {
      A: '0.0.0-candidate.gaaaaaaaaaaaa',
      B: '0.0.0-candidate.gbbbbbbbbbbbb',
    },
    stages: [],
    transitions: {},
  };
  const texts = (): string[] => [
    JSON.stringify(record),
    rehearsalSummary(record),
  ];

  it('does not claim that no public release exists', () => {
    for (const text of texts()) {
      expect(text).not.toMatch(/no published release exists/i);
      expect(text).not.toMatch(
        /no (SAGA )?package has (ever )?been published/i,
      );
      expect(text).not.toMatch(/first candidate/i);
      expect(text).not.toMatch(/no earlier release/i);
    }
  });

  it('keeps the limit that no registry release was involved or tested', () => {
    for (const text of texts()) {
      expect(text).toMatch(
        /Public npm releases of SAGA packages already exist/,
      );
      expect(text).toMatch(/no registry release was involved/i);
      expect(text).toMatch(/no upgrade from a registry release/i);
      expect(text).toMatch(/not a difference between two versions of the code/);
    }
  });
});

describe('the browser report', () => {
  const report = {
    suites: [
      {
        title: 'pack1-consumers.spec.ts',
        suites: [
          {
            title: 'own consumer, installed from packed artifacts',
            specs: [
              {
                title: 'shows only the public fields',
                tests: [{ status: 'expected' }],
              },
              { title: 'a late result', tests: [{ status: 'unexpected' }] },
            ],
          },
          {
            title: 'card consumer, installed from packed artifacts',
            specs: [
              {
                title: 'shows only the public fields',
                tests: [{ status: 'expected' }],
              },
              { title: 'disposal', tests: [{ status: 'skipped' }] },
            ],
          },
        ],
      },
    ],
  };

  it('names the consumer and the outcome of each case that ran', () => {
    expect(observedCases(report)).toEqual([
      {
        consumer: 'own',
        title: 'shows only the public fields',
        status: 'passed',
      },
      { consumer: 'own', title: 'a late result', status: 'failed' },
      {
        consumer: 'card',
        title: 'shows only the public fields',
        status: 'passed',
      },
      { consumer: 'card', title: 'disposal', status: 'skipped' },
    ]);
  });
});
