// The Lit and MCP Apps stack, main entry: an application's own catalog and nothing else. It
// imports nothing from `@saga-a2ui/components`, so an own-catalog application's emitted browser
// bundle holds neither the FaithfulCard nor a Markdown parser. (Its installed tree does include
// them, as declared dependencies of the stack; the card application's entry is `/faithful-card`.)
export {
  startA2uiView,
  type BoundSurface,
  type RunningA2uiView,
  type StartA2uiViewOptions,
  type ViewHost,
} from './start-a2ui-view.js';
export { StartFailure, type StartFailureKind } from './start-failure.js';
export type { RunningView } from './running-view.js';
// The shapes of the two notifications an application's handlers receive.
export type { ToolInput, ToolResult } from '@saga-a2ui/mcp/view';
// The authoring surface of an own-catalog application: what the qualifying consumer imports.
export { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
export type { SurfaceLayout } from '@saga-a2ui/core/protocols/a2ui/v0_9';
export { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
export {
  ActionButton,
  actionButtonEntry,
  createLitActions,
  type LitActionsOptions,
} from '@saga-a2ui/lit/actions';
