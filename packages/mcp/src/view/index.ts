// The browser side of MCP Apps delivery: the view's lifetime, host links, sizing and the reading
// profile of the host. Types from the MCP packages only; no server code and no renderer.

export {
  runToolResultView,
  ViewStartFailure,
  type HostContext,
  type ToolInput,
  type ToolResult,
  type ToolResultView,
  type ToolResultViewDependencies,
  type ViewErrorPhase,
  type ViewFailureKind,
} from './run-tool-result-view.js';
export { hostLinksFromApp } from './host-links.js';
export { startOwnSizing } from './own-sizing.js';
export { readingProfile, type ReadingProfile } from './reading-profile.js';
export { deliveredResultFromToolResult } from './delivered-result.js';
