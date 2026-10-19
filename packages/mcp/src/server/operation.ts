import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { AuthInfo, CallToolResult, McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { ViewCsp } from '../policy/index.js';
import { createServerBudgets, throwIfEnded, valueOrThrow, type BoundedScope, type RequestLifetime } from './lifetime.js';

// Declared MCP operations. The application owns the listener, authentication, domain
// authorization and every backend effect; it hands this module an operation declaration and an
// MCP server it created. This module validates the input before the handler runs, waits for the
// handler only within its bound, projects the handler's record explicitly, validates that
// projection against the declared output contract, and returns a safe failure for everything
// else. Upstream tool registration stays here: there is no SAGA registry of operations.
//
// Time: the complete handler, projection included, runs as one `handler` operation inside the
// request's lifetime (see `lifetime.ts`). Its limit is the declaration's `boundMs`, else the
// route/SDK-instance operation limit (3,000 ms by default), and it never outlasts what the request
// has left. Work the handler starts through `OperationRequest.within` shares that one aggregate
// budget. Unreleased preparation slice (CORE1): the full SSE/progress and delayed-completion
// matrix remains CORE3's.

/** The view the host mounts for an operation's result. The application builds it from its built bundle. */
export interface OperationView {
  readonly uri: string;
  /** Resource name shown in `resources/list`. */
  readonly title: string;
  /** The immutable document, served verbatim. Request data never enters it. */
  readonly html: string;
  readonly csp: ViewCsp;
}

/** Safe tool-failure texts. Each is fixed text: no backend detail, validator message or field value. */
export interface OperationFailures {
  /** The handler found no record to publish. */
  readonly absent: string;
  /** The handler failed, was cancelled, or did not finish within the bound. */
  readonly unavailable: string;
  /** The projection broke the declared output contract. */
  readonly invalidOutput: string;
}

export interface ProtectedFailures extends OperationFailures {
  /** The transport verified no identity the application accepts. The handler does not run. */
  readonly signInRequired: string;
}

export interface ProgressUpdate {
  readonly progress: number;
  readonly total?: number;
  readonly message?: string;
}

/** Stages a handler can name for work nested inside its own budget. */
export type NestedStage = 'authorization' | 'storage' | 'dependency';

/** What a handler may observe and do for the one request it serves. */
export interface OperationRequest {
  /**
   * Aborts when the caller cancels or disconnects, when the handler's budget or the request's
   * deadline expires, and once the operation has finished. The application cleans up work it cannot
   * interrupt; a result that arrives after any of these is dropped.
   */
  readonly signal: AbortSignal;
  /**
   * Runs one dependency call (an authorization lookup, a storage read) inside this handler's
   * aggregate budget. The call gets a signal to stop on, waits no longer than `limitMs` or what the
   * handler has left, and cannot renew either. Rejects with a `StageFailure` carrying the typed
   * cause when it does not finish; a handler may catch that and keep a known result.
   */
  within<T>(stage: NestedStage, work: (signal: AbortSignal) => T | PromiseLike<T>, options?: { readonly limitMs?: number }): Promise<T>;
  /**
   * Reports progress to a caller that asked for it. Reports after the operation has finished or
   * been retired are dropped quietly, so a late callback cannot reach the caller.
   */
  reportProgress(update: ProgressUpdate): Promise<void>;
}

/** What a handler decided about its input. Anything else it does is a failure (throw or reject). */
export type OperationOutcome<Found> =
  | { readonly kind: 'record'; readonly record: Found }
  | { readonly kind: 'absent' }
  /** The business input is well-formed but not accepted; `text` is a fixed safe failure text. */
  | { readonly kind: 'refused'; readonly text: string };

/** The explicit result of projecting a record: the model-facing text and the structured result. */
export interface Projection {
  readonly text: string;
  /**
   * Built field by field from the record, never spread from it. It is unchecked until the
   * connector validates it against the declared output contract, before anything is serialized.
   */
  readonly data: unknown;
}

interface Declaration<Input extends z.ZodObject, Output extends z.ZodObject> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Stated, not assumed: the host may treat read-only operations differently. */
  readonly annotations: ToolAnnotations;
  /** Runtime contract for the caller's arguments. Undeclared fields are dropped, never forwarded. */
  readonly input: Input;
  /** Runtime contract for the structured result. Strict contracts keep private fields out. */
  readonly output: Output;
  readonly view: OperationView;
  /**
   * This operation's own limit for its complete handler and projection: the per-operation override
   * of the operation limit. Omitted, the route's or SDK instance's operation limit applies, else
   * 3,000 ms. It is not a second timer: it resolves unambiguously with those settings and can
   * never extend the request.
   */
  readonly boundMs?: number;
}

