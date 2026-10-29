import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoRoot } from './consumer-boundary.js';
import { runCli, SUPPORTED_PAIRS } from './saga.js';
import { templateDirectory, templateFiles } from './starter-template.js';
import {
  GET_GAME_TOOL,
  NEW_GAME_TOOL,
  PLAY_MOVE_TOOL,
  SHOW_GAME_TOOL,
} from '../examples/tic-tac-toe/src/contract.js';
import { DEFAULT_TTL_MS } from '../examples/tic-tac-toe/server/game-store.js';
import {
  CONVERSATION,
  moveText,
  VIEW_TEXT,
} from '../examples/tic-tac-toe/src/text.js';

// docs/build-tic-tac-toe-with-react.md, the whole guide. Every command, every piece of source it
// quotes, every sentence it quotes from the game, every claim it makes about a host and every
// link, image and diagram is checked against the example (or the document that backs the claim),
// so the guide cannot describe a game that is not there. The setup guide and the Lit track are
// checked by guide.test.ts. The guide never claims a host run: its hosts section is checked for
// saying that none has happened.

const GUIDE = 'docs/build-tic-tac-toe-with-react.md';
const EXAMPLE = 'examples/tic-tac-toe';
const read = (file: string): string =>
  fs.readFileSync(path.join(repoRoot, file), 'utf8');
const guide = read(GUIDE);
const example = (file: string): string => read(`${EXAMPLE}/${file}`);
const rootManifest = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-ttt-guide-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

interface Block {
  readonly info: string;
  readonly lines: readonly string[];
}

/** Every fenced block of a document, with its info string. */
const fenced = (markdown: string): Block[] =>
  [...markdown.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)].map((match) => ({
    info: match[1]!,
    lines: match[2]!.replace(/\n$/, '').split('\n'),
  }));

/** The lines of every block that starts with this info string. */
const blocks = (info: string): string[][] =>
  fenced(guide)
    .filter((block) => block.info === info)
    .map((block) => [...block.lines]);

/** The text under one second-level heading, up to the next one. */
function section(heading: string): string {
  const start = guide.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`no section "${heading}"`);
  const body = guide.slice(start + 1);
  const next = body.indexOf('\n## ', 1);
  return next === -1 ? body : body.slice(0, next);
}

