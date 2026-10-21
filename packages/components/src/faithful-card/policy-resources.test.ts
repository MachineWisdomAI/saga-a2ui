import { describe, expect, it } from 'vitest';
import {
  createContentPolicy,
  establishImageEnforcement,
  type ContentPolicy,
  type ImageContext,
} from './policy.js';

// The trusted resource permissions of the policy: the image and font source lists the document's
// Content-Security-Policy carries, and the separate trusted exact-origin font allowlist. Everything
// is observed through the public policy interface.

const ESTABLISHED: ImageContext = {
  enforcement: 'established',
  consent: 'not-granted',
};

function policyOf(config: object): ContentPolicy {
  const created = createContentPolicy(config);
  if (!created.ok)
    throw new Error(
      `unexpected configuration failure: ${created.failure.message}`,
    );
  return created.policy;
}

/** The directives named `name` in a policy: a policy must carry exactly one. */
function directives(policy: string, name: string): string[] {
  return policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part === name || part.startsWith(`${name} `));
}

const sourceList = (
  policy: ContentPolicy,
  name: 'img-src' | 'font-src',
): string => {
  const found = directives(policy.resource.contentSecurityPolicy, name);
  expect(found).toHaveLength(1);
  return found[0] as string;
};

describe('image sources', () => {
  it.each([
    ['standard', 'img-src data: blob:'],
    ['strict', 'img-src data:'],
  ])(
    '%s with an empty host list carries only its baseline schemes, never none',
    (level, expected) => {
      const policy = policyOf({ level });
      expect(sourceList(policy, 'img-src')).toBe(expected);
      expect(policy.resource.contentSecurityPolicy).not.toContain(
        "img-src 'none'",
      );
    },
  );

  it.each([
    [
      'standard',
      'one host',
      ['images.example.com'],
      'img-src data: blob: https://images.example.com',
    ],
    [
      'standard',
      'several hosts',
      ['b.example.com', 'a.example.com'],
      'img-src data: blob: https://a.example.com https://b.example.com',
    ],
    [
      'strict',
      'one host',
      ['images.example.com'],
      'img-src data: https://images.example.com',
    ],
    [
      'strict',
      'several hosts',
      ['b.example.com', 'a.example.com'],
      'img-src data: https://a.example.com https://b.example.com',
    ],
  ])(
    '%s with %s extends the baseline instead of replacing it',
    (level, _name, imageHosts, expected) => {
      expect(sourceList(policyOf({ level, imageHosts }), 'img-src')).toBe(
        expected,
      );
    },
  );

  it('adds no embedded-asset opt-in setting', () => {
    for (const setting of [
      'embeddedImages',
      'embeddedAssets',
      'allowDataImages',
      'allowBlobImages',
    ]) {
      expect(createContentPolicy({ [setting]: true }).ok).toBe(false);
    }
  });
});

