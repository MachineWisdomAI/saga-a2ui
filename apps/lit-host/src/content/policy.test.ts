import { describe, expect, it } from 'vitest';
import { createContentPolicy, establishImageEnforcement, type ContentPolicy } from './policy.js';

// The trusted policy is exercised only through its public interface: construction from
// unchecked configuration, link and image decisions, and the derived resource restrictions.

function policyWith(imageHosts: readonly string[] = []): ContentPolicy {
  const created = createContentPolicy({ level: 'standard', imageHosts });
  if (!created.ok) throw new Error(`unexpected configuration failure: ${created.failure.message}`);
  return created.policy;
}

describe('creating a content policy', () => {
  it('defaults to Standard with an empty image allowlist', () => {
    const created = createContentPolicy({});
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.policy.level).toBe('standard');
    expect(created.policy.imageHosts).toEqual([]);
    expect(created.policy.resource.imageOrigins).toEqual([]);
  });

  it('accepts exact lowercase hosts and returns them sorted without duplicates', () => {
    const policy = policyWith(['images.example.com', 'cdn.example.org', 'images.example.com']);
    expect(policy.imageHosts).toEqual(['cdn.example.org', 'images.example.com']);
  });

  it.each([
    ['a wildcard', '*.example.com'],
    ['a bare wildcard', '*'],
    ['a scheme', 'https://images.example.com'],
    ['a path', 'images.example.com/a'],
    ['a port', 'images.example.com:8443'],
    ['credentials', 'user:pw@images.example.com'],
    ['an uppercase host', 'Images.Example.com'],
    ['a trailing dot', 'images.example.com.'],
    ['surrounding whitespace', ' images.example.com'],
    ['an empty string', ''],
    ['a query', 'images.example.com?x=1'],
    ['a non-ASCII host that is not in canonical form', 'bücher.example'],
  ])('rejects %s in the image allowlist', (_name, host) => {
    const created = createContentPolicy({ imageHosts: [host] });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.failure.kind).toBe('invalid-image-host');
  });

  it.each([
    ['an unsupported level', { level: 'strict' }],
    ['an unknown level', { level: 'permissive' }],
    ['a non-object', 'standard'],
    ['an unknown setting', { imageHosts: [], allowAllImages: true }],
    ['a non-array allowlist', { imageHosts: 'images.example.com' }],
    ['a non-string host', { imageHosts: [42] }],
  ])('rejects %s instead of guessing a looser policy', (_name, config) => {
    const created = createContentPolicy(config);
    expect(created.ok).toBe(false);
  });

  it('rejects an allowlist longer than the finite bound', () => {
    const hosts = Array.from({ length: 33 }, (_unused, index) => `h${index}.example.com`);
    const created = createContentPolicy({ imageHosts: hosts });
    expect(created.ok).toBe(false);
  });

  it('is immutable once created', () => {
    const policy = policyWith(['images.example.com']);
    expect(() => (policy.imageHosts as string[]).push('evil.example')).toThrow(TypeError);
    expect(() => (policy.resource.imageOrigins as string[]).push('https://evil.example')).toThrow(TypeError);
    expect(policy.decideImage('https://evil.example/x.png', 'established').allowed).toBe(false);
  });
});

describe('link decisions', () => {
  const policy = policyWith();

  it('allows an absolute HTTPS destination and reports its parsed hostname', () => {
    const decision = policy.decideLink('https://Docs.Example.com/guide?a=1#top');
    expect(decision).toEqual({
      allowed: true,
      url: 'https://docs.example.com/guide?a=1#top',
      hostname: 'docs.example.com',
    });
  });

  it('reports an internationalized hostname in its ASCII form', () => {
    const decision = policy.decideLink('https://bücher.example/');
    expect(decision).toMatchObject({ allowed: true, hostname: 'xn--bcher-kva.example' });
  });

  it.each([
    ['plain HTTP', 'http://example.com/', 'not-https'],
    ['a script URL', 'javascript:alert(1)', 'not-https'],
    ['a data URL', 'data:text/html,hi', 'not-https'],
    ['a relative path', '/relative', 'malformed'],
    ['a protocol-relative URL', '//example.com/', 'malformed'],
    ['an empty destination', '', 'malformed'],
    ['text that is not a URL', 'not a url', 'malformed'],
    ['embedded credentials', 'https://user:pw@example.com/', 'credentials'],
    ['a username only', 'https://user@example.com/', 'credentials'],
  ])('refuses %s', (_name, destination, reason) => {
    expect(policy.decideLink(destination)).toEqual({ allowed: false, reason });
  });
});

