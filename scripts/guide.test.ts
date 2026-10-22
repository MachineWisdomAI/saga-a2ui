import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkRecipes,
  dedent,
  renderRecipes,
  RECIPES_FILE,
  REQUIRED_SERVERS,
} from './guide-recipes.js';
import { repoRoot } from './packed-consumer.js';
import { QUALIFIED_STARTERS } from './qualified-starters.js';
import { DOWNLOAD_SCRIPTS } from '../demo/lit-node/download-scripts.js';
import { SUPPORTED_PAIRS, runCli } from './saga.js';
import {
  extractSnippets,
  readTemplateMetadata,
  templateDirectory,
  templateFiles,
} from './starter-template.js';

// The setup guide (docs/getting-started.md) and its generated recipes
// (docs/attach-to-existing-backend.md) as a developer uses them: every command a reader is told to
// run, every snippet they are told to copy and every name they are told to install is checked
// against the tool, template or package it names. Prose is not parsed for meaning; what is checked
// is what a reader would type, import or follow.

const GUIDE = 'docs/getting-started.md';
const read = (file: string): string =>
  fs.readFileSync(path.join(repoRoot, file), 'utf8');
/** The guide only runs `init`; a demo build here would be a defect, so asking for one fails the test. */
const stageDemo = (): never => {
  throw new Error('init must not build the demonstration');
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-guide-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

interface Block {
  /** `repository` (run in a checkout), `project` (in a created project), `demo` (in the download), or a language. */
  readonly kind: string;
  readonly lines: readonly string[];
}

/** The fenced blocks of a document. The word after `sh` says where the commands are run. */
function blocks(markdown: string): Block[] {
  const found: Block[] = [];
  let open: { kind: string; lines: string[] } | undefined;
  for (const line of markdown.split('\n')) {
    const fence = /^```(.*)$/.exec(line);
    if (fence === null) {
      open?.lines.push(line);
      continue;
    }
    if (open) {
      found.push(open);
      open = undefined;
    } else {
      const words = (fence[1] as string).trim().split(/\s+/);
      open = {
        kind:
          words[0] === 'sh' && words[1] !== undefined
            ? words[1]
            : (words[0] as string),
        lines: [],
      };
    }
  }
  return found;
}

const commandsOf = (markdown: string, kind: string): string[] =>
  blocks(markdown)
    .filter((block) => block.kind === kind)
    .flatMap((block) => block.lines)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line !== '');

const guide = read(GUIDE);
const recipes = read(RECIPES_FILE);
const documents: Record<string, string> = {
  [GUIDE]: guide,
  [RECIPES_FILE]: recipes,
};

const packageManifests = fs
  .readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(
    (entry) =>
      JSON.parse(read(`packages/${entry.name}/package.json`)) as {
        name: string;
        exports?: Record<string, string>;
      },
  );

describe('the generated existing-backend recipes', () => {
  it('are current: they equal what the qualified templates render today', () => {
    expect(checkRecipes(path.join(repoRoot, RECIPES_FILE))).toEqual({
      current: true,
    });
  });

  it('are reported stale, with the way to refresh them, when a recipe differs from its template', () => {
    const stale = path.join(work, 'stale.md');
    fs.writeFileSync(
      stale,
      recipes.replace(
        'Object.assign(req, { auth: decision.authInfo });',
        'req.user = decision.authInfo;',
      ),
    );
    const result = checkRecipes(stale);
    expect(result.current).toBe(false);
    expect(result).toMatchObject({
      current: false,
      message: expect.stringContaining('npm run guide:recipes'),
    });
  });

  it('show each qualified template\u2019s own snippet lines, and every declared snippet, for every qualified template', () => {
    for (const name of QUALIFIED_STARTERS) {
      const template = templateDirectory(name);
      const metadata = readTemplateMetadata(template);
      const section = recipes.slice(
        recipes.indexOf(`<!-- recipe:${name} -->`),
        recipes.indexOf(`<!-- /recipe:${name} -->`),
      );
      expect(section, `${name} has a recipe section`).not.toBe('');
      expect(section).toContain(
        `${metadata.serverAdapter.package}\` ${metadata.serverAdapter.version}`,
      );
      for (const declared of metadata.snippets) {
        const snippet = extractSnippets(template).find(
          (one) => one.name === declared,
        );
        expect(snippet, `${name} extracts ${declared}`).toBeDefined();
        expect(section, `${name} shows ${declared}`).toContain(
          dedent((snippet as { text: string }).text),
        );
        expect(section).toContain(
          `templates/${name}/${(snippet as { file: string }).file}`,
        );
      }
    }
  });

  it('have no recipe for a template CI does not qualify, and name the required servers still without one', () => {
    const shown = [...recipes.matchAll(/<!-- recipe:([a-z-]+) -->/g)].map(
      (match) => match[1],
    );
    expect(shown).toEqual([...QUALIFIED_STARTERS]);
    const covered = QUALIFIED_STARTERS.map(
      (name) => readTemplateMetadata(templateDirectory(name)).server,
    );
    const uncovered = REQUIRED_SERVERS.filter(
      (server) => !covered.includes(server),
    );
    const missing = recipes.slice(
      recipes.indexOf('<!-- uncovered -->'),
      recipes.indexOf('<!-- /uncovered -->'),
    );
    for (const server of uncovered) expect(missing).toContain(`\`${server}\``);
    for (const server of covered)
      expect(missing).not.toContain(`\`${server}\``);
  });

  it('say which qualified pairs `saga init` offers, and that is the list the command offers', () => {
    const table = recipes.slice(
      recipes.indexOf('<!-- pairs -->'),
      recipes.indexOf('<!-- /pairs -->'),
    );
    const rows = table.split('\n').filter((line) => /^\| `lit-mcp`/.test(line));
    const offered = rows
      .filter((row) => /\| offered \|$/.test(row))
      .map((row) => row.split('|')[2]?.trim());
    expect(offered).toEqual(
      SUPPORTED_PAIRS.map((pair) => `\`${pair.server}\``),
    );
    expect(rows).toHaveLength(QUALIFIED_STARTERS.length);
  });

  it('render the same text twice', () => {
    expect(renderRecipes()).toBe(renderRecipes());
  });
});

