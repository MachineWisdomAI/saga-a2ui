import { z } from 'zod';

// The trusted content policy: one immutable value, created by the application when it creates a
// view. It decides which content effects are permitted (link activation and image requests) and
// derives the resource restrictions that must agree with those decisions. It knows nothing of
// Markdown, Lit, MCP or any host, and nothing in a description, tool result or A2UI property can
// change it.
//
// Two levels exist. Standard permits validated HTTPS links through the host and images from the
// exactly listed hosts. Strict keeps every link inert and loads no image until the reader
// consents. Consent is separate, revocable view state (see image-consent.ts) that this module
// only receives as an input to a decision, so it can never change the policy.

/** The most exact image hosts one policy may name. A finite bound keeps the derived policy small. */
export const MAX_IMAGE_HOSTS = 32;

/** The most exact font origins one policy may name, bounded for the same reason. */
const MAX_FONT_ORIGINS = 32;

export type ContentLevel = 'standard' | 'strict';

/**
 * How Strict first shows a blocked fragment (a link, an image reference or raw markup): as an
 * accessible placeholder, or as readable inert text. The reader can switch either way. Standard
 * never uses placeholders, so it reports `inert-text`.
 */
export type BlockedPresentation = 'placeholder' | 'inert-text';

export type PolicyFailure =
  | { readonly kind: 'invalid-level'; readonly message: string }
  | { readonly kind: 'invalid-presentation'; readonly message: string }
  | { readonly kind: 'invalid-image-host'; readonly message: string }
  | { readonly kind: 'invalid-font-origin'; readonly message: string }
  | { readonly kind: 'invalid-config'; readonly message: string };

export type CreatePolicyResult =
  | { readonly ok: true; readonly policy: ContentPolicy }
  | { readonly ok: false; readonly failure: PolicyFailure };

export type LinkDecision =
  | { readonly allowed: true; readonly url: string; readonly hostname: string }
  | {
      readonly allowed: false;
      readonly reason: 'malformed' | 'not-https' | 'credentials' | 'strict';
    };

export type ImageDecision =
  | { readonly allowed: true; readonly url: string }
  | {
      readonly allowed: false;
      readonly reason:
        | 'malformed'
        | 'not-https'
        | 'credentials'
        | 'host-not-allowed'
        | 'enforcement-unestablished'
        | 'consent-required';
    };

/** Whether the mounted document demonstrably carries the restrictions this policy derives. */
export type ImageEnforcement = 'established' | 'unestablished';

/** Whether the reader has consented to load images in the current description and view. */
export type ImageConsentState = 'granted' | 'not-granted';

/** Everything besides the image's own address that an image decision depends on. */
export interface ImageContext {
  readonly enforcement: ImageEnforcement;
  /** Standard ignores it. Strict allows an otherwise-permitted image only when it is granted. */
  readonly consent: ImageConsentState;
}

/** Whether the reader should be offered Show images for the images a description references. */
export type ImageOffer =
  | { readonly available: true; readonly qualifying: number }
  | {
      readonly available: false;
      readonly reason: 'not-applicable' | 'no-images' | 'none-qualify';
    };

/** Content-related restrictions the resource must declare before it is mounted. */
export interface ResourcePolicy {
  /**
   * Exact HTTPS origins that may serve content images. Empty means no content image may load from
   * the network; it does not affect the embedded `data:` images the document may always display.
   */
  readonly imageOrigins: readonly string[];
  /** Exact HTTPS origins, with any explicit port, that may serve fonts. Never authorizes images. */
  readonly fontOrigins: readonly string[];
  /**
   * What the resource declares to a host as `resourceDomains`: the image origins and the font
   * origins together, because that host permission is not per resource type. The document's own
   * restrictions below are what keep each origin to its one type.
   */
  readonly resourceDomains: readonly string[];
  /**
   * A Content-Security-Policy with one `img-src` and one `font-src`. Each starts from the level's
   * baseline schemes (`data:` at both levels, `blob:` at Standard only), which trusted embedded
   * artwork and fonts use, and adds that type's own origins. A host that builds its own policy
   * from `resourceDomains` can broaden scripts, styles, fonts, images and media to those origins;
   * this policy is applied in addition to the host's, and a document must satisfy both, so no
   * origin gains any permission other than the one type it was configured for. The baseline
   * schemes fetch nothing from the network. `'unsafe-inline'` covers the single-file view's own
   * inline script and styles and no origin. The restrictions are declared before mounting at
   * either level; Strict's consent cannot relax them.
   */
  readonly contentSecurityPolicy: string;
}

