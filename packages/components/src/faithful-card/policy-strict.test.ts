import { describe, expect, it } from 'vitest';
import { createContentPolicy, type ContentPolicy, type ImageContext } from './policy.js';

// The Strict level, exercised through the same public interface as Standard: construction from
// unchecked configuration, link and image decisions, and the offer of Show images.

const ESTABLISHED: ImageContext = { enforcement: 'established', consent: 'not-granted' };
const CONSENTED: ImageContext = { enforcement: 'established', consent: 'granted' };
const IMAGE = 'https://images.example.com/a.png';

function policyOf(config: object): ContentPolicy {
  const created = createContentPolicy(config);
  if (!created.ok) throw new Error(`unexpected configuration failure: ${created.failure.message}`);
  return created.policy;
}

const strict = (config: object = {}) => policyOf({ level: 'strict', ...config });
const standard = (config: object = {}) => policyOf({ level: 'standard', ...config });

describe('creating a Strict policy', () => {
  it('is chosen explicitly and shows blocked fragments as placeholders by default', () => {
    const policy = strict();
    expect(policy.level).toBe('strict');
    expect(policy.blockedPresentation).toBe('placeholder');
    expect(policy.imageHosts).toEqual([]);
  });

  it('lets the trusted application choose readable inert text instead', () => {
    expect(strict({ blockedPresentation: 'inert-text' }).blockedPresentation).toBe('inert-text');
  });

  it.each([
    ['an unknown level', { level: 'permissive' }, 'invalid-level'],
    ['a level in the wrong case', { level: 'Strict' }, 'invalid-level'],
    ['an unknown presentation', { level: 'strict', blockedPresentation: 'collapsed' }, 'invalid-presentation'],
    ['a presentation on Standard', { level: 'standard', blockedPresentation: 'placeholder' }, 'invalid-presentation'],
    ['a presentation with no level', { blockedPresentation: 'inert-text' }, 'invalid-presentation'],
    ['a wildcard image host', { level: 'strict', imageHosts: ['*.example.com'] }, 'invalid-image-host'],
  ])('fails explicitly for %s instead of guessing a looser policy', (_name, config, kind) => {
    const created = createContentPolicy(config);
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.failure.kind).toBe(kind);
  });

  it('reports a configuration that recreates an equal policy, for the resource to carry', () => {
    const policy = strict({ imageHosts: ['images.example.com'], blockedPresentation: 'inert-text' });
    expect(policy.configuration).toEqual({
      level: 'strict',
      imageHosts: ['images.example.com'],
      fontOrigins: [],
      blockedPresentation: 'inert-text',
    });
    const rebuilt = createContentPolicy(policy.configuration);
    expect(rebuilt.ok && rebuilt.policy.configuration).toEqual(policy.configuration);
    expect(standard({ imageHosts: ['images.example.com'] }).configuration).toEqual({
      level: 'standard',
      imageHosts: ['images.example.com'],
      fontOrigins: [],
    });
  });

  it('declares the same origins as Standard for the same hosts and differs only by the missing blob: baseline', () => {
    const hosts = ['images.example.com'];
    const { contentSecurityPolicy: strictPolicy, ...strictRest } = strict({ imageHosts: hosts }).resource;
    const { contentSecurityPolicy: standardPolicy, ...standardRest } = standard({ imageHosts: hosts }).resource;
    expect(strictRest).toEqual(standardRest);
    expect(strictPolicy).not.toContain('blob:');
    expect(strictPolicy).toBe(standardPolicy.replaceAll(' blob:', ''));
  });

  it('is immutable once created', () => {
    const policy = strict({ imageHosts: ['images.example.com'] });
    expect(() => (policy.configuration.imageHosts as string[]).push('evil.example')).toThrow(TypeError);
    expect(() => ((policy as { level: string }).level = 'standard')).toThrow(TypeError);
  });
});

describe('Strict decisions', () => {
  it('keeps every link inert, even a valid HTTPS one, and still says why an invalid one is refused', () => {
    const policy = strict();
    expect(policy.decideLink('https://docs.example.com/guide')).toEqual({ allowed: false, reason: 'strict' });
    expect(policy.decideLink('http://docs.example.com/guide')).toEqual({ allowed: false, reason: 'not-https' });
  });

  it('refuses a qualifying image until the reader consents, then allows exactly that image', () => {
    const policy = strict({ imageHosts: ['images.example.com'] });
    expect(policy.decideImage(IMAGE, ESTABLISHED)).toEqual({ allowed: false, reason: 'consent-required' });
    expect(policy.decideImage(IMAGE, CONSENTED)).toEqual({ allowed: true, url: IMAGE });
  });

  it('never lets consent widen what qualifies', () => {
    const policy = strict({ imageHosts: ['images.example.com'] });
    const refused = (source: string, context: ImageContext) => policy.decideImage(source, context);
    expect(refused('https://other.example.net/a.png', CONSENTED)).toEqual({ allowed: false, reason: 'host-not-allowed' });
    expect(refused('https://a.images.example.com/a.png', CONSENTED)).toEqual({ allowed: false, reason: 'host-not-allowed' });
    expect(refused('http://images.example.com/a.png', CONSENTED)).toEqual({ allowed: false, reason: 'not-https' });
    expect(refused('https://u:p@images.example.com/a.png', CONSENTED)).toEqual({ allowed: false, reason: 'credentials' });
    expect(refused(IMAGE, { enforcement: 'unestablished', consent: 'granted' })).toEqual({
      allowed: false,
      reason: 'enforcement-unestablished',
    });
  });

  it('loads nothing under the default empty allowlist, even with consent', () => {
    expect(strict().decideImage(IMAGE, CONSENTED)).toEqual({ allowed: false, reason: 'host-not-allowed' });
  });

  it('leaves Standard unchanged: it needs no consent', () => {
    expect(standard({ imageHosts: ['images.example.com'] }).decideImage(IMAGE, ESTABLISHED)).toEqual({
      allowed: true,
      url: IMAGE,
    });
  });
});

describe('offering Show images', () => {
  const other = 'https://other.example.net/b.png';
  const plain = 'http://images.example.com/c.png';
  const policy = strict({ imageHosts: ['images.example.com'] });

  it('is available when an image qualifies, counting only those that do', () => {
    expect(policy.offerImages([IMAGE, other, plain, IMAGE], 'established')).toEqual({ available: true, qualifying: 2 });
  });

  it('is unavailable, with a reason, when the description has no image', () => {
    expect(policy.offerImages([], 'established')).toEqual({ available: false, reason: 'no-images' });
  });

  it('is unavailable when images are present but none qualifies', () => {
    expect(policy.offerImages([other, plain], 'established')).toEqual({ available: false, reason: 'none-qualify' });
    expect(strict().offerImages([IMAGE], 'established')).toEqual({ available: false, reason: 'none-qualify' });
  });

  it('is unavailable when the document does not demonstrably enforce the image restrictions', () => {
    expect(policy.offerImages([IMAGE], 'unestablished')).toEqual({ available: false, reason: 'none-qualify' });
  });

  it('is not part of Standard, which loads qualifying images without a reader decision', () => {
    expect(standard({ imageHosts: ['images.example.com'] }).offerImages([IMAGE], 'established')).toEqual({
      available: false,
      reason: 'not-applicable',
    });
  });
});
