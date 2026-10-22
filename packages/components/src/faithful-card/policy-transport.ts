import { headInsertionPoint } from './head-insertion.js';
import {
  createContentPolicy,
  type ContentPolicy,
  type CreatePolicyResult,
} from './policy.js';

// How a content policy travels inside the one document an application serves. The server writes the
// policy-derived Content-Security-Policy and the policy's configuration into the HTML, and the view
// rebuilds the same policy from that configuration, validating it again. The document is the only
// source: a tool result, an answer or an A2UI property can never supply or change it. This module
// is the one owner of the format. It works on strings alone, so a server runs it without a DOM; a
// stack reads the document and passes the configuration text to `contentPolicyFromEmbedded`.

/** The `id` of the script element that carries the policy's configuration. */
export const CONTENT_POLICY_ELEMENT_ID = 'saga-content-policy';

/**
 * JSON that can sit inside a script element. Every `<` is written as the six characters
 * backslash, `u`, `0`, `0`, `3`, `c`, so no value can contain a closing tag or open a comment;
 * JSON decoding restores the original text.
 */
function inertJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/**
 * Returns the view document with the policy-derived `Content-Security-Policy` meta and the
 * policy's configuration inserted where they precede every script: immediately after the head's
 * start tag, or after a `<meta charset>` only when that is head's first element. The position is
 * found in the document's real structure (a `>` in a quoted attribute or a comment that mentions a
 * head does not move it) and the rest of the text is kept byte for byte. Throws, so that nothing
 * is served, when the document has no `<head>` of its own, has a script or any other element but
 * `html` before it, declares its charset anywhere but as head's first element, or when the
 * policy's Content-Security-Policy contains a `"`.
 */
export function embedContentPolicy(
  html: string,
  policy: ContentPolicy,
): string {
  const contentSecurityPolicy = policy.resource.contentSecurityPolicy;
  if (contentSecurityPolicy.includes('"'))
    throw new Error(
      'The content security policy contains a double quote, which would end its attribute.',
    );
  const insertAt = headInsertionPoint(html);
  const restrictions = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">`;
  const configuration = `<script type="application/json" id="${CONTENT_POLICY_ELEMENT_ID}">${inertJson(policy.configuration)}</script>`;
  return (
    html.slice(0, insertAt) +
    restrictions +
    configuration +
    html.slice(insertAt)
  );
}

/**
 * Rebuilds the policy from the text of the configuration element. `null` (no element) means the
 * default Standard policy with empty lists; anything else that does not validate is a failure, so
 * a view is never mounted on a guessed policy.
 */
export function contentPolicyFromEmbedded(
  text: string | null,
): CreatePolicyResult {
  if (text === null) return createContentPolicy({});
  let configuration: unknown;
  try {
    configuration = JSON.parse(text);
  } catch {
    return {
      ok: false,
      failure: {
        kind: 'invalid-config',
        message: 'The embedded content policy is not valid JSON.',
      },
    };
  }
  return createContentPolicy(configuration);
}

/**
 * What the policy asks of a resource's host: the document's own Content-Security-Policy and the
 * origins to declare as `resourceDomains`. A structural value, so a delivery package can consume
 * it without importing this one.
 */
export function resourcePermissionsOf(policy: ContentPolicy): {
  readonly contentSecurityPolicy: string;
  readonly resourceDomains: readonly string[];
} {
  return {
    contentSecurityPolicy: policy.resource.contentSecurityPolicy,
    resourceDomains: policy.resource.resourceDomains,
  };
}
