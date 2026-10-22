// The React and MCP Apps stack, card entry: a FaithfulCard application started from one validated
// definition. Import the card's stylesheet from `@saga-a2ui/react-mcp-stack/faithful-card.css`.
export { FaithfulCardApp } from '@saga-a2ui/components/faithful-card';
export type {
  CardContent,
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
