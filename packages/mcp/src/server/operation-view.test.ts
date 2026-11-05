import { describe, expect, it } from 'vitest';
import { CLOSED_VIEW_CSP } from '../policy/index.js';
import { operationViewFromHtml } from './operation-view.js';
import { viewUriForMajor } from './view-identity.js';

const HTML = '<!doctype html><html><head></head><body>view</body></html>';

describe('operationViewFromHtml', () => {
  it('addresses the view by its major and keeps the document and title', () => {
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      major: 1,
      title: 'Answer card',
    });
    expect(view.html).toBe(HTML);
    expect(view.title).toBe('Answer card');
    expect(view.uri).toBe('ui://views/card.v1.html');
    expect(view.uri).toBe(viewUriForMajor('card.html', 1));
  });

  it('keeps the address when only a build stamp in the document changes, and serves that stamp', () => {
    const stamped = (release: string) =>
      operationViewFromHtml({
        html: HTML.replace('view', `view ${release}`),
        filename: 'card.html',
        major: 1,
        title: 'Answer card',
      });
    const first = stamped('2026.11.05-1');
    const second = stamped('2026.11.05-2');
    expect(second.uri).toBe(first.uri);
    expect(first.html).toContain('2026.11.05-1');
    expect(second.html).toContain('2026.11.05-2');
  });

  it('gives a new address for a new major', () => {
    const at = (major: number) =>
      operationViewFromHtml({
        html: HTML,
        filename: 'cards/card.html',
        major,
        title: 'Answer card',
      }).uri;
    expect(at(1)).toBe('ui://views/cards/card.v1.html');
    expect(at(2)).toBe('ui://views/cards/card.v2.html');
    expect(at(2)).toBe(viewUriForMajor('cards/card.html', 2));
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses %s as the major', (major) => {
    expect(() =>
      operationViewFromHtml({
        html: HTML,
        filename: 'card.html',
        major,
        title: 'Answer card',
      }),
    ).toThrow(TypeError);
  });

  it('requires the major at runtime as well as in TypeScript', () => {
    expect(() =>
      // @ts-expect-error The JavaScript calling convention must fail explicitly too.
      operationViewFromHtml({ html: HTML, filename: 'card.html', title: 'A' }),
    ).toThrow(/major/);
  });

  it('declares a closed view unless the caller names permissions', () => {
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      major: 1,
      title: 'Answer card',
    });
    expect(view.csp).toEqual(CLOSED_VIEW_CSP);
  });

  it('takes only the permissions it is given and leaves the rest closed', () => {
    const view = operationViewFromHtml({
      html: HTML,
      filename: 'card.html',
      major: 1,
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
      major: 1,
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
      major: 1,
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
    'throws for %s as the filename, as viewUriForMajor does',
    (_name, filename) => {
      expect(() =>
        operationViewFromHtml({
          html: HTML,
          filename,
          major: 1,
          title: 'Answer card',
        }),
      ).toThrow(TypeError);
    },
  );
});
