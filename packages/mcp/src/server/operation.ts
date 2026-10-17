import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { AuthInfo, CallToolResult, McpServer, ServerContext, ToolAnnotations } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { DEFAULT_OPERATION_BOUND_MS, type ViewCsp } from '../policy/index.js';

// Declared MCP operations. The application owns the listener, authentication, domain
// authorization and every backend effect; it hands this module an operation declaration and an
// MCP server it created. This module validates the input before the handler runs, waits for the
// handler only within its bound, projects the handler's record explicitly, validates that
// projection against the declared output contract, and returns a safe failure for everything
// else. Upstream tool registration stays here: there is no SAGA registry of operations.
//
// Unreleased preparation slice (CORE1): `OperationRequest` carries what the existing browse code
// already used (the request's cancellation signal) plus progress reporting. The complete
// deadline, callback and transport contract is CORE3's.

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

/** What a handler may observe and do for the one request it serves. */
export interface OperationRequest {
  /** Aborts when the caller cancels or disconnects. The application cleans up work it cannot interrupt. */
  readonly signal: AbortSignal;
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
  /** Finite wait for the handler. Defaults to `DEFAULT_OPERATION_BOUND_MS`. */
  readonly boundMs?: number;
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
const isText = (value: unknown): boolean => typeof value === 'string' && value.length > 0;
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
  const bound = declaration.boundMs;
  if (bound !== undefined && !(Number.isFinite(bound) && bound > 0)) problems.push('boundMs must be a finite positive number');
  if (problems.length > 0) throw new OperationConfigurationError(isText(declaration.name) ? String(declaration.name) : '(unnamed)', problems);
}

const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

const RETIRED = Symbol('retired-operation');

/**
 * Waits for one handler only until the bound or the request's abort signal. A settlement that loses
 * that race is ignored, so it cannot become the result. A rejection retires the call the same way.
 */
function withinBound<T>(operation: Promise<T>, boundMs: number, signal: AbortSignal): Promise<T | typeof RETIRED> {
  if (signal.aborted) return Promise.resolve(RETIRED);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | typeof RETIRED) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(signal.aborted ? RETIRED : value);
    };
    const onAbort = () => finish(RETIRED);
    const timer = setTimeout(onAbort, boundMs);
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(value),
      () => finish(RETIRED),
    );
  });
}

function requestFor(ctx: ServerContext, live: { open: boolean }): OperationRequest {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  return {
    signal: ctx.mcpReq.signal,
    async reportProgress(update) {
      if (!live.open || progressToken === undefined || ctx.mcpReq.signal.aborted) return;
      const { progress, total, message } = update;
      await ctx.mcpReq
        .notify({ method: 'notifications/progress', params: { progressToken, progress, total, message } })
        .catch(() => undefined);
    },
  };
}

/**
 * Runs the steps every operation shares, after its access mode has settled who the caller is.
 * `run` is the access mode's own part: it calls the handler and supplies the projection.
 */
async function execute<Found>(
  declaration: Pick<Declaration<z.ZodObject, z.ZodObject>, 'output' | 'boundMs'> & { readonly failures: OperationFailures },
  ctx: ServerContext,
  run: (request: OperationRequest) => {
    readonly handling: Promise<OperationOutcome<Found>>;
    readonly project: (record: Found) => Projection;
  },
): Promise<CallToolResult> {
  const live = { open: true };
  const { signal } = ctx.mcpReq;
  try {
    const { handling, project } = run(requestFor(ctx, live));
    const outcome = await withinBound(handling, declaration.boundMs ?? DEFAULT_OPERATION_BOUND_MS, signal);
    if (outcome === RETIRED || signal.aborted) return failure(declaration.failures.unavailable);
    if (outcome.kind === 'absent') return failure(declaration.failures.absent);
    if (outcome.kind === 'refused') return failure(outcome.text);
    const projection = project(outcome.record);
    const parsed = declaration.output.safeParse(projection.data);
    if (!parsed.success) return failure(declaration.failures.invalidOutput);
    if (signal.aborted) return failure(declaration.failures.unavailable);
    return { content: [{ type: 'text' as const, text: projection.text }], structuredContent: parsed.data };
  } catch {
    // A projection that throws is a fault of the application's mapping; say nothing about it.
    return failure(declaration.failures.unavailable);
  } finally {
    live.open = false;
  }
}

/**
 * Registers the tool and its view on the server. The server has parsed `args` with the
 * declaration's input contract before `callback` runs, so a wrapper that knows the contract's
 * type states that fact (`args as z.output<Input>`). Structured content leaves `callback` already
 * validated against the declaration's output contract.
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
    callback,
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
): void {
  assertConfigured(operation, false);
  register(server, operation, (args, ctx) =>
    execute(operation, ctx, (request) => ({
      handling: Promise.resolve().then(() => operation.handle(args as z.output<Input>, request)),
      project: (record: Found) => operation.project(record),
    })),
  );
}

/**
 * Declares an operation that acts for a verified identity. Registration fails, with the missing
 * requirement named, unless the identity resolver, sign-in failure text, projection and view
 * are all configured. With no acceptable identity the handler never runs.
 */
export function registerProtectedOperation<Input extends z.ZodObject, Output extends z.ZodObject, Found, Identity>(
  server: McpServer,
  operation: ProtectedOperation<Input, Output, Found, Identity>,
): void {
  assertConfigured(operation, true);
  register(server, operation, async (args, ctx) => {
    const identity = operation.identity(ctx.http?.authInfo);
    if (identity === undefined) return failure(operation.failures.signInRequired);
    return execute(operation, ctx, (request) => ({
      handling: Promise.resolve().then(() => operation.handle(args as z.output<Input>, identity, request)),
      project: (record: Found) => operation.project(record, identity),
    }));
  });
}
