import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  claudeApp,
  copyFixture,
  editInput,
  editing,
  fixtureCallsFile,
  recordOf,
  saga,
  wire,
  workspace,
  type Options,
  type Run,
} from './harness.js';
import { staleness } from './previous.js';
import { ARCHIVE_FILES, RECORD_FILE, sha256 } from './record.js';

// `saga publish handoff` as a maintainer runs it (CLI5 #68), on the fixture application of harness.ts:
// prepare a release, begin a handoff for it, record the manual submission, the host's review and the
// live listing, interrupt and resume. Every handoff command is run against a network seam that
// records the requests it sees: the record is kept from local files only, so none may appear. The
// events are read back from the record directory, the way a maintainer or a colleague would.

const START = Date.parse('2026-10-21T09:00:00.000Z');
const MINUTE = 60_000;

/** A clock the test moves; the record's times come from it. */
function clock(): {
  readonly now: () => Date;
  readonly advance: (minutes: number) => string;
} {
  let at = START;
  return {
    now: () => new Date(at),
    advance: (minutes) => {
      at += minutes * MINUTE;
      return new Date(at).toISOString();
    },
  };
}

const release = (app: string): string =>
  path.join(app, 'saga-publication.json');
const prepare = (
  app: string,
  target: 'chatgpt' | 'claude',
  out: string,
  options?: Options,
  extra: readonly string[] = [],
): Promise<Run> =>
  saga(
    [
      'publish',
      'prepare',
      '--target',
      target,
      '--release',
      release(app),
      '--out',
      out,
      ...extra,
    ],
    options,
  );

/** A directory `prepare` wrote for the target, in a workspace of its own. */
async function prepared(
  target: 'chatgpt' | 'claude' = 'claude',
  out = 'publication',
): Promise<{
  readonly app: string;
  readonly cwd: string;
  readonly out: string;
}> {
  const app = target === 'claude' ? claudeApp() : copyFixture();
  const cwd = workspace();
  const run = await prepare(app, target, out, { cwd });
  expect(run.code, run.out + run.err).toBe(0);
  return { app, cwd, out };
}

interface Session {
  readonly cwd: string;
  readonly time: ReturnType<typeof clock>;
  /** Every JSON-RPC method any handoff command other than `begin` sent anywhere. Always empty. */
  readonly network: string[];
  /** Every JSON-RPC method `begin` sent: it assesses the release again, as `check` does, and calls no tool. */
  readonly assessed: string[];
  readonly run: (args: readonly string[], options?: Options) => Promise<Run>;
}

/**
 * Runs handoff commands in `cwd` with one clock and one recording network seam. `begin` assesses
 * the release again, so when the application is given it is passed as `--release` unless the case
 * gives its own.
 */
function session(cwd: string, app?: string): Session {
  const time = clock();
  const seen = wire();
  const assessed: string[] = [];
  return {
    cwd,
    time,
    network: seen.methods,
    assessed,
    run: async (args, options = {}) => {
      const begins = args[0] === 'begin';
      const given =
        begins && app !== undefined && !args.includes('--release')
          ? [...args, '--release', release(app)]
          : args;
      const run = await saga(['publish', 'handoff', ...given], {
        cwd,
        wire: seen,
        now: time.now,
        ...options,
      });
      if (begins) assessed.push(...seen.methods.splice(0));
      return run;
    },
  };
}

const HANDOFF = 'handoff';
const events = (cwd: string): Record<string, any>[] =>
  fs
    .readdirSync(path.join(cwd, HANDOFF))
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map(
      (name) =>
        JSON.parse(
          fs.readFileSync(path.join(cwd, HANDOFF, name), 'utf8'),
        ) as Record<string, any>,
    );
const types = (cwd: string): string[] => events(cwd).map((event) => event.type);
const files = (cwd: string): string[] =>
  fs.readdirSync(path.join(cwd, HANDOFF)).sort();

const AUTHORITY = 'Owner confirmation, ticket NOTES-12';

/** A handoff begun for a freshly prepared Claude release. */
async function begun(target: 'chatgpt' | 'claude' = 'claude'): Promise<{
  readonly s: Session;
  readonly app: string;
  readonly out: string;
}> {
  const { app, cwd, out } = await prepared(target);
  const s = session(cwd, app);
  const run = await s.run([
    'begin',
    '--handoff',
    HANDOFF,
    '--prepared',
    out,
    '--authority-ref',
    AUTHORITY,
  ]);
  expect(run.code, run.out + run.err).toBe(0);
  s.time.advance(5);
  return { s, app, out };
}

/** A handoff whose attempt was recorded and whose submission the host now shows. */
async function submitted(): Promise<{
  readonly s: Session;
  readonly app: string;
  readonly out: string;
}> {
  const handoff = await begun();
  expect(
    (
      await handoff.s.run([
        'attempt',
        '--handoff',
        HANDOFF,
        '--prepared',
        handoff.out,
      ])
    ).code,
  ).toBe(0);
  handoff.s.time.advance(10);
  const run = await handoff.s.run([
    'confirm-submission',
    '--handoff',
    HANDOFF,
    '--reference',
    'SUB-1001',
  ]);
  expect(run.code, run.out + run.err).toBe(0);
  handoff.s.time.advance(60);
  return handoff;
}

/** A clock that, the first time the command reads it (after the record was read, before it is written), runs `swap`: the way a path is replaced under a running command. */
const swappingClock = (s: Session, swap: () => void): (() => Date) => {
  let done = false;
  return () => {
    if (!done) {
      done = true;
      swap();
    }
    return s.time.now();
  };
};

/** Moves the handoff directory aside and puts another directory, holding one file that is not a record, at its path. */
function replaceHandoff(cwd: string, aside: string): void {
  fs.renameSync(path.join(cwd, HANDOFF), path.join(cwd, aside));
  fs.mkdirSync(path.join(cwd, HANDOFF));
  fs.writeFileSync(path.join(cwd, HANDOFF, 'foreign.txt'), 'not a record');
}

const statusOf = (s: Session, ...extra: string[]): Promise<Run> =>
  s.run(['status', '--handoff', HANDOFF, ...extra]);

