// The React and MCP Apps stack, card entry: a FaithfulCard application started from one validated
// definition. Import the card's stylesheet from `@saga-a2ui/react-mcp-stack/faithful-card.css`.
export { FaithfulCardApp } from '@saga-a2ui/components/faithful-card';
export type {
  CardContent,
  CardResultOutcome,
  CardResultReader,
  FaithfulCardAppDefinition,
} from '@saga-a2ui/components/faithful-card';
// What an application's `result` reader receives: the delivery-neutral whole result.
export type { DeliveredResult } from '@saga-a2ui/core/delivered-result';
export {
  startFaithfulCardApp,
  type CardChromeProps,
  type CardViewState,
  type StartFaithfulCardOptions,
} from './start-faithful-card-app.js';
// The failures `startFaithfulCardApp` reports, and the phase its `onError` callback is told: the
// same values the main entry exports, so one `catch` serves an application that uses both.
export {
  StartError,
  StartFailure,
  type ErrorPhase,
  type StartFailureKind,
  type StartMisuse,
} from '../start-failure.js';
export type { RunningView } from '../running-view.js';
// A link the card's host can be asked to open, for the application's own chrome.
export {
  useHostLink,
  type HostLink,
  type HostLinkOutcome,
} from '@saga-a2ui/react/faithful-card';
// How the reader meets the host (device or desktop), for an application that maps its own tokens.
export { readingProfile, type ReadingProfile } from '@saga-a2ui/mcp/view';
