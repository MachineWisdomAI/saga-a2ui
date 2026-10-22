import {
  createContentPolicy,
  type HostLinks,
  type ImageConsentScope,
  type ImageEnforcement,
  type LinkOpenOutcome,
} from '@saga-a2ui/components/faithful-card';
import { createFaithfulCardView } from './content-view.js';
import type { ContentView } from './content-view.js';

// Test-only. A trusted view as an application builds it through the public factory, whose host
// links record what they were asked and answer as the test decides.

export interface TrustedOptions {
  readonly level?: 'standard' | 'strict';
  readonly imageHosts?: readonly string[];
  readonly maxLength?: number;
  /** Whether the document demonstrably carries the policy's image restrictions. Default: established. */
  readonly enforcement?: ImageEnforcement;
  /** What the host answers when asked to open a link. */
  readonly answer?:
    | LinkOpenOutcome
    | 'pending'
    | 'reject'
    | ((url: string) => Promise<LinkOpenOutcome>);
}

export interface Trusted {
  readonly view: ContentView;
  /** Every URL the host was asked to open, in order. */
  readonly requests: string[];
  /** Answers for each request made while the host's answer was `pending`, in order. */
  readonly pending: Array<(outcome: LinkOpenOutcome) => void>;
  readonly consent: ImageConsentScope;
}

export function trusted(options: TrustedOptions = {}): Trusted {
  const policy = createContentPolicy({
    level: options.level ?? 'standard',
    imageHosts: [...(options.imageHosts ?? [])],
  });
  if (!policy.ok) throw new Error(policy.failure.message);
  const requests: string[] = [];
  const pending: Array<(outcome: LinkOpenOutcome) => void> = [];
  const answer = options.answer ?? 'opened';
  const hostLinks: HostLinks = {
    open(url) {
      requests.push(url);
      if (answer === 'pending')
        return new Promise<LinkOpenOutcome>(
          (resolve) => void pending.push(resolve),
        );
      if (answer === 'reject')
        return Promise.reject(new Error('the host adapter failed'));
      if (typeof answer === 'function') return answer(url);
      return Promise.resolve(answer);
    },
  };
  const view = createFaithfulCardView({
    dialect: 'commonmark-tables-strikethrough',
    maxLength: options.maxLength ?? 5000,
    policy: policy.policy,
    contentSecurityPolicies:
      (options.enforcement ?? 'established') === 'established'
        ? [policy.policy.resource.contentSecurityPolicy]
        : [],
    hostLinks,
  });
  return { view, consent: view.consent, requests, pending };
}

/** Lets pending promise callbacks and Lit's asynchronous updates run. */
export const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Every element matching `selector` beneath `root`, looking through the shadow roots the card sits in. */
export function queryDeep(root: Element, selector: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (node: ParentNode): void => {
    found.push(...node.querySelectorAll<HTMLElement>(selector));
    for (const element of node.querySelectorAll('*'))
      if (element.shadowRoot) visit(element.shadowRoot);
  };
  if (root.shadowRoot) visit(root.shadowRoot);
  visit(root);
  return found;
}
