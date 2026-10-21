import { describe, expect, it } from 'vitest';
import { createContentPolicy, type ContentPolicy } from '@saga-a2ui/components/faithful-card';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import { policyFromEmbedded } from '../content/embedded-policy.js';
import { contentResource } from './content-resource.js';

// The resource a host receives is built from the policy and nothing else: its identity, its
// declared host metadata and the restrictions inside the document all come from one value.

const VIEW = '<!doctype html><html><head><meta charset="UTF-8" /><title>v</title></head><body><script>1</script></body></html>';

function policyWith(imageHosts: readonly string[] = []): ContentPolicy {
  const created = createContentPolicy({ imageHosts });
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
}

function embeddedJson(html: string): string | null {
  return /<script type="application\/json" id="saga-content-policy">([^<]*)<\/script>/.exec(html)?.[1] ?? null;
}

describe('the content-policy resource', () => {
  it('derives the identity of the default policy from the served document and declares no domains', () => {
    const resource = contentResource(VIEW, policyWith());
    expect(resource.uri).toBe(viewUriForHtml(resource.html, 'view.html'));
    expect(resource.uri).toMatch(/^ui:\/\/views\/view\.[0-9a-f]{32}\.html$/);
    expect(resource.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] });
  });

  it('declares the exact image origins as the only resource domains', () => {
    const resource = contentResource(VIEW, policyWith(['images.example.com']));
    expect(resource.csp).toEqual({
      connectDomains: [],
      resourceDomains: ['https://images.example.com'],
      frameDomains: [],
      baseUriDomains: [],
    });
  });

  it('gives each policy variant its own identity, and equal policies the same one', () => {
    const base = contentResource(VIEW, policyWith()).uri;
    const a = contentResource(VIEW, policyWith(['images.example.com'])).uri;
    const same = contentResource(VIEW, policyWith(['images.example.com'])).uri;
    const b = contentResource(VIEW, policyWith(['cdn.example.org'])).uri;
    expect(a).toBe(same);
    expect(new Set([base, a, b]).size).toBe(3);
    expect(a).toMatch(/^ui:\/\/views\/view\.[0-9a-f]{32}\.html$/);
  });

  it('puts the policy-derived restrictions in the document before any script', () => {
    const policy = policyWith(['images.example.com']);
    const { html } = contentResource(VIEW, policy);
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.resource.contentSecurityPolicy}">`;
    expect(html).toContain(meta);
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<script>'));
    expect(html.indexOf(meta)).toBeGreaterThan(html.indexOf('<head>'));
  });

  it('embeds the configuration so the view rebuilds the same policy', () => {
    const policy = policyWith(['images.example.com', 'cdn.example.org']);
    const rebuilt = policyFromEmbedded(embeddedJson(contentResource(VIEW, policy).html));
    expect(rebuilt.ok && rebuilt.policy.resource).toEqual(policy.resource);
  });

  it('does not change the rest of the view', () => {
    const { html } = contentResource(VIEW, policyWith());
    expect(html).toContain('<title>v</title></head><body><script>1</script></body></html>');
  });

  it('refuses a view that has no head to carry its restrictions', () => {
    expect(() => contentResource('<!doctype html><saga-app></saga-app>', policyWith())).toThrow(/head/);
  });
});

function configured(config: object): ContentPolicy {
  const created = createContentPolicy(config);
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
}