describe('font sources and the trusted font origin allowlist', () => {
  it('defaults to an empty allowlist and the mode baseline', () => {
    const standard = policyOf({});
    expect(standard.fontOrigins).toEqual([]);
    expect(standard.resource.fontOrigins).toEqual([]);
    expect(sourceList(standard, 'font-src')).toBe('font-src data: blob:');
    expect(sourceList(policyOf({ level: 'strict' }), 'font-src')).toBe(
      'font-src data:',
    );
  });

  it.each([
    [
      'standard',
      'one origin',
      ['https://fonts.example.com'],
      'font-src data: blob: https://fonts.example.com',
    ],
    [
      'standard',
      'several origins',
      ['https://b.example.com', 'https://a.example.com:8443'],
      'font-src data: blob: https://a.example.com:8443 https://b.example.com',
    ],
    [
      'strict',
      'one origin',
      ['https://fonts.example.com'],
      'font-src data: https://fonts.example.com',
    ],
    [
      'strict',
      'several origins',
      ['https://b.example.com', 'https://a.example.com:8443'],
      'font-src data: https://a.example.com:8443 https://b.example.com',
    ],
  ])(
    '%s with %s extends the baseline instead of replacing it',
    (level, _name, fontOrigins, expected) => {
      expect(sourceList(policyOf({ level, fontOrigins }), 'font-src')).toBe(
        expected,
      );
    },
  );

  it('normalizes case and the default port, deduplicates, and sorts', () => {
    const policy = policyOf({
      fontOrigins: [
        'https://Fonts.Example.com:443',
        'https://fonts.example.com/',
        'https://a.example.com:8443',
      ],
    });
    expect(policy.fontOrigins).toEqual([
      'https://a.example.com:8443',
      'https://fonts.example.com',
    ]);
  });

  it('keeps an explicit non-default port as part of the origin', () => {
    const policy = policyOf({
      fontOrigins: [
        'https://fonts.example.com:8443',
        'https://fonts.example.com',
      ],
    });
    expect(policy.fontOrigins).toEqual([
      'https://fonts.example.com',
      'https://fonts.example.com:8443',
    ]);
  });

  it.each([
    ['a wildcard subdomain', 'https://*.example.com'],
    ['a bare wildcard', '*'],
    ['plain HTTP', 'http://fonts.example.com'],
    ['a scheme-less host', 'fonts.example.com'],
    ['a data scheme', 'data:'],
    ['credentials', 'https://user:pw@fonts.example.com'],
    ['a username only', 'https://user@fonts.example.com'],
    ['a path', 'https://fonts.example.com/css'],
    ['a trailing path segment', 'https://fonts.example.com/a/'],
    ['a query', 'https://fonts.example.com?family=x'],
    ['a query after the root path', 'https://fonts.example.com/?family=x'],
    ['a bare question mark', 'https://fonts.example.com?'],
    ['a fragment', 'https://fonts.example.com#x'],
    ['a bare fragment mark', 'https://fonts.example.com/#'],
    ['an empty string', ''],
    ['surrounding whitespace', ' https://fonts.example.com'],
    ['an embedded newline', 'https://fonts.example.com\n'],
    ['a backslash', 'https://fonts.example.com\\'],
    ['a port that is not a number', 'https://fonts.example.com:abc'],
    ['a port out of range', 'https://fonts.example.com:99999'],
    ['a bracketed IPv6 literal', 'https://[::1]'],
    ['a trailing-dot host', 'https://fonts.example.com.'],
    [
      'a semicolon that would start a CSP directive',
      'https://fonts.example.com;script-src',
    ],
    ['a comma', 'https://fonts.example.com,https://evil.example'],
    ['a space', 'https://fonts.example.com https://evil.example'],
    ['a quote', "https://fonts.example.com'"],
    ['a non-string entry', 42],
  ])('rejects %s in the font origin allowlist', (_name, origin) => {
    const created = createContentPolicy({ fontOrigins: [origin] });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.failure.kind).toBe('invalid-font-origin');
  });

  it('rejects an invalid origin listed beside valid ones, rather than dropping it', () => {
    expect(
      createContentPolicy({
        fontOrigins: ['https://fonts.example.com', 'https://*.example.com'],
      }).ok,
    ).toBe(false);
  });

  it('rejects a non-array allowlist and an allowlist longer than the finite bound', () => {
    expect(
      createContentPolicy({ fontOrigins: 'https://fonts.example.com' }).ok,
    ).toBe(false);
    const many = Array.from(
      { length: 33 },
      (_unused, index) => `https://h${index}.example.com`,
    );
    expect(createContentPolicy({ fontOrigins: many }).ok).toBe(false);
  });

  it('is immutable once created', () => {
    const policy = policyOf({ fontOrigins: ['https://fonts.example.com'] });
    expect(() =>
      (policy.fontOrigins as string[]).push('https://evil.example'),
    ).toThrow(TypeError);
    expect(() =>
      (policy.resource.fontOrigins as string[]).push('https://evil.example'),
    ).toThrow(TypeError);
    expect(() =>
      (policy.configuration.fontOrigins as string[]).push(
        'https://evil.example',
      ),
    ).toThrow(TypeError);
  });
});

describe('image and font permissions stay separate', () => {
  const policy = policyOf({
    imageHosts: ['images.example.com'],
    fontOrigins: ['https://fonts.example.com'],
  });

  it('grants an image host to images only and a font origin to fonts only', () => {
    expect(sourceList(policy, 'img-src')).toBe(
      'img-src data: blob: https://images.example.com',
    );
    expect(sourceList(policy, 'font-src')).toBe(
      'font-src data: blob: https://fonts.example.com',
    );
    expect(policy.resource.contentSecurityPolicy).not.toMatch(
      /img-src[^;]*fonts\.example\.com/,
    );
    expect(policy.resource.contentSecurityPolicy).not.toMatch(
      /font-src[^;]*images\.example\.com/,
    );
  });

  it('does not let a font origin authorize a content image, or an image host authorize a font', () => {
    expect(
      policy.decideImage('https://fonts.example.com/a.png', ESTABLISHED),
    ).toEqual({
      allowed: false,
      reason: 'host-not-allowed',
    });
    const imagesOnly = policyOf({ imageHosts: ['images.example.com'] });
    expect(imagesOnly.fontOrigins).toEqual([]);
    expect(sourceList(imagesOnly, 'font-src')).toBe('font-src data: blob:');
  });

  it('declares the union of both lists to the host, because its resource permission is not per type', () => {
    expect(policy.resource.resourceDomains).toEqual([
      'https://fonts.example.com',
      'https://images.example.com',
    ]);
    expect(
      policyOf({
        imageHosts: ['x.example.com'],
        fontOrigins: ['https://x.example.com'],
      }).resource.resourceDomains,
    ).toEqual(['https://x.example.com']);
    expect(policyOf({}).resource.resourceDomains).toEqual([]);
  });

  it('keeps every other directive unchanged: no origin reaches scripts, styles, media, connections or frames', () => {
    const csp = policy.resource.contentSecurityPolicy;
    expect(directives(csp, 'default-src')).toEqual(["default-src 'none'"]);
    expect(directives(csp, 'script-src')).toEqual([
      "script-src 'unsafe-inline'",
    ]);
    expect(directives(csp, 'style-src')).toEqual(["style-src 'unsafe-inline'"]);
    for (const name of [
      'media-src',
      'connect-src',
      'frame-src',
      'object-src',
    ]) {
      expect(directives(csp, name)).toEqual([`${name} 'none'`]);
    }
    expect(directives(csp, 'base-uri')).toEqual(["base-uri 'none'"]);
    expect(directives(csp, 'form-action')).toEqual(["form-action 'none'"]);
  });
});

