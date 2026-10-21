import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './packed-consumer.js';
import { QUALIFIED_STARTERS } from './qualified-starters.js';
import { SUPPORTED_PAIRS } from './saga.js';
import {
  extractSnippets,
  readTemplateMetadata,
  templateDirectory,
  templateFiles,
} from './starter-template.js';

// The attach-to-an-existing-backend recipes (GUIDE1), rendered from the maintained templates that CI
// qualifies. Nothing here retypes a snippet: each one is the template's own lines, cut by
// `extractSnippets`, so a recipe cannot differ from the tested file it came from. A template joins
// the document by joining `QUALIFIED_STARTERS`; until the document is regenerated,
// `scripts/guide.test.ts` fails, so a newly qualified server cannot be left out.
//
//   npm run guide:recipes             # writes docs/attach-to-existing-backend.md
//   npm run guide:recipes -- --check  # exits 1 when the written file is not what the templates render

export const RECIPES_FILE = 'docs/attach-to-existing-backend.md';

/**
 * The server targets the application-setup design requires. Plain data: the target is covered when a
 * qualified template declares it, and is listed as without a recipe until then.
 */
export const REQUIRED_SERVERS = [
  'node',
  'express',
  'hono',
  'fastify',
  'hapi',
] as const;

const OPEN_WORK: Readonly<Record<string, string>> = {};

const SNIPPET_TITLES: Readonly<Record<string, string>> = {
  'identity-handoff': 'Hand the verified identity to the transport',
  'register-protected-operation': 'Register a protected operation',
  'bind-action': 'Attach an action to a rendered control',
};

const SNIPPET_ORDER = [
  'identity-handoff',
  'register-protected-operation',
  'bind-action',
];

/** Removes the indentation every non-blank line shares, so a snippet cut from a nested position reads from the margin. */
export function dedent(text: string): string {
  const lines = text.split('\n');
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => /^ */.exec(line)?.[0].length ?? 0);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return lines
    .map((line) =>
      line.slice(Math.min(common, /^ */.exec(line)?.[0].length ?? 0)),
    )
    .join('\n');
}

const GLUE_NOT_SHOWN = new Set([
  'server/listener.ts',
  'server/main.ts',
  'server/operations.ts',
]);

function pairTable(): string {
  const rows = QUALIFIED_STARTERS.map((name) => {
    const metadata = readTemplateMetadata(templateDirectory(name));
    const offered = SUPPORTED_PAIRS.some(
      (pair) =>
        pair.stack === metadata.stack &&
        pair.server === metadata.server &&
        pair.template === name,
    );
    return `| \`${metadata.stack}\` | \`${metadata.server}\` | [\`${name}\`](../templates/${name}/) | ${offered ? 'offered' : 'not offered'} |`;
  });
  return [
    '| Stack | Server | Maintained template | `saga init` |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function uncoveredList(): string {
  const covered = new Set(
    QUALIFIED_STARTERS.map(
      (name) => readTemplateMetadata(templateDirectory(name)).server,
    ),
  );
  const uncovered = REQUIRED_SERVERS.filter((server) => !covered.has(server));
  if (uncovered.length === 0)
    return 'Every required server target has a qualified template above.';
  return uncovered
    .map(
      (server) =>
        `- \`${server}\`: ${OPEN_WORK[server] ?? 'It has no qualified template yet.'}`,
    )
    .join('\n');
}

function recipe(name: string): string {
  const template = templateDirectory(name);
  const metadata = readTemplateMetadata(template);
  const snippets = extractSnippets(template);
  const declared = [...metadata.snippets].sort(
    (a, b) => SNIPPET_ORDER.indexOf(a) - SNIPPET_ORDER.indexOf(b),
  );
  const glue = templateFiles(template).filter(
    (file) => file.startsWith('server/') && !GLUE_NOT_SHOWN.has(file),
  );
  const parts = [
    `<!-- recipe:${name} -->`,
    `## \`${metadata.server}\` with \`${metadata.stack}\``,
    '',
    `Template: [\`templates/${name}\`](../templates/${name}/). Server adapter: \`${metadata.serverAdapter.package}\` ${metadata.serverAdapter.version}. SDK packages: ${metadata.sdkPackages.map((one) => `\`@saga-a2ui/${one}\``).join(', ')}.`,
    '',
    `The snippets below call the starter's own application files, which you read in the template (or in a project \`saga init\` created) and adapt: ${glue.map((file) => `\`${file}\``).join(', ')}. \`server/verifier.ts\` and \`server/authorization.ts\` are where your identity provider and your policy go; the starter ships neither.`,
  ];
  for (const snippetName of declared) {
    const snippet = snippets.find((one) => one.name === snippetName);
    if (snippet === undefined)
      throw new Error(
        `${name} declares the snippet ${snippetName}, which the template does not contain.`,
      );
    parts.push(
      '',
      `### ${SNIPPET_TITLES[snippetName] ?? snippetName}`,
      '',
      `From \`templates/${name}/${snippet.file}\`:`,
      '',
      '```ts',
      dedent(snippet.text),
      '```',
    );
  }
  parts.push(`<!-- /recipe:${name} -->`);
  return parts.join('\n');
}