/**
 * The validated settings a policy was created from. `createContentPolicy(policy.configuration)`
 * yields an equal policy, which is how the resource carries it to the view. Strict adds its
 * blocked presentation; Standard has no such setting. The level's baseline `data:`/`blob:`
 * sources follow from the level and are never part of the configuration.
 */
export type PolicyConfiguration =
  | {
      readonly level: 'standard';
      readonly imageHosts: readonly string[];
      readonly fontOrigins: readonly string[];
    }
  | {
      readonly level: 'strict';
      readonly imageHosts: readonly string[];
      readonly fontOrigins: readonly string[];
      readonly blockedPresentation: BlockedPresentation;
    };

export interface ContentPolicy {
  readonly level: ContentLevel;
  readonly blockedPresentation: BlockedPresentation;
  /** Exact lowercase hostnames, sorted and without duplicates. */
  readonly imageHosts: readonly string[];
  /** Normalized exact HTTPS origins that may serve fonts, sorted and without duplicates. */
  readonly fontOrigins: readonly string[];
  readonly configuration: PolicyConfiguration;
  readonly resource: ResourcePolicy;
  /** Only an absolute HTTPS destination without credentials may be activated, and never under Strict. */
  decideLink(destination: string): LinkDecision;
  /** Permits an image only from an exactly listed host, with demonstrated enforcement and, under Strict, consent. */
  decideImage(source: string, context: ImageContext): ImageDecision;
  /**
   * Whether Show images is offered for these image sources: only under Strict, and only when at
   * least one of them would load once the reader consents. Consent cannot expand what qualifies.
   */
  offerImages(
    sources: readonly string[],
    enforcement: ImageEnforcement,
  ): ImageOffer;
}

const ConfigSchema = z
  .object({
    level: z.enum(['standard', 'strict']).optional(),
    imageHosts: z.array(z.unknown()).max(MAX_IMAGE_HOSTS).optional(),
    fontOrigins: z.array(z.unknown()).max(MAX_FONT_ORIGINS).optional(),
    blockedPresentation: z.enum(['placeholder', 'inert-text']).optional(),
  })
  .strict();

/**
 * One DNS label: lowercase letters, digits and interior hyphens, at most 63 characters. This is
 * the character set a Content-Security-Policy host-source accepts, so a host that matches it means
 * the same thing in the policy decision, the resource metadata and the derived `img-src`.
 */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A host entry is valid only when it is already the canonical lowercase ASCII hostname (URL
 * parsing must leave it unchanged) and every label uses only DNS characters. The second check is
 * what keeps delimiters such as `;`, `,` or `'` and other characters URL parsing tolerates (`_`,
 * `!`, `{`) out of the derived CSP, where they would end the source or start a new directive.
 * Canonical dotted IPv4 addresses satisfy both checks; bracketed IPv6 literals do not and are
 * rejected, as are single-label wildcards and empty labels.
 */
function isExactHost(candidate: unknown): candidate is string {
  if (
    typeof candidate !== 'string' ||
    candidate === '' ||
    candidate.length > 253 ||
    candidate.endsWith('.')
  ) {
    return false;
  }
  if (!candidate.split('.').every((label) => DNS_LABEL.test(label)))
    return false;
  try {
    return new URL(`https://${candidate}`).hostname === candidate;
  } catch {
    return false;
  }
}