/** The text under one third-level heading, up to the next heading. */
function subsection(heading: string): string {
  const start = guide.indexOf(`\n### ${heading}\n`);
  if (start === -1) throw new Error(`no subsection "${heading}"`);
  const body = guide.slice(start + 1);
  const next = body.search(/\n#{2,3} /);
  return next === -1 ? body : body.slice(0, next);
}

const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');

const significant = (lines: readonly string[]): string[] =>
  lines
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'));

/** The quoted lines that are not lines of the source, each after the one before it. */
function notInOrder(
  quoted: readonly string[],
  source: readonly string[],
): string[] {
  const missing: string[] = [];
  const lines = source.map((line) => line.trim());
  let from = 0;
  for (const line of significant(quoted)) {
    const at = lines.indexOf(line, from);
    if (at < 0) missing.push(line);
    else from = at + 1;
  }
  return missing;
}

describe('the shape of the guide', () => {
  it('is no longer marked as a draft, and has the sections of the design in order', () => {
    expect(guide).not.toContain('**Draft.**');
    const headings = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'The finished game',
      'Run it',
      'Your first click',
      'The layout and the operations',
      'What saga handles',
      'Make one change: a move list',
      'Connect it to Claude, ChatGPT and Alexa+',
      'What else this design allows',
      'Where to go next',
    ]);
  });

  it('stays short enough to read in about ten minutes, and says that this is reading time', () => {
    // About 250 words a minute is a slow reading speed for technical prose. Code is skimmed.
    const prose = guide
      .replace(/^```[\s\S]*?^```/gm, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\]\([^)]*\)/g, ']');
    const words = prose.match(/[A-Za-z0-9`'’_.\-/+]+/g)?.length ?? 0;
    expect(words).toBeLessThanOrEqual(2800);
    expect(guide).toContain('about ten minutes');
    expect(guide).toContain('Ten minutes is reading time.');
  });
});

describe('the commands in the guide', () => {
  const commands = blocks('sh repository');

  it('are the four groups the guide shows, in order', () => {
    expect(commands).toEqual([
      [
        'npm ci',
        'npm run build:tic-tac-toe',
        'node apps/lit-host/dist/tic-tac-toe/server.mjs',
      ],
      ['node apps/lit-host/dist/tic-tac-toe-guided/server.mjs'],
      [
        'npm run build -w apps/lit-host',
        'npm run build:tic-tac-toe',
        'cd apps/lit-host',
        'npx playwright install chromium',
        'npx playwright test e2e/tic-tac-toe.spec.ts -g "adds a move list"',
      ],
      [
        'npx tsx scripts/saga.ts init --a2ui-stack react-mcp --server hono ../my-saga',
      ],
    ]);
    // Nothing else is presented as something to type.
    expect(blocks('sh')).toEqual([]);
  });

  it('name scripts, a workspace, a specification and a test that exist', () => {
    expect(rootManifest.scripts['build:tic-tac-toe']).toBe(
      'tsx scripts/build-tic-tac-toe.ts',
    );
    const host = JSON.parse(read('apps/lit-host/package.json')) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(host.scripts['build']).toBeDefined();
    const spec = read('apps/lit-host/e2e/tic-tac-toe.spec.ts');
    expect(spec).toContain("test.describe('the guided change'");
    expect(spec).toContain('adds a move list');
    expect(spec).toContain('../dist/tic-tac-toe-guided/index.html');
  });

  it('start servers that one build writes: the example and the guided change, each with its server.mjs', () => {
    const builder = read('scripts/build-tic-tac-toe.ts');
    expect(builder).toContain("path.join(outDir, 'server.mjs')");
    expect(builder).toMatch(/'apps',\s*'lit-host',\s*'dist',\s*'tic-tac-toe'/);
    expect(builder).toMatch(
      /'apps',\s*'lit-host',\s*'dist',\s*'tic-tac-toe-guided'/,
    );
    expect(builder).toContain('[ticTacToeDist, {}]');
    expect(builder).toContain('[ticTacToeGuidedDist, { guidedChange: true }]');
  });

  it('build the fixture page before the example, as the root build does, because the host build clears the example', () => {
    const build = rootManifest.scripts['build']!;
    expect(
      (JSON.parse(read('apps/lit-host/package.json')) as { name: string }).name,
    ).toBe('@saga-a2ui/lit-host-app');
    expect(build.indexOf('@saga-a2ui/lit-host-app')).toBeGreaterThanOrEqual(0);
    expect(build.indexOf('@saga-a2ui/lit-host-app')).toBeLessThan(
      build.indexOf('build:tic-tac-toe'),
    );
    const fixture = commands[2]!;
    expect(fixture.indexOf('npm run build -w apps/lit-host')).toBeLessThan(
      fixture.indexOf('npm run build:tic-tac-toe'),
    );
    expect(guide).toContain("building it clears the example's build");
  });

  it('print the endpoint line the server prints, on the port and path it uses', () => {
    const [printed] = blocks('text');
    expect(printed?.join('\n').trim()).toBe(
      'Tic-tac-toe MCP endpoint: http://127.0.0.1:3000/mcp',
    );
    const main = example('server/main.ts');
    expect(main).toContain('Tic-tac-toe MCP endpoint: ${listener.url}');
    expect(main).toContain('process.env.PORT ?? 3000');
    const listener = example('server/listener.ts');
    expect(listener).toContain("const GAME_PATH = '/mcp'");
    expect(listener).toContain("const HOST = '127.0.0.1'");
  });

  it('say the Node version the repository requires', () => {
    const nvmrc = read('.nvmrc').trim().replace(/^v/, '');
    expect(guide).toContain(`Node ${nvmrc} or newer`);
  });

  it('create the starter the example came from, for a pair the CLI offers', async () => {
    const init = commands[3]![0]!;
    const [, stack, server, directory] =
      /--a2ui-stack (\S+) --server (\S+) (\S+)$/.exec(init) as RegExpExecArray;
    const pair = SUPPORTED_PAIRS.find(
      (one) => one.stack === stack && one.server === server,
    );
    expect(pair, `${stack} on ${server} is offered`).toBeDefined();
    let out = '';
    let err = '';
    const cwd = fs.mkdtempSync(path.join(work, 'init-'));
    const code = await runCli(
      ['init', '--a2ui-stack', stack!, '--server', server!, directory!],
      {
        cwd,
        sdkVersion: () => '0.0.0-candidate.g0123456789ab',
        stageDemo: () => {
          throw new Error('init must not build the demonstration');
        },
        stdout: (text) => (out += text),
        stderr: (text) => (err += text),
      },
    );
    expect(code, err).toBe(0);
    expect(out).toContain('Nothing was installed and no command was run.');
    const created = path.join(cwd, directory!);
    for (const file of templateFiles(templateDirectory(pair!.template)))
      expect(fs.existsSync(path.join(created, file)), file).toBe(true);
    // The example was generated by this command.
    expect(read(`${EXAMPLE}/README.md`)).toContain(
      '`saga init --a2ui-stack react-mcp --server hono`',
    );
  });
});

describe('the route from a checkout, and the release it needs', () => {
  it('says the source packages the game needs are newer than the published release', () => {
    const published = /@saga-a2ui\/react-mcp-stack@(\S+?) /.exec(
      read('docs/getting-started.md'),
    )?.[1];
    const source = (
      JSON.parse(read('packages/react-mcp-stack/package.json')) as {
        version: string;
      }
    ).version;
    expect(published).toBeDefined();
    expect(source).not.toBe(published);
    expect(guide).toContain(`(\`${source}\`)`);
    expect(guide).toContain(
      `\`${published}\` release on npm does not have them`,
    );
  });

  it('never tells the reader to install the example from the registry', () => {
    expect(guide).not.toMatch(/npm (install|i) .*@saga-a2ui/);
  });
});