/** Where an operation finds the request it serves. Absent, it runs under the SDK defaults. */
export interface OperationContext {
  /** The lifetime the adapter started at admission, passed through the per-request server factory. */
  readonly lifetime: RequestLifetime;
}

/** An explicitly public operation: the caller needs no credential and no identity exists. */
export interface PublicOperation<Input extends z.ZodObject, Output extends z.ZodObject, Found>
  extends Declaration<Input, Output> {
  readonly failures: OperationFailures;
  handle(input: z.output<Input>, request: OperationRequest): OperationOutcome<Found> | Promise<OperationOutcome<Found>>;
  project(record: Found): Projection;
}

/**
 * An operation that acts for a verified identity. The application's listener verifies the request
 * and the transport hands that context to the callback; `identity` turns it into the application's
 * own immutable value. No tool argument can name an identity.
 */
export interface ProtectedOperation<Input extends z.ZodObject, Output extends z.ZodObject, Found, Identity>
  extends Declaration<Input, Output> {
  readonly failures: ProtectedFailures;
  /** `undefined` when the verified context names no acceptable principal (for example a service credential). */
  identity(authInfo: AuthInfo | undefined): Identity | undefined;
  handle(
    input: z.output<Input>,
    identity: Identity,
    request: OperationRequest,
  ): OperationOutcome<Found> | Promise<OperationOutcome<Found>>;
  project(record: Found, identity: Identity): Projection;
}

/** The declaration is incomplete or unusable. Names the missing requirement, never a credential. */
export class OperationConfigurationError extends Error {
  constructor(operation: string, problems: readonly string[]) {
    super(`Operation "${operation}" is not configured: ${problems.join('; ')}.`);
    this.name = 'OperationConfigurationError';
  }
}

const isFunction = (value: unknown): boolean => typeof value === 'function';
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isSchema = (value: unknown): boolean => typeof value === 'object' && value !== null && isFunction((value as { safeParse?: unknown }).safeParse);

/** The fields registration checks, as an untrusted caller (plain JavaScript, a cast) might supply them. */
interface UncheckedDeclaration {
  readonly name?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly annotations?: unknown;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly view?: { readonly uri?: unknown; readonly title?: unknown; readonly html?: unknown; readonly csp?: unknown };
  readonly failures?: {
    readonly absent?: unknown;
    readonly unavailable?: unknown;
    readonly invalidOutput?: unknown;
    readonly signInRequired?: unknown;
  };
  readonly boundMs?: number;
  readonly handle?: unknown;
  readonly project?: unknown;
  readonly identity?: unknown;
}

/** Fails before anything is registered, so a misconfigured protected operation is never served. */
function assertConfigured(declaration: UncheckedDeclaration, requireIdentity: boolean): void {
  const problems: string[] = [];
  const needs = (present: boolean, requirement: string) => {
    if (!present) problems.push(`missing ${requirement}`);
  };
  needs(isText(declaration.name), 'name');
  needs(isText(declaration.title) && isText(declaration.description), 'title and description');
  needs(declaration.annotations !== undefined, 'annotations');
  needs(isSchema(declaration.input), 'input contract');
  needs(isSchema(declaration.output), 'output contract');
  const view = declaration.view;
  needs(view !== undefined && isText(view.uri) && isText(view.title) && typeof view.html === 'string' && view.csp !== undefined, 'view');
  const failures = declaration.failures;
  needs(isText(failures?.absent) && isText(failures?.unavailable) && isText(failures?.invalidOutput), 'failures (absent, unavailable, invalidOutput)');
  needs(isFunction(declaration.handle), 'handle callback');
  needs(isFunction(declaration.project), 'project callback');
  if (requireIdentity) {
    needs(isFunction(declaration.identity), 'identity resolver');
    needs(isText(failures?.signInRequired), 'failures.signInRequired');
  }
  const bound: unknown = declaration.boundMs;
  if (bound !== undefined && !(typeof bound === 'number' && Number.isFinite(bound) && bound > 0)) problems.push('boundMs must be a finite positive number');
  if (problems.length > 0) throw new OperationConfigurationError(isText(declaration.name) ? String(declaration.name) : '(unnamed)', problems);
}

