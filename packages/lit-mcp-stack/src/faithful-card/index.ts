// The Lit and MCP Apps stack, card entry: a FaithfulCard application started from one validated
// definition. The Lit card styles itself; there is no stylesheet to import.
export { FaithfulCardApp } from '@saga-a2ui/components/faithful-card';
export type {
  CardContent,
  CardResultOutcome,
  FaithfulCardAppDefinition,
} from '@saga-a2ui/components/faithful-card';
export {
  startFaithfulCardApp,
  type CardChrome,
  type CardChromeParts,
  type CardViewState,
  type StartFaithfulCardOptions,
} from './start-faithful-card-app.js';
export {
  contentPolicyFromDocument,
  documentContentSecurityPolicies,
} from './document-policy.js';
export { StartFailure, type StartFailureKind } from '../start-failure.js';
export type { RunningView } from '../running-view.js';
// A link the card's host can be asked to open, for the application's own chrome.
export {
  bindHostLink,
  type HostLinkBinding,
  type HostLinkOutcome,
} from '@saga-a2ui/lit/faithful-card';
// How the reader meets the host (device or desktop), for an application that maps its own tokens.
export { readingProfile, type ReadingProfile } from '@saga-a2ui/mcp/view';