describe('beginning a handoff', () => {
  it('pins the exact prepared release to its host, publisher and authority references, and keeps the four states apart', async () => {
    const { s, out } = await begun();
    const [begin] = events(s.cwd);

    expect(files(s.cwd)).toEqual(['000001.json']);
    expect(begin?.type).toBe('begin');
    expect(begin?.recordedAt).toBe('2026-10-21T09:00:00.000Z');
    expect(begin?.host).toEqual({
      target: 'claude',
      name: 'Claude connector directory',
      guide: 'https://claude.com/docs/connectors/building/submission',
      portal: 'https://claude.ai/directory/manage',
    });
    expect(begin?.authority).toEqual([AUTHORITY]);
    const record = JSON.parse(
      fs.readFileSync(path.join(s.cwd, out, RECORD_FILE), 'utf8'),
    ) as Record<string, any>;
    expect(begin?.release.artifact.sha256).toBe(record.artifact.sha256);
    expect(begin?.release.endpoint.contractSha256).toBe(
      record.endpoint.contractSha256,
    );
    expect(begin?.release.endpoint.tools).toEqual(record.endpoint.tools);
    expect(begin?.release.application.publisher).toEqual({
      name: 'Notes Fixture Publisher',
      url: 'https://notes.example.com',
    });

    const status = await statusOf(s);
    expect(status.code, status.err).toBe(0);
    expect(status.out).toMatch(/Preparation\s+ready/);
    expect(status.out).toMatch(/Submission\s+not submitted/);
    expect(status.out).toMatch(/Review\s+not started/);
    expect(status.out).toMatch(/Live listing\s+not verified/);
    expect(status.out).toContain(AUTHORITY);
    expect(status.out).toContain(
      'Nothing was deployed, uploaded, submitted or published.',
    );
    expect(s.network).toEqual([]);
  });

  it('gives each host its own record identity', async () => {
    const claude = await begun('claude');
    const chatgpt = await begun('chatgpt');

    const [one, other] = [events(claude.s.cwd)[0]!, events(chatgpt.s.cwd)[0]!];
    expect(other.host.name).toBe('ChatGPT plugin directory');
    expect(other.host.portal).toBeNull();
    expect(other.release.artifact.file).toBe(ARCHIVE_FILES.chatgpt);
    expect(one.handoffId).not.toBe(other.handoffId);
  });

  it('refuses a release that is not ready, an altered package and a missing or secret-bearing authority reference, and writes nothing', async () => {
    const { app, cwd } = await prepared();
    const s = session(cwd, app);

    editInput(
      app,
      (input) => (input.endpoint.expectedServer.version = '9.9.9'),
    );
    expect((await prepare(app, 'claude', 'blocked', { cwd })).code).toBe(1);
    const blocked = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      'blocked',
      '--authority-ref',
      AUTHORITY,
    ]);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toMatch(/blocked, not ready/);

    const bytes = path.join(cwd, 'publication', ARCHIVE_FILES.claude);
    fs.appendFileSync(bytes, 'x');
    const altered = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      'publication',
      '--authority-ref',
      AUTHORITY,
    ]);
    expect(altered.code).toBe(1);
    expect(altered.err).toMatch(/altered|digest/);
    fs.truncateSync(bytes, fs.statSync(bytes).size - 1);

    const none = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      'publication',
    ]);
    expect(none.code).toBe(2);
    expect(none.err).toMatch(/--authority-ref is required/);

    const token = `sk-${'synthetic'.repeat(4)}`;
    const secret = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      'publication',
      '--authority-ref',
      `login ${token}`,
    ]);
    expect(secret.code).toBe(1);
    expect(secret.err).toMatch(/never credentials/);
    expect(secret.err).not.toContain(token);

    expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    expect(s.network).toEqual([]);
  });

  /** Rewrites a prepared output's record and package by hand, the two files a self-authored "ready" has to agree in. */
  function forge(
    cwd: string,
    directory: string,
    change: (record: Record<string, any>) => Buffer,
  ): void {
    const file = path.join(cwd, directory, RECORD_FILE);
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      any
    >;
    const bytes = change(record);
    fs.writeFileSync(path.join(cwd, directory, ARCHIVE_FILES.claude), bytes);
    record.artifact = {
      file: ARCHIVE_FILES.claude,
      sha256: sha256(bytes),
      bytes: bytes.length,
      files: [],
    };
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  }

  it('does not take a self-authored ready record and its matching package as evidence of readiness', async () => {
    const { app, cwd } = await prepared();
    // The release is blocked: the deployment reports a version the release input does not expect.
    editInput(
      app,
      (input) => (input.endpoint.expectedServer.version = '9.9.9'),
    );
    expect((await prepare(app, 'claude', 'forged', { cwd })).code).toBe(1);
    expect(fs.existsSync(path.join(cwd, 'forged', ARCHIVE_FILES.claude))).toBe(
      false,
    );
    // Then the record is edited to say ready, with a package it names by digest. The two files agree
    // with each other, which is all the earlier `begin` asked of them.
    forge(cwd, 'forged', (record) => {
      record.verdict = 'ready';
      record.findings = record.findings.map((finding: any) => ({
        id: finding.id,
        status: 'pass',
        summary: finding.summary,
      }));
      return Buffer.from('not a connector dossier');
    });
    const sound = recordOf(path.join(cwd, 'forged'));
    expect(sound.verdict).toBe('ready');

    const s = session(cwd, app);
    const run = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      'forged',
      '--authority-ref',
      AUTHORITY,
    ]);

    expect(run.code, run.out + run.err).toBe(1);
    expect(run.err).toMatch(/assessed again now, the release is blocked/);
    expect(run.err).toMatch(/not evidence of readiness/);
    expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    expect(s.network).toEqual([]);
  });

  it('does not take a package swapped together with its record for the one the release produces', async () => {
    const { app, cwd, out } = await prepared();
    // The release is ready, but the package that would be submitted is not what it produces.
    forge(cwd, out, () => Buffer.from('another package, with its own digest'));
    const s = session(cwd, app);
    const run = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--authority-ref',
      AUTHORITY,
    ]);

    expect(run.code, run.out + run.err).toBe(1);
    expect(run.err).toMatch(
      /does not match the release as assessed now: the package content changed/,
    );
    expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
  });

  it('does not begin for a release that changed after it was prepared, and names what changed', async () => {
    const { app, cwd, out } = await prepared();
    editInput(
      app,
      (input) => (input.endpoint.expectedServer.version = '9.9.9'),
    );
    const s = session(cwd, app);
    const run = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--authority-ref',
      AUTHORITY,
    ]);

    expect(run.code, run.out + run.err).toBe(1);
    expect(run.err).toMatch(/assessed again now, the release is blocked/);
    expect(run.err).toMatch(/Deployment identity: mismatch/);
    expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
  });

  it('names what changed when the release is still ready but is no longer the one that was prepared', async () => {
    const { app, cwd, out } = await prepared();
    editInput(app, (input) => {
      input.claude.connector.oneLiner = 'Shows whether the service is up.';
    });
    const s = session(cwd, app);
    const run = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--authority-ref',
      AUTHORITY,
    ]);

    expect(run.code, run.out + run.err).toBe(1);
    expect(run.err).toMatch(/does not match the release as assessed now/);
    expect(run.err).toMatch(/the release input changed/);
    expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
  });

  it('assesses the release again, without calling a tool, and needs the release input to do so', async () => {
    const { app, cwd, out } = await prepared();
    const s = session(cwd);
    const missing = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--authority-ref',
      AUTHORITY,
    ]);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/--release is required/);
    expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);

    const ok = session(cwd, app);
    expect(ok.network).toEqual([]);
    const run = await ok.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--authority-ref',
      AUTHORITY,
    ]);
    expect(run.code, run.err).toBe(0);
    expect(ok.assessed).toContain('initialize');
    expect(ok.assessed).toContain('tools/list');
    expect(ok.assessed).not.toContain('tools/call');
    expect(ok.network).toEqual([]);
  });

  describe('when the preparation opted in to a fixture invocation', () => {
    const beginArgs = (out: string, ...extra: string[]): string[] => [
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--authority-ref',
      AUTHORITY,
      ...extra,
    ];

    /** A release prepared with a fixture call that succeeded, in a workspace of its own. */
    async function preparedWithFixture(): Promise<{
      readonly app: string;
      readonly cwd: string;
      readonly out: string;
      readonly calls: string;
    }> {
      const app = copyFixture();
      const cwd = workspace();
      const calls = await fixtureCallsFile();
      const run = await prepare(app, 'chatgpt', 'publication', { cwd }, [
        '--invoke-fixture',
        calls,
      ]);
      expect(run.code, run.out + run.err).toBe(0);
      expect(recordOf(path.join(cwd, 'publication')).fixture.invoked).toBe(
        true,
      );
      return { app, cwd, out: 'publication', calls };
    }

    /** Replaces the result of every `tools/call` the endpoint answers, as an endpoint whose answer changed would. */
    const answering =
      (text: string) =>
      async (method: string, response: Response): Promise<Response> => {
        if (method !== 'tools/call') return response;
        const body = (await response.json()) as Record<string, any>;
        body.result = { content: [{ type: 'text', text }] };
        return new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
        });
      };

    it('assesses with the same fixture and pins the invocation it saw', async () => {
      const { app, cwd, out, calls } = await preparedWithFixture();
      const methods: string[] = [];
      const seen = wire();
      const s = session(cwd, app);
      const run = await s.run(beginArgs(out, '--invoke-fixture', calls), {
        wire: seen,
      });
      methods.push(...seen.methods);

      expect(run.code, run.out + run.err).toBe(0);
      expect(methods.filter((method) => method === 'tools/call')).toHaveLength(
        1,
      );
      const pinned = events(cwd)[0]!.release;
      expect(pinned.fixture).toEqual(recordOf(path.join(cwd, out)).fixture);
      expect(pinned.fixture.invoked).toBe(true);
      expect(pinned.fixture.invocations).toEqual([
        {
          tool: 'get_status',
          outcome: 'ok',
          resultSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      ]);
    });

    it('does not begin without the fixture the preparation was made with, and calls no tool', async () => {
      const { app, cwd, out } = await preparedWithFixture();
      const seen = wire();
      const s = session(cwd, app);
      const run = await s.run(beginArgs(out), { wire: seen });

      expect(run.code, run.out + run.err).toBe(1);
      expect(run.err).toMatch(/does not match the release as assessed now/);
      expect(run.err).toMatch(/the fixture invocation changed/);
      expect(seen.methods).not.toContain('tools/call');
      expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    });

    it('does not begin when the fixture now returns another result', async () => {
      const { app, cwd, out, calls } = await preparedWithFixture();
      const s = session(cwd, app);
      const run = await s.run(beginArgs(out, '--invoke-fixture', calls), {
        wire: wire(answering('another answer')),
      });

      expect(run.code, run.out + run.err).toBe(1);
      expect(run.err).toMatch(/does not match the release as assessed now/);
      expect(run.err).toMatch(/the fixture invocation changed/);
      expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    });

    it('does not begin when the fixture now fails', async () => {
      const { app, cwd, out } = await preparedWithFixture();
      const refused = await fixtureCallsFile({
        calls: [{ tool: 'delete_everything', arguments: {} }],
      });
      const s = session(cwd, app);
      const run = await s.run(beginArgs(out, '--invoke-fixture', refused));

      expect(run.code, run.out + run.err).toBe(1);
      expect(run.err).toMatch(/not ready/);
      expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    });

    it('does not begin with a fixture over a preparation made without one', async () => {
      const { app, cwd, out } = await prepared('chatgpt');
      const calls = await fixtureCallsFile();
      const s = session(cwd, app);
      const run = await s.run(beginArgs(out, '--invoke-fixture', calls));

      expect(run.code, run.out + run.err).toBe(1);
      expect(run.err).toMatch(/the fixture invocation changed/);
      expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    });

    it('still begins without a fixture over a preparation made without one, and pins that no fixture ran', async () => {
      const { app, cwd, out } = await prepared('chatgpt');
      const s = session(cwd, app);
      const run = await s.run(beginArgs(out));

      expect(run.code, run.out + run.err).toBe(0);
      expect(s.assessed).not.toContain('tools/call');
      expect(events(cwd)[0]!.release.fixture).toEqual({
        declared: 0,
        callsSha256: null,
        invoked: false,
        invocations: [],
      });
    });

    /** Removes the fixture section from a prepared record by hand; the package is untouched, so its digest still matches. */
    function withoutFixtureSection(cwd: string, out: string): void {
      const file = path.join(cwd, out, RECORD_FILE);
      const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
        string,
        any
      >;
      expect(record.fixture).toBeDefined();
      delete record.fixture;
      fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    }

    it('does not begin from a prepared record whose fixture section was removed, with the fixture or without it', async () => {
      const { app, cwd, out, calls } = await preparedWithFixture();
      withoutFixtureSection(cwd, out);

      for (const extra of [[], ['--invoke-fixture', calls]]) {
        const s = session(cwd, app);
        const run = await s.run(beginArgs(out, ...extra));
        expect(run.code, run.out + run.err).toBe(1);
        expect(run.err).toMatch(/does not match the release as assessed now/);
        expect(run.err).toMatch(
          /the fixture evidence is missing from the earlier record/,
        );
        expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
      }
    });

    it('does not begin from a fixtureless prepared record whose fixture section was removed', async () => {
      const { app, cwd, out } = await prepared('chatgpt');
      withoutFixtureSection(cwd, out);
      const s = session(cwd, app);
      const run = await s.run(beginArgs(out));

      expect(run.code, run.out + run.err).toBe(1);
      expect(run.err).toMatch(
        /the fixture evidence is missing from the earlier record/,
      );
      expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    });

    it('does not begin when the declared call has other arguments, though it returns the same result', async () => {
      // An endpoint that ignores its arguments answers every call alike.
      const app = copyFixture();
      const cwd = workspace();
      const calls = await fixtureCallsFile();
      const made = await prepare(
        app,
        'chatgpt',
        'publication',
        { cwd, wire: wire(answering('same answer')) },
        ['--invoke-fixture', calls],
      );
      expect(made.code, made.out + made.err).toBe(0);
      const other = await fixtureCallsFile({
        calls: [{ tool: 'get_status', arguments: { verbose: true } }],
      });
      const s = session(cwd, app);
      const run = await s.run(
        beginArgs('publication', '--invoke-fixture', other),
        { wire: wire(answering('same answer')) },
      );

      expect(run.code, run.out + run.err).toBe(1);
      expect(run.err).toMatch(/does not match the release as assessed now/);
      expect(run.err).toMatch(/the fixture invocation changed/);
      expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
    });

    it('pins a digest of the declared calls and keeps the arguments out of every record', async () => {
      const marker = 'argument-marker-7f3a';
      const app = copyFixture();
      const cwd = workspace();
      const calls = await fixtureCallsFile({
        calls: [{ tool: 'get_status', arguments: { note: marker } }],
      });
      const made = await prepare(
        app,
        'chatgpt',
        'publication',
        { cwd, wire: wire(answering('same answer')) },
        ['--invoke-fixture', calls],
      );
      expect(made.code, made.out + made.err).toBe(0);
      const s = session(cwd, app);
      const run = await s.run(
        beginArgs('publication', '--invoke-fixture', calls),
        { wire: wire(answering('same answer')) },
      );
      expect(run.code, run.out + run.err).toBe(0);

      const pinned = events(cwd)[0]!.release.fixture;
      expect(pinned.callsSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pinned.callsSha256).toBe(
        recordOf(path.join(cwd, 'publication')).fixture.callsSha256,
      );
      const everything = [
        fs.readFileSync(path.join(cwd, 'publication', RECORD_FILE), 'utf8'),
        ...fs
          .readdirSync(path.join(cwd, HANDOFF))
          .map((name) =>
            fs.readFileSync(path.join(cwd, HANDOFF, name), 'utf8'),
          ),
        run.out,
        run.err,
      ].join('\n');
      expect(everything).not.toContain(marker);
    });

    describe('comparing a pinned release with a newer preparation', () => {
      const fixtureSection = {
        declared: 1,
        callsSha256: 'a'.repeat(64),
        invoked: true,
        invocations: [],
      };

      it('requires the fixture section of a prepared record, and only a pin from an earlier handoff may lack it', async () => {
        const { cwd, out } = await preparedWithFixture();
        const { fixture: _fixture, ...bare } = recordOf(path.join(cwd, out));
        const current = recordOf(path.join(cwd, out));

        expect(staleness(bare, current)).toEqual([
          'the fixture evidence is missing from the earlier record',
        ]);
        expect(staleness(bare, current, { historicalPin: true })).toEqual([]);
        expect(staleness(current, current)).toEqual([]);
        expect(
          staleness({ ...current, fixture: fixtureSection }, current, {
            historicalPin: true,
          }),
        ).toEqual(['the fixture invocation changed']);
      });
    });
  });

  it('keeps the assessment options to begin', async () => {
    const { app, cwd } = await begun().then((one) => ({
      ...one,
      cwd: one.s.cwd,
    }));
    const s = session(cwd);
    const run = await s.run([
      'status',
      '--handoff',
      HANDOFF,
      '--release',
      release(app),
    ]);
    expect(run.code).toBe(2);
    expect(run.err).toMatch(/--release belongs to saga publish handoff begin/);
  });

  it('does not begin over a record that exists', async () => {
    const { s, out } = await begun();
    const again = await s.run([
      'begin',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--authority-ref',
      'another ref',
    ]);

    expect(again.code).toBe(1);
    expect(again.err).toMatch(/already holds files/);
    expect(files(s.cwd)).toEqual(['000001.json']);
  });

  it('leaves no new directory when interrupted before the record exists', async () => {
    const { app, cwd, out } = await prepared();
    const controller = new AbortController();
    controller.abort();
    const run = await session(cwd, app).run(
      [
        'begin',
        '--handoff',
        HANDOFF,
        '--prepared',
        out,
        '--authority-ref',
        AUTHORITY,
      ],
      { signal: controller.signal },
    );

    expect(run.code).toBe(130);
    expect(fs.existsSync(path.join(cwd, HANDOFF))).toBe(false);
  });
});