describe('the resource of a Strict policy', () => {
  const HOSTS = ['images.example.com'];

  it('declares exactly what Standard declares for the same hosts, so Show images can use only mount-time permissions', () => {
    const strict = contentResource(VIEW, configured({ level: 'strict', imageHosts: HOSTS }));
    const standard = contentResource(VIEW, configured({ level: 'standard', imageHosts: HOSTS }));
    expect(strict.csp).toEqual(standard.csp);
    expect(strict.csp.resourceDomains).toEqual(['https://images.example.com']);
  });

  it('never shares an identity with another policy variant, even when the declared metadata is equal', () => {
    // A cache keyed by URI must not hand a Strict view a Standard document, or the reverse.
    const uris = [
      configured({}),
      configured({ level: 'strict' }),
      configured({ level: 'strict', blockedPresentation: 'inert-text' }),
      configured({ imageHosts: HOSTS }),
      configured({ level: 'strict', imageHosts: HOSTS }),
      configured({ level: 'strict', imageHosts: HOSTS, blockedPresentation: 'inert-text' }),
    ].map((policy) => contentResource(VIEW, policy).uri);
    expect(new Set(uris).size).toBe(uris.length);
    expect(contentResource(VIEW, configured({ level: 'strict', imageHosts: HOSTS })).uri).toBe(uris[4]);
  });

  it('embeds the level and presentation so the view rebuilds the same Strict policy', () => {
    const policy = configured({ level: 'strict', imageHosts: HOSTS, blockedPresentation: 'inert-text' });
    const rebuilt = policyFromEmbedded(embeddedJson(contentResource(VIEW, policy).html));
    expect(rebuilt.ok && rebuilt.policy.configuration).toEqual(policy.configuration);
  });
});

describe('reading an embedded configuration', () => {
  it('falls back to the default Standard policy only when nothing is embedded', () => {
    const rebuilt = policyFromEmbedded(null);
    expect(rebuilt.ok && rebuilt.policy.imageHosts).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['a wildcard host', '{"level":"standard","imageHosts":["*.example.com"]}'],
    ['an unknown level', '{"level":"permissive","imageHosts":[]}'],
    ['a presentation on Standard', '{"level":"standard","imageHosts":[],"blockedPresentation":"placeholder"}'],
    ['an unknown presentation', '{"level":"strict","imageHosts":[],"blockedPresentation":"collapsed"}'],
  ])('fails explicitly for %s instead of guessing a policy', (_name, text) => {
    expect(policyFromEmbedded(text).ok).toBe(false);
  });
});

describe('the resource of a policy with trusted font origins', () => {
  const FONTS = ['https://fonts.example.com', 'https://assets.example.org:8443'];

  it('declares font origins beside image origins, once each, and nothing else', () => {
    const resource = contentResource(VIEW, configured({ imageHosts: ['images.example.com'], fontOrigins: FONTS }));
    expect(resource.csp).toEqual({
      connectDomains: [],
      resourceDomains: ['https://assets.example.org:8443', 'https://fonts.example.com', 'https://images.example.com'],
      frameDomains: [],
      baseUriDomains: [],
    });
    const shared = contentResource(
      VIEW,
      configured({ imageHosts: ['cdn.example.com'], fontOrigins: ['https://cdn.example.com'] }),
    );
    expect(shared.csp.resourceDomains).toEqual(['https://cdn.example.com']);
  });

  it('declares nothing for the embedded baseline: a Strict and a Standard policy without origins declare no domains', () => {
    expect(contentResource(VIEW, configured({})).csp.resourceDomains).toEqual([]);
    expect(contentResource(VIEW, configured({ level: 'strict' })).csp.resourceDomains).toEqual([]);
  });

  it('gives a font-origin variant its own identity, even when its declared domains equal an image-host variant', () => {
    const base = contentResource(VIEW, configured({})).uri;
    const fonts = contentResource(VIEW, configured({ fontOrigins: ['https://cdn.example.com'] }));
    const images = contentResource(VIEW, configured({ imageHosts: ['cdn.example.com'] }));
    expect(fonts.csp).toEqual(images.csp);
    expect(new Set([base, fonts.uri, images.uri]).size).toBe(3);
    expect(contentResource(VIEW, configured({ fontOrigins: ['https://cdn.example.com:443'] })).uri).toBe(fonts.uri);
  });

  it('embeds the font origins so the view rebuilds the same policy, in either level', () => {
    for (const level of ['standard', 'strict']) {
      const policy = configured({ level, imageHosts: ['images.example.com'], fontOrigins: FONTS });
      const rebuilt = policyFromEmbedded(embeddedJson(contentResource(VIEW, policy).html));
      expect(rebuilt.ok && rebuilt.policy.configuration).toEqual(policy.configuration);
      expect(rebuilt.ok && rebuilt.policy.resource.contentSecurityPolicy).toBe(policy.resource.contentSecurityPolicy);
    }
  });

  it.each([
    ['a wildcard origin', '{"level":"standard","imageHosts":[],"fontOrigins":["https://*.example.com"]}'],
    ['a plain HTTP origin', '{"level":"standard","imageHosts":[],"fontOrigins":["http://fonts.example.com"]}'],
    ['an origin with a path', '{"level":"strict","imageHosts":[],"fontOrigins":["https://fonts.example.com/css"]}'],
    ['an origin that would start a new directive', '{"level":"standard","fontOrigins":["https://fonts.example.com;script-src"]}'],
  ])('fails explicitly for an embedded configuration with %s', (_name, text) => {
    expect(policyFromEmbedded(text).ok).toBe(false);
  });
});

