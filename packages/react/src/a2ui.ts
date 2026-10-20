// Keep the renderer and its catalog types in the React package's Zod 3 dependency context.
// These are upstream A2UI v0.9 APIs, not another implementation of the protocol.
export {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
  type ReactComponentImplementation,
  type NodeViewProps,
} from '@a2ui/react/v0_9';
export {Catalog, CommonSchemas, type SurfaceModel} from '@a2ui/web_core/v0_9';