describe('the commands the guide tells a reader to type', () => {
  const initLines = commandsOf(guide, 'repository').filter((line) =>
    line.startsWith('npx tsx scripts/saga.ts init'),
  );

  it('include a command for a supported pair and a refused pair', () => {
    const pairs = initLines.map((line) =>
      /--a2ui-stack (\S+) --server (\S+)/.exec(line)?.slice(1, 3).join(' on '),
    );
    const offered = SUPPORTED_PAIRS.map(
      (pair) => `${pair.stack} on ${pair.server}`,
    );
    expect(
      pairs.some((pair) => pair !== undefined && offered.includes(pair)),
    ).toBe(true);
    expect(
      pairs.some((pair) => pair !== undefined && !offered.includes(pair)),
    ).toBe(true);
  });

  it('create the exported starter for each supported pair and refuse the others without writing', async () => {
    for (const [index, line] of initLines.entries()) {
      const [, stack, server, directory] =
        /--a2ui-stack (\S+) --server (\S+) (\S+)$/.exec(
          line,
        ) as RegExpExecArray;
      const cwd = fs.mkdtempSync(path.join(work, `init-${index}-`));
      let out = '';
      let err = '';
      const code = await runCli(
        [
          'init',
          '--a2ui-stack',
          stack as string,
          '--server',
          server as string,
          directory as string,
        ],
        {
          cwd,
          sdkVersion: () => '0.0.0-candidate.g0123456789ab',
          stageDemo,
          stdout: (text) => (out += text),
          stderr: (text) => (err += text),
        },
      );
      const pair = SUPPORTED_PAIRS.find(
        (one) => one.stack === stack && one.server === server,
      );
      if (pair === undefined) {
        expect(code, line).toBe(1);
        expect(fs.readdirSync(cwd), `${line} wrote nothing`).toEqual([]);
        for (const offered of SUPPORTED_PAIRS)
          expect(err).toContain(
            `--a2ui-stack ${offered.stack} --server ${offered.server}`,
          );
      } else {
        expect(code, `${line}: ${err}`).toBe(0);
        const created = path.join(cwd, directory as string);
        const files = templateFiles(templateDirectory(pair.template));
        for (const file of files)
          expect(
            fs.existsSync(path.join(created, file)),
            `${line} creates ${file}`,
          ).toBe(true);
        expect(out).toContain('Nothing was installed and no command was run.');
      }
    }
  });

  it('run only repository scripts, tools and files that exist', () => {
    const rootScripts = (
      JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    ).scripts;
    for (const document of Object.values(documents)) {
      for (const line of commandsOf(document, 'repository')) {
        const script = /^npm run ([\w:.-]+)/.exec(line)?.[1];
        if (script !== undefined)
          expect(rootScripts, line).toHaveProperty(script);
        const tool = /^npx tsx (scripts\/[\w./-]+\.ts)/.exec(line)?.[1];
        if (tool !== undefined)
          expect(fs.existsSync(path.join(repoRoot, tool)), line).toBe(true);
      }
    }
    expect(commandsOf(guide, 'repository').length).toBeGreaterThan(0);
  });

  it('run in a created project only scripts that every qualified starter has, in the order `saga init` prints them', async () => {
    const shown = commandsOf(guide, 'project');
    expect(shown.length).toBeGreaterThan(0);
    for (const name of QUALIFIED_STARTERS) {
      const scripts = (
        JSON.parse(
          fs.readFileSync(
            path.join(templateDirectory(name), 'package.json'),
            'utf8',
          ),
        ) as { scripts: Record<string, string> }
      ).scripts;
      for (const line of shown) {
        const script = /^npm run ([\w:.-]+)/.exec(line)?.[1];
        if (script !== undefined)
          expect(scripts, `${name}: ${line}`).toHaveProperty(script);
        if (line === 'npm start') expect(scripts, name).toHaveProperty('start');
      }
    }
    let out = '';
    await runCli(
      ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'next-steps'],
      {
        cwd: fs.mkdtempSync(path.join(work, 'steps-')),
        sdkVersion: () => '0.0.0-candidate.g0123456789ab',
        stageDemo,
        stdout: (text) => (out += text),
        stderr: () => undefined,
      },
    );
    const printed = out
      .split('\n')
      .filter((line) => /^ {2}(cd |npm )/.test(line))
      .map((line) => line.trim());
    expect(shown.filter((line) => line !== 'npm run typecheck')).toEqual(
      printed.map((line) => (line.startsWith('cd ') ? 'cd my-app' : line)),
    );
  });

  it('run in the demo download only its declared scripts, without requiring a build', () => {
    const scripts = DOWNLOAD_SCRIPTS;
    const shown = commandsOf(guide, 'demo');
    expect(shown.length).toBeGreaterThan(0);
    for (const line of shown) {
      const script = /^npm (?:run )?(start|[\w:.-]+)$/.exec(line)?.[1];
      if (script !== undefined) expect(scripts, line).toHaveProperty(script);
    }
  });
});

