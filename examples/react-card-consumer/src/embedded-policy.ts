import { createContentPolicy, type ContentPolicy, type CreatePolicyResult } from '@saga-a2ui/components/faithful-card';

// How the application's content policy travels inside the one document it serves. The server writes
// the policy-derived Content-Security-Policy and the policy's configuration into the HTML, and the
// view rebuilds the same policy from that configuration, validating it again. The document is the
// only source: a tool result, an answer or an A2UI property can never supply or change it. Both sides
// use this module so the format has one owner.

export const CONTENT_POLICY_ELEMENT_ID = 'saga-content-policy';

const HEAD_OPENING = /<head(\s[^>]*)?>/i;
const CHARSET_META = /<meta\s+charset=[^>]*>/i;

/** JSON that can sit inside a script element: `<` can never start a closing tag. */
function inertJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/**
 * Returns `viewHtml` with the policy's restrictions and configuration at the start of its head (after
 * the charset declaration, which must stay near the top), so the restrictions precede every script.
 */
export function embedPolicy(viewHtml: string, policy: ContentPolicy): string {
  const head = HEAD_OPENING.exec(viewHtml);
  if (head === null) throw new Error('The view document has no <head> to carry its content restrictions.');
  const restrictions = `<meta http-equiv="Content-Security-Policy" content="${policy.resource.contentSecurityPolicy}">`;
  const configuration = `<script type="application/json" id="${CONTENT_POLICY_ELEMENT_ID}">${inertJson(policy.configuration)}</script>`;
  const charset = CHARSET_META.exec(viewHtml);
  const insertAt = charset !== null && charset.index > head.index ? charset.index + charset[0].length : head.index + head[0].length;
  return viewHtml.slice(0, insertAt) + restrictions + configuration + viewHtml.slice(insertAt);
}

/**
 * Rebuilds the policy from the embedded configuration text. Nothing embedded means the default
 * Standard policy with empty lists; anything embedded that does not validate is a failure, so a view
 * is never mounted on a guessed policy.
 */
export function policyFromEmbedded(text: string | null): CreatePolicyResult {
  if (text === null) return createContentPolicy({});
  let configuration: unknown;
  try {
    configuration = JSON.parse(text);
  } catch {
    return { ok: false, failure: { kind: 'invalid-config', message: 'The embedded content policy is not valid JSON.' } };
  }
  return createContentPolicy(configuration);
}
