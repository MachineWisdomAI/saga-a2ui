import fs from 'node:fs';
import path from 'node:path';
import type { CallToolResult, Client } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RENDERERS, SCENARIOS, SYNTHETIC_BANNER } from '../demo/tour/src/scenarios.js';
import { GUIDES, SOURCE_ENTRIES, headingSlug, locate, locateAll, type GuideLink } from '../demo/tour/src/source-map.js';
import { repoRoot } from './packed-consumer.js';
import { createTourWorld, type ControlName, type Person, type TourWorld } from '../demo/tour/src/simulated-world.js';
import { startTestHost, type TestHost } from '../packages/mcp/src/server/http-host.test-support.js';
import { syntheticNotes } from '../demo/lit-node/fixtures/notes.js';
import { createFixtureBackend, createNotesServer, type FixtureBackend } from '../examples/pack1-consumer/server/index.js';
import { ARCHIVE_TOOL, LIST_TOOL, SESSION_TOOL, declaresNoEffect } from '../examples/pack1-consumer/src/notes-contract.js';

// TOUR1: the static tour. This file qualifies what it can without a browser; the page itself is
// driven by apps/lit-host/e2e/tour.spec.ts.
//
// 1. The simulated server answers like the real one. The tour has no backend, so its replies are
//    local data. They are only worth showing if they are the replies the notes application's real
//    server (examples/pack1-consumer/server) gives for the same synthetic data and the same
//    situation, so each case below runs both and compares what a view can see of the reply.

const REAL_ACCOUNTS = { alice: 'acct-real-alice', bob: 'acct-real-bob' } as const;
const PERSONS: readonly Person[] = ['alice', 'bob', 'nobody'];

/** What a view can see of a reply, and the one fact an action reads from `_meta`. */
const seenBy = (reply: CallToolResult) => ({
  isError: reply.isError === true,
  content: reply.content,
  structuredContent: reply.structuredContent,
  declaresNoEffect: declaresNoEffect(reply),
});

interface Side {
  call(person: Person, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  control(name: ControlName): void;
  /** Archives that were applied, in order. */
  archived(): readonly string[];
}

function simulatedSide(world: TourWorld): Side {
  return {
    async call(person, name, args) {
      world.choose(person);
      return world.callTool(name, args);
    },
    control: (name) => void world.control(name),
    archived: () => world.state().archived,
  };
}

let host: TestHost | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
});

async function realSide(): Promise<Side> {
  let failsAfterWrite = false;
  let held = false;
  const waiting: Array<() => void> = [];
  const backend: FixtureBackend = createFixtureBackend(
    {
      before: async (call) => {
        if (call === 'archive' && held) await new Promise<void>((resolve) => waiting.push(resolve));
      },
      afterArchive: () => {
        if (failsAfterWrite) throw new Error('failed after the write');
      },
    },
    syntheticNotes(REAL_ACCOUNTS),
  );
  const html = '<!doctype html><title>notes</title><p data-testid="view-status"></p>';
  const credential = (person: Person): string | undefined => (person === 'nobody' ? undefined : person);
  host = await startTestHost({
    jsonResponse: true,
    buildServer: () => createNotesServer({ html, backend }),
    authenticate: (token) =>
      token === 'alice' || token === 'bob' ? { token, clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId: REAL_ACCOUNTS[token] } } : undefined,
  });
  const clients = new Map<Person, Client>();
  for (const person of PERSONS) clients.set(person, await host.connect(credential(person)));
  return {
    async call(person, name, args) {
      return (await (clients.get(person) as Client).callTool({ name, arguments: args })) as CallToolResult;
    },
    control(name) {
      switch (name) {
        case 'end-notes-session':
          return void backend.signedOut.add(REAL_ACCOUNTS.alice);
        case 'restore-notes-session':
          return void backend.signedOut.delete(REAL_ACCOUNTS.alice);
        case 'revoke-archive-permission':
          return void backend.revoked.add(REAL_ACCOUNTS.alice);
        case 'restore-archive-permission':
          return void backend.revoked.delete(REAL_ACCOUNTS.alice);
        case 'hold-archives':
          return void (held = true);
        case 'release-archives':
          held = false;
          return void waiting.splice(0).forEach((go) => go());
        case 'fail-after-write':
          return void (failsAfterWrite = true);
        case 'stop-failing-after-write':
          return void (failsAfterWrite = false);
        case 'reverse-list-order':
        case 'restore-list-order':
          // Presentation only: the real server lists in storage order. Not part of the comparison.
          return;
      }
    },
    archived: () => [...backend.archived],
  };
}

/** One situation: the same sequence of changes and calls on both sides, compared reply by reply. */
async function bothAnswerAlike(steps: ReadonlyArray<readonly [Person, string, Record<string, unknown>] | ControlName>): Promise<void> {
  const real = await realSide();
  const simulated = simulatedSide(createTourWorld());
  for (const step of steps) {
    if (typeof step === 'string') {
      real.control(step);
      simulated.control(step);
      continue;
    }
    const [person, name, args] = step;
    const [expected, actual] = [await real.call(person, name, args), await simulated.call(person, name, args)];
    expect(seenBy(actual), `${person} ${name} ${JSON.stringify(args)}`).toEqual(seenBy(expected));
  }
  expect(simulated.archived()).toEqual(real.archived());
}

