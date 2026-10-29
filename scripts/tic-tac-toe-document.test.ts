import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './consumer-boundary.js';
import { CONVERSATION, VIEW_TEXT } from '../examples/tic-tac-toe/src/text.js';

// The opening of docs/build-tic-tac-toe-with-react.md: the finished game and the first click. Every
// command, every sentence it quotes from the game and every link and image is checked against the
// example, so the guide cannot describe a game that is not there. The rest of the guide is written
// after the owner reviews this opening.

const GUIDE = 'docs/build-tic-tac-toe-with-react.md';
const guide = fs.readFileSync(path.join(repoRoot, GUIDE), 'utf8');
const rootManifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as { scripts: Record<string, string> };

/** The text of every fenced block that starts with this info string. */
const blocks = (info: string): string[] =>
  [...guide.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)]
    .filter((match) => match[1] === info)
    .map((match) => match[2]!);

describe('the commands in the opening', () => {
  const commands = blocks('sh repository').flatMap((block) =>
    block.split('\n').filter((line) => line.trim() !== ''),
  );

  it('are the three that build and start the example from a checkout, in order', () => {
    expect(commands).toEqual([
      'npm ci',
      'npm run build:tic-tac-toe',
      'node apps/lit-host/dist/tic-tac-toe/server.mjs',
    ]);
  });

  it('name a script that exists and a server file that the build writes', () => {
    expect(rootManifest.scripts['build:tic-tac-toe']).toBe(
      'tsx scripts/build-tic-tac-toe.ts',
    );
    const builder = fs.readFileSync(
      path.join(repoRoot, 'scripts/build-tic-tac-toe.ts'),
      'utf8',
    );
    expect(builder).toContain("path.join(outDir, 'server.mjs')");
    expect(builder).toMatch(/'apps',\s*'lit-host',\s*'dist',\s*'tic-tac-toe'/);
  });

  it('print the endpoint line the server prints', () => {
    const [printed] = blocks('text');
    expect(printed?.trim()).toBe(
      'Tic-tac-toe MCP endpoint: http://127.0.0.1:3000/mcp',
    );
    const main = fs.readFileSync(
      path.join(repoRoot, 'examples/tic-tac-toe/server/main.ts'),
      'utf8',
    );
    expect(main).toContain('Tic-tac-toe MCP endpoint: ${listener.url}');
    expect(main).toContain('process.env.PORT ?? 3000');
    const listener = fs.readFileSync(
      path.join(repoRoot, 'examples/tic-tac-toe/server/listener.ts'),
      'utf8',
    );
    expect(listener).toContain("const GAME_PATH = '/mcp'");
    expect(listener).toContain("const HOST = '127.0.0.1'");
  });

  it('say the Node version the repository requires', () => {
    const nvmrc = fs
      .readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8')
      .trim()
      .replace(/^v/, '');
    expect(guide).toContain(`Node ${nvmrc} or newer`);
  });
});

describe('what the opening quotes from the game', () => {
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
    const controller = fs.readFileSync(
      path.join(repoRoot, 'examples/tic-tac-toe/src/controller.ts'),
      'utf8',
    );
    expect(controller).toContain('everyMs: 1_500, reads: 40');
    expect(guide).toContain('every second and a half, for up to a minute');
  });

  it('names the operations the server declares', () => {
    const contract = fs.readFileSync(
      path.join(repoRoot, 'examples/tic-tac-toe/src/contract.ts'),
      'utf8',
    );
    for (const name of ['new_game', 'play_move', 'get_game'])
      expect(contract, name).toContain(`'${name}'`);
    for (const name of ['new_game', 'play_move', 'get_game'])
      expect(guide, name).toContain(`\`${name}\``);
  });
});

describe('the links and the screenshot', () => {
  const targets = [...guide.matchAll(/\]\(([^)\s]+)\)/g)].map(
    (match) => match[1]!,
  );

  it('resolve to files and headings that exist', () => {
    expect(targets.length).toBeGreaterThanOrEqual(4);
    for (const target of targets) {
      if (/^https?:/.test(target)) continue;
      const [file = '', anchor] = target.split('#');
      const resolved = path.resolve(
        path.dirname(path.join(repoRoot, GUIDE)),
        file,
      );
      expect(fs.existsSync(resolved), target).toBe(true);
      if (anchor !== undefined && resolved.endsWith('.md')) {
        const headings = fs
          .readFileSync(resolved, 'utf8')
          .split('\n')
          .filter((line) => /^#{1,6} /.test(line))
          .map((line) =>
            line
              .replace(/^#+ /, '')
              .toLowerCase()
              .replace(/[^a-z0-9 -]/g, '')
              .replace(/ /g, '-'),
          );
        expect(headings, target).toContain(anchor);
      }
    }
  });

  it('shows one screenshot, stored with Git LFS', () => {
    const images = [...guide.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(
      (match) => match[1]!,
    );
    expect(images).toEqual(['images/tic-tac-toe-board.png']);
    const file = path.join(repoRoot, 'docs', images[0]!);
    const head = fs.readFileSync(file).subarray(0, 64);
    // A checkout either holds the pointer (the LFS object not fetched) or the PNG itself.
    const isPointer = head
      .toString('utf8')
      .startsWith('version https://git-lfs');
    const isPng = head.subarray(1, 4).toString('latin1') === 'PNG';
    expect(isPointer || isPng).toBe(true);
    const attributes = fs.readFileSync(
      path.join(repoRoot, '.gitattributes'),
      'utf8',
    );
    expect(attributes).toContain('*.png filter=lfs');
  });

  it('gives the screenshot a description that matches what it shows', () => {
    const alt = /!\[([^\]]*)\]/.exec(guide)?.[1] ?? '';
    for (const part of [
      'Your move. You are X.',
      'New game',
      'O at the top left',
    ])
      expect(alt, part).toContain(part);
  });
});

describe('what the opening says about hosts', () => {
  it('claims no host run and points at the host compatibility guide', () => {
    expect(guide).toContain(
      'None of the three has been run against this game yet',
    );
    expect(guide).toContain('(host-compatibility.md)');
  });
});