const isThenable = (value: unknown): boolean => typeof value === 'object' && value !== null && isFunction((value as { then?: unknown }).then);

/** A projection callback's answer, checked as the untrusted value it is. `data` is validated separately against the output contract. */
const isProjection = (value: unknown): value is Projection =>
  typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string';

const SDK_DEFAULTS = createServerBudgets();

const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

function requestFor(ctx: ServerContext, live: { open: boolean }, scope: BoundedScope): OperationRequest {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  return {
    signal: scope.signal,
    within: (stage, work, options) => scope.run(stage, (nested) => work(nested.signal), options).then(valueOrThrow),
    async reportProgress(update) {
      if (!live.open || progressToken === undefined || scope.signal.aborted) return;
      const { progress, total, message } = update;
      await ctx.mcpReq
        .notify({ method: 'notifications/progress', params: { progressToken, progress, total, message } })
        .catch(() => undefined);
    },
  };
}

/**
 * Runs the steps every operation shares, after its access mode has settled who the caller is.
 * `run` is the access mode's own part: it calls the handler and supplies the projection. The handler
 * and the projection are one bounded operation, so a slow mapping cannot outlast the budget either.
 * Whatever ends that operation without a result (expiry, cancellation, a dependency failure) leaves
 * its typed cause on the request lifetime and the caller sees only the declared unavailable text.
 */
async function execute<Found>(
  declaration: Pick<Declaration<z.ZodObject, z.ZodObject>, 'output' | 'boundMs'> & { readonly failures: OperationFailures },
  ctx: ServerContext,
  lifetime: RequestLifetime,
  run: (request: OperationRequest) => {
    readonly handling: Promise<OperationOutcome<Found>>;
    readonly project: (record: Found) => Projection;
  },
): Promise<CallToolResult> {
  const live = { open: true };
  try {
    const bounded = await lifetime.run(
      'handler',
      async (scope): Promise<CallToolResult> => {
        const { handling, project } = run(requestFor(ctx, live, scope));
        const outcome = await handling;
        // An uncooperative handler can answer after this operation was retired or ran out of time. The
        // projection is an owned stage of the same operation, so it starts only while the scope is live.
        throwIfEnded(scope);
        // The handler is application code too: only the three declared outcomes are acted on, and a
        // refusal's text must be a real string before it can reach the SDK. Anything else is a contract
        // break, answered before the projection can run, never serialized as a success.
        const unchecked: unknown = outcome;
        const kind = typeof unchecked === 'object' && unchecked !== null ? (unchecked as { kind?: unknown }).kind : undefined;
        if (kind === 'absent') return failure(declaration.failures.absent);
        if (kind === 'refused') {
          const text = (unchecked as { text?: unknown }).text;
          return failure(isText(text) ? text : declaration.failures.invalidOutput);
        }
        if (kind !== 'record') return failure(declaration.failures.invalidOutput);
        const projection: unknown = project((unchecked as { record: Found }).record);
        // Projections are synchronous. An asynchronous one is refused without being awaited, which
        // would renew the budget, and its eventual rejection is consumed so it cannot surface unhandled.
        if (isThenable(projection)) {
          void Promise.resolve(projection).catch(() => undefined);
          return failure(declaration.failures.invalidOutput);
        }
        throwIfEnded(scope);
        // The callback is application code: a projection that is not the declared shape is a contract
        // break like invalid data, not a thrown fault and never something the SDK serializes.
        if (!isProjection(projection)) return failure(declaration.failures.invalidOutput);
        const parsed = declaration.output.safeParse(projection.data);
        if (!parsed.success) return failure(declaration.failures.invalidOutput);
        return { content: [{ type: 'text' as const, text: projection.text }], structuredContent: parsed.data };
      },
      { limitMs: declaration.boundMs ?? lifetime.operationMs, upstream: ctx.mcpReq.signal },
    );
    if (bounded.ok) return bounded.value;
    lifetime.record(bounded.cause);
    return failure(declaration.failures.unavailable);
  } finally {
    live.open = false;
  }
}

/**
 * Starts a lifetime for the call when the adapter supplied none, and finishes it with the call, so
 * an operation registered without an adapter is still bounded by the SDK defaults.
 */