describe('an uncertain submission', () => {
  it('is inspected before any retry: no second attempt, no second submission, nothing sent to a host', async () => {
    const { s, out } = await begun();
    const attempt = await s.run([
      'attempt',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
    ]);

    expect(attempt.code, attempt.err).toBe(0);
    expect(attempt.out).toContain('This tool submits nothing');
    expect(attempt.out).toContain('https://claude.ai/directory/manage');
    expect(attempt.out).toContain(AUTHORITY);
    s.time.advance(30);

    // The process died, or the maintainer lost the page: the portal may or may not hold the upload.
    const status = await statusOf(s);
    expect(status.code).toBe(1);
    expect(status.out).toMatch(
      /Submission\s+UNRESOLVED attempt since 2026-10-21T09:05:00.000Z/,
    );

    const retry = await s.run([
      'attempt',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
    ]);
    expect(retry.code).toBe(1);
    expect(retry.err).toMatch(/outcome was never recorded/);
    expect(retry.err).toMatch(
      /Inspect the existing submission in Claude connector directory/,
    );
    expect(types(s.cwd)).toEqual(['begin', 'submission-attempt']);

    // Reviews cannot be recorded against a submission nobody has confirmed.
    const review = await s.run([
      'record-review',
      '--handoff',
      HANDOFF,
      '--state',
      'in-review',
    ]);
    expect(review.code).toBe(1);
    expect(types(s.cwd)).toEqual(['begin', 'submission-attempt']);

    // The existing submission is found: it is recorded, and a further attempt would duplicate it.
    const found = await s.run([
      'confirm-submission',
      '--handoff',
      HANDOFF,
      '--reference',
      'SUB-1001',
    ]);
    expect(found.code, found.err).toBe(0);
    const again = await s.run([
      'attempt',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
    ]);
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/Already submitted: .* reference SUB-1001/);

    const conflicting = await s.run([
      'confirm-submission',
      '--handoff',
      HANDOFF,
      '--reference',
      'SUB-2002',
    ]);
    expect(conflicting.code).toBe(1);
    expect(conflicting.err).toMatch(/second upload of the same release/);
    const same = await s.run([
      'confirm-submission',
      '--handoff',
      HANDOFF,
      '--reference',
      'SUB-1001',
    ]);
    expect(same.code).toBe(0);
    expect(same.out).toMatch(/already recorded/);

    expect(types(s.cwd)).toEqual([
      'begin',
      'submission-attempt',
      'submission-confirmed',
    ]);
    expect(events(s.cwd)[2]).toMatchObject({
      attemptSeq: 2,
      reference: 'SUB-1001',
    });
    expect(s.network).toEqual([]);
  });

  it('allows another attempt only after the maintainer records what they inspected and found nothing', async () => {
    const { s, out } = await begun();
    expect(
      (await s.run(['attempt', '--handoff', HANDOFF, '--prepared', out])).code,
    ).toBe(0);

    const unexplained = await s.run(['void-attempt', '--handoff', HANDOFF]);
    expect(unexplained.code).toBe(2);
    expect(types(s.cwd)).toEqual(['begin', 'submission-attempt']);

    s.time.advance(20);
    const voided = await s.run([
      'void-attempt',
      '--handoff',
      HANDOFF,
      '--inspected',
      'Developer portal, Submissions list: no entry for notes-fixture',
    ]);
    expect(voided.code, voided.err).toBe(0);
    expect((await statusOf(s)).out).toMatch(/Submission\s+not submitted/);

    const second = await s.run([
      'attempt',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
    ]);
    expect(second.code, second.err).toBe(0);
    expect(types(s.cwd)).toEqual([
      'begin',
      'submission-attempt',
      'attempt-voided',
      'submission-attempt',
    ]);
    expect(events(s.cwd)[2]).toMatchObject({
      attemptSeq: 2,
      inspected:
        'Developer portal, Submissions list: no entry for notes-fixture',
    });
    // There is nothing to void once nothing is unsettled.
    expect(
      (
        await s.run([
          'confirm-submission',
          '--handoff',
          HANDOFF,
          '--reference',
          'SUB-7',
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await s.run([
          'void-attempt',
          '--handoff',
          HANDOFF,
          '--inspected',
          'looked',
        ])
      ).code,
    ).toBe(1);
  });

  it('records no attempt when interrupted after the event was staged and before it was in place', async () => {
    const { s, out } = await begun();
    const controller = new AbortController();
    // The interrupt arrives once the event is staged beside the record and before it is linked into place.
    const write = fs.writeFileSync;
    const written = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementationOnce(
        (...args: Parameters<typeof fs.writeFileSync>) => {
          write(...args);
          controller.abort();
        },
      );
    let run: Run;
    try {
      run = await s.run(['attempt', '--handoff', HANDOFF, '--prepared', out], {
        signal: controller.signal,
      });
    } finally {
      written.mockRestore();
    }

    expect(run.code).toBe(130);
    expect(run.err).toMatch(/interrupted; nothing was recorded/);
    expect(files(s.cwd)).toEqual(['000001.json']);
    expect((await statusOf(s)).out).toMatch(/Submission\s+not submitted/);
    // Resumed: the same attempt can now be made, once.
    expect(
      (await s.run(['attempt', '--handoff', HANDOFF, '--prepared', out])).code,
    ).toBe(0);
    expect(types(s.cwd)).toEqual(['begin', 'submission-attempt']);
  });

  it('records one attempt when two commands race for the same place in the record', async () => {
    const { s, out } = await begun();
    const link = vi.spyOn(fs, 'linkSync');
    // The other command wins: its identical event takes the place first.
    link.mockImplementationOnce((existing, target) => {
      fs.copyFileSync(existing, target);
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    });
    let loser: Run;
    try {
      loser = await s.run(['attempt', '--handoff', HANDOFF, '--prepared', out]);
    } finally {
      link.mockRestore();
    }

    expect(loser.code).toBe(1);
    expect(loser.err).toMatch(/changed while this command was running/);
    expect(types(s.cwd)).toEqual(['begin', 'submission-attempt']);
    expect(files(s.cwd)).toEqual(['000001.json', '000002.json']);
    const retry = await s.run([
      'attempt',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
    ]);
    expect(retry.code).toBe(1);
    expect(retry.err).toMatch(/outcome was never recorded/);
  });

  it('writes only into the directory that was read: a path replaced under a running command is refused and the other directory is untouched', async () => {
    const { s, out } = await begun();
    const run = await s.run(
      ['attempt', '--handoff', HANDOFF, '--prepared', out],
      {
        now: swappingClock(s, () => replaceHandoff(s.cwd, 'handoff-original')),
      },
    );

    expect(run.code).toBe(1);
    expect(run.err).toMatch(
      /handoff directory was replaced while this command was running, so nothing was recorded/,
    );
    expect(run.out).not.toMatch(/Recorded the start of a submission attempt/);
    // The foreign directory holds what it held, byte for byte, with no event and no leftover.
    expect(files(s.cwd)).toEqual(['foreign.txt']);
    expect(
      fs.readFileSync(path.join(s.cwd, HANDOFF, 'foreign.txt'), 'utf8'),
    ).toBe('not a record');
    // The record that was read has no attempt, so resuming it does not mistake the refusal for one.
    expect(fs.readdirSync(path.join(s.cwd, 'handoff-original')).sort()).toEqual(
      ['000001.json'],
    );

    fs.rmSync(path.join(s.cwd, HANDOFF), { recursive: true });
    fs.renameSync(
      path.join(s.cwd, 'handoff-original'),
      path.join(s.cwd, HANDOFF),
    );
    expect((await statusOf(s)).out).toMatch(/Submission\s+not submitted/);
    expect(
      (await s.run(['attempt', '--handoff', HANDOFF, '--prepared', out])).code,
    ).toBe(0);
    expect(types(s.cwd)).toEqual(['begin', 'submission-attempt']);
  });

  it('writes the first event only into the directory it made: a path replaced meanwhile is refused and left alone', async () => {
    const { app, cwd, out } = await prepared();
    const s = session(cwd, app);
    const run = await s.run(
      [
        'begin',
        '--handoff',
        HANDOFF,
        '--prepared',
        out,
        '--authority-ref',
        AUTHORITY,
      ],
      { now: swappingClock(s, () => replaceHandoff(cwd, 'handoff-made')) },
    );

    expect(run.code).toBe(1);
    expect(run.err).toMatch(
      /handoff directory was replaced while this command was running, so nothing was recorded/,
    );
    expect(files(cwd)).toEqual(['foreign.txt']);
    expect(
      fs.readFileSync(path.join(cwd, HANDOFF, 'foreign.txt'), 'utf8'),
    ).toBe('not a record');
    expect(fs.readdirSync(path.join(cwd, 'handoff-made'))).toEqual([]);
  });

  /**
   * A signal that, when it is read after the event was staged and before it is linked, replaces the
   * handoff path at that moment: the original is
   * moved aside and the other directory holds a file of the same name as the staged temporary file.
   */
  const replacingAfterStaging = (cwd: string): AbortSignal => {
    let done = false;
    return {
      get aborted(): boolean {
        // Read earlier too, before anything is staged: act only once the temporary file exists.
        const staged = done
          ? []
          : fs
              .readdirSync(path.join(cwd, HANDOFF))
              .filter((name) => name.includes('.tmp-'));
        if (staged.length > 0) {
          done = true;
          replaceHandoff(cwd, 'handoff-original');
          fs.writeFileSync(
            path.join(cwd, HANDOFF, staged[0] as string),
            'somebody else',
          );
        }
        return false;
      },
    } as AbortSignal;
  };

  it('never cleans a replacement when the system names no open directory: a path replaced after staging is refused and a same-named file there stays', async () => {
    const { s, out } = await begun();
    const real = fs.existsSync;
    const noProc = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation((target) =>
        String(target).startsWith('/proc/self/fd/') ? false : real(target),
      );
    let run: Run;
    try {
      run = await s.run(['attempt', '--handoff', HANDOFF, '--prepared', out], {
        signal: replacingAfterStaging(s.cwd),
      });
    } finally {
      noProc.mockRestore();
    }

    expect(run.code).toBe(1);
    expect(run.err).toMatch(
      /handoff directory was replaced while this command was running, so nothing was recorded/,
    );
    expect(files(s.cwd).sort()).toEqual(
      expect.arrayContaining(['foreign.txt']),
    );
    expect(files(s.cwd)).toHaveLength(2);
    const [other] = files(s.cwd).filter((name) => name !== 'foreign.txt');
    expect(
      fs.readFileSync(path.join(s.cwd, HANDOFF, other as string), 'utf8'),
    ).toBe('somebody else');
    expect(
      fs.readFileSync(path.join(s.cwd, HANDOFF, 'foreign.txt'), 'utf8'),
    ).toBe('not a record');
    // No event anywhere; this command's own temporary file may stay in the directory that was moved, ignored.
    expect(
      fs
        .readdirSync(path.join(s.cwd, 'handoff-original'))
        .filter((name) => !name.startsWith('.')),
    ).toEqual(['000001.json']);

    fs.rmSync(path.join(s.cwd, HANDOFF), { recursive: true });
    fs.renameSync(
      path.join(s.cwd, 'handoff-original'),
      path.join(s.cwd, HANDOFF),
    );
    expect((await statusOf(s)).code).toBe(0);
    expect(
      (await s.run(['attempt', '--handoff', HANDOFF, '--prepared', out])).code,
    ).toBe(0);
    expect(types(s.cwd)).toEqual(['begin', 'submission-attempt']);
  });

  it.skipIf(!fs.existsSync('/proc/self/fd'))(
    'cleans its own staged file through the open directory when the path was replaced after staging, and touches nothing at the path',
    async () => {
      const { s, out } = await begun();
      const run = await s.run(
        ['attempt', '--handoff', HANDOFF, '--prepared', out],
        { signal: replacingAfterStaging(s.cwd) },
      );

      expect(run.code).toBe(1);
      expect(run.err).toMatch(
        /handoff directory was replaced while this command was running, so nothing was recorded/,
      );
      expect(files(s.cwd)).toHaveLength(2);
      const [other] = files(s.cwd).filter((name) => name !== 'foreign.txt');
      expect(
        fs.readFileSync(path.join(s.cwd, HANDOFF, other as string), 'utf8'),
      ).toBe('somebody else');
      // Through the open directory the command removed its own file from the directory that was moved.
      expect(fs.readdirSync(path.join(s.cwd, 'handoff-original'))).toEqual([
        '000001.json',
      ]);
    },
  );

  it('is unaffected by the remains of an interrupted write, and refuses a record that was altered', async () => {
    const { s } = await begun();
    fs.writeFileSync(
      path.join(s.cwd, HANDOFF, '.000002.json.tmp-abc123'),
      '{"half":',
    );
    expect((await statusOf(s)).code).toBe(0);

    const first = path.join(s.cwd, HANDOFF, '000001.json');
    expect(
      (
        await s.run([
          'attempt',
          '--handoff',
          HANDOFF,
          '--prepared',
          'publication',
        ])
      ).code,
    ).toBe(0);
    const original = fs.readFileSync(first, 'utf8');
    fs.writeFileSync(
      first,
      original.replace('Owner confirmation', 'Someone else'),
    );
    const altered = await statusOf(s);
    expect(altered.code).toBe(1);
    expect(altered.err).toMatch(
      /does not follow the event before it; the record was altered/,
    );

    fs.writeFileSync(first, original);
    fs.rmSync(path.join(s.cwd, HANDOFF, '000002.json'));
    fs.writeFileSync(path.join(s.cwd, HANDOFF, '000003.json'), '{}');
    expect((await statusOf(s)).err).toMatch(/not the next event|missing/);
  });
});

describe('stale evidence', () => {
  /** A change to what the deployment serves or the release says, and how a maintainer's status then names it. */
  const changes: readonly {
    readonly name: string;
    readonly apply: (app: string) => Options | undefined;
    readonly reads: RegExp;
  }[] = [
    {
      name: 'a tool definition',
      apply: () => ({
        wire: editing(
          'tools/list',
          (result) =>
            (result.tools[0].description = `${result.tools[0].description} Also reports uptime.`),
        ),
      }),
      reads: /the tool definitions changed/,
    },
    {
      name: "a served resource's content security policy",
      apply: () => ({
        wire: editing('resources/read', (result) => {
          const content = result.contents[0];
          content._meta = {
            ...content._meta,
            ui: {
              ...content._meta?.ui,
              csp: {
                ...content._meta?.ui?.csp,
                connectDomains: ['https://elsewhere.example.com'],
              },
            },
          };
        }),
      }),
      reads:
        /a served resource's metadata \(its content security policy and permissions\) changed/,
    },
    {
      name: 'the server instructions',
      apply: () => ({
        wire: editing(
          'initialize',
          (result) =>
            (result.instructions = 'Use these tools for anything at all.'),
        ),
      }),
      reads: /the server instructions changed/,
    },
    {
      name: 'the deployment identity',
      apply: (app) => {
        editInput(
          app,
          (input) => (input.endpoint.expectedServer.version = '9.9.9'),
        );
        return undefined;
      },
      reads: /the current preparation is blocked, not ready/,
    },
  ];

  it.each(changes)(
    '$name invalidates the readiness of a new attempt, and an unchanged preparation does not',
    async ({ apply, reads }) => {
      const { s, app } = await begun();

      const same = await prepare(app, 'claude', 'again', { cwd: s.cwd });
      expect(same.code).toBe(0);
      expect((await statusOf(s, '--prepared', 'again')).out).toMatch(
        /Freshness: current/,
      );

      await prepare(app, 'claude', 'changed', { cwd: s.cwd, ...apply(app) });
      expect(fs.existsSync(path.join(s.cwd, 'changed', RECORD_FILE))).toBe(
        true,
      );
      const status = await statusOf(s, '--prepared', 'changed');
      expect(status.code).toBe(1);
      expect(status.out).toMatch(/Freshness: STALE/);
      expect(status.out).toMatch(reads);
      expect(status.out).toMatch(/Preparation\s+stale/);

      const refused = await s.run([
        'attempt',
        '--handoff',
        HANDOFF,
        '--prepared',
        'changed',
      ]);
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(/no longer the current one/);
      expect(types(s.cwd)).toEqual(['begin']);

      // The unchanged preparation still allows it.
      expect(
        (await s.run(['attempt', '--handoff', HANDOFF, '--prepared', 'again']))
          .code,
      ).toBe(0);
    },
  );

  it('is not guessed: a command that depends on the release needs a preparation to compare with, and rejects an unusable one', async () => {
    const { s } = await begun();

    const missing = await s.run(['attempt', '--handoff', HANDOFF]);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/--prepared is required/);

    const nowhere = await s.run([
      'attempt',
      '--handoff',
      HANDOFF,
      '--prepared',
      'nowhere',
    ]);
    expect(nowhere.code).toBe(1);
    expect(nowhere.err).toMatch(/cannot be used/);

    expect((await statusOf(s)).out).toMatch(/Freshness: not checked/);
    expect(types(s.cwd)).toEqual(['begin']);
  });

  it('does not let a changed deployment pass for the verified listing of the release that was submitted', async () => {
    const { s, app, out } = await submitted();
    expect(
      (
        await s.run([
          'record-review',
          '--handoff',
          HANDOFF,
          '--state',
          'approved',
        ])
      ).code,
    ).toBe(0);
    s.time.advance(60);
    const widened = editing('resources/read', (result) => {
      const content = result.contents[0];
      content._meta = {
        ...content._meta,
        ui: {
          ...content._meta?.ui,
          csp: {
            ...content._meta?.ui?.csp,
            connectDomains: ['https://elsewhere.example.com'],
          },
        },
      };
    });
    expect(
      (await prepare(app, 'claude', 'changed', { cwd: s.cwd, wire: widened }))
        .code,
    ).toBe(0);

    const refused = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--prepared',
      'changed',
      '--state',
      'verified-live',
      '--host',
      'Claude web, Notes workspace',
      '--evidence',
      'recording 7',
    ]);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/no longer the current one/);

    // Observed against the release that was submitted, the same command is accepted.
    const accepted = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--state',
      'verified-live',
      '--host',
      'Claude web, Notes workspace',
      '--evidence',
      'recording 7',
    ]);
    expect(accepted.code, accepted.err).toBe(0);
    // And when the deployment later changes, the earlier observation is reported as made for the earlier release.
    const status = await statusOf(s, '--prepared', 'changed');
    expect(status.code).toBe(1);
    expect(status.out).toMatch(/verified-live on Claude web, Notes workspace/);
    expect(status.out).toMatch(
      /observed for the earlier release, so recheck it on the named host/,
    );
  });
});

