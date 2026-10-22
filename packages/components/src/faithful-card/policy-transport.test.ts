// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createContentPolicy, type ContentPolicy } from './policy.js';
import {
  CONTENT_POLICY_ELEMENT_ID,
  contentPolicyFromEmbedded,
  embedContentPolicy,
  resourcePermissionsOf,
} from './policy-transport.js';

// The transport pair is tested at its own interface: strings in, strings out, and the parsed
// document an HTML parser makes of them. The policy value is built by `createContentPolicy` where a
// real one is needed; the serializer tests give it hostile configuration values that
// `createContentPolicy` would refuse (it is tested for that separately, below), because the
// serializer must keep any JSON value inert whatever produced it.

const VIEW =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>v</title>' +
  '<script>window.first = 1;</script></head><body><script>window.second = 2;</script></body></html>';

function policyOf(config: unknown = {}): ContentPolicy {
  const created = createContentPolicy(config);
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
}

/** A policy whose configuration holds arbitrary strings, as only a hostile or broken producer could. */
function withConfiguration(configuration: ContentPolicy['configuration']) {
  return { ...policyOf(), configuration } satisfies ContentPolicy;
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** What the parsed document's head and body say, in document order. */
function elementsInOrder(doc: Document): string[] {
  return [...doc.querySelectorAll('meta, script')].map((element) => {
    if (element.localName === 'meta')
      return element.hasAttribute('charset')
        ? 'meta:charset'
        : `meta:${element.getAttribute('http-equiv')}`;
    return element.id === '' ? 'script' : `script#${element.id}`;
  });
}

describe('embedContentPolicy: the configuration element', () => {
  const HOSTILE = [
    '</script><img src=x onerror=alert(1)>',
    '<!--<script>',
    'a < b && c <\u2028 d',
  ];

  it('writes every less-than sign as the six-character escape and decodes to the original value', () => {
    const configuration = {
      level: 'standard',
      imageHosts: HOSTILE,
      fontOrigins: [],
    } as const;
    const html = embedContentPolicy(VIEW, withConfiguration(configuration));
    const doc = parse(html);
    const element = doc.getElementById(CONTENT_POLICY_ELEMENT_ID);
    const text = element?.textContent ?? '';
    expect(text).not.toContain('<');
    expect(text).toContain('\\u003c/script>');
    expect(JSON.parse(text)).toEqual(configuration);
    // The hostile value stayed data: nothing it names was created.
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelectorAll('script')).toHaveLength(3);
  });
});

describe('embedContentPolicy: placement', () => {
  it('orders the charset meta, the CSP meta, the configuration, then every other script', () => {
    const policy = policyOf({ imageHosts: ['images.example.com'] });
    const order = elementsInOrder(parse(embedContentPolicy(VIEW, policy)));
    expect(order).toEqual([
      'meta:charset',
      'meta:Content-Security-Policy',
      `script#${CONTENT_POLICY_ELEMENT_ID}`,
      'script',
      'script',
    ]);
    const meta = parse(embedContentPolicy(VIEW, policy)).querySelector(
      'meta[http-equiv]',
    );
    expect(meta?.getAttribute('content')).toBe(
      policy.resource.contentSecurityPolicy,
    );
  });

  it('inserts right after head when the document declares no charset', () => {
    const html = embedContentPolicy(
      '<html><head data-x="1"><title>t</title><script>1</script></head></html>',
      policyOf(),
    );
    expect(elementsInOrder(parse(html))).toEqual([
      'meta:Content-Security-Policy',
      `script#${CONTENT_POLICY_ELEMENT_ID}`,
      'script',
    ]);
  });

  it('adds nothing but the two inserted elements', () => {
    const html = embedContentPolicy(VIEW, policyOf());
    const inserted =
      /<meta http-equiv="Content-Security-Policy"[^>]*><script type="application\/json" id="saga-content-policy">[^<]*<\/script>/.exec(
        html,
      );
    expect(inserted).not.toBeNull();
    expect(html.replace(inserted?.[0] ?? '', '')).toBe(VIEW);
  });

  it('accepts uppercase tag names and a head with attributes on separate lines', () => {
    const html = embedContentPolicy(
      '<HTML><HEAD\n lang="en"><META CHARSET="utf-8"><title>t</title></HEAD></HTML>',
      policyOf(),
    );
    expect(elementsInOrder(parse(html)).slice(0, 3)).toEqual([
      'meta:charset',
      'meta:Content-Security-Policy',
      `script#${CONTENT_POLICY_ELEMENT_ID}`,
    ]);
  });
});

