import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractSnippets, templateDirectory, writeSnippets } from './starter-template.js';

// The attach-to-an-existing-backend snippets, cut from the maintained and tested starter template.
// The guides and the CLI take their server and view snippets from here instead of retyping them.
//
//   npx tsx scripts/starter-snippets.ts                  # list the snippets and the template file each comes from
//   npx tsx scripts/starter-snippets.ts --out DIR        # write <name>.ts for each into a new directory
//
// Choose another template with `--template NAME` (default `lit-node`).

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const template = templateDirectory(option(argv, '--template') ?? 'lit-node');
  const out = option(argv, '--out');
  if (out === undefined) {
    for (const snippet of extractSnippets(template)) console.log(`${snippet.name}\t${snippet.file}`);
  } else {
    for (const file of writeSnippets(template, out)) console.log(file);
  }
}