describe('review and the live listing', () => {
  const LIVE = (out: string): string[] => [
    'record-listing',
    '--handoff',
    HANDOFF,
    '--prepared',
    out,
    '--state',
    'verified-live',
    '--host',
    'Claude web, Notes workspace',
    '--evidence',
    'recording 7',
  ];

  it('checks the current release before it answers that the listing is already verified live, and keeps the earlier observation', async () => {
    const { s, app, out } = await submitted();
    expect(
      (
        await s.run([
          'record-review',
          '--handoff',
          HANDOFF,
          '--state',
          'approved',
        ])
      ).code,
    ).toBe(0);
    s.time.advance(60);
    expect((await s.run(LIVE(out))).code).toBe(0);
    const recorded = files(s.cwd);
    const widened = editing('resources/read', (result) => {
      const content = result.contents[0];
      content._meta = {
        ...content._meta,
        ui: {
          ...content._meta?.ui,
          csp: {
            ...content._meta?.ui?.csp,
            connectDomains: ['https://elsewhere.example.com'],
          },
        },
      };
    });
    expect(
      (await prepare(app, 'claude', 'changed', { cwd: s.cwd, wire: widened }))
        .code,
    ).toBe(0);

    // The same command, against changed, missing or unusable evidence: refused, not idempotent success.
    for (const current of ['changed', 'missing']) {
      const repeated = await s.run(LIVE(current));
      expect(repeated.code, repeated.out).toBe(1);
      expect(repeated.out).not.toMatch(/already verified live/);
      expect(repeated.err).toMatch(
        current === 'changed' ? /no longer the current one/ : /cannot be used/,
      );
      expect(repeated.err).toMatch(
        /earlier observation \(verified live on Claude web, Notes workspace, recording 7, observed [^)]*\) stays in the record as made for the release this record pins/,
      );
    }
    const unchecked = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--state',
      'verified-live',
      '--host',
      'Claude web, Notes workspace',
      '--evidence',
      'recording 7',
    ]);
    expect(unchecked.code).toBe(2);
    expect(files(s.cwd)).toEqual(recorded);

    // Against the release that was submitted, still current, the repeat is idempotent and says which release it speaks for.
    const same = await s.run(LIVE(out));
    expect(same.code, same.err).toBe(0);
    expect(same.out).toMatch(
      /already verified live .* for the release this record pins, which is still the current one; nothing changed/,
    );
    expect(files(s.cwd)).toEqual(recorded);
    const status = await statusOf(s, '--prepared', 'changed');
    expect(status.out).toMatch(
      /observed for the earlier release, so recheck it on the named host/,
    );
  });

  it('orders each review and listing observation after the newest one already recorded', async () => {
    const { s, out } = await submitted();
    s.time.advance(60);
    const review = (state: string, at: string): Promise<Run> =>
      s.run([
        'record-review',
        '--handoff',
        HANDOFF,
        '--state',
        state,
        '--observed-at',
        at,
      ]);

    expect((await review('in-review', '2026-10-21T10:30:00Z')).code).toBe(0);
    const older = await review('approved', '2026-10-21T10:00:00Z');
    expect(older.code).toBe(1);
    expect(older.err).toMatch(
      /before the review was last observed as in-review \(2026-10-21T10:30:00.000Z\)/,
    );
    expect(types(s.cwd)).toEqual([
      'begin',
      'submission-attempt',
      'submission-confirmed',
      'review-observed',
    ]);
    // The existing floor still applies, and a time equal to the last observation is not before it.
    expect((await review('approved', '2026-10-21T09:00:00Z')).err).toMatch(
      /before the submission was observed/,
    );
    expect((await review('approved', '2026-10-21T10:30:00Z')).code).toBe(0);

    const listing = (state: string, at: string): Promise<Run> =>
      s.run([
        'record-listing',
        '--handoff',
        HANDOFF,
        '--prepared',
        out,
        '--state',
        state,
        '--host',
        'Claude web',
        '--evidence',
        'note',
        '--observed-at',
        at,
      ]);
    expect((await listing('not-listed', '2026-10-21T11:00:00Z')).code).toBe(0);
    const stale = await listing('verified-live', '2026-10-21T10:45:00Z');
    expect(stale.code).toBe(1);
    expect(stale.err).toMatch(
      /before the listing was last observed as not-listed \(2026-10-21T11:00:00.000Z\)/,
    );
    expect((await listing('verified-live', '2026-10-21T11:00:00Z')).code).toBe(
      0,
    );
    expect(types(s.cwd).slice(-3)).toEqual([
      'review-observed',
      'listing-observed',
      'listing-observed',
    ]);
  });

  it("keeps submission, the host's review and a verified listing distinct, in order, with named-host evidence", async () => {
    const { s, out } = await submitted();
    const open = await statusOf(s);
    expect(open.out).toMatch(
      /Submission\s+submitted, reference SUB-1001 \(observed 2026-10-21T09:15:00.000Z\)/,
    );
    expect(open.out).toMatch(/Review\s+not started/);

    // A listing is not observed before the host approved.
    const early = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--state',
      'verified-live',
      '--host',
      'Claude web',
      '--evidence',
      'note',
    ]);
    expect(early.code).toBe(1);
    expect(early.err).toMatch(/only after an approval is recorded/);

    expect(
      (
        await s.run([
          'record-review',
          '--handoff',
          HANDOFF,
          '--state',
          'in-review',
          '--reference',
          'https://claude.ai/directory/manage/review/1',
        ])
      ).code,
    ).toBe(0);
    s.time.advance(120);
    const approved = await s.run([
      'record-review',
      '--handoff',
      HANDOFF,
      '--state',
      'approved',
    ]);
    expect(approved.code, approved.err).toBe(0);
    expect(approved.out).toMatch(/An approval is not a live listing/);

    // Approved is not live.
    const afterApproval = await statusOf(s);
    expect(afterApproval.out).toMatch(/Review\s+approved/);
    expect(afterApproval.out).toMatch(/Live listing\s+not verified/);

    // A live listing needs a named host and its evidence.
    const unnamed = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--state',
      'verified-live',
    ]);
    expect(unnamed.code).toBe(2);
    const future = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--state',
      'verified-live',
      '--host',
      'Claude web',
      '--evidence',
      'rec',
      '--observed-at',
      '2030-01-01T00:00:00Z',
    ]);
    expect(future.code).toBe(1);
    expect(future.err).toMatch(/in the future/);
    const early2 = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--state',
      'verified-live',
      '--host',
      'Claude web',
      '--evidence',
      'rec',
      '--observed-at',
      '2026-10-21T09:00:00Z',
    ]);
    expect(early2.err).toMatch(/before the approval was observed/);

    s.time.advance(30);
    const live = await s.run([
      'record-listing',
      '--handoff',
      HANDOFF,
      '--prepared',
      out,
      '--state',
      'verified-live',
      '--host',
      'Claude web, Notes workspace',
      '--evidence',
      'recording 7',
    ]);
    expect(live.code, live.err).toBe(0);
    const done = await statusOf(s, '--prepared', out);
    expect(done.code).toBe(0);
    expect(done.out).toMatch(
      /Live listing\s+verified-live on Claude web, Notes workspace \(recording 7; observed 2026-10-21T12:45:00.000Z\)/,
    );
    expect(types(s.cwd)).toEqual([
      'begin',
      'submission-attempt',
      'submission-confirmed',
      'review-observed',
      'review-observed',
      'listing-observed',
    ]);
    expect(events(s.cwd)[5]?.release).toEqual({
      artifactSha256: events(s.cwd)[0]?.release.artifact.sha256,
      contractSha256: events(s.cwd)[0]?.release.endpoint.contractSha256,
    });
    expect(s.network).toEqual([]);
  });

  it("refuses a review that predates the submission, a review after the host's final answer, and a time that is not a time", async () => {
    const { s } = await submitted();
    const predates = await s.run([
      'record-review',
      '--handoff',
      HANDOFF,
      '--state',
      'in-review',
      '--observed-at',
      '2026-10-21T08:00:00Z',
    ]);
    expect(predates.code).toBe(1);
    expect(predates.err).toMatch(/before the submission was observed/);
    const nonsense = await s.run([
      'record-review',
      '--handoff',
      HANDOFF,
      '--state',
      'in-review',
      '--observed-at',
      'yesterday',
    ]);
    expect(nonsense.err).toMatch(/ISO 8601/);
    const unknown = await s.run([
      'record-review',
      '--handoff',
      HANDOFF,
      '--state',
      'live',
    ]);
    expect(unknown.err).toMatch(/--state must be one of/);

    expect(
      (
        await s.run([
          'record-review',
          '--handoff',
          HANDOFF,
          '--state',
          'rejected',
          '--reference',
          'email from the host',
        ])
      ).code,
    ).toBe(0);
    const reversed = await s.run([
      'record-review',
      '--handoff',
      HANDOFF,
      '--state',
      'approved',
    ]);
    expect(reversed.code).toBe(1);
    expect(reversed.err).toMatch(/ends this record/);
    expect(
      (
        await s.run([
          'record-review',
          '--handoff',
          HANDOFF,
          '--state',
          'rejected',
        ])
      ).out,
    ).toMatch(/already recorded/);
    expect(types(s.cwd)).toEqual([
      'begin',
      'submission-attempt',
      'submission-confirmed',
      'review-observed',
    ]);
  });

  it('keeps credentials out of the record and out of what it prints', async () => {
    const { s } = await submitted();
    const token = `sk-${'synthetic'.repeat(4)}`;
    const run = await s.run([
      'record-review',
      '--handoff',
      HANDOFF,
      '--state',
      'in-review',
      '--reference',
      `portal login ${token}`,
    ]);

    expect(run.code).toBe(1);
    expect(run.err + run.out).not.toContain(token);
    expect(types(s.cwd)).toEqual([
      'begin',
      'submission-attempt',
      'submission-confirmed',
    ]);
    for (const name of files(s.cwd))
      expect(
        fs.readFileSync(path.join(s.cwd, HANDOFF, name), 'utf8'),
      ).not.toContain(token);
  });
});