describe('the names and imports the guide uses', () => {
  const imports = (markdown: string): string[] =>
    blocks(markdown)
      .filter((block) => ['ts', 'tsx'].includes(block.kind))
      .flatMap((block) => block.lines);

  it('install only flat package names that exist, with retired and proposed names marked as such', () => {
    const real = new Set(packageManifests.map((manifest) => manifest.name));
    for (const [file, document] of Object.entries(documents)) {
      for (const line of document.split('\n')) {
        for (const match of line.matchAll(/@saga-a2ui\/([a-z0-9-]+)/g)) {
          const name = `@saga-a2ui/${match[1]}`;
          if (real.has(name)) continue;
          expect(
            line,
            `${file}: ${name} is neither a package nor marked`,
          ).toMatch(
            /retired|proposal|proposed|no such|does not exist|aggregate/i,
          );
        }
      }
    }
    for (const aggregate of [
      'genui',
      'protocol',
      'transport',
      'tools',
      'a2a',
    ]) {
      for (const document of Object.values(documents)) {
        for (const line of document
          .split('\n')
          .filter((one) => one.includes(`@saga-a2ui/${aggregate}`)))
          expect(line).toMatch(/no |not |aggregate/i);
      }
    }
  });

  it('import only subpaths a package exports', () => {
    for (const document of Object.values(documents)) {
      for (const match of imports(document)
        .join('\n')
        .matchAll(/['"](@saga-a2ui\/[a-z0-9-]+)((?:\/[\w./-]+)?)['"]/g)) {
        const manifest = packageManifests.find((one) => one.name === match[1]);
        expect(manifest, match[0]).toBeDefined();
        const exported = Object.keys(manifest?.exports ?? {});
        expect(exported, match[0]).toContain(`.${match[2]}`);
      }
    }
  });

  it('never import the upstream A2UI packages in a code block, and name the React entry point for React surfaces', () => {
    for (const document of Object.values(documents)) {
      expect(imports(document).join('\n')).not.toMatch(
        /from ['"]@a2ui\/react|from ['"]@a2ui\/web_core.*react/i,
      );
    }
    const reactSection = guide.slice(
      guide.indexOf('<!-- react -->'),
      guide.indexOf('<!-- /react -->'),
    );
    expect(reactSection).toContain('`@saga-a2ui/react/a2ui`');
    expect(reactSection).not.toMatch(/import .* from '@a2ui\/react'/);
  });
});

describe('links in the guide and the recipes', () => {
  const slug = (heading: string): string =>
    heading
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^\p{L}\p{N} -]/gu, '')
      .trim()
      .replace(/ /g, '-');

  it('lead to files and headings that exist', () => {
    for (const [file, document] of Object.entries(documents)) {
      for (const match of document.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1] as string;
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [pathPart, anchor] = target.split('#') as [
          string,
          string | undefined,
        ];
        const resolved =
          pathPart === ''
            ? path.join(repoRoot, file)
            : path.resolve(path.dirname(path.join(repoRoot, file)), pathPart);
        expect(fs.existsSync(resolved), `${file} links to ${target}`).toBe(
          true,
        );
        if (anchor !== undefined && resolved.endsWith('.md')) {
          const headings = fs
            .readFileSync(resolved, 'utf8')
            .split('\n')
            .filter((line) => /^#{1,6} /.test(line))
            .map((line) => slug(line.replace(/^#+ /, '')));
          expect(headings, `${file} links to ${target}`).toContain(anchor);
        }
      }
    }
  });
});

describe('what the guide must explain', () => {
  const headings = guide
    .split('\n')
    .filter((line) => /^#{2,3} /.test(line))
    .map((line) => line.replace(/^#+ /, ''));

  it('has a section for each part of the setup the issue names', () => {
    for (const required of [
      'Which packages do what',
      'Component, definition, template and instance',
      'Start from the demo',
      'Create a new project',
      'Attach to an existing backend',
      'Content policy',
      'Identity and the evidence behind it',
      'Actions',
      'What is implemented and what is not',
      'Friction recorded while writing this guide',
    ]) {
      expect(headings, required).toContain(required);
    }
  });

  it('keeps Lynx as history, with no setup claim, and does not route another renderer through the Lit lifecycle', () => {
    // Prose only: the one command that installs the retained fixture's own lockfile is a command, not a claim.
    const prose = guide.replace(/```[\s\S]*?```/g, '');
    const lynx = prose.split('\n').filter((line) => /lynx/i.test(line));
    expect(lynx.length).toBeGreaterThan(0);
    for (const line of lynx)
      expect(line).toMatch(/retired|history|historical/i);
    expect(guide).toMatch(
      /not a Lit lifecycle|no Lit-specific lifecycle|Lit-specific lifecycle/,
    );
  });

  it('quotes identifiers the notes example and the starter really contain', () => {
    const files = {
      'examples/pack1-consumer/src/notes-surface.ts': [
        "id: 'row-archive'",
        "componentId: 'note-row'",
        "path: '/notes'",
      ],
      'examples/pack1-consumer/src/notes-view.ts': [
        "watchById('row-archive'",
        'bindAction(',
        'subject',
      ],
      'examples/pack1-consumer/src/notes-actions.ts': [
        "event.read('id')",
        'prerequisite(',
        'Action.server',
        'Action.local',
      ],
      'templates/lit-node/server/operations.ts': [
        'CLOSED_VIEW_CSP',
        'identityOf',
      ],
      'templates/lit-node/src/view.ts': ['MISMATCH_TEXT'],
    };
    for (const [file, needles] of Object.entries(files)) {
      const source = read(file);
      for (const needle of needles)
        expect(
          source.replace(/\s+/g, ''),
          `${file} contains ${needle}`,
        ).toContain(needle.replace(/\s+/g, ''));
    }
    for (const quoted of [
      'row-archive',
      "{ componentId: 'note-row', path: '/notes' }",
      '/status/mcp',
      '/account/mcp',
      'CLOSED_VIEW_CSP',
      'identityOf',
    ]) {
      expect(guide, quoted).toContain(quoted);
    }
    expect(read('templates/lit-node/server/listener.ts')).toContain(
      "'/status/mcp'",
    );
    expect(read('templates/lit-node/server/listener.ts')).toContain(
      "'/account/mcp'",
    );
  });

  describe('the quoted stack composition', () => {
    const composition = blocks(guide).find((block) =>
      block.lines.some((line) => line.includes('startA2uiView({')),
    );
    const significant = (lines: readonly string[]): string[] =>
      lines
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('//'));
    const starterLines = significant(
      read('templates/lit-node/src/view.ts').split('\n'),
    );
    const requiredOptions = (): string[] => {
      const declaration = read('packages/lit/src/actions/lit-actions.ts');
      const body = /export interface LitActionsOptions \{([\s\S]*?)\n\}/.exec(
        declaration,
      )?.[1];
      expect(body, 'LitActionsOptions is declared').toBeDefined();
      return [...body!.matchAll(/^ {2}readonly (\w+):/gm)].map(
        (match) => match[1] as string,
      );
    };

    /** The quoted lines that are not lines of the source, each after the one before it. */
    const notInOrder = (
      quoted: readonly string[],
      source: readonly string[],
    ): string[] => {
      const missing: string[] = [];
      let from = 0;
      for (const line of significant(quoted)) {
        const at = source.indexOf(line, from);
        if (at < 0) missing.push(line);
        else from = at + 1;
      }
      return missing;
    };
    /** The required options the quoted text does not pass as a property. */
    const unsupplied = (required: readonly string[], text: string): string[] =>
      required.filter(
        (option) => !new RegExp(`^\\s+${option}:`, 'm').test(text),
      );

    it('is the starter\u2019s own lines, in the starter\u2019s order', () => {
      expect(composition, 'the guide shows the composition').toBeDefined();
      expect(notInOrder(composition!.lines, starterLines)).toEqual([]);
    });

    it('supplies every option createLitActions requires, read from its declared type', () => {
      const required = requiredOptions();
      expect(required).toEqual(
        expect.arrayContaining(['attach', 'onSetupError']),
      );
      expect(unsupplied(required, composition!.lines.join('\n'))).toEqual([]);
    });

    it('would fail if the quoted call dropped a required option or invented a line', () => {
      const lines = composition!.lines;
      const dropped = lines
        .filter((line) => !line.includes('onSetupError'))
        .join('\n');
      expect(unsupplied(requiredOptions(), dropped)).toEqual(['onSetupError']);
      expect(
        notInOrder(
          [...lines, '  actions: createLitActions({ attach: bind }),'],
          starterLines,
        ),
      ).toEqual(['actions: createLitActions({ attach: bind }),']);
      // Lines that exist but are quoted out of the starter's order are caught too.
      expect(
        notInOrder(
          ['await view.ready;', "container: requireElement('starter-app'),"],
          starterLines,
        ),
      ).toEqual(["container: requireElement('starter-app'),"]);
    });
  });

  it('separates a local candidate install from a public registry release', () => {
    for (const name of ['core', 'components', 'mcp', 'react']) {
      expect(guide).toContain(`@saga-a2ui/${name}`);
    }
    expect(guide).toContain('published on public npm at `0.1.0-rc.1`');
    expect(guide).toContain('`@saga-a2ui/lit`, which is not published on npm');
    expect(guide).toMatch(/not a public registry release/i);
    expect(guide).not.toMatch(
      /there is no release|packages are private, unpublished and unversioned/i,
    );
    expect(guide).toContain('candidate-update-and-rollback.md');
  });
});