// The identity of the resource is the identity of the exact document it serves. The tests read the
// URI the resource actually carries, so they fail if it stops following the final bytes.
describe('identity of the self-contained resource', () => {
  const artworkPixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  const cardDocument = (parts: { artwork?: string; font?: string; css?: string; code?: string } = {}): string =>
    '<!doctype html><html><head><meta charset="UTF-8" />' +
    `<style>${parts.css ?? 'body{margin:0}'}@font-face{font-family:Card;src:url(data:font/woff2;base64,${parts.font ?? 'AAAA'})}</style>` +
    `</head><body><img alt="" src="data:image/png;base64,${parts.artwork ?? artworkPixel}"><script>${parts.code ?? '1'}</script></body></html>`;
  const identity = (html: string, policy: ContentPolicy = configured({})): string => contentResource(html, policy).uri;

  const POLICIES: readonly [string, ContentPolicy][] = [
    ['the default policy', configured({})],
    ['a Strict policy', configured({ level: 'strict' })],
    ['a font-origin policy', configured({ fontOrigins: ['https://fonts.example.com'] })],
    ['an image-host policy', configured({ imageHosts: ['images.example.com'] })],
  ];

  it('is the SDK byte identity of the served document, for every policy', () => {
    for (const [, policy] of POLICIES) {
      const resource = contentResource(cardDocument(), policy);
      expect(resource.uri).toBe(viewUriForHtml(resource.html, 'view.html'));
      expect(resource.uri).toBe(viewUriForHtml(Buffer.from(resource.html, 'utf8'), 'view.html'));
    }
  });

  it.each(POLICIES)('keeps the URI for equal bytes and changes it with the code, CSS, font or artwork under %s', (_name, policy) => {
    const base = identity(cardDocument(), policy);
    expect(identity(cardDocument(), policy)).toBe(base);
    const changed = [
      identity(cardDocument({ code: '2' }), policy),
      identity(cardDocument({ css: 'body{margin:1px}' }), policy),
      identity(cardDocument({ font: 'BBBB' }), policy),
      identity(cardDocument({ artwork: `${artworkPixel.slice(0, -4)}AAAA` }), policy),
      identity(cardDocument({ code: '2', css: 'body{margin:1px}' }), policy),
    ];
    expect(new Set([base, ...changed]).size).toBe(changed.length + 1);
  });

  it('changes with the policy bytes for the same application document', () => {
    const uris = POLICIES.map(([, policy]) => identity(cardDocument(), policy));
    expect(new Set(uris).size).toBe(uris.length);
    expect(identity(cardDocument(), configured({ fontOrigins: ['https://fonts.example.com:443'] }))).toBe(uris[2]);
  });

  it('does not depend on the answer: only the document bytes name the resource', () => {
    // Two resources built from the same bytes are the same resource, however often it is built.
    const first = contentResource(cardDocument(), configured({}));
    const second = contentResource(cardDocument(), configured({}));
    expect(second).toEqual(first);
  });
});