describe('the command line', () => {
  it('refuses options that belong to another command, an unknown action and a record that is not one', async () => {
    const { s, out } = await begun();
    const wrong = await s.run([
      'status',
      '--handoff',
      HANDOFF,
      '--target',
      'claude',
    ]);
    expect(wrong.code).toBe(2);
    expect(wrong.err).toMatch(
      /--target belongs to saga publish check and prepare/,
    );

    const misplaced = await saga(
      [
        'publish',
        'prepare',
        '--target',
        'claude',
        '--release',
        'x',
        '--out',
        'y',
        '--handoff',
        HANDOFF,
      ],
      { cwd: s.cwd },
    );
    expect(misplaced.code).toBe(2);
    expect(misplaced.err).toMatch(/--handoff belongs to saga publish handoff/);
    const init = await saga(
      [
        'init',
        '--a2ui-stack',
        'lit-mcp',
        '--server',
        'node',
        '--state',
        'x',
        'dir',
      ],
      { cwd: s.cwd },
    );
    expect(init.code).toBe(2);

    expect((await s.run(['submit', '--handoff', HANDOFF])).code).toBe(2);
    expect((await s.run(['status'])).code).toBe(2);

    const notARecord = await s.run(['status', '--handoff', out]);
    expect(notARecord.code).toBe(1);
    expect(notARecord.err).toMatch(
      /not the next event of a handoff record|holds no handoff record/,
    );
    expect((await s.run(['status', '--handoff', 'missing'])).err).toMatch(
      /does not exist/,
    );
  });
});
