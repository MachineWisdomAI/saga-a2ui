import { describe, expect, it } from 'vitest';
import { CLOSED_VIEW_CSP } from '../policy/index.js';
import { operationViewFromHtml } from './operation-view.js';
import { viewUriForHtml } from './view-identity.js';

const HTML = '<!doctype html><html><head></head><body>view</body></html>';

describe('operationViewFromHtml', () => {
  it('identifies the exact document it serves and keeps the document and title', () => {
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      title: 'Answer card',
    });
    expect(view.html).toBe(HTML);
    expect(view.title).toBe('Answer card');
    expect(view.uri).toBe(viewUriForHtml(HTML, 'card.html'));
    expect(view.uri).toMatch(/^ui:\/\/views\/card\.[0-9a-f]{32}\.html$/);
  });

  it('declares a closed view unless the caller names permissions', () => {
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      title: 'Answer card',
    });
    expect(view.csp).toEqual(CLOSED_VIEW_CSP);
  });

  it('takes only the permissions it is given and leaves the rest closed', () => {
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      title: 'Answer card',
      csp: { resourceDomains: ['https://fonts.example.com'] },
    });
    expect(view.csp).toEqual({
      connectDomains: [],
      resourceDomains: ['https://fonts.example.com'],
      frameDomains: [],
      baseUriDomains: [],
    });
  });

  it('declares nothing beyond the host permission fields, whatever a structural value carries', () => {
    // A package that describes a policy may pass one value for several consumers; only the fields
    // a host reads become `_meta.ui.csp`.
    const permissions = {
      contentSecurityPolicy: "default-src 'none'",
      resourceDomains: ['https://images.example.com'],
    };
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      title: 'Answer card',
      csp: permissions,
    });
    expect(Object.keys(view.csp).sort()).toEqual([
      'baseUriDomains',
      'connectDomains',
      'frameDomains',
      'resourceDomains',
    ]);
    expect(view.csp.resourceDomains).toEqual(['https://images.example.com']);
  });

  it("does not let a later change to the caller's array change the declared view", () => {
    const domains = ['https://images.example.com'];
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      title: 'Answer card',
      csp: { resourceDomains: domains },
    });
    domains.push('https://evil.example.com');
    expect(view.csp.resourceDomains).toEqual(['https://images.example.com']);
  });

  it.each([
    ['an absolute path', '/card.html'],
    ['a traversal', '../card.html'],
    ['a backslash', 'a\\card.html'],
    ['a file that is not HTML', 'card.js'],
  ])(
    'throws for %s as the filename, as viewUriForHtml does',
    (_name, filename) => {
      expect(() =>
        operationViewFromHtml({ html: HTML, filename, title: 'Answer card' }),
      ).toThrow(TypeError);
    },
  );
});
