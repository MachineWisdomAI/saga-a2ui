import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Dependencies and generated output are not authored source. Disposable agent
// files are not part of the repository either. Do not add a broad fixture or
// e2e exclusion here: those directories contain authored tests.
export const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-installed',
  'coverage',
  'test-results',
  'playwright-report',
  '.git',
  '.wise-agents',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

export function repositoryRoot(cwd: string): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    const root = (result.stdout ?? '').trim();
    if (root) return root;
  }
  return path.resolve(cwd);
}

export function isAuthoredTypeScript(fileName: string): boolean {
  if (fileName.endsWith('.d.ts')) return false;
  return SOURCE_EXTENSIONS.has(path.extname(fileName));
}

export function walkFiles(
  root: string,
  accept: (fileName: string) => boolean,
): string[] {
  const found: string[] = [];
  function visit(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        visit(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (accept(entry.name)) found.push(path.join(dir, entry.name));
    }
  }
  visit(root);
  found.sort();
  return found;
}

export function relativePosix(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