// The markup around the insertion point is read as the HTML parser reads it: a `>` inside a quoted
// attribute does not end a tag, and a comment is not an element. Each case is judged on the parsed
// result, with the original bytes untouched around the two inserted elements.
describe('embedContentPolicy: the structure around the insertion point', () => {
  const STRICT = policyOf({ level: 'strict', imageHosts: ['a.example.com'] });
  const SCRIPT = `script#${CONTENT_POLICY_ELEMENT_ID}`;
  const CSP = 'meta:Content-Security-Policy';

  /** The document with the two inserted elements taken out again. */
  function withoutInsertion(html: string): string {
    return html.replace(
      /<meta http-equiv="Content-Security-Policy"[^>]*><script type="application\/json" id="saga-content-policy">[^<]*<\/script>/,
      '',
    );
  }

  it.each([
    [
      'a > inside a quoted head attribute',
      '<!doctype html><html><head data-description="a > b"><title>t</title><script>window.ran=1</script></head><body></body></html>',
      [CSP, SCRIPT, 'script'],
    ],
    [
      'a > inside a single-quoted head attribute',
      "<html><head data-d='x > y'><script>1</script></head></html>",
      [CSP, SCRIPT, 'script'],
    ],
    [
      'a > inside an attribute of the first-element charset meta',
      '<head><meta charset="utf-8" data-d="a > b"><script>1</script></head>',
      ['meta:charset', CSP, SCRIPT, 'script'],
    ],
    [
      'a normal comment before a first-element charset meta',
      '<head><!-- build header --><meta charset="utf-8"><script>1</script></head>',
      ['meta:charset', CSP, SCRIPT, 'script'],
    ],
    [
      'a comment holding a fake head, a fake script and a fake charset',
      '<!-- <head><script>1</script><meta charset="x"> --><html><head><title>t</title><script>1</script></head></html>',
      [CSP, SCRIPT, 'script'],
    ],
    [
      'a comment between the head tag and its attributes-bearing html tag',
      '<!doctype html><!-- a --><html lang="en" data-x="<head>"><!-- b --><head><script>1</script></head></html>',
      [CSP, SCRIPT, 'script'],
    ],
    [
      'a script whose text mentions a charset meta',
      '<head><title>t</title><script>var s = \'<meta charset="x">\';</script></head>',
      [CSP, SCRIPT, 'script'],
    ],
    [
      'an unquoted charset value and CRLF line ends',
      '<html>\r\n<head>\r\n<meta charset=utf-8>\r\n<script>1</script></head></html>',
      ['meta:charset', CSP, SCRIPT, 'script'],
    ],
  ])('keeps the order and the original bytes with %s', (_name, html, order) => {
    const embedded = embedContentPolicy(html, STRICT);
    const doc = parse(embedded);
    expect(elementsInOrder(doc)).toEqual(order);
    expect(doc.querySelector('meta[http-equiv]')?.getAttribute('content')).toBe(
      STRICT.resource.contentSecurityPolicy,
    );
    expect(withoutInsertion(embedded)).toBe(html);
    const rebuilt = contentPolicyFromEmbedded(
      doc.getElementById(CONTENT_POLICY_ELEMENT_ID)?.textContent ?? null,
    );
    expect(rebuilt.ok && rebuilt.policy.configuration).toEqual(
      STRICT.configuration,
    );
  });

  it('keeps the head attribute that held a > in the parsed document', () => {
    const doc = parse(
      embedContentPolicy(
        '<html><head data-description="a > b"><script>1</script></head></html>',
        STRICT,
      ),
    );
    expect(doc.head.getAttribute('data-description')).toBe('a > b');
  });
});