/**
 * A trusted font origin as written: `https://`, a host, an optional numeric port and at most the
 * root path. The class excludes userinfo, backslashes (which URL parsing reads as slashes), a
 * query, a fragment, whitespace and everything after a path, so none of them can be normalized
 * away silently; a trailing colon with no port is rejected the same way.
 */
const FONT_ORIGIN = /^https:\/\/[^/?#\\@\s:]+(?::\d+)?\/?$/i;

/**
 * Returns the normalized origin (lowercase ASCII host, the port only when it is not the default)
 * of a valid trusted font origin, or `undefined`. The host must meet the same DNS-character rule
 * as an image host, which keeps CSP delimiters, wildcards and bracketed IPv6 literals out of the
 * derived `font-src`; a canonical dotted IPv4 address is an exact host and is accepted.
 */
function normalizeFontOrigin(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string' || !FONT_ORIGIN.test(candidate))
    return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  return isExactHost(url.hostname) ? url.origin : undefined;
}

type ParsedUrl =
  | { readonly ok: true; readonly url: URL }
  | {
      readonly ok: false;
      readonly reason: 'malformed' | 'not-https' | 'credentials';
    };

function parseHttpsUrl(raw: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'credentials' };
  return { ok: true, url };
}

/**
 * The schemes trusted embedded images and fonts need, by level. `data:` is available at both
 * levels; `blob:` only at Standard, where an application-owned object URL is a convenience.
 * Neither fetches from the network, and neither is an origin: configured origins extend this
 * list and can neither replace it nor add `blob:` to Strict.
 */
const BASELINE_SCHEMES: Readonly<Record<ContentLevel, readonly string[]>> = {
  standard: ['data:', 'blob:'],
  strict: ['data:'],
};