async function withLifetime(context: OperationContext | undefined, call: (lifetime: RequestLifetime) => Promise<CallToolResult>): Promise<CallToolResult> {
  if (context) return call(context.lifetime);
  const own = SDK_DEFAULTS.startRequest();
  try {
    return await call(own);
  } finally {
    own.finish();
  }
}

/**
 * Names the declared view on a result so a host can resolve it from the result alone. The value
 * comes only from the trusted declaration; the callbacks never produce `_meta`, so nothing the
 * caller, the handler's record or the projection supplies can select a different resource.
 */
function linkedToView(result: CallToolResult, view: OperationView): CallToolResult {
  return { ...result, _meta: { ui: { resourceUri: view.uri } } };
}

/**
 * Registers the tool and its view on the server. The server has parsed `args` with the
 * declaration's input contract before `callback` runs, so a wrapper that knows the contract's
 * type states that fact (`args as z.output<Input>`). Structured content leaves `callback` already
 * validated against the declaration's output contract. Every result `callback` returns, success or
 * safe failure, leaves linked to the declaration's view.
 */
function register(
  server: McpServer,
  declaration: Declaration<z.ZodObject, z.ZodObject>,
  callback: (args: unknown, ctx: ServerContext) => Promise<CallToolResult>,
): void {
  registerAppTool(
    server,
    declaration.name,
    {
      title: declaration.title,
      description: declaration.description,
      inputSchema: declaration.input,
      outputSchema: declaration.output,
      annotations: declaration.annotations,
      _meta: { ui: { resourceUri: declaration.view.uri } },
    },
    async (args, ctx) => linkedToView(await callback(args, ctx), declaration.view),
  );
  const { view } = declaration;
  registerAppResource(server, view.title, view.uri, {}, async () => ({
    contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: view.html, _meta: { ui: { csp: view.csp } } }],
  }));
}

/** Declares an explicitly public operation and its view on an application-owned MCP server. */
export function registerPublicOperation<Input extends z.ZodObject, Output extends z.ZodObject, Found>(
  server: McpServer,
  operation: PublicOperation<Input, Output, Found>,
  context?: OperationContext,
): void {
  assertConfigured(operation, false);
  register(server, operation, (args, ctx) =>
    withLifetime(context, (lifetime) =>
      execute(operation, ctx, lifetime, (request) => ({
        handling: Promise.resolve().then(() => operation.handle(args as z.output<Input>, request)),
        project: (record: Found) => operation.project(record),
      })),
    ),
  );
}

/**
 * Declares an operation that acts for a verified identity. Registration fails, with the missing
 * requirement named, unless the identity resolver, sign-in failure text, projection and view
 * are all configured. With no acceptable identity the handler never runs, and neither does it for a
 * call that was cancelled or whose request already ended before the handler could start.
 */
export function registerProtectedOperation<Input extends z.ZodObject, Output extends z.ZodObject, Found, Identity>(
  server: McpServer,
  operation: ProtectedOperation<Input, Output, Found, Identity>,
  context?: OperationContext,
): void {
  assertConfigured(operation, true);
  register(server, operation, (args, ctx) =>
    withLifetime(context, async (lifetime) => {
      if (ctx.mcpReq.signal.aborted || lifetime.check()) return failure(operation.failures.unavailable);
      let identity: Identity | undefined;
      try {
        const resolved = operation.identity(ctx.http?.authInfo);
        // Inspecting what the resolver returned is part of the same boundary: a `then` accessor is
        // application code and may throw, and what it throws may name the identity provider.
        if (isThenable(resolved)) {
          // The resolver is synchronous. A promise would reach the handler as the principal; its own
          // rejection, if any, is not ours to surface.
          void Promise.resolve(resolved).catch(() => undefined);
          throw new Error('The identity resolver returned a promise.');
        }
        identity = resolved;
      } catch (error) {
        // The resolver is application code; whatever it threw may name the identity provider.
        lifetime.record({ kind: 'dependency-failure', stage: 'authentication', effect: 'none', error });
        return failure(operation.failures.unavailable);
      }
      if (identity === undefined) return failure(operation.failures.signInRequired);
      const principal = identity;
      return execute(operation, ctx, lifetime, (request) => ({
        handling: Promise.resolve().then(() => operation.handle(args as z.output<Input>, principal, request)),
        project: (record: Found) => operation.project(record, principal),
      }));
    }),
  );
}
