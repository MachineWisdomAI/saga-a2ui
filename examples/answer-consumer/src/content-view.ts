import {
  createContentPolicy,
  createFaithfulCardReader,
  createImageConsentScope,
  establishImageEnforcement,
} from '@saga-a2ui/components/faithful-card';
import { type HostLinks } from '@saga-a2ui/core/host-links';
import {
  documentContentSecurityPolicies,
  type ContentView,
} from '@saga-a2ui/lit/faithful-card';

/**
 * The trusted settings of the card, created once by the application: the Markdown dialect and a
 * finite bound for its long answers, the content policy with the hosts images may come from, how
 * a link leaves the page, and the image restrictions the document actually carries. Nothing in an
 * answer can change any of them.
 */
export function createContentView(settings: {
  readonly level: 'standard' | 'strict';
  readonly imageHosts: readonly string[];
  readonly hostLinks: HostLinks;
}): ContentView {
  const reader = createFaithfulCardReader({
    dialect: 'commonmark-tables-strikethrough',
    maxLength: 50_000,
  });
  const policy = createContentPolicy({
    level: settings.level,
    imageHosts: settings.imageHosts,
  });
  if (!reader.ok) throw new Error(reader.failure.message);
  if (!policy.ok) throw new Error(policy.failure.message);
  return {
    reader: reader.reader,
    policy: policy.policy,
    hostLinks: settings.hostLinks,
    // Images load only if this document declares exactly the restrictions the policy derives (a
    // Content-Security-Policy meta element, or the host's equivalent); otherwise they stay inert.
    imageEnforcement: establishImageEnforcement(
      policy.policy,
      documentContentSecurityPolicies(document),
    ),
    consent: createImageConsentScope(),
  };
}
