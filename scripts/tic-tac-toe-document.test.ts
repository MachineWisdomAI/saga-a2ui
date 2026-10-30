import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { repoRoot } from './consumer-boundary.js';
import { ticTacToeSource, ticTacToeGuidedChange } from './build-tic-tac-toe.js';

const read = (name: string) =>
  fs.readFileSync(path.join(repoRoot, name), 'utf8');
const guide = read('docs/build-tic-tac-toe-with-react.md');
const chapters = [
  '1-first-card.md',
  '2-playable-game.md',
  '3-move-list.md',
].map((name) => read(`docs/tic-tac-toe/${name}`));
const checkpoint = read('docs/tic-tac-toe/checkpoints/first-card.md');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-tutorial-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

function files(markdown: string): Map<string, string> {
  return new Map(
    [...markdown.matchAll(/^```\w+ file=([^\n]+)\n([\s\S]*?)^```/gm)].map(
      (match) => [match[1]!, match[2]!],
    ),
  );
}
describe('the standalone React tutorial', () => {
  it('keeps the framework introduction and tutorial copy aligned with the brand', () => {
    for (const copy of [
      read('README.md'),
      read('package.json'),
      guide,
      checkpoint,
      ...chapters,
    ])
      expect(copy).not.toMatch(/\bSAGA\b|\bMachineWisdom\b/);
    expect(read('README.md')).toContain('saga means Simple Agentic Apps.');
    expect(read('README.md')).toContain('https://saga-ai.dev/');
    expect(read('README.md')).toContain(
      'https://github.com/MachineWisdomAI/saga-a2ui-examples',
    );
  });

  it('provides the complete maintained game, followed by the maintained move-list extension', () => {
    const assembled = new Map([...files(checkpoint), ...files(chapters[1]!)]);
    // Generated project configuration differs from the repository's contributor harness.
    // Application source must remain identical.
    for (const name of assembled.keys())
      if (!/^(src|server)\//.test(name)) assembled.delete(name);
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

  it('keeps the first lesson’s complete application and build files in the checkpoint', () => {
    const reference = files(checkpoint);
    for (const [name, source] of files(chapters[0]!))
      expect(source.trim(), name).toBe(reference.get(name)?.trim());
  });

  it('uses a registry-only manifest with exact versions and one saga stack', () => {
    const manifest = JSON.parse(files(checkpoint).get('package.json')!);
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
      ['docs/tic-tac-toe/checkpoints/first-card.md', checkpoint],
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
