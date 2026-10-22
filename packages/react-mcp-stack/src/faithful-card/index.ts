// The React and MCP Apps stack, card entry: a FaithfulCard application started from one validated
// definition. Import the card's stylesheet from `@saga-a2ui/react-mcp-stack/faithful-card.css`.
export { FaithfulCardApp } from '@saga-a2ui/components/faithful-card';
export type {
  CardContent,
  CardResultOutcome,
  FaithfulCardAppDefinition,
} from '@saga-a2ui/components/faithful-card';
export {
  startFaithfulCardApp,
  type CardChromeProps,
  type CardViewState,
  type StartFaithfulCardOptions,
} from './start-faithful-card-app.js';
export { StartFailure, type StartFailureKind } from '../start-failure.js';
export type { RunningView } from '../running-view.js';
// A link the card's host can be asked to open, for the application's own chrome.
export {
  useHostLink,
  type HostLink,
  type HostLinkOutcome,
} from '@saga-a2ui/react/faithful-card';
// How the reader meets the host (device or desktop), for an application that maps its own tokens.
export { readingProfile, type ReadingProfile } from '@saga-a2ui/mcp/view';
