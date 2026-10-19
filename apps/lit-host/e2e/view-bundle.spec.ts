import { readFile, readdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { builtUrl } from './built-artifacts.js';

// The browser artifacts must contain no server code and no credentials.
const FORBIDDEN = [
  'StreamableHTTPServerTransport', // MCP server transport (v1 name)
  'NodeStreamableHTTPServerTransport', // MCP server transport
  'StreamableHTTPClientTransport', // the HTTP client: the view talks to its host over postMessage only
  'node:http',
  'createEpisodeServer',
  'createSubscriptionsServer',
  'createAnswerServer',
  'registerPublicOperation',
  'registerProtectedOperation',
  'createDevelopmentVerifier',
  'dev-only-token',
  'process.env',
  'Bearer ',
];

// The credential header, matched as a quoted name rather than a substring. MCP Apps builds on
// `@modelcontextprotocol/client`, whose OAuth error classes (for example
// `AuthorizationServerMismatchError`) are bundled with the view and contain the word. Nothing in
// the view sets the header.
const FORBIDDEN_PATTERNS = [/["'`]authorization["'`]/i];

function violations(text: string, extra: readonly string[] = []): string[] {
  return [
    ...[...FORBIDDEN, ...extra].filter((marker) => text.includes(marker)),
    ...FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(text)).map(String),
  ];
}

async function builtFiles(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? builtFiles(new URL(`${entry.name}/`, directory))
        : Promise.resolve([new URL(entry.name, directory).pathname]),
    ),
  );
  return nested.flat();
}

test('the view HTML is one self-contained document without server code or credentials', async () => {
  const html = await readFile(builtUrl('view/view.html'), 'utf8');
  expect(html).not.toMatch(/<script[^>]+\bsrc=/); // no external script
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  expect(violations(html)).toEqual([]);
});

test('the Lit application and host-fixture bundles contain no server code or credentials', async () => {
  const files = (await builtFiles(builtUrl(''))).filter((path) => /\.(js|html)$/.test(path));
  expect(files.length).toBeGreaterThan(0);
  for (const path of files) {
    const text = await readFile(path, 'utf8');
    expect(violations(text), path).toEqual([]);
  }
});

test('the answer view is one self-contained document without server code or credentials', async () => {
  const html = await readFile(builtUrl('answer-view/answer.html'), 'utf8');
  expect(html).not.toMatch(/<script[^>]+\bsrc=/); // no external script
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  expect(violations(html, ['createAnswerServer', 'AnswerBackend'])).toEqual([]);
  // It renders through the SDK's Lit binding with its own catalog, and carries nothing of the
  // panel catalog, its Markdown policy or any optional component.
  expect(html).toContain('answer-card');
  expect(html).not.toMatch(/saga-panel|saga-description|FaithfulCard|html_block/); // html_block: markdown-it rule
});

test('the player view is one self-contained document with no server code, credential or per-user value', async () => {
  const html = await readFile(builtUrl('playback-view/playback.html'), 'utf8');
  expect(html).not.toMatch(/<script[^>]+\bsrc=/); // no external script
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  // Bytes are decoded in script, never given to a media element: the document has none, and nothing
  // constructs one. (The optional description card brings the upstream A2UI Lit renderer along, whose
  // unused media components contain `<audio` and `<video` template text, so the check is on the
  // document's markup and on construction rather than on every character of the script.)
  expect(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')).not.toMatch(/<audio|<video|<source/i);
  expect(html).not.toMatch(/new Audio\(|createElement\(["'`](?:audio|video|source)["'`]\)/);
  expect(violations(html, ['createPlaybackServer', 'createMediaService', 'node:crypto', 'playback:play'])).toEqual([]);
  // The only thing signed in the view is a proof, and its key is generated at run time.
  expect(html).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
});