describe('embedContentPolicy: documents it refuses', () => {
  const policy = policyOf();

  it.each([
    ['has no head', '<!doctype html><saga-app></saga-app>'],
    [
      'has a script before the head',
      '<script>1</script><html><head><title>t</title></head></html>',
    ],
    [
      'has a script before the head, in capitals',
      '<SCRIPT>1</SCRIPT><head></head>',
    ],
    [
      'declares its charset after a script',
      '<html><head><script>1</script><meta charset="utf-8"></head></html>',
    ],
    [
      'declares its charset after other head content',
      '<html><head><title>t</title><meta charset="utf-8"></head></html>',
    ],
    ['has a head only inside a comment', '<!-- <head> --><html></html>'],
    [
      'has an element other than html before the head',
      '<meta name="x"><head></head>',
    ],
    ['has text before the head', 'text<head></head>'],
    ['ends inside the head tag', '<html><head data-x="1'],
    [
      'declares a second charset after the first',
      '<head><meta charset="utf-8"><meta charset="utf-8"></head>',
    ],
    [
      'declares its charset in the body',
      '<head><title>t</title></head><body><meta charset="utf-8"></body>',
    ],
  ])('throws for a document that %s', (_name, html) => {
    expect(() => embedContentPolicy(html, policy)).toThrow();
  });

  it('throws for a Content-Security-Policy value containing a double quote', () => {
    const quoted = {
      ...policy,
      resource: {
        ...policy.resource,
        contentSecurityPolicy: `default-src 'none'" onload="x`,
      },
    } satisfies ContentPolicy;
    expect(() => embedContentPolicy(VIEW, quoted)).toThrow(/double quote/);
  });
});

describe('embedded configuration round trip', () => {
  const CONFIGURATIONS = [
    ['Standard', {}],
    ['Standard with image hosts', { imageHosts: ['images.example.com'] }],
    [
      'Standard with image and font origins',
      {
        imageHosts: ['images.example.com', 'cdn.example.org'],
        fontOrigins: [
          'https://fonts.example.com',
          'https://a.example.net:8443',
        ],
      },
    ],
    ['Strict', { level: 'strict' }],
    [
      'Strict with image and font origins',
      {
        level: 'strict',
        blockedPresentation: 'inert-text',
        imageHosts: ['images.example.com'],
        fontOrigins: ['https://fonts.example.com'],
      },
    ],
  ] as const;

  it.each(CONFIGURATIONS)(
    'returns an equal policy for %s',
    (_name, configuration) => {
      const policy = policyOf(configuration);
      const doc = parse(embedContentPolicy(VIEW, policy));
      const rebuilt = contentPolicyFromEmbedded(
        doc.getElementById(CONTENT_POLICY_ELEMENT_ID)?.textContent ?? null,
      );
      expect(rebuilt.ok && rebuilt.policy.configuration).toEqual(
        policy.configuration,
      );
      expect(rebuilt.ok && rebuilt.policy.resource).toEqual(policy.resource);
      expect(rebuilt.ok && rebuilt.policy.level).toBe(policy.level);
    },
  );
});

describe('contentPolicyFromEmbedded', () => {
  it('yields the default Standard policy when nothing is embedded', () => {
    const rebuilt = contentPolicyFromEmbedded(null);
    expect(rebuilt.ok && rebuilt.policy.level).toBe('standard');
    expect(rebuilt.ok && rebuilt.policy.imageHosts).toEqual([]);
    expect(rebuilt.ok && rebuilt.policy.fontOrigins).toEqual([]);
  });

  it.each([
    ['malformed JSON', 'not json', 'invalid-config'],
    ['empty text', '', 'invalid-config'],
    ['a JSON array', '[]', 'invalid-config'],
    ['a JSON number', '42', 'invalid-config'],
    ['JSON null', 'null', 'invalid-config'],
    ['an unknown level', '{"level":"permissive"}', 'invalid-level'],
    [
      'a wildcard image host',
      '{"level":"standard","imageHosts":["*.example.com"]}',
      'invalid-image-host',
    ],
    [
      'a wildcard font origin',
      '{"fontOrigins":["https://*.example.com"]}',
      'invalid-font-origin',
    ],
    [
      'a blocked presentation on Standard',
      '{"level":"standard","blockedPresentation":"placeholder"}',
      'invalid-presentation',
    ],
  ])('fails for %s with the policy failure kind', (_name, text, kind) => {
    const rebuilt = contentPolicyFromEmbedded(text);
    expect(!rebuilt.ok && rebuilt.failure.kind).toBe(kind);
  });
});

describe('resourcePermissionsOf', () => {
  it('reports the document restrictions and the origins to declare', () => {
    const policy = policyOf({
      imageHosts: ['images.example.com'],
      fontOrigins: ['https://fonts.example.com'],
    });
    expect(resourcePermissionsOf(policy)).toEqual({
      contentSecurityPolicy: policy.resource.contentSecurityPolicy,
      resourceDomains: [
        'https://fonts.example.com',
        'https://images.example.com',
      ],
    });
  });

  it('declares nothing for the embedded baseline', () => {
    expect(resourcePermissionsOf(policyOf()).resourceDomains).toEqual([]);
  });
});
