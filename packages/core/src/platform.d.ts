// The platform globals core relies on. Browsers, Node and the Lynx background runtime provide
// them; the ES2022 library types do not declare them, and core deliberately does not load the DOM
// or Node typings. Programs that do load those typings (the renderer packages, and core's own
// test configuration) get the real declarations, and do not include this file.
declare function structuredClone<T>(value: T): T;

interface AbortSignal {
  readonly aborted: boolean;
}

declare class AbortController {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
}

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(handle: unknown): void;
