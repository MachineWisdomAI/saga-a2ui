import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repository verification route. Receipts record the invocation and git state.
// They do not record environment variables or command output. A run is
// pristine-head only when the commit and tracked dirty state stay clean and
// unchanged across every command boundary. See docs/development-reference.md#repository-verification.

const toolRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

type Command = { name: string; argv: string[] };

type GitSnapshot = { commit: string | null; trackedStatus: string[] | null };

type CommandReceipt = {
  name: string;
  argv: string[];
  startedAt: string;
  endedAt: string;
  exitCode: number | null;
};

type VerifyReceipt = {
  startedAt: string;
  endedAt: string;
  cwd: string;
  argv: string[];
  node: string;
  npm: string;
  commitAtStart: string | null;
  commitAtEnd: string | null;
  revisionChanged: boolean;
  trackedStatusAtStart: string[];
  trackedStatusAtEnd: string[];
  trackedStateChanged: boolean;
  pristineHead: boolean;
  validationLabel: 'pristine-head' | 'not-pristine-head';
  invocation: 'repository-suite' | 'exec';
  commands: CommandReceipt[];
  exitCode: number;
};

function parseArgs(argv: string[]): {
  cwd: string;
  receiptDir: string | undefined;
  exec: Command[];
} {
  let cwd = toolRoot;
  let receiptDir: string | undefined;
  const exec: Command[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      const value = argv[index + 1];
      if (!value) throw new Error('--cwd requires a directory');
      cwd = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--receipt-dir') {
      const value = argv[index + 1];
      if (!value) throw new Error('--receipt-dir requires a directory');
      receiptDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--exec') {
      const value = argv[index + 1];
      if (!value) throw new Error('--exec requires a JSON command');
      const parsed = JSON.parse(value) as { name?: unknown; argv?: unknown };
      if (
        typeof parsed.name !== 'string' ||
        !Array.isArray(parsed.argv) ||
        parsed.argv.length === 0
      ) {
        throw new Error('--exec requires {"name":"...","argv":["..."]}');
      }
      if (!parsed.argv.every((item) => typeof item === 'string')) {
        throw new Error('--exec argv must be strings');
      }
      exec.push({ name: parsed.name, argv: parsed.argv as string[] });
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return { cwd, receiptDir, exec };
}

function capture(bin: string, args: string[]): string {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

function gitSnapshot(cwd: string): GitSnapshot {
  const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  const statusResult = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=no'],
    {
      cwd,
      encoding: 'utf8',
    },
  );
  const commit =
    commitResult.status === 0 ? (commitResult.stdout ?? '').trim() : null;
  const trackedStatus =
    statusResult.status === 0
      ? (statusResult.stdout ?? '').split('\n').filter(Boolean).sort()
      : null;
  return { commit: commit || null, trackedStatus };
}

function sameStatus(left: string[] | null, right: string[] | null): boolean {
  if (left === null || right === null) return false;
  if (left.length !== right.length) return false;
  return left.every((line, index) => line === right[index]);
}

function repositorySuite(): Command[] {
  const tsx = path.join(toolRoot, 'node_modules', '.bin', 'tsx');
  return [
    {
      name: 'static-guard',
      argv: [tsx, path.join(toolRoot, 'scripts', 'guard-fixed-or.ts')],
    },
    {
      name: 'test-discovery',
      argv: [tsx, path.join(toolRoot, 'scripts', 'check-test-discovery.ts')],
    },
    { name: 'typecheck', argv: ['npm', 'run', 'typecheck'] },
    { name: 'build', argv: ['npm', 'run', 'build'] },
    { name: 'test:headless', argv: ['npm', 'run', 'test:headless'] },
    { name: 'test:browser', argv: ['npm', 'run', 'test:browser'] },
    { name: 'lfs-pointers', argv: ['python3', 'scripts/check-lfs.py'] },
    {
      name: 'version-enrollment',
      argv: ['python3', 'scripts/check-version-enrollment.py'],
    },
  ];
}

function receiptName(when: Date): string {
  const stamp = when.toISOString().replace(/[-:]/g, '').replace('.', '');
  return `${stamp}-${process.pid}.json`;
}

function writeReceipt(dir: string, when: Date, receipt: VerifyReceipt): void {
  fs.mkdirSync(dir, { recursive: true });
  const body = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(path.join(dir, receiptName(when)), body);
  fs.writeFileSync(path.join(dir, 'latest.json'), body);
}

function main(): number {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const started = new Date();
  const cwd = parsed.cwd;
  const commands = parsed.exec.length === 0 ? repositorySuite() : parsed.exec;
  const invocation = parsed.exec.length === 0 ? 'repository-suite' : 'exec';
  const startSnapshot = gitSnapshot(cwd);
  const snapshots = [startSnapshot];
  const commandReceipts: CommandReceipt[] = [];
  let exitCode = 0;

  for (const command of commands) {
    const commandStarted = new Date();
    const result = spawnSync(command.argv[0], command.argv.slice(1), {
      cwd,
      stdio: 'inherit',
    });
    const commandEnded = new Date();
    commandReceipts.push({
      name: command.name,
      argv: command.argv,
      startedAt: commandStarted.toISOString(),
      endedAt: commandEnded.toISOString(),
      exitCode: result.status,
    });
    snapshots.push(gitSnapshot(cwd));
    if (result.status !== 0) {
      exitCode = result.status === null ? 1 : result.status;
      break;
    }
  }

  const ended = new Date();
  const endSnapshot = snapshots[snapshots.length - 1] ?? startSnapshot;
  const revisionChanged = snapshots.some(
    (snapshot) => snapshot.commit !== startSnapshot.commit,
  );
  const trackedStateChanged = snapshots.some(
    (snapshot) =>
      !sameStatus(snapshot.trackedStatus, startSnapshot.trackedStatus),
  );
  const pristineHead =
    startSnapshot.commit !== null &&
    startSnapshot.trackedStatus !== null &&
    startSnapshot.trackedStatus.length === 0 &&
    !revisionChanged &&
    !trackedStateChanged;
  const receipt: VerifyReceipt = {
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    cwd,
    argv: process.argv,
    node: capture(process.execPath, ['--version']),
    npm: capture('npm', ['--version']),
    commitAtStart: startSnapshot.commit,
    commitAtEnd: endSnapshot.commit,
    revisionChanged,
    trackedStatusAtStart: startSnapshot.trackedStatus ?? [],
    trackedStatusAtEnd: endSnapshot.trackedStatus ?? [],
    trackedStateChanged,
    pristineHead,
    validationLabel: pristineHead ? 'pristine-head' : 'not-pristine-head',
    invocation,
    commands: commandReceipts,
    exitCode,
  };
  const receiptDir =
    parsed.receiptDir ?? path.join(cwd, '.wise-agents', 'verify-receipts');
  writeReceipt(receiptDir, started, receipt);
  console.log(`receipt: ${path.join(receiptDir, 'latest.json')}`);
  return exitCode;
}

process.exit(main());