describe('reconstructing a policy from its configuration', () => {
  it.each([
    ['standard, nothing configured', {}],
    ['strict, nothing configured', { level: 'strict' }],
    [
      'standard with both lists',
      {
        imageHosts: ['images.example.com'],
        fontOrigins: ['https://fonts.example.com:8443'],
      },
    ],
    [
      'strict with both lists',
      {
        level: 'strict',
        imageHosts: ['images.example.com', 'cdn.example.org'],
        fontOrigins: ['https://fonts.example.com', 'https://b.example.com'],
        blockedPresentation: 'inert-text',
      },
    ],
  ])(
    'yields an equal policy for %s, and Strict never acquires blob:',
    (_name, config) => {
      const original = policyOf(config);
      const rebuilt = policyOf(
        JSON.parse(JSON.stringify(original.configuration)),
      );
      expect(rebuilt.configuration).toEqual(original.configuration);
      expect(rebuilt.resource).toEqual(original.resource);
      expect(rebuilt.resource.contentSecurityPolicy).toBe(
        original.resource.contentSecurityPolicy,
      );
      if (original.level === 'strict')
        expect(rebuilt.resource.contentSecurityPolicy).not.toContain('blob:');
    },
  );

  it('carries the font origins in the configuration, empty when none are configured', () => {
    expect(policyOf({}).configuration).toEqual({
      level: 'standard',
      imageHosts: [],
      fontOrigins: [],
    });
    expect(policyOf({ level: 'strict' }).configuration).toEqual({
      level: 'strict',
      imageHosts: [],
      fontOrigins: [],
      blockedPresentation: 'placeholder',
    });
  });

  it('still establishes enforcement only for the exact derived document policy', () => {
    const policy = policyOf({ imageHosts: ['images.example.com'] });
    expect(
      establishImageEnforcement(policy, [
        policy.resource.contentSecurityPolicy,
      ]),
    ).toBe('established');
    // The baseline schemes cannot manufacture enforcement when the required policy is missing or different.
    expect(establishImageEnforcement(policy, [])).toBe('unestablished');
    expect(
      establishImageEnforcement(policy, [
        "default-src 'none'; img-src data: blob:",
      ]),
    ).toBe('unestablished');
    const strict = policyOf({
      level: 'strict',
      imageHosts: ['images.example.com'],
    });
    expect(
      establishImageEnforcement(strict, [
        policy.resource.contentSecurityPolicy,
      ]),
    ).toBe('unestablished');
  });
});

describe('content image decisions are unchanged by the baseline schemes', () => {
  it.each([
    ['standard', {}],
    ['standard with a host', { imageHosts: ['images.example.com'] }],
    ['strict', { level: 'strict' }],
  ])('%s still refuses data and blob sources', (_name, config) => {
    const policy = policyOf(config);
    const consented: ImageContext = {
      enforcement: 'established',
      consent: 'granted',
    };
    expect(policy.decideImage('data:image/png;base64,AAAA', consented)).toEqual(
      { allowed: false, reason: 'not-https' },
    );
    expect(
      policy.decideImage('blob:https://images.example.com/1234', consented),
    ).toEqual({
      allowed: false,
      reason: 'not-https',
    });
    expect(
      policy.offerImages(
        ['data:image/png;base64,AAAA', 'blob:https://images.example.com/1'],
        'established',
      ),
    ).not.toMatchObject({
      available: true,
    });
  });
});
