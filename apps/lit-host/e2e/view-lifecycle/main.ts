import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { runToolResultView } from '@saga-a2ui/mcp/view';

// Test-only probe of the view lifecycle in a real browser. It is a minimal consumer of
// `runToolResultView`: every callback appends one line to the log the specification reads, and a
// few inputs make a callback misbehave so the failure outcomes can be observed. Nothing here is an
// SDK feature or part of an app bundle.

const control = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (found === null) throw new Error(`the probe has no ${id}`);
  return found;
};
const log = control('log');
const line = (text: string): void => {
  const item = document.createElement('li');
  item.textContent = text;
  log.append(item);
};
const textOf = (result: {
  content?: Array<{ type: string; text?: string }>;
}): string => result.content?.[0]?.text ?? '';

const app = new App({ name: 'view-lifecycle-probe', version: '0.0.0' });

const view = runToolResultView({
  app,
  transport: new PostMessageTransport(window.parent, window.parent),
  // Stands in for embedded fonts: the test settles it by hand, before or after the view ends. It
  // ignores the abort on purpose, so a late outcome after disposal can be observed.
  readyWhen: (signal) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => line('readiness-aborted'));
      control('release-ready').addEventListener('click', () => resolve());
      control('fail-ready').addEventListener('click', () =>
        reject(new Error('fonts failed')),
      );
    }),
  onToolResult(result) {
    const text = textOf(result);
    if (text === 'throw') throw new Error('result rejected');
    line(
      `result:${text}:theme=${document.documentElement.dataset.theme ?? '-'}`,
    );
  },
  onHostContext(context, hostName) {
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
  onTeardown() {
    line('teardown');
  },
  onFailure: (failure) => line(`failure:${failure.kind}`),
  onError: (error, phase) =>
    line(
      `error:${phase}:${error instanceof Error ? error.message : String(error)}`,
    ),
});

view.ready.then(
  () => line('ready'),
  (failure: { kind?: string }) =>
    line(`not-ready:${failure.kind ?? 'unknown'}`),
);
control('dispose').addEventListener('click', () => {
  void view.dispose().then(() => line('dispose-settled'));
});
