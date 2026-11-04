// Keep the renderer and its catalog types in the React package's Zod 3 dependency context.
// These are upstream A2UI v0.9 APIs, not another implementation of the protocol.
export {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
  type ReactComponentImplementation,
  type NodeViewProps,
} from '@a2ui/react/v0_9';
export { Catalog, CommonSchemas, type SurfaceModel } from '@a2ui/web_core/v0_9';
// The layout components' contracts, for an application that builds its own layout components
// over them (`createComponentImplementation(ColumnApi, ...)`); `@a2ui/react` ships no basic catalog.
export { ColumnApi, ListApi, RowApi } from '@a2ui/web_core/v0_9/basic_catalog';
export {
  openSurface,
  Surface,
  type BoundSurface,
  type SurfaceHandle,
  type UpdateFailure,
  type UpdateResult,
} from './bound-surface.js';