describe('what the guide quotes from the game', () => {
  it('uses the status lines the board shows', () => {
    expect(guide).toContain(`"${VIEW_TEXT.yourTurn}"`);
    expect(guide).toContain(`"${VIEW_TEXT.assistantTurn}"`);
    expect(guide).toContain(`"${VIEW_TEXT.tellTheAssistant}"`);
  });

  it('quotes the move message exactly, with a game identifier in place of the placeholder', () => {
    const quoted = guide
      .split('\n')
      .find((line) => line.startsWith('   > Your move in tic-tac-toe game'));
    expect(quoted).toBeDefined();
    expect(quoted!.replace(/^ {3}> /, '').replace(/`([^`]+)`/, '$1')).toBe(
      CONVERSATION.yourMove('zDfjqVwo1WmUlxN1BOqAhw'),
    );
  });

  it('quotes both result messages', () => {
    const won = CONVERSATION.result({ winner: 'X' } as never);
    const drawn = CONVERSATION.result({ winner: null } as never);
    expect(guide).toContain(`"${won}"`);
    expect(guide).toContain(`"${drawn}"`);
  });

  it('describes the wait the controller has', () => {
    expect(example('src/controller.ts')).toContain('everyMs: 1_500, reads: 40');
    expect(guide).toContain('every second and a half, for up to a minute');
  });

  it('quotes the lines of the move list the board shows', () => {
    // The first click is the centre square, which is square 4: row 2, column 2.
    expect(moveText({ player: 'X', square: 4 }, 0).text).toBe(
      '1. You: row 2, column 2',
    );
    expect(moveText({ player: 'O', square: 0 }, 1).text).toBe(
      '2. Assistant: row 1, column 1',
    );
    expect(guide).toContain('"1. You: row 2, column 2"');
    expect(guide).toContain('"2. Assistant: row 1, column 1"');
  });

  it('says how long a game lives, that there is no sign-in, and where a host name is allowed', () => {
    expect(DEFAULT_TTL_MS).toBe(30 * 60 * 1000);
    expect(guide).toContain('expire thirty minutes after their last move');
    expect(example('src/contract.ts')).toContain('authorizes nothing else');
    expect(guide).toContain('The game has no sign-in');
    expect(example('server/listener.ts')).toContain('ALLOWED_HOSTNAMES');
    expect(guide).toContain('`ALLOWED_HOSTNAMES` in `server/listener.ts`');
  });
});

describe('the operations the guide describes', () => {
  const operations = example('server/operations.ts');
  const constants: Record<string, string> = {
    [NEW_GAME_TOOL]: 'NEW_GAME_TOOL',
    [SHOW_GAME_TOOL]: 'SHOW_GAME_TOOL',
    [GET_GAME_TOOL]: 'GET_GAME_TOOL',
    [PLAY_MOVE_TOOL]: 'PLAY_MOVE_TOOL',
  };

  /** Each `registerPublicOperation` call of the server, with its tool and whether it has a view. */
  const declared = operations
    .split('registerPublicOperation(')
    .slice(1)
    .map((call) => ({
      constant: /name: (\w+),/.exec(call)![1]!,
      view: /\bview: views\./.test(call.slice(0, call.indexOf('{ lifetime }'))),
    }));

  const boardCalls = (constant: string): boolean =>
    [example('src/actions.ts'), example('src/controller.ts')].some((source) =>
      source.includes(constant),
    );

  it('are four, and the table says which open the board and who calls them', () => {
    expect(declared.map((one) => one.constant).sort()).toEqual(
      Object.values(constants).sort(),
    );
    const rows = section('The layout and the operations')
      .split('\n')
      .filter((line) => /^\| `[a-z_]+` \|/.test(line))
      .map((line) => line.split('|').map((cell) => cell.trim()));
    expect(rows.map((row) => row[1])).toEqual(
      ['new_game', 'show_game', 'get_game', 'play_move'].map(
        (name) => `\`${name}\``,
      ),
    );
    for (const row of rows) {
      const name = row[1]!.replace(/`/g, '');
      const constant = constants[name]!;
      const source = declared.find((one) => one.constant === constant)!;
      expect(row[3], `${name} opens the board`).toBe(
        source.view ? 'Yes' : 'No',
      );
      expect(row[2], `${name} is called by`).toBe(
        boardCalls(constant) ? 'Assistant or board' : 'Assistant',
      );
    }
  });

  it('show the data-only operation without a view, and name the two that add one', () => {
    const quoted = fenced(guide).find((block) =>
      block.lines.some((line) => line.includes('name: GET_GAME_TOOL')),
    )!;
    expect(quoted.lines.join('\n')).not.toContain('view:');
    expect(operations).toContain('view: views.newGame');
    expect(operations).toContain('view: views.showGame');
    expect(guide).toContain('`view: views.newGame` and `view: views.showGame`');
  });

  it('describe the arguments play_move takes, and a store that refuses a stale move whole', () => {
    const contract = example('src/contract.ts');
    for (const field of ['gameId', 'square', 'player', 'expectedMoveNumber'])
      expect(contract, field).toContain(`${field}:`);
    expect(guide).toContain('`expectedMoveNumber`');
    expect(guide).toContain('a square from 0 to 8');
    const store = example('server/game-store.ts');
    expect(store).toContain('cannot both be applied');
    expect(store).toContain('A refused move changes nothing');
  });
});

describe('the source the guide quotes', () => {
  // Each excerpt is the source's own lines, in the source's order, with `// ...` for what is left
  // out. A block that is not listed here is not allowed: a new excerpt has to be registered.
  const sources: { readonly marker: string; readonly file: string }[] = [
    { marker: 'name: GET_GAME_TOOL', file: 'server/operations.ts' },
    { marker: 'const playSquare = Action.server', file: 'src/actions.ts' },
    { marker: 'bestEffort: true', file: 'src/actions.ts' },
    {
      marker: "bindAction('activate', actions.playSquare",
      file: 'src/view.tsx',
    },
  ];
  const excerpts = fenced(guide).filter((block) => block.info === 'ts');

  it('is the example’s own text, in order', () => {
    expect(excerpts).toHaveLength(sources.length);
    for (const source of sources) {
      const excerpt = excerpts.find((block) =>
        block.lines.some((line) => line.includes(source.marker)),
      );
      expect(excerpt, source.marker).toBeDefined();
      expect(
        notInOrder(excerpt!.lines, example(source.file).split('\n')),
        `${source.file}: ${source.marker}`,
      ).toEqual([]);
    }
  });

  it('would fail if an excerpt invented a line or reordered two', () => {
    const source = example('server/operations.ts').split('\n');
    expect(
      notInOrder(
        [...excerpts[0]!.lines, '  handle: async () => forged,'],
        source,
      ),
    ).toEqual(['handle: async () => forged,']);
    // `play_move` is declared after `get_game`, so quoting them the other way round is caught.
    expect(
      notInOrder(['name: PLAY_MOVE_TOOL,', 'name: GET_GAME_TOOL,'], source),
    ).toEqual(['name: GET_GAME_TOOL,']);
  });

  it('puts the context the move message carries inside the append the board makes', () => {
    const actions = example('src/actions.ts');
    const append = actions.slice(
      actions.indexOf('host.conversation.appendMessage(CONVERSATION.yourMove'),
    );
    expect(append).toContain('context: {');
    expect(append.indexOf('context: {')).toBeLessThan(
      append.indexOf('bestEffort: true'),
    );
  });
});

describe('the guided change', () => {
  const patch = example('guided-change/move-list.patch');
  const shown = fenced(guide).find((block) => block.info === 'diff')!;

  it('is the patch the example ships, without its blob names, and nothing else', () => {
    const expected = patch
      .replace(/\n$/, '')
      .split('\n')
      .filter((line) => !line.startsWith('index '));
    expect(shown.lines).toEqual(expected);
  });

  it('touches only the layout and the catalog, as the guide says', () => {
    const files = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    expect(files).toEqual(['src/catalog.tsx', 'src/surface.ts']);
    const change = section('Make one change: a move list');
    expect(change).toContain('only the layout and the catalog');
    expect(change).toContain(
      'The server, the controller and the actions do not change.',
    );
    expect(change).toContain(
      '`examples/tic-tac-toe/guided-change/move-list.patch`',
    );
  });

  it('adds a component the layout names, over data the board already supplies', () => {
    expect(patch).toContain("component: 'MoveList'");
    expect(patch).toContain(
      "children: { componentId: 'move', path: '/history' }",
    );
    // The controller already feeds the layout's `history`, so nothing else has to change.
    expect(example('src/controller.ts')).toContain(
      'history: (game?.history ?? []).map(moveText)',
    );
    expect(example('src/surface.ts')).toContain('history: z.array(');
  });
});

describe('the links, the screenshot and the diagrams', () => {
  const targets = [...guide.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);

  it('resolve to files and headings that exist, including headings of this guide', () => {
    expect(targets.length).toBeGreaterThanOrEqual(15);
    for (const target of targets) {
      if (/^https?:/.test(target)) continue;
      const [file = '', anchor] = target.split('#');
      const resolved =
        file === ''
          ? path.join(repoRoot, GUIDE)
          : path.resolve(path.dirname(path.join(repoRoot, GUIDE)), file);
      expect(fs.existsSync(resolved), target).toBe(true);
      if (anchor !== undefined && resolved.endsWith('.md')) {
        const headings = fs
          .readFileSync(resolved, 'utf8')
          .split('\n')
          .filter((line) => /^#{1,6} /.test(line))
          .map((line) => slug(line.replace(/^#+ /, '')));
        expect(headings, target).toContain(anchor);
      }
    }
  });

  it('link the next steps: the setup guide, the Lit track, the action guide, the host guide and the example', () => {
    for (const target of [
      '(getting-started.md#create-a-new-project)',
      '(build-notes-with-lit.md)',
      '(actions.md)',
      '(host-compatibility.md)',
      '(../examples/tic-tac-toe/README.md)',
      '(react-consumers.md)',
      '(attach-to-existing-backend.md)',
    ])
      expect(guide, target).toContain(target);
  });

  it('show the screenshot, stored with Git LFS, and the three diagrams, each with its sources', () => {
    const images = [...guide.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(
      (match) => match[1],
    );
    expect(images).toEqual([
      'images/tic-tac-toe-board.png',
      '../diagrams/tic-tac-toe-turn-loop.svg',
      '../diagrams/tic-tac-toe-arrangements.svg',
      '../diagrams/tic-tac-toe-a2a-delivery.svg',
    ]);
    expect(read('.gitattributes')).toContain('*.png filter=lfs');
    for (const name of ['turn-loop', 'arrangements', 'a2a-delivery']) {
      const base = `diagrams/tic-tac-toe-${name}`;
      for (const extension of ['mmd', 'svg', 'png'])
        expect(fs.existsSync(path.join(repoRoot, `${base}.${extension}`))).toBe(
          true,
        );
      expect(guide).toContain(`[Editable Mermaid](../${base}.mmd)`);
      expect(guide).toContain(`[PNG](../${base}.png)`);
    }
    for (const file of [
      'docs/images/tic-tac-toe-board.png',
      'diagrams/tic-tac-toe-turn-loop.png',
      'diagrams/tic-tac-toe-arrangements.png',
      'diagrams/tic-tac-toe-a2a-delivery.png',
    ]) {
      const head = fs.readFileSync(path.join(repoRoot, file)).subarray(0, 64);
      // A checkout either holds the pointer (the LFS object not fetched) or the PNG itself.
      const isPointer = head
        .toString('utf8')
        .startsWith('version https://git-lfs');
      const isPng = head.subarray(1, 4).toString('latin1') === 'PNG';
      expect(isPointer || isPng, file).toBe(true);
    }
  });

  it('give every image a description, and the screenshot one that matches what it shows', () => {
    const alts = [...guide.matchAll(/!\[([^\]]*)\]/g)].map((m) => m[1]!);
    expect(alts).toHaveLength(4);
    for (const alt of alts) expect(alt.length, alt).toBeGreaterThan(40);
    for (const part of [
      'Your move. You are X.',
      'New game',
      'O at the top left',
      'a few moves into a game',
    ])
      expect(alts[0], part).toContain(part);
  });

  it('presents the screenshot as a game in progress and starts the first click from an empty board', () => {
    // The screenshot holds four marks, so its centre is taken: it cannot be the board a new game
    // shows, and the walkthrough must not ask the reader to click the centre of it.
    const finished = section('The finished game');
    expect(finished).toContain('a new board with nine empty squares');
    expect(finished).toContain('a few moves into a game');
    const firstClick = section('Your first click');
    expect(firstClick).toContain('a new, empty board');
    expect(firstClick).toContain('Click the centre square of the empty board');
    expect(firstClick).not.toContain('the board above');
  });

  it('draw the new diagrams from sources that name what the guide names, and render them', () => {
    const arrangements = read('diagrams/tic-tac-toe-arrangements.mmd');
    const arrangementsSvg = read('diagrams/tic-tac-toe-arrangements.svg');
    for (const label of [
      'Workers KV',
      'Durable Object',
      'Native A2UI host',
      'Gateway server',
      'App API server',
      'Lit catalog',
      'React catalog',
      'message/send',
    ]) {
      expect(arrangements, label).toContain(label);
      expect(arrangementsSvg, label).toContain(label);
    }
    for (const kind of ['runnable', 'compose', 'sketch'])
      expect(arrangements).toContain(`classDef ${kind}`);
    const a2a = read('diagrams/tic-tac-toe-a2a-delivery.mmd');
    const a2aSvg = read('diagrams/tic-tac-toe-a2a-delivery.svg');
    for (const label of [
      'appendMessage',
      'message/send',
      'data {game}',
      'Architectural sketch',
      'play_move(O, expectedMoveNumber 1)',
    ])
      expect(a2a, label).toContain(label);
    for (const label of [
      'appendMessage',
      'message/send',
      'Architectural sketch',
    ])
      expect(a2aSvg, label).toContain(label);
  });
});

describe('what the guide says about hosts', () => {
  const hosts = section('Connect it to Claude, ChatGPT and Alexa+');
  const compatibility = read('docs/host-compatibility.md');

  it('claims no host run, in the opening and in each host section, and links the host compatibility guide', () => {
    expect(guide).toContain(
      'None of the three has been run against this game yet',
    );
    expect(hosts).toContain('None of the three has been run against this game');
    expect(hosts).toContain('(host-compatibility.md)');
    for (const host of ['Claude', 'ChatGPT', 'Alexa+']) {
      const text = subsection(host);
      expect(text, host).toMatch(/unverified/i);
      expect(text, host).toContain('(host-compatibility.md');
    }
    // No sentence reports that a host was run, or that the game was seen working there.
    expect(guide).not.toMatch(
      /\b(we|I) (ran|tested|played|tried)\b|verified (in|on|with) (Claude|ChatGPT|Alexa)|works (in|on) (Claude|ChatGPT|Alexa\+)/i,
    );
  });

  it('describes a voice or conversation move as a different interaction from clicking the board', () => {
    const alexa = subsection('Alexa+');
    expect(alexa).toContain(
      'A voice or conversation move is a different interaction from clicking the board.',
    );
    for (const part of [
      'no click',
      'no message appended by the board',
      'no wait',
    ])
      expect(alexa, part).toContain(part);
    // The tool the assistant uses for the person's move says it may place X when told to.
    const operations = example('server/operations.ts');
    expect(operations).toContain(
      'Place X only when the person tells you their move in the conversation',
    );
    expect(operations).toContain('call show_game to display the board');
  });

  it('rests each host statement on what the host compatibility guide records', () => {
    expect(compatibility).toContain('about 30 seconds');
    expect(compatibility).toContain('Try again');
    expect(compatibility).toContain('A ChatGPT reload removed a pending view');
    expect(compatibility).toContain('Existing-frame in-card calls failed');
    expect(compatibility).toContain('## ChatGPT and Claude');
    expect(compatibility).toContain('## Alexa+');
    // It records no host taking a message that a card appends, so the guide cannot say one did.
    expect(compatibility).not.toMatch(/appendMessage|ui\/message/);
    expect(hosts).toContain('about 30 seconds');
    expect(hosts).toContain('Try again');
    expect(hosts).toContain('one recorded reload removed a pending view');
    expect(hosts).toContain('did not complete usably in the recorded probes');
    expect(hosts).toContain("No recorded run covers this game's hand-over");
  });

  it('says what a host needs before it can reach the server', () => {
    expect(hosts).toContain('the loopback address is not enough');
    expect(hosts).toContain('public HTTPS address');
  });
});

describe('what else the design allows', () => {
  const closing = section('What else this design allows');
  const labels = [
    'Runnable',
    'Straightforward composition',
    'Architectural sketch',
  ];

  it('defines the three labels, and every arrangement carries exactly one of them', () => {
    const legend = closing
      .split('\n')
      .filter((line) =>
        /^\| (Runnable|Straightforward composition|Architectural sketch) \|/.test(
          line,
        ),
      )
      .map((line) => line.split('|')[1]!.trim());
    expect(legend).toEqual(labels);
    const items = [...closing.matchAll(/^- \*\*(.+?)\.\*\* \*(.+?)\.\*/gm)].map(
      (match) => [match[1], match[2]],
    );
    expect(items).toEqual([
      ['The game as built', 'Runnable'],
      [
        'A gateway and an app API on separate servers',
        'Straightforward composition',
      ],
      ['Renderer independence', 'Straightforward composition'],
      ['A native A2UI host without MCP', 'Architectural sketch'],
      ['A2A delivery', 'Architectural sketch'],
      ['`GameStore` on Workers KV or a Durable Object', 'Architectural sketch'],
    ]);
  });

  it('is true to the example: the seams it names are there, and only the view is tied to React', () => {
    const store = example('server/game-store.ts');
    expect(store).toContain('export interface GameStore');
    expect(store).toContain('a conditional write on the move number');
    expect(store).toContain('a key-value store, a Durable Object');
    for (const file of [
      'src/contract.ts',
      'server/rules.ts',
      'server/game-store.ts',
      'server/operations.ts',
    ])
      expect(example(file), file).not.toMatch(
        /from ['"]react(-dom)?(\/[^'"]*)?['"]/,
      );
    expect(example('src/surface.ts')).not.toMatch(/from ['"]react/);
    const actions = example('src/actions.ts');
    expect(actions).toContain('host.server');
    expect(actions).toContain('host.conversation.appendMessage');
    // The Lit stack hands a view the same two, and exports the same layout and action builders.
    const lit = read('packages/lit-mcp-stack/src/start-a2ui-view.ts');
    expect(lit).toContain('readonly conversation: Conversation;');
    const litIndex = read('packages/lit-mcp-stack/src/index.ts');
    expect(litIndex).toContain('export { defineSurface }');
    expect(litIndex).toContain('export { Action');
  });

  it('describes the A2A mapping as the conversation design does, and as work that does not exist yet', () => {
    const design = read('blueprints/features/view_conversation.blueprint.md');
    expect(design).toContain(
      '`context` would become a data part on that message',
    );
    expect(design).toContain('One `message/send`');
    expect(design).toContain('issues/198');
    const a2a = closing
      .split('\n')
      .find((line) => line.startsWith('- **A2A delivery.**'))!;
    expect(a2a).toContain('`appendMessage` would become an A2A `message/send`');
    expect(a2a).toContain('its `context` would become a data part');
    expect(a2a).toContain('nothing sends it today');
    expect(a2a).toContain('issues/198');
  });

  it('ships neither a Workers store nor a gateway, so the guide does not call them runnable', () => {
    const shipped = fs
      .readdirSync(path.join(repoRoot, EXAMPLE, 'server'))
      .join(' ');
    expect(shipped).not.toMatch(/kv|durable|worker|gateway/i);
    expect(closing).toContain('The repository ships neither store');
  });
});
