import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp.js';

// Direct contract tests for the fixture's CSP builder. They run in plain Node against the pure
// module the host fixture imports, so they need no DOM, iframe, or bridge setup. The browser
// regressions in e2e/csp-image.spec.ts still verify the policy applied to the mounted view.

describe('contentSecurityPolicy', () => {
  it('emits the embedded image baseline and an explicit none connect directive for empty lists', () => {
    const policy = contentSecurityPolicy({
      connectDomains: [],
      resourceDomains: [],
    });
    expect(policy).toContain("default-src 'none'");
    // An empty resource list still lets a view show `data:` and `blob:` images, and nothing from the network.
    expect(policy).toContain('img-src data: blob:;');
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
    expect(policy).toContain(`img-src data: blob: ${origins}`);
    expect(policy).toContain(`script-src 'unsafe-inline' ${origins}`);
    expect(policy).toContain(`style-src 'unsafe-inline' ${origins}`);
    expect(policy).toContain('connect-src https://api.example.test');
  });

  it('grants resource origins to fonts and media too, as the broad resourceDomains permission does', () => {
    const empty = contentSecurityPolicy({
      connectDomains: [],
      resourceDomains: [],
    });
    expect(empty).toContain('font-src data: blob:;');
    expect(empty).toContain("media-src 'none'");
    const populated = contentSecurityPolicy({
      connectDomains: [],
      resourceDomains: ['https://cdn.example.test'],
    });
    expect(populated).toContain(
      'font-src data: blob: https://cdn.example.test',
    );
    expect(populated).toContain('media-src https://cdn.example.test');
  });

  it('keeps the connect directive none while allowing named resource origins', () => {
    const policy = contentSecurityPolicy({
      connectDomains: [],
      resourceDomains: ['https://cdn.example.test'],
    });
    expect(policy).toContain('img-src data: blob: https://cdn.example.test');
    expect(policy).toContain("connect-src 'none'");
  });

  it('keeps the image directive at the embedded baseline while allowing named connect origins', () => {
    const policy = contentSecurityPolicy({
      connectDomains: ['https://api.example.test'],
      resourceDomains: [],
    });
    expect(policy).toContain('img-src data: blob:;');
    expect(policy).toContain('connect-src https://api.example.test');
  });
});
