import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readApplicationFile, readApplicationTree } from './application-files.js';
import type { ClaudePluginBundleInput, ReleaseInput } from './release-input.js';
import { redactSecrets } from './secrets.js';
import { safeArchivePath, type ZipEntry } from './zip.js';

// The optional Claude plugin bundle (CLI4 #67). A bundle exists only because the application
// supplied its scope: the skills it ships, a README and a license (`claude.pluginBundle` in the
// release input). Nothing is invented for it, so no sidebar, no onboarding flow, no command, agent
// or hook, and no skill the application did not write. Its one MCP server is the connector's own
// endpoint, because the directory says to point the bundle at the same URL so that people who have
// both see one set of tools. The bundle is a separate submission from a GitHub repository; this
// only prepares its files and checks them with Claude Code's own validator.
//
//   https://claude.com/docs/plugins/build        (folder layout)
//   https://claude.com/docs/plugins/submit       (submitting from GitHub)
//   https://claude.com/docs/plugins/pre-submission-checklist  (`claude plugin validate`)

/** Where the bundle's files sit inside the dossier archive. */
export const BUNDLE_DIRECTORY = 'plugin';

const json = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const withoutUndefined = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, inner]) => inner !== undefined)) as T;

export interface AssembledBundle {
  readonly entries: readonly ZipEntry[];
  /** What cannot be added to the bundle, with the reason. */
  readonly problems: readonly string[];
}

/** The files of the plugin folder for a release input and the scope it supplies. Nothing is validated here. */
export function assembleBundle(input: ReleaseInput, bundle: ClaudePluginBundleInput, directory: string): AssembledBundle {
  const entries: ZipEntry[] = [];
  const problems: string[] = [];
  const add = (entryPath: string, data: Uint8Array): void => {
    entries.push({ path: `${BUNDLE_DIRECTORY}/${entryPath}`, data });
  };

  for (const [label, source] of [['README', bundle.readme], ['license', bundle.license]] as const) {
    const read = readApplicationFile(directory, source);
    if (read.ok) add(label === 'README' ? 'README.md' : 'LICENSE', read.data);
    else problems.push(`The ${label} ${source}: ${read.reason}`);
  }

  const taken = new Map<string, string>();
  for (const source of bundle.skills) {
    const name = path.basename(source);
    const earlier = taken.get(name);
    if (earlier !== undefined) {
      problems.push(`The skill ${source} has the same directory name as ${earlier}; skill directory names must be distinct.`);
      continue;
    }
    taken.set(name, source);
    const tree = readApplicationTree(directory, source);
    if (!tree.ok) {
      problems.push(`The skill ${source}: ${tree.reason}`);
      continue;
    }
    if (!tree.files.some((file) => file.path === 'SKILL.md')) problems.push(`The skill ${source} has no SKILL.md.`);
    for (const file of tree.files) add(`skills/${name}/${file.path}`, file.data);
  }

  add(
    '.claude-plugin/plugin.json',
    json(
      withoutUndefined({
        name: input.name,
        version: input.version,
        description: input.description,
        author: withoutUndefined({ name: input.publisher.name, email: input.publisher.email, url: input.publisher.url }),
        homepage: input.homepage,
        repository: bundle.repository,
        license: input.license,
        keywords: input.keywords,
      }),
    ),
  );
  add('.mcp.json', json({ mcpServers: { [input.name]: { type: 'http', url: input.endpoint.url } } }));
  return { entries, problems };
}

/** Problems with the bundle's files that the directory states and that a path alone shows. */
export function bundlePathProblems(entries: readonly ZipEntry[]): string[] {
  const problems: string[] = [];
  const inside = entries.filter((entry) => entry.path.startsWith(`${BUNDLE_DIRECTORY}/`));
  for (const entry of inside) if (!safeArchivePath(entry.path)) problems.push(`${entry.path} is not a path that can be placed in the plugin folder.`);
  // "A top-level bin/ directory stops claude.ai and Cowork from installing the plugin at all."
  if (inside.some((entry) => entry.path.startsWith(`${BUNDLE_DIRECTORY}/bin/`))) problems.push('The plugin folder has a top-level bin/ directory, which stops claude.ai and Cowork from installing the plugin.');
  for (const required of ['.claude-plugin/plugin.json', '.mcp.json', 'README.md', 'LICENSE']) if (!inside.some((entry) => entry.path === `${BUNDLE_DIRECTORY}/${required}`)) problems.push(`The plugin folder has no ${required}.`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Claude Code's validator
// ---------------------------------------------------------------------------------------------

/** What Claude Code's `claude plugin validate` concluded, or why it could not be run. */
export type PluginValidation =
  | { readonly kind: 'checked'; readonly identity: string; readonly passed: boolean; readonly report: string }
  | { readonly kind: 'unavailable'; readonly problem: string };

/** Validates the bundle's files (paths below `plugin/`). A seam: the command line runs Claude Code's, a test supplies another. */
export type PluginValidator = (files: readonly ZipEntry[], signal: AbortSignal | undefined) => Promise<PluginValidation>;

const VALIDATOR_TIMEOUT_MS = 60_000;
const MAX_REPORT = 600;

const run = (args: readonly string[], cwd: string, signal: AbortSignal | undefined): Promise<{ code: number | 'unavailable'; output: string }> =>
  new Promise((resolve) => {
    // Only what the command needs: no credential of this process reaches it.
    const environment = Object.fromEntries(['PATH', 'HOME', 'LANG', 'CLAUDE_CONFIG_DIR'].flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])));
    execFile('claude', [...args], { cwd, env: environment, timeout: VALIDATOR_TIMEOUT_MS, maxBuffer: 1024 * 1024, ...(signal === undefined ? {} : { signal }) }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      if (error === null) return resolve({ code: 0, output });
      const code = (error as NodeJS.ErrnoException & { killed?: boolean }).code;
      if (typeof code === 'number') return resolve({ code, output });
      resolve({ code: 'unavailable', output: code === 'ENOENT' ? 'the claude command is not installed' : (error as { killed?: boolean }).killed === true ? 'it did not finish in time' : 'it could not be run' });
    });
  });

/** Claude Code's validator: `claude plugin validate` over the bundle written to a directory of its own. */
export const claudePluginValidate: PluginValidator = async (files, signal) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-claude-plugin-'));
  try {
    for (const file of files) {
      const target = path.join(root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.data);
    }
    const version = await run(['--version'], root, signal);
    if (version.code !== 0) return { kind: 'unavailable', problem: `Claude Code could not be run (${version.output.trim().slice(0, 120)}).` };
    const validation = await run(['plugin', 'validate', `./${BUNDLE_DIRECTORY}`], root, signal);
    if (validation.code === 'unavailable') return { kind: 'unavailable', problem: `claude plugin validate could not be run (${validation.output}).` };
    // Colour codes and the scratch directory's name are not part of what was found.
    const report = redactSecrets(validation.output.replaceAll(root, '<bundle>').replace(/\u001b\[[0-9;]*m/g, '').trim()).slice(0, MAX_REPORT);
    return { kind: 'checked', identity: `claude plugin validate, from Claude Code ${version.output.trim().slice(0, 80)}`, passed: validation.code === 0, report };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};
