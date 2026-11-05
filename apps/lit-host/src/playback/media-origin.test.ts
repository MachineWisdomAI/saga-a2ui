// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createContentPolicy,
  embedContentPolicy,
} from '@saga-a2ui/components/faithful-card';
import { admittedMediaOrigin, canonicalMediaOrigin } from './playback.js';
import { embedMediaOrigin } from './playback-server.js';

// The admitted media origin travels in the served player document: the server writes it, the view
// reads it back. These specifications cover that round trip and what each side refuses.

const BUILT =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>player</title></head><body><main></main></body></html>';

const parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html');

describe('canonicalMediaOrigin', () => {
  it.each([
    ['http://127.0.0.1:3001', 'http://127.0.0.1:3001'],
    ['https://media.example.com', 'https://media.example.com'],
    ['https://media.example.com/', 'https://media.example.com'],
    ['https://MEDIA.example.com:443', 'https://media.example.com'],
  ])('reduces %s to %s', (raw, canonical) => {
    expect(canonicalMediaOrigin(raw)).toBe(canonical);
  });

  it.each([
    ['nothing', undefined],
    ['a non-string', 42],
    ['an empty string', ''],
    ['a relative path', '/playback/media/ep-1'],
    ['another scheme', 'ftp://media.example.com'],
    ['a script scheme', 'javascript:alert(1)'],
    ['credentials', 'https://user:secret@media.example.com'],
    ['a path', 'https://media.example.com/playback'],
    ['a query', 'https://media.example.com/?x=1'],
    ['a fragment', 'https://media.example.com/#x'],
  ])('refuses %s', (_name, raw) => {
    expect(canonicalMediaOrigin(raw)).toBeUndefined();
  });
});

describe('the served document and the view agree on one admitted origin', () => {
  it('writes the origin into the head and the view reads the same origin back', () => {
    const served = embedMediaOrigin(BUILT, 'http://127.0.0.1:3001');

    expect(served).toBe(
      BUILT.replace(
        '<meta charset="UTF-8" />',
        '<meta charset="UTF-8" /><meta name="saga-media-origin" content="http://127.0.0.1:3001">',
      ),
    );
    const document = parse(served);
    expect(document.head.querySelectorAll('meta[name]')).toHaveLength(1);
    expect(admittedMediaOrigin(document)).toBe('http://127.0.0.1:3001');
  });

  it('keeps the charset declaration first, so a content policy can still be embedded after it', () => {
    const served = embedMediaOrigin(BUILT, 'http://127.0.0.1:3001');

    expect(parse(served).head.firstElementChild?.getAttribute('charset')).toBe(
      'UTF-8',
    );
    const created = createContentPolicy({ level: 'strict', imageHosts: [] });
    if (!created.ok) throw new Error(created.failure.message);
    const embedded = embedContentPolicy(served, created.policy);
    expect(admittedMediaOrigin(parse(embedded))).toBe('http://127.0.0.1:3001');
    expect(
      parse(embedded).head.firstElementChild?.getAttribute('charset'),
    ).toBe('UTF-8');
  });

  it('places the meta first in a head that declares no charset', () => {
    const served = embedMediaOrigin(
      '<!doctype html><html><head><title>p</title></head></html>',
      'https://media.example.com',
    );
    expect(parse(served).head.firstElementChild?.getAttribute('name')).toBe(
      'saga-media-origin',
    );
  });

  it('serializes the origin once, canonically, whatever form the application configured', () => {
    const served = embedMediaOrigin(BUILT, 'HTTP://Media.Example.com:80/');
    expect(admittedMediaOrigin(parse(served))).toBe('http://media.example.com');
  });

  it('places the meta in the head of a document whose head tag has attributes or a different case', () => {
    const served = embedMediaOrigin(
      '<!DOCTYPE html><HTML><HEAD data-x="1"><title>p</title></HEAD></HTML>',
      'https://media.example.com',
    );
    expect(parse(served).head.querySelector('meta[name]')).not.toBeNull();
    expect(admittedMediaOrigin(parse(served))).toBe(
      'https://media.example.com',
    );
  });

  it('still admits the origin from a document with no head tag, keeping the doctype first', () => {
    const served = embedMediaOrigin(
      '<!doctype html><title>player</title>',
      'https://media.example.com',
    );
    expect(served.startsWith('<!doctype html><meta')).toBe(true);
    expect(admittedMediaOrigin(parse(served))).toBe(
      'https://media.example.com',
    );
  });

  it('adds nothing but the one meta: the rest of the document is served as built', () => {
    const served = embedMediaOrigin(BUILT, 'https://media.example.com');
    expect(served.replace(/<meta name="saga-media-origin"[^>]*>/, '')).toBe(
      BUILT,
    );
  });

  it.each([
    ['a path', 'https://media.example.com/playback'],
    ['credentials', 'https://user@media.example.com'],
    ['another scheme', 'ftp://media.example.com'],
    ['nothing usable', '"><script>alert(1)</script>'],
  ])('refuses to serve an origin with %s', (_name, origin) => {
    expect(() => embedMediaOrigin(BUILT, origin)).toThrow(
      'plain http or https origin',
    );
  });
});

describe('what the view admits from a document', () => {
  it.each([
    ['no meta', '<head></head>'],
    ['an empty content', '<meta name="saga-media-origin" content="">'],
    [
      'a content that is not an origin',
      '<meta name="saga-media-origin" content="https://media.example.com/playback/media/">',
    ],
    [
      'a content with credentials',
      '<meta name="saga-media-origin" content="https://u:p@media.example.com">',
    ],
    [
      'a script scheme',
      '<meta name="saga-media-origin" content="javascript:1">',
    ],
  ])('admits nothing from %s', (_name, head) => {
    expect(
      admittedMediaOrigin(parse(`<!doctype html><head>${head}</head>`)),
    ).toBeUndefined();
  });
});
