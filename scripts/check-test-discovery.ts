import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativePosix, repositoryRoot, walkFiles } from './authored-tree.js';

// Compares authored headless *.test.ts files with Vitest's own file list, and
// authored *.spec.ts files with Playwright's own list. The two inventories are
// separate. This does not copy either runner's include glob, and it does not
// exclude fixture or e2e tests. See docs/development-reference.md#repository-verification.

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestBin = path.join(toolRoot, 'node_modules', '.bin', 'vitest');
const playwrightBin = path.join(toolRoot, 'node_modules', '.bin', 'playwright');

type ParsedArgs = { root: string; config: string };

function parseArgs(argv: string[], cwd: string): ParsedArgs {
  let root = repositoryRoot(cwd);
  let config: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a directory');
      root = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--config') {
      const value = argv[index + 1];
      if (!value) throw new Error('--config requires a Vitest config path');
      config = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { root, config: config ?? path.join(root, 'vitest.config.ts') };
}

function isHeadlessTest(fileName: string): boolean {
  return fileName.endsWith('.test.ts');
}

function isBrowserSpec(fileName: string): boolean {
  return fileName.endsWith('.spec.ts');
}

function run(bin: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function vitestFiles(root: string, config: string): string[] {
  const result = run(vitestBin, ['list', '--filesOnly', '--config', config, '--root', root], root);
  if (result.status !== 0) {
    throw new Error(`vitest list failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.test.ts'))
    .map((line) => path.resolve(root, line));
}

type PlaywrightList = {
  config?: { projects?: Array<{ testDir?: string }> };
  suites?: unknown[];
};

function collectListed(node: unknown, testDirs: string[], found: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const record = node as { file?: unknown; suites?: unknown[]; specs?: unknown[] };
  if (typeof record.file === 'string') {
    if (path.isAbsolute(record.file)) found.add(path.resolve(record.file));
    for (const testDir of testDirs) found.add(path.resolve(testDir, record.file));
  }
  for (const suite of record.suites ?? []) collectListed(suite, testDirs, found);
  for (const spec of record.specs ?? []) collectListed(spec, testDirs, found);
}

function playwrightFiles(configPath: string): string[] {
  const result = run(
    playwrightBin,
    ['test', '--list', '--reporter=json', '--config', configPath],
    path.dirname(configPath),
  );
  if (result.status !== 0) {
    throw new Error(`playwright test --list failed for ${configPath}\n${result.stdout}${result.stderr}`);
  }
  const jsonStart = result.stdout.indexOf('{');
  if (jsonStart < 0) throw new Error(`playwright test --list did not return JSON for ${configPath}`);
  const parsed = JSON.parse(result.stdout.slice(jsonStart)) as PlaywrightList;
  const testDirs = (parsed.config?.projects ?? [])
    .map((project) => project.testDir)
    .filter((dir): dir is string => typeof dir === 'string' && dir.length > 0);
  if (testDirs.length === 0) testDirs.push(path.dirname(configPath));
  const found = new Set<string>();
  for (const suite of parsed.suites ?? []) collectListed(suite, testDirs, found);
  return [...found];
}

function missing(authored: string[], discovered: string[]): string[] {
  const known = new Set(discovered.map((file) => path.resolve(file)));
  return authored.filter((file) => !known.has(path.resolve(file)));
}

function main(): number {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (!fs.existsSync(parsed.config)) {
    console.error(`Vitest config not found: ${parsed.config}`);
    return 2;
  }

  const headless = walkFiles(parsed.root, isHeadlessTest);
  const specs = walkFiles(parsed.root, isBrowserSpec);
  let discoveredHeadless: string[];
  try {
    discoveredHeadless = vitestFiles(parsed.root, parsed.config);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const omittedHeadless = missing(headless, discoveredHeadless);
  for (const file of headless) {
    if (!omittedHeadless.includes(file)) console.log(`headless ${relativePosix(parsed.root, file)}`);
  }
  for (const file of omittedHeadless) {
    console.log(`omitted headless test: ${relativePosix(parsed.root, file)}`);
  }

  const playwrightConfigs = walkFiles(parsed.root, (name) => name === 'playwright.config.ts');
  let discoveredSpecs: string[] = [];
  try {
    discoveredSpecs = playwrightConfigs.flatMap(playwrightFiles);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const omittedSpecs = missing(specs, discoveredSpecs);
  for (const file of specs) {
    if (!omittedSpecs.includes(file)) console.log(`browser ${relativePosix(parsed.root, file)}`);
  }
  for (const file of omittedSpecs) {
    console.log(`omitted browser spec: ${relativePosix(parsed.root, file)}`);
  }

  return omittedHeadless.length === 0 && omittedSpecs.length === 0 ? 0 : 1;
}

process.exit(main());