describe('the simulated server answers like the notes application’s real server', () => {
  it('lists only the signed-in person’s own notes, with only the three public fields, and refuses a request that names nobody', async () => {
    await bothAnswerAlike([
      ['alice', LIST_TOOL, {}],
      ['bob', LIST_TOOL, {}],
      ['nobody', LIST_TOOL, {}],
    ]);
  });

  it('answers the session check, which authorizes nothing: signed in, ended, and nobody', async () => {
    await bothAnswerAlike([
      ['alice', SESSION_TOOL, {}],
      ['nobody', SESSION_TOOL, {}],
      'end-notes-session',
      ['alice', SESSION_TOOL, {}],
      ['bob', SESSION_TOOL, {}], // another account's session is unaffected
      'restore-notes-session',
      ['alice', SESSION_TOOL, {}],
    ]);
  });

  it('archives the person’s own note once, and says "cannot be archived" alike for another person’s, an absent and an already archived note', async () => {
    await bothAnswerAlike([
      ['alice', ARCHIVE_TOOL, { noteId: 'n-1' }],
      ['alice', ARCHIVE_TOOL, { noteId: 'n-1' }], // already archived
      ['alice', ARCHIVE_TOOL, { noteId: 'n-4' }], // Bob’s
      ['alice', ARCHIVE_TOOL, { noteId: 'n-404' }],
      ['bob', ARCHIVE_TOOL, { noteId: 'n-4' }],
      ['alice', LIST_TOOL, {}], // an archived note is gone from the list
    ]);
  });

  it('refuses an archive that names nobody, and one whose permission was withdrawn after a valid session check, declaring that nothing changed', async () => {
    await bothAnswerAlike([
      ['nobody', ARCHIVE_TOOL, { noteId: 'n-1' }],
      ['alice', SESSION_TOOL, {}],
      'revoke-archive-permission',
      ['alice', SESSION_TOOL, {}], // the session check still says yes
      ['alice', ARCHIVE_TOOL, { noteId: 'n-2' }],
      'restore-archive-permission',
      ['alice', ARCHIVE_TOOL, { noteId: 'n-2' }],
    ]);
  });

  it('leaves the outcome unknown, and does not declare "no effect", when the backend fails after it applied the archive', async () => {
    await bothAnswerAlike(['fail-after-write', ['alice', ARCHIVE_TOOL, { noteId: 'n-1' }], 'stop-failing-after-write', ['alice', LIST_TOOL, {}]]);
  });

  it('applies an archive that was held open even though the caller stopped waiting, and answers it when released', async () => {
    const world = createTourWorld();
    world.choose('alice');
    world.control('hold-archives');
    const pending = world.callTool(ARCHIVE_TOOL, { noteId: 'n-1' });
    expect(world.state().waiting).toBe(1);
    expect(world.state().archived).toEqual([]);
    world.control('release-archives');
    expect(seenBy(await pending).structuredContent).toEqual({ noteId: 'n-1', archivedAt: 1_001 });
    expect(world.state()).toMatchObject({ archived: ['n-1'], waiting: 0, archives: 'immediate' });
  });

  it('rejects input the contract does not accept before any backend call, as the real server’s strict schema does', async () => {
    const world = createTourWorld();
    for (const args of [{ noteId: 'n-1', accountId: 'tour-account-bob' }, { noteId: 42 }, { noteId: '' }]) {
      await expect(world.callTool(ARCHIVE_TOOL, args)).rejects.toThrow();
    }
    expect(world.state().backendCalls).toEqual({ sessionChecks: 0, archives: 0 });
  });

  it('keeps the synthetic business of one tour out of the next', async () => {
    const first = createTourWorld();
    first.choose('alice');
    await first.callTool(ARCHIVE_TOOL, { noteId: 'n-1' });
    expect(createTourWorld().state().archived).toEqual([]);
  });
});

// 2. Fixture and source alignment. The tour quotes the lines its explanations are about and links
//    them by line number at the commit it was built from, so a quote that no longer matches its
//    file, a guide heading that was renamed or a scenario that names a source that does not exist
//    must fail here and not on a visitor's click.

const readRepository = (file: string): string => fs.readFileSync(path.join(repoRoot, file), 'utf8');

