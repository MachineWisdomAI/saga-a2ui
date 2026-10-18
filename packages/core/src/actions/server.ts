// What a server action needs from its application. The action module never imports an MCP package:
// the transport is the application's seam, declared here by the shape of what the action sends
// and what it gets back. In the example application the transport is the MCP Apps `App` itself,
// whose `callServerTool(params, options)` accepts these request and option shapes and returns a
// `CallToolResult`; the application's own tests qualify that against the pinned package types.

/** What the action asks the server to do: a tool name and its arguments. */
export interface ServerRequest {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

/**
 * The options the runtime builds for every request. The handler never supplies them: `signal` is
 * the invocation's own signal and `timeout` is the time left on the work deadline.
 */
export interface ServerRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

/**
 * What a returned reply must at least have. A tool-level failure arrives as a reply with
 * `isError: true`, not as an exception, and the handler decides what that means for its action.
 */
export interface ServerReply {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
}

/**
 * The application's way to reach its server. A rejection means the request did not complete as a
 * request: a timeout, a lost connection or a host refusing it. Whether the server applied the
 * request is then unknown. `Reply` lets a transport keep its own reply type.
 */
export interface ServerTransport<Reply extends ServerReply = ServerReply> {
  callServerTool(request: ServerRequest, options?: ServerRequestOptions): Promise<Reply>;
}

/** What a handler may ask for beyond the arguments: a shorter wait. It can never be longer. */
export interface ServerCallOptions {
  /** Finite and positive. The request waits for the smaller of this and the time left on the work deadline. */
  readonly timeoutMs?: number;
}

/** Added to the handler context of a server action, and only of a server action. */
export interface ServerCalls<Reply extends ServerReply = ServerReply> {
  /**
   * Sends one request through the transport and returns the transport's reply unchanged. The
   * request carries the invocation's signal and a timeout that is the time left on the work
   * deadline, or less. A call after the invocation stopped waiting for the handler, or after the
   * work deadline, rejects without sending anything. The timeout covers one call, not the whole
   * invocation, and aborting the signal ends the client's wait: it does not show that the host
   * forwarded the cancellation or that the server stopped.
   */
  call(name: string, args: Readonly<Record<string, unknown>>, options?: ServerCallOptions): Promise<Reply>;
}

/** Work deadline and hook budget are both required for a server action. Each finite and positive. */
export interface ServerLimits {
  readonly deadlineMs: number;
  readonly hookMs: number;
}

/** Reads the transport an application passed: an object with a `callServerTool` function. */
export function checkTransport(label: string, transport: unknown): ServerTransport {
  const candidate = transport as { callServerTool?: unknown } | null | undefined;
  if (typeof candidate !== 'object' || candidate === null || typeof candidate.callServerTool !== 'function') {
    throw new TypeError(`Action '${label}': a server action needs a transport with a callServerTool function.`);
  }
  return candidate as ServerTransport;
}

/** The smallest of the time left and the handler's own narrower request, or why there is none. */
export function requestTimeout(label: string, remainingMs: number, supplied: unknown): number {
  if (supplied !== undefined && (typeof supplied !== 'number' || !Number.isFinite(supplied) || supplied <= 0)) {
    throw new TypeError(`Action '${label}': timeoutMs must be a finite number greater than zero.`);
  }
  return supplied === undefined ? remainingMs : Math.min(remainingMs, supplied);
}
