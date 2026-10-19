// MCP delivery decisions that the server and the view (and the application composing them)
// must agree on. This module has no runtime imports: no renderer, no Node module, no MCP server
// and no application policy such as who may see which subscription.

/**
 * What the host may let an operation's view load. These are the `_meta.ui.csp` arrays an MCP
 * Apps host reads before it mounts the resource; each entry is an exact origin.
 */
export interface ViewCsp {
  readonly connectDomains: readonly string[];
  readonly resourceDomains: readonly string[];
  readonly frameDomains: readonly string[];
  readonly baseUriDomains: readonly string[];
}

/** A view that may reach no network and load no external resource. The conservative default. */
export const CLOSED_VIEW_CSP: ViewCsp = Object.freeze({
  connectDomains: Object.freeze([]),
  resourceDomains: Object.freeze([]),
  frameDomains: Object.freeze([]),
  baseUriDomains: Object.freeze([]),
});

/**
 * How long one server operation may be waited for when neither the operation, its route nor the
 * SDK instance states a limit: admission, credential verification, body ingestion, the complete
 * handler including projection, an authorization lookup and a storage read are each an operation.
 * An overridable product default, not a latency guarantee.
 */
export const DEFAULT_OPERATION_MS = 3_000;

/**
 * How long one whole server request may run, from the adapter's admission of it (before
 * authentication) through transport finish of a finite response, when no route or SDK instance
 * states a limit. An established streaming response has an idle policy of its own instead.
 */
export const DEFAULT_REQUEST_MS = 10_000;

export { startBoundedTimer } from './timer.js';