function deriveResourcePolicy(
  level: ContentLevel,
  imageHosts: readonly string[],
  fontOrigins: readonly string[],
): ResourcePolicy {
  const imageOrigins = Object.freeze(
    imageHosts.map((host) => `https://${host}`),
  );
  const baseline = BASELINE_SCHEMES[level];
  const resourceDomains = Object.freeze(
    [...new Set([...imageOrigins, ...fontOrigins])].sort(),
  );
  const contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src ${[...baseline, ...imageOrigins].join(' ')}`,
    `font-src ${[...baseline, ...fontOrigins].join(' ')}`,
    "media-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return Object.freeze({
    imageOrigins,
    fontOrigins,
    resourceDomains,
    contentSecurityPolicy,
  });
}

function failureFor(error: z.ZodError): PolicyFailure {
  const settings = error.issues.map((issue) => issue.path[0]);
  if (settings.includes('level')) {
    return {
      kind: 'invalid-level',
      message: 'The content level must be "standard" or "strict".',
    };
  }
  if (settings.includes('blockedPresentation')) {
    return {
      kind: 'invalid-presentation',
      message:
        'The blocked presentation must be "placeholder" or "inert-text".',
    };
  }
  return {
    kind: 'invalid-config',
    message: 'The content policy configuration is not valid.',
  };
}

/**
 * Validates unchecked trusted configuration and returns the policy or an explicit failure. An
 * invalid level, a wildcard or otherwise malformed host, an invalid or misplaced blocked
 * presentation, or an unknown setting is a failure; the caller must not mount a view on a
 * guessed, looser policy. Omitted settings take the defaults: Standard with an empty image
 * allowlist, and for Strict, placeholders for blocked fragments.
 */
export function createContentPolicy(config: unknown): CreatePolicyResult {
  const parsed = ConfigSchema.safeParse(config);
  if (!parsed.success) return { ok: false, failure: failureFor(parsed.error) };

  const level = parsed.data.level ?? 'standard';
  if (level === 'standard' && parsed.data.blockedPresentation !== undefined) {
    return {
      ok: false,
      failure: {
        kind: 'invalid-presentation',
        message: 'A blocked presentation applies to the "strict" level only.',
      },
    };
  }
  const requested = parsed.data.imageHosts ?? [];
  for (const host of requested) {
    if (!isExactHost(host)) {
      return {
        ok: false,
        failure: {
          kind: 'invalid-image-host',
          message:
            'Each image host must be an exact lowercase hostname: no wildcard, scheme, port, path or credentials.',
        },
      };
    }
  }
  const imageHosts = Object.freeze([...new Set(requested as string[])].sort());
  const normalizedFontOrigins: string[] = [];
  for (const origin of parsed.data.fontOrigins ?? []) {
    const normalized = normalizeFontOrigin(origin);
    if (normalized === undefined) {
      return {
        ok: false,
        failure: {
          kind: 'invalid-font-origin',
          message:
            'Each font origin must be an exact HTTPS origin, with an explicit port if it is not the default: no wildcard, credentials, path, query or fragment.',
        },
      };
    }
    normalizedFontOrigins.push(normalized);
  }
  const fontOrigins = Object.freeze([...new Set(normalizedFontOrigins)].sort());
  const resource = deriveResourcePolicy(level, imageHosts, fontOrigins);
  const allowedOrigins = new Set(resource.imageOrigins);
  const strict = level === 'strict';
  const blockedPresentation: BlockedPresentation = strict
    ? (parsed.data.blockedPresentation ?? 'placeholder')
    : 'inert-text';
  const configuration: PolicyConfiguration = Object.freeze(
    strict
      ? { level, imageHosts, fontOrigins, blockedPresentation }
      : { level, imageHosts, fontOrigins },
  );

  /** Whether this image could load at all, before the reader's consent is considered. */
  const decideDestination = (
    source: string,
    enforcement: ImageEnforcement,
  ): ImageDecision => {
    const image = parseHttpsUrl(source);
    if (!image.ok) return { allowed: false, reason: image.reason };
    // `origin` includes a non-default port, so only the exact `https://host` origin matches.
    if (!allowedOrigins.has(image.url.origin))
      return { allowed: false, reason: 'host-not-allowed' };
    if (enforcement !== 'established')
      return { allowed: false, reason: 'enforcement-unestablished' };
    return { allowed: true, url: image.url.href };
  };

  const policy: ContentPolicy = Object.freeze({
    level,
    blockedPresentation,
    imageHosts,
    fontOrigins,
    configuration,
    resource,
    decideLink(destination: string): LinkDecision {
      const link = parseHttpsUrl(destination);
      if (!link.ok) return { allowed: false, reason: link.reason };
      if (strict) return { allowed: false, reason: 'strict' };
      return { allowed: true, url: link.url.href, hostname: link.url.hostname };
    },
    decideImage(source: string, context: ImageContext): ImageDecision {
      const decision = decideDestination(source, context.enforcement);
      if (decision.allowed && strict && context.consent !== 'granted') {
        return { allowed: false, reason: 'consent-required' };
      }
      return decision;
    },
    offerImages(
      sources: readonly string[],
      enforcement: ImageEnforcement,
    ): ImageOffer {
      if (!strict) return { available: false, reason: 'not-applicable' };
      if (sources.length === 0)
        return { available: false, reason: 'no-images' };
      const qualifying = sources.filter(
        (source) => decideDestination(source, enforcement).allowed,
      ).length;
      return qualifying === 0
        ? { available: false, reason: 'none-qualify' }
        : { available: true, qualifying };
    },
  });
  return { ok: true, policy };
}

/** Standard with an empty image allowlist: the policy an application gets by configuring nothing. */
export const DEFAULT_CONTENT_POLICY: ContentPolicy = (() => {
  const created = createContentPolicy({});
  if (!created.ok) throw new Error(created.failure.message);
  return created.policy;
})();

/**
 * Image loading is enforced only when the document carries exactly the restrictions derived from
 * this policy. `appliedPolicies` are the Content-Security-Policy values found in the document.
 * Anything else, including their absence, leaves every image inert.
 */
export function establishImageEnforcement(
  policy: ContentPolicy,
  appliedPolicies: readonly string[],
): ImageEnforcement {
  return appliedPolicies.includes(policy.resource.contentSecurityPolicy)
    ? 'established'
    : 'unestablished';
}
