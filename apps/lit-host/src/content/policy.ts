import { z } from 'zod';

// The trusted content policy: one immutable value, created by the application when it creates a
// view. It decides which content effects are permitted (link activation and image requests) and
// derives the resource restrictions that must agree with those decisions. It knows nothing of
// Markdown, Lit, MCP or any host, and nothing in a description, tool result or A2UI property can
// change it. Standard is the only level in this slice.

/** The most exact image hosts one policy may name. A finite bound keeps the derived policy small. */
export const MAX_IMAGE_HOSTS = 32;

export type ContentLevel = 'standard';

export type PolicyFailure =
  | { readonly kind: 'invalid-level'; readonly message: string }
  | { readonly kind: 'invalid-image-host'; readonly message: string }
  | { readonly kind: 'invalid-config'; readonly message: string };

export type CreatePolicyResult =
  | { readonly ok: true; readonly policy: ContentPolicy }
  | { readonly ok: false; readonly failure: PolicyFailure };

export type LinkDecision =
  | { readonly allowed: true; readonly url: string; readonly hostname: string }
  | { readonly allowed: false; readonly reason: 'malformed' | 'not-https' | 'credentials' };

export type ImageDecision =
  | { readonly allowed: true; readonly url: string }
  | {
      readonly allowed: false;
      readonly reason: 'malformed' | 'not-https' | 'credentials' | 'host-not-allowed' | 'enforcement-unestablished';
    };

/** Whether the mounted document demonstrably carries the restrictions this policy derives. */
export type ImageEnforcement = 'established' | 'unestablished';

/** Content-related restrictions the resource must declare before it is mounted. */
export interface ResourcePolicy {
  /** Exact HTTPS origins that may serve images. Empty means no content image may load. */
  readonly imageOrigins: readonly string[];
  /**
   * A Content-Security-Policy that grants the image origins to `img-src` only. A host that
   * builds its own policy from the resource's `resourceDomains` can broaden scripts, styles,
   * fonts and media to those origins; this policy is applied in addition to the host's, and a
   * document must satisfy both, so no origin gains any permission other than loading images.
   * `'unsafe-inline'` covers the single-file view's own inline script and styles and no origin.
   */
  readonly contentSecurityPolicy: string;
}

export interface ContentPolicy {
  readonly level: ContentLevel;
  /** Exact lowercase hostnames, sorted and without duplicates. */
  readonly imageHosts: readonly string[];
  readonly resource: ResourcePolicy;
  /** Only an absolute HTTPS destination without credentials may be activated. */
  decideLink(destination: string): LinkDecision;
  /** Permits an image only from an exactly listed host, and only with demonstrated enforcement. */
  decideImage(source: string, enforcement: ImageEnforcement): ImageDecision;
}

const ConfigSchema = z
  .object({
    level: z.literal('standard').optional(),
    imageHosts: z.array(z.unknown()).max(MAX_IMAGE_HOSTS).optional(),
  })
  .strict();

/** A host entry is valid only when it is already the canonical lowercase ASCII hostname. */
function isExactHost(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate === '' || candidate.includes('*') || candidate.endsWith('.')) {
    return false;
  }
  try {
    return new URL(`https://${candidate}`).hostname === candidate;
  } catch {
    return false;
  }
}

type ParsedUrl =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: 'malformed' | 'not-https' | 'credentials' };

function parseHttpsUrl(raw: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' };
  return { ok: true, url };
}

function deriveResourcePolicy(imageHosts: readonly string[]): ResourcePolicy {
  const imageOrigins = Object.freeze(imageHosts.map((host) => `https://${host}`));
  const contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src ${imageOrigins.join(' ') || "'none'"}`,
    "font-src 'none'",
    "media-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return Object.freeze({ imageOrigins, contentSecurityPolicy });
}

/**
 * Validates unchecked trusted configuration and returns the policy or an explicit failure. An
 * invalid level, a wildcard or otherwise malformed host, or an unknown setting is a failure; the
 * caller must not mount a view on a guessed, looser policy. Omitted settings take the defaults:
 * Standard with an empty image allowlist.
 */
export function createContentPolicy(config: unknown): CreatePolicyResult {
  const parsed = ConfigSchema.safeParse(config);
  if (!parsed.success) {
    const levelIssue = parsed.error.issues.some((issue) => issue.path[0] === 'level');
    return {
      ok: false,
      failure: levelIssue
        ? { kind: 'invalid-level', message: 'Only the "standard" content level is supported.' }
        : { kind: 'invalid-config', message: 'The content policy configuration is not valid.' },
    };
  }
  const requested = parsed.data.imageHosts ?? [];
  for (const host of requested) {
    if (!isExactHost(host)) {
      return {
        ok: false,
        failure: {
          kind: 'invalid-image-host',
          message: 'Each image host must be an exact lowercase hostname: no wildcard, scheme, port, path or credentials.',
        },
      };
    }
  }
  const imageHosts = Object.freeze([...new Set(requested as string[])].sort());
  const resource = deriveResourcePolicy(imageHosts);
  const allowedOrigins = new Set(resource.imageOrigins);

  const policy: ContentPolicy = Object.freeze({
    level: 'standard' as const,
    imageHosts,
    resource,
    decideLink(destination: string): LinkDecision {
      const link = parseHttpsUrl(destination);
      if (!link.ok) return { allowed: false, reason: link.reason };
      return { allowed: true, url: link.url.href, hostname: link.url.hostname };
    },
    decideImage(source: string, enforcement: ImageEnforcement): ImageDecision {
      const image = parseHttpsUrl(source);
      if (!image.ok) return { allowed: false, reason: image.reason };
      // `origin` includes a non-default port, so only the exact `https://host` origin matches.
      if (!allowedOrigins.has(image.url.origin)) return { allowed: false, reason: 'host-not-allowed' };
      if (enforcement !== 'established') return { allowed: false, reason: 'enforcement-unestablished' };
      return { allowed: true, url: image.url.href };
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
  return appliedPolicies.includes(policy.resource.contentSecurityPolicy) ? 'established' : 'unestablished';
}
