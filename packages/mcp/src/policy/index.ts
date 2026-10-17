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
 * How long one operation's handler may be waited for when its declaration states no bound. The
 * wait is finite on purpose: expiry retires the handler's result and returns the declared safe
 * failure. This is the established per-operation wait, not a whole-request deadline.
 */
export const DEFAULT_OPERATION_BOUND_MS = 5_000;
