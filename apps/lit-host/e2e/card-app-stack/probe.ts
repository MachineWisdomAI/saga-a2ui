import type {
  FaithfulCardApp,
  FaithfulCardAppDefinition,
} from '@saga-a2ui/components/faithful-card';
import { PROBE_TEXTS } from './texts.js';

// Test-only probe of the card application stacks in a real browser. It is a minimal consumer of one
// stack's `startFaithfulCardApp`: every callback appends one line to the log the specification
// reads, and a few inputs make a callback misbehave so the failure outcomes can be observed. The
// two stacks differ only in the chrome they render, which each main file supplies. Nothing here is
// an SDK feature or part of an app bundle.

export interface ProbeView {
  readonly ready: Promise<void>;
  dispose(): Promise<void>;
}

export interface ProbeOptions {
  readonly container: Element;
  readonly sizing: 'own';
  readonly readyWhen: (signal: AbortSignal) => Promise<void>;
  readonly hostContext: (
    context: { theme?: string; userAgent?: string } | undefined,
    hostName: string | undefined,
  ) => void;
  readonly onError: (error: unknown, phase: string) => void;
}

export interface ProbeStack {
  readonly FaithfulCardApp: typeof FaithfulCardApp;
  start(
    definition: FaithfulCardAppDefinition,
    options: ProbeOptions,
  ): ProbeView;
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

  const definition = stack.FaithfulCardApp.define({
    name: 'Probe answers',
    version: '0.0.0',
  })
    .reader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 })
    .policy('document')
    .result((value) => {
      const content = value as { answer?: unknown; question?: unknown };
      if (content.answer === 'throw') throw new Error('map rejected');
      if (typeof content.answer !== 'string') return undefined;
      line(
        `result:${content.answer}:theme=${document.documentElement.dataset.theme ?? '-'}`,
      );
      return {
        markdown: content.answer,
        ...(typeof content.question === 'string'
          ? { heading: content.question }
          : {}),
      };
    })
    .texts(PROBE_TEXTS)
    .build();

  const options = (gated: boolean): ProbeOptions => ({
    container,
    sizing: 'own',
    // Stands in for embedded fonts: the test settles it by hand, before or after the view ends. It
    // ignores the abort on purpose, so a late outcome after disposal can be observed.
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
    hostContext(context, hostName) {
      line(`context:${context?.theme ?? '-'}:${hostName ?? '-'}`);
      if (context?.theme === 'dark')
        document.documentElement.dataset.theme = 'dark';
      if (context?.theme === 'light')
        document.documentElement.dataset.theme = 'light';
      // An application callback that changes the page and then throws.
      if (context?.userAgent === 'mutate-then-throw') {
        document.documentElement.style.setProperty('--probe-ink', 'white');
        throw new Error('theme broke halfway');
      }
    },
    onError: (error, phase) =>
      line(
        `error:${phase}:${error instanceof Error ? error.message : String(error)}`,
      ),
  });

  let view: ProbeView | undefined;
  const begin = (gated: boolean, label: string): void => {
    const started = stack.start(definition, options(gated));
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
