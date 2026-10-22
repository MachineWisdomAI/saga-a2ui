import type { HostLinks } from './host-links.js';
import {
  createImageConsentScope,
  type ImageConsentScope,
} from './image-consent.js';
import {
  establishImageEnforcement,
  type ContentPolicy,
  type ImageEnforcement,
} from './policy.js';
import {
  createFaithfulCardReader,
  type FaithfulCardReader,
  type ReaderFailure,
} from './reader.js';

/**
 * What an application decides once for its card: the Markdown dialect and a finite bound for the
 * content, the content policy it was served with, the Content-Security-Policy values its document
 * carries (the restrictions image loading relies on) and the one way a link leaves the page. The
 * values are data: nothing here reads a document, so a caller that has one reads it and passes
 * the values in.
 */
export interface CardViewSettings {
  readonly dialect: 'commonmark' | 'commonmark-tables-strikethrough';
  readonly maxLength: number;
  readonly policy: ContentPolicy;
  readonly contentSecurityPolicies: readonly string[];
  readonly hostLinks: HostLinks;
}

/** The trusted parts every renderer's card view is made of. Renderers add nothing to them. */
export interface CardViewParts {
  readonly reader: FaithfulCardReader;
  readonly policy: ContentPolicy;
  readonly hostLinks: HostLinks;
  /** Images load only when `contentSecurityPolicies` carried exactly the restrictions the policy derives. */
  readonly imageEnforcement: ImageEnforcement;
  /** This view's own consent scope; whoever ends the view ends it. */
  readonly consent: ImageConsentScope;
}

const SETTING_OF_FAILURE: Record<ReaderFailure['kind'], string> = {
  'invalid-dialect': 'dialect',
  'invalid-limit': 'maxLength',
  'invalid-config': 'settings',
};

/**
 * Establishes the trusted parts of a card view. Throws an `Error` that names the offending
 * setting (`dialect` or `maxLength`) and builds nothing when the reader settings are not valid:
 * a card must not be mounted on guessed settings.
 */
export function createCardView(settings: CardViewSettings): CardViewParts {
  const reader = createFaithfulCardReader({
    dialect: settings.dialect,
    maxLength: settings.maxLength,
  });
  if (!reader.ok)
    throw new Error(
      `Invalid FaithfulCard ${SETTING_OF_FAILURE[reader.failure.kind]}: ${reader.failure.message}`,
    );
  return {
    reader: reader.reader,
    policy: settings.policy,
    hostLinks: settings.hostLinks,
    imageEnforcement: establishImageEnforcement(
      settings.policy,
      settings.contentSecurityPolicies,
    ),
    consent: createImageConsentScope(),
  };
}