/** The whole recipes document, from the templates as they are now. */
export function renderRecipes(): string {
  return [
    '# Attach SAGA to an existing backend',
    '',
    '<!-- Generated by scripts/guide-recipes.ts from templates/*. Do not edit; run `npm run guide:recipes`. -->',
    '',
    'This document is generated. Each snippet is the maintained starter template\u2019s own text, cut from the files CI builds and qualifies, so it cannot drift from a tested file. The [setup guide](getting-started.md) explains the concepts and the order to read them in.',
    '',
    'Attaching SAGA to a backend you already run is an integration you make in your own source. No command edits an existing application: `saga init` creates one new directory and nothing else. The four React/MCP packages are [published on npm](public-install.md). These Lit-based snippets also need the unpublished `@saga-a2ui/lit` package, so install their matched packages from a local candidate (see [Install the packages from a candidate](getting-started.md#install-the-packages-from-a-candidate)).',
    '',
    '## Which pairs have a recipe',
    '',
    '<!-- pairs -->',
    pairTable(),
    '<!-- /pairs -->',
    '',
    'A pair is listed only while CI qualifies it, and a qualified pair is not automatically offered by `saga init`: that command offers the pairs in its own list. A recipe is not a claim about any other pair, and no full matrix is claimed.',
    '',
    '### Required servers without a recipe yet',
    '',
    '<!-- uncovered -->',
    uncoveredList(),
    '<!-- /uncovered -->',
    '',
    '## The steps, whichever server you use',
    '',
    '1. Install the SDK packages the recipe lists from one candidate, together, and keep the `@a2ui/markdown-it` override in your root `package.json`.',
    '2. Decide who is asking. Your application authenticates the request (`server/verifier.ts` is the seam for your identity provider) and gives SAGA the result only through the transport\u2019s per-request auth, as in the identity handoff below. A protected operation that receives no verified identity does not run; a declared public operation needs none and is given none.',
    '3. Register the operations your backend exposes. The handler makes your own authorization decision for that request\u2019s identity, and the projection copies the public fields out of the record by name.',
    '4. Build the view with your own catalog and serve it as the operation\u2019s view resource, as the starter does. The view\u2019s address is derived from its bytes, so rebuild the view and restart the server together.',
    '5. Attach each action to the rendered control it belongs to. The layout names no action; the attachment is application code.',
    '',
    'CI qualifies the starter\u2019s listener and operations against real MCP clients. That qualification belongs to the starter: attaching the same lines to your application does not inherit it. Test your own authentication, authorization and refusal paths in your application.',
    '',
    ...QUALIFIED_STARTERS.flatMap((name) => [recipe(name), '']),
  ]
    .join('\n')
    .replace(/\n+$/, '\n');
}

export type RecipesCheck =
  | { readonly current: true }
  | { readonly current: false; readonly message: string };

/** Compares a written recipes file with what the templates render now. */
export function checkRecipes(file: string): RecipesCheck {
  const written = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : undefined;
  if (written === renderRecipes()) return { current: true };
  return {
    current: false,
    message: `${path.relative(repoRoot, file)} is ${written === undefined ? 'missing' : 'not what the qualified templates render now'}. Run \`npm run guide:recipes\` and commit the result.`,
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const file = path.join(repoRoot, RECIPES_FILE);
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') {
    const result = checkRecipes(file);
    if (!result.current) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = 1;
    }
  } else if (args.length === 0) {
    fs.writeFileSync(file, renderRecipes());
    process.stdout.write(`${RECIPES_FILE}\n`);
  } else {
    process.stderr.write('Usage: guide-recipes.ts [--check]\n');
    process.exitCode = 2;
  }
}
