import { expect, test, type Page } from '@playwright/test';
import {
  contentPolicyFromEmbedded,
  createContentPolicy,
  embedContentPolicy,
  type ContentPolicy,
} from '@saga-a2ui/components/faithful-card';

// The served document, as a browser parses it. `embedContentPolicy` is a string operation, so the
// claim that matters is what the parser makes of its output: the charset declaration first, then
// the policy-derived Content-Security-Policy, then the configuration, then every script of the
// application, and a configuration value that spells a closing tag stays text.

const VIEW =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>view</title>' +
  '<script>window.applicationScriptRan = true;</script></head><body><p id="app">view</p>' +
  '<script>window.laterScriptRan = true;</script></body></html>';

// An image source that would run script if the parser ever saw it as markup.
const HOSTILE =
  '</script><img id="injected" src="x" onerror="window.injectedCodeRan = true">';

function strictPolicy(): ContentPolicy {
  const created = createContentPolicy({
    level: 'strict',
    blockedPresentation: 'inert-text',
    imageHosts: ['images.example.com'],
    fontOrigins: ['https://fonts.example.com'],
  });
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
}

/** A policy value only a hostile or broken producer could hold: the serializer must still keep it inert. */
function hostilePolicy(): ContentPolicy {
  return {
    ...strictPolicy(),
    configuration: {
      level: 'strict',
      blockedPresentation: 'inert-text',
      imageHosts: [HOSTILE],
      fontOrigins: [],
    },
  };
}

async function serve(page: Page, html: string): Promise<void> {
  await page.route('**/served-view.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto('/served-view.html');
}

test('the served document orders charset, restrictions and configuration before every script, and keeps a hostile value inert', async ({
  page,
}) => {
  const policy = hostilePolicy();
  await serve(page, embedContentPolicy(VIEW, policy));

  const headOrder = await page.evaluate(() =>
    [...document.head.children].map((element) => {
      if (element.localName === 'meta')
        return element.hasAttribute('charset')
          ? 'meta:charset'
          : `meta:${element.getAttribute('http-equiv')}`;
      if (element.localName === 'script')
        return element.id === '' ? 'script' : `script#${element.id}`;
      return element.localName;
    }),
  );
  expect(headOrder).toEqual([
    'meta:charset',
    'meta:Content-Security-Policy',
    'script#saga-content-policy',
    'title',
    'script',
  ]);

  const observed = await page.evaluate(() => {
    const configuration = document.getElementById('saga-content-policy');
    const meta = document.querySelector('meta[http-equiv]');
    return {
      configurationText: configuration?.textContent ?? null,
      cspContent: meta?.getAttribute('content') ?? null,
      injectedElements: document.querySelectorAll('#injected, img').length,
      scriptCount: document.scripts.length,
      applicationScriptRan: Reflect.get(window, 'applicationScriptRan'),
      laterScriptRan: Reflect.get(window, 'laterScriptRan'),
      injectedCodeRan: Reflect.get(window, 'injectedCodeRan'),
    };
  });
  // The configuration is one text node of the one element: no `<` survives, and decoding restores the value.
  expect(observed.configurationText).not.toContain('<');
  expect(JSON.parse(observed.configurationText ?? 'null')).toEqual(
    policy.configuration,
  );
  expect(observed.injectedElements).toBe(0);
  expect(observed.injectedCodeRan).toBeUndefined();
  expect(observed.scriptCount).toBe(3);
  // The restrictions are the policy's own, and still let the application's inline scripts run.
  expect(observed.cspContent).toBe(policy.resource.contentSecurityPolicy);
  expect(observed.applicationScriptRan).toBe(true);
  expect(observed.laterScriptRan).toBe(true);

  // What a view reads back from this document is refused rather than guessed, as it is a hostile host.
  const rebuilt = contentPolicyFromEmbedded(observed.configurationText);
  expect(!rebuilt.ok && rebuilt.failure.kind).toBe('invalid-image-host');
});

test('a real Strict policy survives the served document and rebuilds equal', async ({
  page,
}) => {
  const policy = strictPolicy();
  await serve(page, embedContentPolicy(VIEW, policy));
  const text = await page.evaluate(
    () => document.getElementById('saga-content-policy')?.textContent ?? null,
  );
  const rebuilt = contentPolicyFromEmbedded(text);
  expect(rebuilt.ok && rebuilt.policy.configuration).toEqual(
    policy.configuration,
  );
  expect(rebuilt.ok && rebuilt.policy.resource.contentSecurityPolicy).toBe(
    policy.resource.contentSecurityPolicy,
  );
});
