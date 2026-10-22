import type { ToolResult } from '@saga-a2ui/mcp/view';

// Test-only probe of the own-catalog entry `startA2uiView` of both stacks in a real browser. It is
// a minimal consumer of one stack's entry: every callback and every registration the page makes on
// its event target appends one line to the log the specification reads. The two stacks differ only
// in the catalog and the start call, which each main file supplies. Nothing here is an SDK feature
// or part of an app bundle.

export interface ProbeView {
  readonly ready: Promise<void>;
  dispose(): Promise<void>;
  readonly surface: {
    update(data: { label: string }): { readonly ok: boolean };
  };
}

export interface ProbeOptions {
  readonly container: Element;
  readonly readyWhen: (signal: AbortSignal) => Promise<void>;
  readonly onToolResult: (result: ToolResult, view: ProbeView) => void;
  readonly onTeardown: () => void;
  readonly onError: (error: unknown, phase: string) => void;
}

export interface ProbeStack {
  start(options: ProbeOptions): ProbeView;
}

const control = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (found === null) throw new Error(`the probe has no ${id}`);
  return found;
};

export function runProbe(stack: ProbeStack): void {
  const log = control('log');
  const line = (text: string): void => {
    const item = document.createElement('li');
    item.textContent = text;
    log.append(item);
  };
  const container = control('root');
  // The application breaks in every callback it is given, as a page of its own might.
  const throwing =
    document.querySelector('meta[name="probe-throwing"]') !== null;

  // The stack's registrations on the real event target, seen where they happen. A transport that
  // closes removes its `message` listener, so the container's content at that moment says whether
  // the view outlived its connection.
  const addEventListener = window.addEventListener.bind(window);
  const removeEventListener = window.removeEventListener.bind(window);
  let closed = false;
  window.addEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === 'pagehide') line('pagehide:+');
    return (addEventListener as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === 'pagehide') line('pagehide:-');
    if (type === 'message' && !closed) {
      closed = true;
      line(`close:${container.childElementCount}`);
    }
    return (removeEventListener as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof window.removeEventListener;

  const options = (gated: boolean): ProbeOptions => ({
    container,
    // Stands in for embedded fonts: the test settles it by hand.
    readyWhen: (signal) =>
      gated
        ? new Promise<void>((resolve, reject) => {
            signal.addEventListener('abort', () => line('readiness-aborted'));
            control('release-ready').addEventListener('click', () => resolve());
            control('fail-ready').addEventListener('click', () =>
              reject(new Error('fonts failed')),
            );
          })
        : Promise.resolve(),
    onToolResult: (result, view) => {
      const shown = result.structuredContent as { label?: unknown } | undefined;
      if (typeof shown?.label !== 'string') return;
      line(`result:${shown.label}`);
      view.surface.update({ label: shown.label });
    },
    onTeardown() {
      line('teardown');
      if (throwing) throw new Error('teardown broke');
    },
    onError(error, phase) {
      line(`error:${phase}`);
      if (throwing) throw new Error('reporter broke');
    },
  });

  let view: ProbeView | undefined;
  const begin = (gated: boolean, label: string): void => {
    const started = stack.start(options(gated));
    view = started;
    started.ready.then(
      () => line(`${label}ready`),
      (failure: { kind?: string }) =>
        line(`${label}not-ready:${failure.kind ?? 'unknown'}`),
    );
  };
  begin(true, '');

  control('dispose').addEventListener('click', () => {
    void view?.dispose().then(() => line('dispose-settled'));
  });
  control('start-again').addEventListener('click', () => {
    try {
      begin(false, 'again:');
      line('start-again:started');
    } catch (error) {
      line(`start-again:${(error as { code?: string }).code ?? 'error'}`);
    }
  });
}
