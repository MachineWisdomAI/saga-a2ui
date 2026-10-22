import type {
  CardResultOutcome,
  FaithfulCardApp,
  FaithfulCardAppDefinition,
} from '@saga-a2ui/components/faithful-card';
import type { DeliveredResult } from '@saga-a2ui/core/delivered-result';
import type { HostContext, ReadingProfile } from '@saga-a2ui/mcp/view';
import { PROBE_TEXTS, PROBE_UNSUPPORTED } from './texts.js';

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
    context: HostContext | undefined,
    hostName: string | undefined,
  ) => void;
  readonly onError: (error: unknown, phase: string) => void;
}

export interface ProbeStack {
  readonly FaithfulCardApp: typeof FaithfulCardApp;
  /** The stack's export, the one owner of which hosts are read on a device. */
  readonly readingProfile: (
    context: HostContext | undefined,
    hostName: string | undefined,
  ) => ReadingProfile;
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

  /** The default reading: structured content alone; an error result is rejected unread. */
  const readStructured = (result: DeliveredResult): CardResultOutcome => {
    if (result.isError) return { kind: 'rejected' };
    const content = result.structuredContent as
      { answer?: unknown; question?: unknown } | undefined;
    if (content?.answer === 'throw') throw new Error('map rejected');
    if (typeof content?.answer !== 'string') return { kind: 'rejected' };
    line(
      `result:${content.answer}:theme=${document.documentElement.dataset.theme ?? '-'}`,
    );
    return {
      kind: 'content',
      content: {
        markdown: content.answer,
        ...(typeof content.question === 'string'
          ? { heading: content.question }
          : {}),
      },
    };
  };

  /**
   * The application's own protocol, for a page that asks for it: `{version: 1, question, answer}`
   * in structured content, the answer a non-empty string; absent or `null` structured content shows
   * the first text block's string when it is not empty. Anything else is rejected with the
   * application's wording. The error flag reaches it like any other field: an error result is
   * rejected with its own text, else with the application's unsupported wording. A first text block
   * of `throw` makes the reader itself throw.
   */
  const readEnvelopeOrText = (result: DeliveredResult): CardResultOutcome => {
    const unsupported = { kind: 'rejected', text: PROBE_UNSUPPORTED } as const;
    const first = result.content.find((block) => block.type === 'text');
    const text = first?.text ?? '';
    if (text === 'throw') throw new Error('reader rejected');
    if (result.isError) {
      return text === '' ? unsupported : { kind: 'rejected', text };
    }
    const structured: unknown = result.structuredContent;
    if (structured === undefined || structured === null) {
      return text === ''
        ? unsupported
        : { kind: 'content', content: { markdown: text, heading: '' } };
    }
    if (typeof structured !== 'object') return unsupported;
    const envelope = structured as Record<string, unknown>;
    if (
      envelope.version === 1 &&
      typeof envelope.answer === 'string' &&
      envelope.answer !== '' &&
      typeof envelope.question === 'string'
    ) {
      line(`classified:${envelope.answer}`);
      return {
        kind: 'content',
        content: { markdown: envelope.answer, heading: envelope.question },
      };
    }
    return unsupported;
  };
  const classified =
    document.querySelector('meta[name="probe-classify"]') !== null;

  const definition = stack.FaithfulCardApp.define({
    name: 'Probe answers',
    version: '0.0.0',
  })
    .reader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 })
    .policy('document')
    .result(classified ? readEnvelopeOrText : readStructured)
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
      // The application maps the stack's reading profile onto its own tokens, as the styling
      // guide describes: a device is read at arm's length, so its text is set larger. The
      // application branches on no host name and sets no transform.
      const profile = stack.readingProfile(context, hostName);
      document.documentElement.dataset.readingProfile = profile;
      document.documentElement.style.setProperty(
        '--saga-card-font-size',
        profile === 'device' ? '1.6em' : '1em',
      );
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
