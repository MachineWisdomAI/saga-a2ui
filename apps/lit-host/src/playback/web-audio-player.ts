import type { AudioPlayer } from './playback-view.js';

/**
 * The one foreground player, on Web Audio: the bytes arrive through `fetch` (where the capability
 * and the recipient's proof are checked) and are decoded here, so the view needs no media element
 * and no media URL for the browser to fetch on its own.
 *
 * `prepare()` creates and resumes the context synchronously inside the user's activation. `start()`
 * reports `started` only once the audio clock is advancing, and `blocked` when the browser still
 * holds the context back, which tells the view to ask for another explicit press.
 */
const CLOCK_START_TIMEOUT_MS = 1_500;
const CLOCK_POLL_MS = 25;

export function createWebAudioPlayer(): AudioPlayer {
  let context: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let endedListener: (() => void) | undefined;
  let cancelStart: ((reason: Error) => void) | undefined;

  const release = () => {
    cancelStart?.(new Error('stopped'));
    cancelStart = undefined;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Not started yet: there is nothing to stop.
      }
      source.disconnect();
      source = undefined;
    }
    const closing = context;
    context = undefined;
    void closing?.close().catch(() => undefined);
  };

  const clockAdvanced = (ctx: AudioContext, from: number): Promise<boolean> =>
    new Promise((resolve, reject) => {
      const deadline = performance.now() + CLOCK_START_TIMEOUT_MS;
      const timer = setInterval(() => {
        if (context !== ctx) {
          clearInterval(timer);
          reject(new Error('stopped'));
        } else if (ctx.currentTime > from) {
          clearInterval(timer);
          resolve(true);
        } else if (performance.now() >= deadline) {
          clearInterval(timer);
          resolve(false);
        }
      }, CLOCK_POLL_MS);
      cancelStart = (reason) => {
        clearInterval(timer);
        reject(reason);
      };
    });

  return {
    prepare() {
      release();
      context = new AudioContext();
      void context.resume().catch(() => undefined);
    },

    async start(bytes) {
      const ctx = context;
      if (!ctx) throw new Error('prepare() was not called inside a user activation');
      const buffer = await ctx.decodeAudioData(bytes);
      if (context !== ctx) throw new Error('stopped');
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.onended = () => {
        if (source === node) endedListener?.();
      };
      source = node;
      const from = ctx.currentTime;
      node.start();
      return (await clockAdvanced(ctx, from)) ? 'started' : 'blocked';
    },

    pause: () => void context?.suspend().catch(() => undefined),
    resume: () => void context?.resume().catch(() => undefined),
    stop: release,
    onEnded: (listener) => void (endedListener = listener),
  };
}
