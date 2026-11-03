import type { App } from '@modelcontextprotocol/ext-apps';

/**
 * Tells the host how big the page is, until `signal` aborts. For an `App` built with
 * `autoResize: false`, which then has exactly one sizing owner.
 *
 * The size is the page's width and the height its content needs: the root element is measured
 * at `max-content` height so a host-imposed frame height cannot feed back into the measurement,
 * and its own height style is put back before anything can paint. Measurement happens in an
 * animation frame, and a resize of the root or the body asks for one frame however many
 * notifications arrive. A size equal to the last one sent is not sent again.
 *
 * Aborting disconnects the observer and cancels a waiting frame, so nothing is sent afterwards. A
 * send the host connection can no longer carry is dropped: sizing is advisory.
 */
export function startOwnSizing(app: App, signal: AbortSignal): void {
  if (signal.aborted) return;

  let frame: number | undefined;
  let lastSent: { width: number; height: number } | undefined;

  const measureAndSend = (): void => {
    frame = undefined;
    const root = document.documentElement;
    const authoredHeight = root.style.height;
    root.style.height = 'max-content';
    const height = Math.ceil(root.getBoundingClientRect().height);
    root.style.height = authoredHeight;
    const width = Math.ceil(window.innerWidth);
    if (lastSent?.width === width && lastSent.height === height) return;
    lastSent = { width, height };
    app.sendSizeChanged({ width, height }).catch(() => undefined);
  };
  const requestFrame = (): void => {
    frame ??= requestAnimationFrame(measureAndSend);
  };

  const observer = new ResizeObserver(requestFrame);
  observer.observe(document.documentElement);
  observer.observe(document.body);
  requestFrame();

  signal.addEventListener(
    'abort',
    () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
    { once: true },
  );
}
