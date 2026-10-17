// Public interface of the A2UI v0.9 protocol module. Decoding, validated message cases and the
// message session are one coherent interface; nothing here imports a DOM, MCP or renderer.
export { a2uiV0_9Decoder, type DecodeFailure, type DecodeResult, type MessageDecoder } from './decoder.js';
export type { A2uiMessageVisitor, ValidatedMessage } from './message.js';
export {
  createMessageSession,
  type IngestFailure,
  type IngestResult,
  type MessageSession,
  type MessageSessionOptions,
} from './session.js';