describe('the tour’s source links stay aligned with the source they quote', () => {
  it('finds every quoted source in the file it names, on the lines the page links', () => {
    const located = locateAll(readRepository);
    expect(located).toHaveLength(SOURCE_ENTRIES.length);
    for (const entry of located) {
      const lines = readRepository(entry.path).split('\n');
      const linked = lines.slice(entry.start - 1, entry.end).map((line) => line.trim()).filter((line) => line !== '');
      expect(linked, `${entry.id}: lines ${entry.start}-${entry.end} of ${entry.path}`).toEqual(entry.quote.map((line) => line.trim()));
    }
  });

  it('fails loudly, naming the quote and the file, when a quoted line has changed', () => {
    const changed = (file: string): string => readRepository(file).replace('return prerequisite(\'session\'', 'return prerequisite(\'sessions\'');
    expect(() => locateAll(changed)).toThrow(/The asynchronous session prerequisite.*examples\/pack1-consumer\/src\/notes-actions\.ts/);
  });

  it('locates a quote regardless of indentation, and refuses lines that are only found apart', () => {
    const text = ['function f() {', '    one();', '', '    two();', '    other();', '    three();', '}'].join('\n');
    expect(locate(text, ['one();', 'two();'])).toEqual({ start: 2, end: 4 });
    expect(locate(text, ['one();', 'three();'])).toBeUndefined();
    expect(locate(text, [])).toBeUndefined();
  });

  it('links each guide at a heading that exists, with the anchor GitHub gives it', () => {
    for (const guide of Object.values(GUIDES) as readonly GuideLink[]) {
      const text = readRepository(guide.path); // a guide that does not exist is an error
      if (guide.heading === undefined) continue;
      const headings = text.split('\n').filter((line) => /^#{1,6} /.test(line)).map((line) => line.replace(/^#+ /, ''));
      expect(headings, `${guide.path} has the heading "${guide.heading}"`).toContain(guide.heading);
    }
    expect(headingSlug('Prerequisites: session validity, confirmation and an audit entry')).toBe('prerequisites-session-validity-confirmation-and-an-audit-entry');
    expect(headingSlug('Trace one press, allowed and denied')).toBe('trace-one-press-allowed-and-denied');
  });

  it('quotes the same Archive definition, prerequisite, attachment and cleanup as the action guide', () => {
    const guide = readRepository('docs/actions.md');
    const guideLines = new Set(guide.split('\n').map((line) => line.trim()));
    for (const id of ['definition', 'prerequisite', 'attachment-lit', 'attachment-react', 'cleanup-success', 'cleanup-canceled', 'holds'] as const) {
      const entry = SOURCE_ENTRIES.find((one) => one.id === id);
      for (const line of (entry as (typeof SOURCE_ENTRIES)[number]).quote) expect(guideLines.has(line.trim()), `${id}: "${line}" is quoted by docs/actions.md`).toBe(true);
    }
  });
});

describe('the scenarios the tour offers', () => {
  it('are distinct, each linked to existing sources and a guide, and each carries the limit of its own simulation', () => {
    expect(new Set(SCENARIOS.map((one) => one.id)).size).toBe(SCENARIOS.length);
    const known = new Set(SOURCE_ENTRIES.map((one) => one.id));
    for (const scenario of SCENARIOS) {
      expect(scenario.sources.length, scenario.id).toBeGreaterThan(0);
      for (const source of scenario.sources) expect(known.has(source), `${scenario.id} names the source ${source}`).toBe(true);
      expect(GUIDES[scenario.guide], scenario.id).toBeDefined();
      expect(scenario.limit.length, `${scenario.id} says what its simulation does not establish`).toBeGreaterThan(40);
      expect(scenario.steps.length, scenario.id).toBeGreaterThan(0);
    }
  });

  it('cover allowed, refused by a prerequisite, denied by the server, missing credential, unknown outcome, independent instances, an obsolete completion and a closed view', () => {
    expect(new Set(SCENARIOS.map((one) => one.kind))).toEqual(new Set(['allowed', 'refused', 'denied', 'missing-credential', 'unknown', 'independent', 'obsolete', 'canceled']));
  });

  it('say about a denial and about cancellation that neither proves anything about a real server', () => {
    const limit = (id: string): string => (SCENARIOS.find((one) => one.id === id) as (typeof SCENARIOS)[number]).limit;
    expect(limit('permission-withdrawn')).toMatch(/does not prove that any real server enforces permission/);
    expect(limit('allowed')).toMatch(/does not authenticate anyone/);
    expect(limit('obsolete')).toMatch(/does not prove the server’s effect was undone/);
    expect(limit('closed-view')).toMatch(/does not prove a remote effect was undone/);
  });

  it('start from the first thing a reader sees: the synthetic banner', () => {
    expect(SYNTHETIC_BANNER).toBe('Synthetic example — server checks simulated');
    const page = readRepository('demo/tour/index.html');
    expect(page.indexOf('<body>')).toBeLessThan(page.indexOf(SYNTHETIC_BANNER));
    expect(page.slice(page.indexOf('<body>'), page.indexOf(SYNTHETIC_BANNER))).not.toMatch(/<(a|button|input|main|h1|iframe)[\s>]/);
  });

  it('offer only the renderers whose preview works, and none for Lynx, whose delivery was retired', () => {
    expect(RENDERERS.map((one) => one.id)).toEqual(['lit', 'react']);
    expect(JSON.stringify([RENDERERS, SCENARIOS])).not.toMatch(/lynx/i);
    const react = RENDERERS.find((one) => one.id === 'react') as (typeof RENDERERS)[number];
    expect(react.evidence).toMatch(/not renderer parity/);
    expect(react.evidence).toMatch(/no React starter/);
  });
});
