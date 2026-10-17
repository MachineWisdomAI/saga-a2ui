import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPISODE_VIEW_URI } from '../apps/lit-host/src/mcp/episode.js';
import { SUBSCRIPTIONS_VIEW_URI } from '../apps/lit-host/src/mcp/subscriptions.js';
import { PLAYBACK_VIEW_URI } from '../apps/lit-host/src/playback/playback.js';

// Prints the exact identities of the locally qualified MCP candidate: the source revision, the
// installed package recipe (versions, tarball integrity) and the built view resources (SHA-256).
// Actual-host mapping (MAP1) measures this candidate, so it needs identities, not descriptions.
// It reads the lockfile and the built output; it starts nothing and records no secrets.
//
//   npm run build && npm run candidate:identity [-- --out FILE]

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Lockfile path of every package the MCP seam and the A2UI boundary depend on, by role. */
export const RECIPE_PACKAGES = {
  'MCP Apps': 'apps/lit-host/node_modules/@modelcontextprotocol/ext-apps',
  'MCP client': 'node_modules/@modelcontextprotocol/client',
  'MCP core': 'node_modules/@modelcontextprotocol/core',
  'MCP server': 'node_modules/@modelcontextprotocol/server',
  'MCP Node integration': 'node_modules/@modelcontextprotocol/node',
  'Zod (MCP seam, hoisted)': 'node_modules/zod',
  'A2UI Lit': 'node_modules/@a2ui/lit',
  'A2UI web core': 'node_modules/@a2ui/web_core',
  'Zod (A2UI boundary, web core copy)': 'node_modules/@a2ui/web_core/node_modules/zod',
  'Zod (A2UI boundary, Lit copy)': 'node_modules/@a2ui/lit/node_modules/zod',
  'Zod 3 alias (A2UI schema authoring)': 'node_modules/zod3',
  // Must stay under web core, where its Zod peer resolves to Zod 3; hoisted, it would see Zod 4.
  'zod-to-json-schema (A2UI boundary)': 'node_modules/@a2ui/web_core/node_modules/zod-to-json-schema',
} as const;

/** Built single-file views, each served verbatim as the resource at the named URI. */
export const BUILT_VIEWS = [
  { uri: EPISODE_VIEW_URI, file: 'apps/lit-host/dist/view/view.html' },
  { uri: SUBSCRIPTIONS_VIEW_URI, file: 'apps/lit-host/dist/subscriptions-view/subscriptions.html' },
  { uri: PLAYBACK_VIEW_URI, file: 'apps/lit-host/dist/playback-view/playback.html' },
] as const;

interface LockEntry {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly license?: string;
}

export interface PackageIdentity {
  readonly role: string;
  readonly lockPath: string;
  readonly version: string;
  readonly integrity: string;
  readonly license: string | null;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Reads each recipe package from a parsed lockfile; a missing or incomplete entry is an error. */
export function packageIdentities(
  lock: { readonly packages: Readonly<Record<string, LockEntry>> },
  recipe: Readonly<Record<string, string>> = RECIPE_PACKAGES,
): PackageIdentity[] {
  return Object.entries(recipe).map(([role, lockPath]) => {
    const entry = lock.packages[lockPath];
    if (entry?.version === undefined || entry.integrity === undefined) {
      throw new Error(`The lockfile has no complete entry for ${role} at ${lockPath}.`);
    }
    return { role, lockPath, version: entry.version, integrity: entry.integrity, license: entry.license ?? null };
  });
}

function git(root: string, args: string[]): string | null {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function candidateIdentity(root: string): Record<string, unknown> {
  const lockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const lock = JSON.parse(lockText) as { packages: Record<string, LockEntry> };
  const views = BUILT_VIEWS.map((view) => {
    const bytes = fs.readFileSync(path.join(root, view.file));
    return { uri: view.uri, file: view.file, bytes: bytes.length, sha256: sha256Hex(bytes) };
  });
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']);
  const receiptPath = path.join(root, '.wise-agents', 'verify-receipts', 'latest.json');
  return {
    source: {
      commit: git(root, ['rev-parse', 'HEAD']),
      trackedChangesAtCapture: dirty === null ? null : dirty.length > 0,
    },
    runtime: { node: process.version },
    lockfile: { file: 'package-lock.json', sha256: sha256Hex(lockText) },
    packages: packageIdentities(lock),
    resources: views,
    localResult: fs.existsSync(receiptPath) ? summarizeReceipt(fs.readFileSync(receiptPath, 'utf8')) : null,
  };
}

/** The part of a verify receipt that says what ran, on which commit, and how each command ended. */
export function summarizeReceipt(receiptText: string): Record<string, unknown> {
  const receipt = JSON.parse(receiptText) as {
    commitAtStart: string | null;
    validationLabel: string;
    exitCode: number;
    commands: { name: string; exitCode: number | null }[];
  };
  return {
    commit: receipt.commitAtStart,
    validationLabel: receipt.validationLabel,
    exitCode: receipt.exitCode,
    commands: receipt.commands.map((command) => ({ name: command.name, exitCode: command.exitCode })),
  };
}

function main(argv: string[]): void {
  const flag = argv.indexOf('--out');
  const out = flag === -1 ? undefined : argv[flag + 1];
  if (flag !== -1 && out === undefined) throw new Error('--out requires a file');
  const text = `${JSON.stringify(candidateIdentity(toolRoot), null, 2)}\n`;
  if (out === undefined) process.stdout.write(text);
  else {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, text);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
