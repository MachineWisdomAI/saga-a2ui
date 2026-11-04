import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LineCounter,
  Scalar,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
} from 'yaml';

// Reject executable workflow actions that are not pinned to an immutable
// revision. Every `uses` entry of a step, job (reusable workflow) or composite
// action in `.github/workflows` and `.github/actions` must be a
// repository-owned local path (forward-slash `./...` with no `..` segment and
// no backslash, which is a path separator on Windows runners), a Docker image
// with a `@sha256:` digest, or a repository action pinned to a full
// 40-character commit SHA. Branch and tag references, including major-version
// tags, can move after review and are rejected.
//
// The files are read by the maintained `yaml` package (YAML 1.2). The checker
// walks its node tree, so scalar styles, flow and JSON collections, explicit
// keys, anchors, tags, comments, block-scalar text and multiple documents are
// the parser's business, not this file's. Duplicate keys are all kept and all
// checked.
//
// Only executable locations are enforced: a `uses` key that is a direct child
// of a step, of a job under `jobs`, or of `runs`, or of the mapping at the root
// of a document (the same walk covers a bare fragment). A key named `uses`
// anywhere else, such as a `with:` input or an `env:` variable, is data.
//
// The checker fails closed where it cannot see the executable structure
// statically: a `uses` value that is not one literal string (an alias, a block
// scalar, a collection, a number, or nothing); an alias or a merge key (`<<`)
// where a step, job, `steps`, `jobs` or `runs` node or key is expected; and
// any text the parser reports as an error or a warning. A merge key is refused
// in every spelling (`<<`, `'<<'`, and the explicitly tagged `!!merge <<` and
// `!<tag:yaml.org,2002:merge> <<`), and so is any other mapping key of an
// executable node that is not a string scalar (a number, null, a collection).
//
// Scope: this proves the policy against a YAML 1.2 reading of the files. It
// does not claim identical behavior to the YAML reader GitHub Actions runs; a
// construct outside the shapes above that the two readers treat differently is
// not examined. Strictness comes from rejecting anything unusual, not from
// parser equivalence.

export const FULL_SHA = /^[0-9a-f]{40}$/;
export const DOCKER_DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const SCOPES = ['.github/workflows/', '.github/actions/'];
const SUFFIXES = ['.yml', '.yaml'];
const NOT_LITERAL =
  '`uses` has no single literal action reference (alias, block scalar, collection, non-string or empty)';

/** Return why `ref` is not immutable, or null when it is acceptable. */
export function violation(ref) {
  if (!ref) return 'has no action reference';
  // A backslash is a directory separator on a Windows runner, which joins a
  // local path to the workspace without a containment check. The documented
  // local form is forward-slash only, so no reference may carry one.
  if (ref.includes('\\'))
    return 'contains a backslash, which is a path separator on Windows runners';
  if (ref.startsWith('./'))
    return ref.split('/').includes('..')
      ? "is a local path that leaves the repository-owned './' form"
      : null;
  if (ref.startsWith('docker://'))
    return DOCKER_DIGEST.test(ref)
      ? null
      : 'uses a Docker image without a @sha256 digest';
  const at = ref.lastIndexOf('@');
  if (at <= 0) return 'has no pinned revision';
  const revision = ref.slice(at + 1);
  return FULL_SHA.test(revision)
    ? null
    : `uses mutable revision '${revision}' instead of a full 40-character commit SHA`;
}

// A key explicitly tagged `!!merge` (any spelling of the tag) is read by the
// parser as a symbol, not the string `<<`, so a string comparison misses it.
const isMergeSymbol = (key) => isScalar(key) && typeof key.value === 'symbol';

/** Return a mapping key's comparable name, or null when it is not a string scalar. */
function keyName(key) {
  return isScalar(key) && typeof key.value === 'string'
    ? key.value.trim().toLowerCase()
    : null;
}

/**
 * Yield { line, ref, reason } for each unpinned or unverifiable reference in
 * `text`. `name` is only used in messages by callers.
 */
