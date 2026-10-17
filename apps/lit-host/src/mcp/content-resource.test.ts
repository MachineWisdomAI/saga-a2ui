import { describe, expect, it } from 'vitest';
import { createContentPolicy, type ContentPolicy } from '../content/policy.js';
import { policyFromEmbedded } from '../content/embedded-policy.js';
import { EPISODE_VIEW_URI } from './episode.js';
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
  it('keeps the base identity and declares no domains for the default policy', () => {
    const resource = contentResource(VIEW, policyWith());
    expect(resource.uri).toBe(EPISODE_VIEW_URI);
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
    expect(a).toMatch(/^ui:\/\/saga-a2ui\/episode-view-[0-9a-f]{12}\.html$/);
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
    expect(uris[0]).toBe(EPISODE_VIEW_URI);
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
