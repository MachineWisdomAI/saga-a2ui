// Background-side evidence channel. Every observation the browser tests read leaves the Lynx
// background thread as one JSON string through the runtime's `bridge` native module, because the
// test page holds no reference into the background thread and the fixture assumes no main-thread
// bridge for application code.
//
// Tracing is deliberately disabled on the main thread: a render-time call must stay pure there.
// `trace` therefore does nothing unless it runs in the background.

declare const __BACKGROUND__: boolean;
declare const __MAIN_THREAD__: boolean;
// A lexical binding supplied to the bundle by the runtime, not a property of `globalThis`.
declare const NativeModules: { bridge?: BridgeModule } | undefined;

interface BridgeModule {
  call(name: string, data: string, callback: (result: unknown) => void): void;
}

let sequence = 0;

export const onBackground = (): boolean => typeof __BACKGROUND__ !== 'undefined' && __BACKGROUND__;
export const onMainThread = (): boolean => typeof __MAIN_THREAD__ !== 'undefined' && __MAIN_THREAD__;

/** Records one observation. Returns its sequence number, or 0 when it was not recorded. */
export function trace(event: Readonly<Record<string, unknown>>): number {
  if (!onBackground()) return 0;
  if (typeof NativeModules === 'undefined' || NativeModules?.bridge === undefined) return 0;
  sequence += 1;
  // `at` is the worker's wall clock, comparable with the page's for measuring the interval between
  // a native node leaving the document and the effect cleanup that retires its instance.
  NativeModules.bridge.call('saga:record', JSON.stringify({ seq: sequence, at: Date.now(), ...event }), () => undefined);
  return sequence;
}

/**
 * Main-thread evidence, readable by the test page without any bridge in application code: the
 * main thread runs in a same-origin iframe realm of the `<lynx-view>`, so the page can read this
 * object from that realm directly. It counts what the render path and the effects did there.
 */
export interface MainThreadFacts {
  /** Renders of the application root, the only component the first screen reaches. */
  roots: number;
  /** Renders of the action control. */
  renders: number;
  slotsConstructed: number;
  tokensCaptured: number;
  opens: number;
  closes: number;
}

export function countOnMainThread(name: keyof MainThreadFacts): void {
  if (!onMainThread()) return;
  const scope = globalThis as { __sagaMainThread?: MainThreadFacts };
  scope.__sagaMainThread ??= { roots: 0, renders: 0, slotsConstructed: 0, tokensCaptured: 0, opens: 0, closes: 0 };
  scope.__sagaMainThread[name] += 1;
}
