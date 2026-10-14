import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp.js';

// Direct contract tests for the fixture's CSP builder. They run in plain Node against the pure
// module the host fixture imports, so they need no DOM, iframe, or bridge setup. The browser
// regressions in e2e/csp-image.spec.ts still verify the policy applied to the mounted view.

describe('contentSecurityPolicy', () => {
  it('emits explicit none image and connect directives for empty lists', () => {
    const policy = contentSecurityPolicy({ connectDomains: [], resourceDomains: [] });
    expect(policy).toContain("default-src 'none'");
    // An empty resource list must produce an explicit `img-src 'none'`, not a bare `img-src`.
    expect(policy).toContain("img-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("style-src 'unsafe-inline'");
  });

  it('lists every resource origin and the connect origin when both lists are populated', () => {
    const policy = contentSecurityPolicy({
      connectDomains: ['https://api.example.test'],
      resourceDomains: ['https://cdn.example.test', 'https://img.example.test'],
    });
    const origins = 'https://cdn.example.test https://img.example.test';
    expect(policy).toContain(`img-src ${origins}`);
    expect(policy).toContain(`script-src 'unsafe-inline' ${origins}`);
    expect(policy).toContain(`style-src 'unsafe-inline' ${origins}`);
    expect(policy).toContain('connect-src https://api.example.test');
  });

  it('keeps the connect directive none while allowing named resource origins', () => {
    const policy = contentSecurityPolicy({
      connectDomains: [],
      resourceDomains: ['https://cdn.example.test'],
    });
    expect(policy).toContain('img-src https://cdn.example.test');
    expect(policy).toContain("connect-src 'none'");
  });

  it('keeps the image directive none while allowing named connect origins', () => {
    const policy = contentSecurityPolicy({
      connectDomains: ['https://api.example.test'],
      resourceDomains: [],
    });
    expect(policy).toContain("img-src 'none'");
    expect(policy).toContain('connect-src https://api.example.test');
  });
});
