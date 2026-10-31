// The Lit and MCP Apps stack, main entry: an application's own catalog and nothing else. It
// imports nothing from `@saga-a2ui/components`, so an own-catalog application's emitted browser
// bundle holds neither the FaithfulCard nor a Markdown parser. (Its installed tree does include
// them, as declared dependencies of the stack; the card application's entry is `/faithful-card`.)
//
// An application that installs this stack and Lit writes its view, its catalog and its actions
// against the names below and declares no other SDK or upstream package for them. The list is
// what the qualifying consumers use, no more.
export {
  startA2uiView,
  type BoundSurface,
  type RunningA2uiView,
  type StartA2uiViewOptions,
  type ViewHost,
} from './start-a2ui-view.js';
// What a start can fail with and the phase an `onError` callback is told; the card entry shares them.
export {
  StartError,
  StartFailure,
  type ErrorPhase,
  type StartFailureKind,
  type StartMisuse,
} from './start-failure.js';
export type { RunningView } from './running-view.js';
// The shapes of the two notifications an application's handlers receive.
export type { ToolInput, ToolResult } from '@saga-a2ui/mcp/view';
// How the reader meets the host (device or desktop), for an application that maps its own tokens.
export { readingProfile, type ReadingProfile } from '@saga-a2ui/mcp/view';
// The link opener a running view hands its actions, for an optional card the catalog includes.
export type { HostLinks } from '@saga-a2ui/core/host-links';
// The conversation a running view hands its actions, and the results of adding a message to it.
export type {
  AppendResult,
  Conversation,
  RequestOutcome,
} from '@saga-a2ui/core/conversation';
// The authoring surface of an own-catalog application: the layout and its schemas.
export { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
export type { SurfaceLayout } from '@saga-a2ui/core/protocols/a2ui/v0_9';
export { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
// The catalog an application builds: its components over upstream's component API, and the
// catalog value and schemas it declares them with.
export {
  A2uiLitElement,
  basicCatalog,
  Catalog,
  CommonSchemas,
  type LitComponentApi,
} from '@saga-a2ui/lit';
// The actions an application attaches to the controls it renders.
export {
  ActionButton,
  actionButtonEntry,
  createLitActions,
  type ActionButtonActivation,
  type LitActionsOptions,
} from '@saga-a2ui/lit/actions';
export { Action, type ActionBinding } from '@saga-a2ui/core/actions';