describe('image decisions', () => {
  const policy = policyWith(['images.example.com']);

  it('allows an HTTPS image from an exactly listed host once enforcement is established', () => {
    expect(policy.decideImage('https://images.example.com/a/b.png?x=1', 'established')).toEqual({
      allowed: true,
      url: 'https://images.example.com/a/b.png?x=1',
    });
  });

  it('keeps every image inert when enforcement is not established, even from a listed host', () => {
    expect(policy.decideImage('https://images.example.com/a.png', 'unestablished')).toEqual({
      allowed: false,
      reason: 'enforcement-unestablished',
    });
  });

  it('allows no image under the default empty allowlist', () => {
    const empty = policyWith();
    expect(empty.decideImage('https://images.example.com/a.png', 'established')).toEqual({
      allowed: false,
      reason: 'host-not-allowed',
    });
  });

  it.each([
    ['a subdomain that is not listed', 'https://a.images.example.com/x.png'],
    ['a parent domain', 'https://example.com/x.png'],
    ['a suffix trick', 'https://images.example.com.evil.test/x.png'],
    ['a prefix trick', 'https://evilimages.example.com/x.png'],
    ['the listed host used as userinfo', 'https://images.example.com@evil.test/x.png'],
    ['the listed host in the path of another host', 'https://evil.test/images.example.com/x.png'],
    ['a non-default port', 'https://images.example.com:8443/x.png'],
  ])('refuses %s', (_name, source) => {
    const decision = policy.decideImage(source, 'established');
    expect(decision.allowed).toBe(false);
  });

  it.each([
    ['plain HTTP', 'http://images.example.com/x.png', 'not-https'],
    ['credentials', 'https://user:pw@images.example.com/x.png', 'credentials'],
    ['malformed input', 'https://', 'malformed'],
    ['a data URL', 'data:image/png;base64,AAAA', 'not-https'],
    ['a relative path', 'x.png', 'malformed'],
  ])('refuses %s with a specific reason', (_name, source, reason) => {
    expect(policy.decideImage(source, 'established')).toEqual({ allowed: false, reason });
  });

  it('matches a host written in uppercase in the image URL', () => {
    expect(policy.decideImage('https://IMAGES.example.com/x.png', 'established')).toMatchObject({ allowed: true });
  });
});

describe('derived resource restrictions', () => {
  it('lists the exact HTTPS origins of the allowlist for images only', () => {
    const { resource } = policyWith(['images.example.com', 'cdn.example.org']);
    expect(resource.imageOrigins).toEqual(['https://cdn.example.org', 'https://images.example.com']);
    expect(directive(resource.contentSecurityPolicy, 'img-src')).toBe(
      'img-src https://cdn.example.org https://images.example.com',
    );
  });

  it('blocks images outright under the empty allowlist', () => {
    const { resource } = policyWith();
    expect(directive(resource.contentSecurityPolicy, 'img-src')).toBe("img-src 'none'");
  });

  it('grants no host to scripts, styles, fonts, media, connections, frames or objects', () => {
    const { resource } = policyWith(['images.example.com']);
    const policy = resource.contentSecurityPolicy;
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
    expect(directive(policy, 'script-src')).toBe("script-src 'unsafe-inline'");
    expect(directive(policy, 'style-src')).toBe("style-src 'unsafe-inline'");
    for (const name of ['font-src', 'media-src', 'connect-src', 'frame-src', 'object-src']) {
      expect(directive(policy, name)).toBe(`${name} 'none'`);
    }
    const others = policy.split(';').filter((part) => !part.trim().startsWith('img-src'));
    expect(others.join(';')).not.toContain('example.com');
  });

  it('is identical for equal configuration and different when the allowlist differs', () => {
    const a = policyWith(['images.example.com']).resource;
    const b = policyWith(['images.example.com']).resource;
    const c = policyWith(['cdn.example.org']).resource;
    expect(a).toEqual(b);
    expect(a.contentSecurityPolicy).not.toBe(c.contentSecurityPolicy);
  });
});

describe('establishing image enforcement', () => {
  const policy = policyWith(['images.example.com']);

  it('is established when the document carries exactly the policy-derived restrictions', () => {
    expect(establishImageEnforcement(policy, [policy.resource.contentSecurityPolicy])).toBe('established');
  });

  it('is not established when no restriction is present', () => {
    expect(establishImageEnforcement(policy, [])).toBe('unestablished');
  });

  it('is not established when the document carries a different policy', () => {
    expect(establishImageEnforcement(policy, ["default-src 'none'; img-src https://other.example"])).toBe('unestablished');
  });
});

function directive(policy: string, name: string): string | undefined {
  return policy.split(';').map((part) => part.trim()).find((part) => part === name || part.startsWith(`${name} `));
}