export function scan(name, text) {
  const lineCounter = new LineCounter();
  const results = [];
  const lineOf = (node, fallback = 1) => {
    const offset = node?.range?.[0];
    return offset === undefined ? fallback : lineCounter.linePos(offset).line;
  };
  const report = (line, ref, reason) => results.push({ line, ref, reason });

  function checkReference(value, line) {
    const literal =
      isScalar(value) &&
      typeof value.value === 'string' &&
      value.value !== '' &&
      value.type !== Scalar.BLOCK_LITERAL &&
      value.type !== Scalar.BLOCK_FOLDED;
    if (!literal) return report(line, '', NOT_LITERAL);
    const reason = violation(value.value);
    if (reason) report(line, value.value, reason);
  }

  // Return the comparable name of an executable mapping's key, or null after
  // reporting a key the checker cannot read: an alias, a merge key in any
  // spelling (plain, quoted or explicitly tagged) or any other key that is not
  // a string scalar.
  function readKey(pair, node) {
    const line = lineOf(pair.key, lineOf(node));
    if (isAlias(pair.key)) {
      report(
        line,
        '',
        'uses an alias as a mapping key, which cannot be checked',
      );
      return null;
    }
    const key = keyName(pair.key);
    if (key === '<<' || isMergeSymbol(pair.key)) {
      report(line, '', 'uses a YAML merge key, which cannot be checked');
      return null;
    }
    if (key === null) {
      report(
        line,
        '',
        'uses a mapping key that is not a string, which cannot be checked',
      );
      return null;
    }
    return key;
  }

  // Walk the pairs of an executable mapping. `handlers` maps a lowercase key
  // to what to do with its value; `uses` always checks the reference.
  function walkMapping(node, handlers) {
    for (const pair of node.items) {
      const key = readKey(pair, node);
      if (key === 'uses') {
        checkReference(pair.value, lineOf(pair.key, lineOf(node)));
      } else if (key && handlers[key]) {
        handlers[key](pair.value);
      }
    }
  }

  const unreadable = (node, what) =>
    report(
      lineOf(node),
      '',
      `is an alias where ${what} are expected, which cannot be checked`,
    );

  function step(node) {
    if (isAlias(node)) return unreadable(node, 'steps');
    if (isMap(node)) walkMapping(node, {});
  }
  function steps(node) {
    if (isAlias(node)) return unreadable(node, 'steps');
    if (isSeq(node)) for (const item of node.items) step(item);
  }
  function job(node) {
    if (isAlias(node)) return unreadable(node, 'jobs');
    if (isMap(node)) walkMapping(node, { steps });
  }
  function jobs(node) {
    if (isAlias(node)) return unreadable(node, 'jobs');
    if (!isMap(node)) return;
    for (const pair of node.items) {
      readKey(pair, node);
      job(pair.value);
    }
  }
  function runs(node) {
    if (isAlias(node)) return unreadable(node, 'steps');
    if (isMap(node)) walkMapping(node, { steps });
  }
  function root(node) {
    if (isSeq(node)) return steps(node);
    if (isMap(node)) walkMapping(node, { jobs, steps, runs });
  }

  for (const document of parseAllDocuments(text, {
    lineCounter,
    uniqueKeys: false,
  })) {
    // Anything the parser flags is outside what the walk can vouch for.
    for (const problem of [...document.errors, ...document.warnings])
      report(
        problem.linePos?.[0]?.line ?? 1,
        '',
        `could not be scanned conservatively: ${problem.code}: ${problem.message.split('\n')[0]}`,
      );
    if (document.errors.length === 0) root(document.contents);
  }
  return results.sort((a, b) => a.line - b.line);
}

export function trackedWorkflowFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--', '.github'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(
      (name) =>
        SCOPES.some((scope) => name.startsWith(scope)) &&
        SUFFIXES.some((suffix) => name.endsWith(suffix)),
    )
    .sort();
}

export function check(root) {
  const problems = [];
  const names = trackedWorkflowFiles(root);
  for (const name of names)
    for (const { line, ref, reason } of scan(
      name,
      readFileSync(path.join(root, name), 'utf8'),
    ))
      problems.push(`${name}:${line}: ${ref ? `'${ref}' ` : ''}${reason}`);
  return { names, problems };
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const { names, problems } = check(root);
  if (problems.length > 0) {
    console.error(
      'Workflow actions must be pinned to a reviewed full commit SHA:',
    );
    for (const problem of problems) console.error(`  ${problem}`);
    return 1;
  }
  console.log(
    `All executable workflow actions in ${names.length} files are immutably pinned`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main();
