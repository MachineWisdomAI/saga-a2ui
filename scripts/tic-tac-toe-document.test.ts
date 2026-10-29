import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { buildConsumerFromConfig, repoRoot } from './packed-consumer.js';
import {
  prepareTicTacToe,
  typecheckTicTacToe,
  ticTacToeSource,
  ticTacToeGuidedChange,
} from './build-tic-tac-toe.js';

const read = (name: string) =>
  fs.readFileSync(path.join(repoRoot, name), 'utf8');
const guide = read('docs/build-tic-tac-toe-with-react.md');
const chapters = [
  '1-first-card.md',
  '2-playable-game.md',
  '3-move-list.md',
].map((name) => read(`docs/tic-tac-toe/${name}`));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-tutorial-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

function files(markdown: string): Map<string, string> {
  return new Map(
    [...markdown.matchAll(/^```\w+ file=([^\n]+)\n([\s\S]*?)^```/gm)].map(
      (match) => [match[1]!, match[2]!],
    ),
  );
}
function writeFiles(
  directory: string,
  replacements: Map<string, string>,
): void {
  for (const [name, source] of replacements) {
    if (path.isAbsolute(name) || name.split('/').includes('..'))
      throw new Error(`Unsafe tutorial path: ${name}`);
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), source);
  }
}

describe('the standalone React tutorial', () => {
  it('builds the first host card using only the files provided, then builds the game and extension', async () => {
    const { consumer } = prepareTicTacToe(work);
    // Retain only the installed dependencies. No example source may fill a missing tutorial file.
    for (const entry of fs.readdirSync(consumer)) {
      if (entry !== 'node_modules')
        fs.rmSync(path.join(consumer, entry), { recursive: true, force: true });
    }
    for (const chapter of chapters) {
      writeFiles(consumer, files(chapter));
      try {
        typecheckTicTacToe(consumer);
      } catch (error) {
        const output = (error as { stdout?: Buffer }).stdout?.toString();
        throw new Error(output ?? String(error));
      }
      await buildConsumerFromConfig(consumer, 'vite.config.ts');
      await buildConsumerFromConfig(consumer, 'vite.server.config.ts');
      expect(
        fs.readFileSync(path.join(consumer, 'dist/index.html'), 'utf8'),
      ).toContain('<div id="root"');
      expect(fs.existsSync(path.join(consumer, 'dist/server.mjs'))).toBe(true);
    }
  }, 30_000);

  it('provides the complete maintained game, followed by the maintained move-list extension', () => {
    const assembled = new Map([...files(chapters[0]!), ...files(chapters[1]!)]);
    for (const [name, source] of assembled)
      expect(source.trim(), name).toBe(
        fs.readFileSync(path.join(ticTacToeSource, name), 'utf8').trim(),
      );
    const expected = path.join(work, 'extension');
    fs.mkdirSync(expected);
    fs.cpSync(path.join(ticTacToeSource, 'src'), path.join(expected, 'src'), {
      recursive: true,
    });
    execFileSync('git', ['apply', ticTacToeGuidedChange], { cwd: expected });
    for (const [name, source] of files(chapters[2]!))
      expect(source.trim(), name).toBe(
        fs.readFileSync(path.join(expected, name), 'utf8').trim(),
      );
  });

  it('uses a registry-only manifest with exact versions and one SAGA stack', () => {
    const manifest = JSON.parse(files(chapters[0]!).get('package.json')!);
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    for (const version of Object.values(dependencies))
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
    expect(
      Object.keys(dependencies).filter((name) =>
        name.startsWith('@saga-a2ui/'),
      ),
    ).toEqual(['@saga-a2ui/react-mcp-stack']);
    expect(guide).toContain(
      manifest.dependencies['@saga-a2ui/react-mcp-stack'],
    );
    expect(guide).not.toMatch(
      /npx tsx scripts\/|npm run build:tic-tac-toe|sh repository/,
    );
  });

  it('links complete steps and keeps relative documentation links valid', () => {
    const documents = new Map([
      ['docs/build-tic-tac-toe-with-react.md', guide],
      [
        'docs/tic-tac-toe-architecture-options.md',
        read('docs/tic-tac-toe-architecture-options.md'),
      ],
      ...chapters.map((text, index): [string, string] => [
        `docs/tic-tac-toe/${['1-first-card.md', '2-playable-game.md', '3-move-list.md'][index]}`,
        text,
      ]),
    ]);
    for (const [name, markdown] of documents) {
      const prose = markdown.replace(/^```[\s\S]*?^```/gm, '');
      for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1]!;
        if (/^https?:|^#/.test(target)) continue;
        expect(
          fs.existsSync(
            path.resolve(repoRoot, path.dirname(name), target.split('#')[0]!),
          ),
          `${name}: ${target}`,
        ).toBe(true);
      }
    }
    for (const chapter of [
      '1-first-card.md',
      '2-playable-game.md',
      '3-move-list.md',
    ])
      expect(guide).toContain(`(tic-tac-toe/${chapter})`);
  });
});
