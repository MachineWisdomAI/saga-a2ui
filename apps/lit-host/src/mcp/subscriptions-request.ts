import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  SUBSCRIPTION_LIMITS,
  SUBSCRIPTIONS_TOOL_NAME,
} from './subscriptions.js';

/**
 * Classifies one protected browse request before the tool handler runs.
 * HTTP transport failures, JSON-RPC protocol failures and tool results are different
 * outcomes: this module only decides the first two. It never calls the backend.
 * A JSON-RPC batch is not a way around that gate: every element is classified, and
 * any rejection stops the whole batch before the handler.
 */

export type RequestId = string | number | null;

export type SubscriptionsGate =
  | { readonly kind: 'transport'; readonly status: 406 | 413 | 415; readonly error: string }
  | { readonly kind: 'protocol'; readonly status: 200 | 400; readonly id: RequestId; readonly code: number; readonly message: string }
  | { readonly kind: 'forward'; readonly body: unknown };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const INVALID_PARAMS = -32602;
const MAX_ID_LENGTH = 64;

export function declaredBodyTooLarge(request: Pick<IncomingMessage, 'headers'>): boolean {
  const declared = Number(request.headers['content-length']);
  return Number.isFinite(declared) && declared > SUBSCRIPTION_LIMITS.maxRequestBytes;
}

export function transportHeaderFailure(
  request: Pick<IncomingMessage, 'headers'>,
): Extract<SubscriptionsGate, { kind: 'transport' }> | undefined {
  const contentType = request.headers['content-type'];
  const mediaType = typeof contentType === 'string' ? contentType.split(';')[0]?.trim().toLowerCase() : undefined;
  if (mediaType !== 'application/json') return { kind: 'transport', status: 415, error: 'unsupported_media_type' };
  const accept = request.headers.accept;
  if (typeof accept !== 'string' || !accept.includes('application/json') || !accept.includes('text/event-stream')) {
    return { kind: 'transport', status: 406, error: 'not_acceptable' };
  }
  return undefined;
}

function correlatedId(value: unknown): RequestId {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH) return value;
  return null;
}

function argumentWithinLimits(args: unknown): boolean {
  if (args === undefined) return true;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false;
  const entries = Object.entries(args);
  if (entries.length > SUBSCRIPTION_LIMITS.maxArgumentElements) return false;
  return entries.every(([key, value]) => {
    if (key.length > SUBSCRIPTION_LIMITS.maxArgumentString) return false;
    if (typeof value === 'string') return value.length <= SUBSCRIPTION_LIMITS.maxArgumentString;
    if (value === null || typeof value === 'object') return false;
    return typeof value === 'number' || typeof value === 'boolean';
  });
}

/**
 * Reads one JSON value that has already been bounded. Malformed calls and unknown tools stop
 * here, with the request id echoed when one can be read safely. A forwardable call is the only
 * path that may reach the tool handler. An array is classified element by element; a rejected
 * element is not dispatched, and a one-element batch keeps that element's protocol result.
 */
export function classifySubscriptionsBody(raw: string): SubscriptionsGate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'protocol', status: 400, id: null, code: PARSE_ERROR, message: 'Parse error' };
  }
  if (Array.isArray(parsed)) return classifyBatch(parsed);
  return classifyMessage(parsed);
}

function classifyBatch(messages: readonly unknown[]): SubscriptionsGate {
  if (messages.length === 0) {
    return { kind: 'protocol', status: 400, id: null, code: INVALID_REQUEST, message: 'Invalid request' };
  }
  const gates = messages.map((message) => classifyMessage(message));
  const rejected = gates.find((gate) => gate.kind !== 'forward');
  if (rejected) return messages.length === 1 ? rejected : { kind: 'protocol', status: 400, id: null, code: INVALID_REQUEST, message: 'Invalid request' };
  return { kind: 'forward', body: messages };
}

function classifyMessage(parsed: unknown): SubscriptionsGate {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'protocol', status: 400, id: null, code: INVALID_REQUEST, message: 'Invalid request' };
  }
  const message = parsed as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const id = correlatedId(message.id);
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || message.method.length === 0 || message.method.length > 64) {
    return { kind: 'protocol', status: 400, id, code: INVALID_REQUEST, message: 'Invalid request' };
  }
  if (message.method !== 'tools/call') return { kind: 'forward', body: parsed };

  const params = message.params;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { kind: 'protocol', status: 200, id, code: INVALID_PARAMS, message: 'Invalid params' };
  }
  const call = params as { name?: unknown; arguments?: unknown };
  if (typeof call.name !== 'string' || call.name.length === 0 || call.name.length > 64) {
    return { kind: 'protocol', status: 200, id, code: INVALID_PARAMS, message: 'Invalid params' };
  }
  if (call.name !== SUBSCRIPTIONS_TOOL_NAME) {
    return { kind: 'protocol', status: 200, id, code: INVALID_PARAMS, message: 'Unknown tool' };
  }
  if (!argumentWithinLimits(call.arguments)) {
    return { kind: 'protocol', status: 200, id, code: INVALID_PARAMS, message: 'Invalid params' };
  }
  return { kind: 'forward', body: parsed };
}

export function writeTransport(response: ServerResponse, gate: Extract<SubscriptionsGate, { kind: 'transport' }>): void {
  response.writeHead(gate.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: gate.error }));
}

export function writeProtocol(response: ServerResponse, gate: Extract<SubscriptionsGate, { kind: 'protocol' }>): void {
  response.writeHead(gate.status, { 'content-type': 'application/json' }).end(JSON.stringify({
    jsonrpc: '2.0',
    id: gate.id,
    error: { code: gate.code, message: gate.message },
  }));
}
