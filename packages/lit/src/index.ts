export {
  createA2uiAppElement,
  type A2uiActions,
  type A2uiAppDependencies,
  type A2uiSession,
  type A2uiSurfaceMount,
  type A2uiUpdateFailure,
  type A2uiUpdateResult,
} from './a2ui/app-element.js';
export {
  defineElements,
  ElementConflictError,
  type ElementDefinition,
  type ElementRegistry,
} from './element-registration.js';
// The catalog an application builds: its own components over upstream's component API, and the
// catalog value and schemas it declares them with. These are upstream A2UI v0.9 APIs, re-exported
// so an application that installs a stack names no upstream package for them.
export {
  A2uiLitElement,
  basicCatalog,
  type LitComponentApi,
} from '@a2ui/lit/v0_9';
export { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9';
