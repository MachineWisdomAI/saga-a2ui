import { readFile, readdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// The browser artifacts must contain no server code and no credentials.
const FORBIDDEN = [
  'StreamableHTTPServerTransport', // MCP server transport
  'node:http',
  'createEpisodeServer',
  'createSubscriptionsServer',
  'createDevelopmentVerifier',
  'dev-only-token',
  'process.env',
  'Authorization',
  'Bearer ',
];

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
  const html = await readFile(new URL('../dist/view/view.html', import.meta.url), 'utf8');
  expect(html).not.toMatch(/<script[^>]+\bsrc=/); // no external script
  expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  for (const marker of FORBIDDEN) expect(html, marker).not.toContain(marker);
});

test('the Lit application and host-fixture bundles contain no server code or credentials', async () => {
  const files = (await builtFiles(new URL('../dist/', import.meta.url))).filter((path) => /\.(js|html)$/.test(path));
  expect(files.length).toBeGreaterThan(0);
  for (const path of files) {
    const text = await readFile(path, 'utf8');
    for (const marker of FORBIDDEN) expect(text, `${path} contains ${marker}`).not.toContain(marker);
  }
});
