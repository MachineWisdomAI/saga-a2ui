// @vitest-environment jsdom
import {
  FaithfulCardApp,
  type CardResultOutcome,
  type CardResultReader,
} from '@saga-a2ui/components/faithful-card';
import type { DeliveredResult } from '@saga-a2ui/core/delivered-result';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readEnvelopeOrText,
  gate,
  pagehideListeners,
  settle,
  startTestHost,
  toolResult,
  UNSUPPORTED_WORDING,
  unreachableHost,
  watchClose,
  type TestHost,
} from '../stack.test-support.js';
import { StartFailure } from '../start-failure.js';
import {
  startFaithfulCardAppOn,
  type CardChromeProps,
  type CardViewState,
  type StartFaithfulCardOptions,
} from './start-faithful-card-app.js';

// The card application's lifecycle, started over a real bridge joined to a real host by an
// in-memory transport, rendered by real React 19 into jsdom. It exercises the public operation:
// start a definition in a container, then watch what the container shows and what the
// application's callbacks are told. The browser matrix of the same scenarios runs in a real
// browser against the local host fixture (apps/lit-host/e2e/card-app-stack.spec.ts).

const TEXTS = {
  waiting: 'Waiting for the answer…',
  problem: 'The answer could not be shown.',
  connectFailure: 'The host did not answer.',
  readyFailure: 'The fonts did not load.',
  policyFailure: 'The content policy is not valid.',
};

// The default fixture reader: structured `{answer, question}` only, an error result rejected. The
// application's own reading of the whole result is exercised further down.
const readStructuredAnswer = (result: DeliveredResult): CardResultOutcome => {
  if (result.isError) return { kind: 'rejected' };
  const value = result.structuredContent as
    { answer?: unknown; question?: string } | undefined;
  if (value?.answer === 'throw') throw new Error('the map broke');
  return typeof value?.answer === 'string'
    ? {
        kind: 'content',
        content: { markdown: value.answer, heading: value.question },
      }
    : { kind: 'rejected' };
};

const definitionReading = (read: CardResultReader) =>
  FaithfulCardApp.define({ name: 'Answers', version: '1.0.0' })
    .reader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 })
    .policy('document')
    .result(read)
    .texts(TEXTS)
    .build();

const definition = definitionReading(readStructuredAnswer);

const answer = (text: string, question?: string) =>
  toolResult({ answer: text, ...(question === undefined ? {} : { question }) });

let container: HTMLElement;
let host: TestHost | undefined;
const views: Array<{ dispose(): Promise<void> }> = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  document.head.replaceChildren();
  container = document.createElement('div');
  document.body.replaceChildren(container);
});
afterEach(async () => {
  for (const view of views.splice(0)) await view.dispose();
  await host?.close();
  host = undefined;
  vi.restoreAllMocks();
});

async function start(
  options: Partial<StartFaithfulCardOptions> = {},
  hostOptions: Parameters<typeof startTestHost>[0] = {},
  started = definition,
) {
  host = await startTestHost(hostOptions);
  const view = startFaithfulCardAppOn(host.connect, started, {
    container,
    sizing: 'host',
    ...options,
  });
  views.push(view);
  return view;
}

const status = () => container.querySelector('[role="status"]')?.textContent;
const cardText = () =>
  container.querySelector('[data-testid="card-content"]')?.textContent ?? '';
const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof StartFailure ? error.kind : 'other';
  }
};
const embedPolicy = (text: string) => {
  const script = document.createElement('script');
  script.id = 'saga-content-policy';
  script.type = 'application/json';
  script.textContent = text;
  document.head.append(script);
};

describe('startFaithfulCardApp', () => {
  it('returns the running view at once and shows the waiting text until the first answer', async () => {
    const view = await start();
    expect(typeof view.ready.then).toBe('function');
    await vi.waitFor(() => expect(status()).toBe(TEXTS.waiting));
    await view.ready;
    await host!.bridge.sendToolResult(answer('**Yes.**', 'Is it so?'));
    await vi.waitFor(() => expect(cardText()).toContain('Yes.'));
    expect(container.querySelector('h2')?.textContent).toBe('Is it so?');
  });

  it('shows a result delivered during the handshake once, after the host context', async () => {
    const order: string[] = [];
    const view = await start(
      {
        hostContext: (context) => order.push(`context:${context?.theme}`),
        chrome: (props: CardChromeProps) => {
          order.push(`chrome:${props.state.kind}`);
          return props.card;
        },
      },
      {
        hostContext: { theme: 'dark' },
        onInitialized: (bridge) =>
          void bridge.sendToolResult(answer('Early answer')),
      },
    );
    await view.ready;
    await vi.waitFor(() => expect(cardText()).toContain('Early answer'));
    expect(order.indexOf('context:dark')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('context:dark')).toBeLessThan(
      order.indexOf('chrome:answer'),
    );
    expect(order.filter((entry) => entry === 'context:dark')).toHaveLength(1);
  });

  it('holds the first presentation until readyWhen finishes, and abandons nothing when it succeeds', async () => {
    const fonts = gate();
    const view = await start(
      { readyWhen: () => fonts.promise },
      { onInitialized: (bridge) => void bridge.sendToolResult(answer('Held')) },
    );
    await settle(60);
    expect(cardText()).toBe('');
    expect(status()).toBe(TEXTS.waiting);
    fonts.resolve();
    await view.ready;
    await vi.waitFor(() => expect(cardText()).toContain('Held'));
  });

  it('shows readyFailure, distinct from connectFailure, when readyWhen rejects, and disposes the connection', async () => {
    const view = await start({
      readyWhen: () => Promise.reject(new Error('fonts failed')),
    });
    expect(await kindOf(view.ready)).toBe('ready');
    await vi.waitFor(() => expect(status()).toBe(TEXTS.readyFailure));
    expect(status()).not.toBe(TEXTS.connectFailure);
  });

  it('shows connectFailure when the handshake fails', async () => {
    const view = startFaithfulCardAppOn(unreachableHost, definition, {
      container,
      sizing: 'host',
    });
    views.push(view);
    expect(await kindOf(view.ready)).toBe('connect');
    await vi.waitFor(() => expect(status()).toBe(TEXTS.connectFailure));
  });

  it('fails closed on an invalid embedded policy: policyFailure, kind policy, no connection made', async () => {
    embedPolicy('{"level":"nope"}');
    host = await startTestHost();
    const view = startFaithfulCardAppOn(host.connect, definition, {
      container,
      sizing: 'host',
    });
    views.push(view);
    expect(await kindOf(view.ready)).toBe('policy');
    await vi.waitFor(() => expect(status()).toBe(TEXTS.policyFailure));
    expect(host.connects()).toBe(0);
  });

  it('treats an absent embedded policy as the Standard policy', async () => {
    const view = await start();
    await view.ready;
    await host!.bridge.sendToolResult(answer('Fine'));
    await vi.waitFor(() => expect(cardText()).toContain('Fine'));
  });

  it('clears the answer and shows the problem text for an unsupported or error result, and recovers', async () => {
    const view = await start();
    await view.ready;
    await host!.bridge.sendToolResult(answer('First'));
    await vi.waitFor(() => expect(cardText()).toContain('First'));

    await host!.bridge.sendToolResult(toolResult({ unexpected: true }));
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    expect(cardText()).toBe('');

    await host!.bridge.sendToolResult(answer('Second'));
    await vi.waitFor(() => expect(cardText()).toContain('Second'));

    await host!.bridge.sendToolResult(toolResult({ answer: 'ignored' }, true));
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    expect(cardText()).toBe('');
  });

  it('reports a throwing result map through onError, clears the answer and shows the problem text', async () => {
    const errors: Array<[unknown, string]> = [];
    const view = await start({
      onError: (error, phase) => errors.push([error, phase]),
    });
    await view.ready;
    await host!.bridge.sendToolResult(answer('Shown'));
    await vi.waitFor(() => expect(cardText()).toContain('Shown'));
    await host!.bridge.sendToolResult(toolResult({ answer: 'throw' }));
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    expect(cardText()).toBe('');
    expect(errors).toHaveLength(1);
    expect(errors[0]![1]).toBe('result');
    expect((errors[0]![0] as Error).message).toBe('the map broke');
  });

  it('presents an equal answer again as a new presentation', async () => {
    const seen: CardViewState[] = [];
    const view = await start({
      chrome: (props: CardChromeProps) => {
        seen.push(props.state);
        return props.card;
      },
    });
    await view.ready;
    await host!.bridge.sendToolResult(answer('Same'));
    await vi.waitFor(() => expect(cardText()).toContain('Same'));
    const card = container.querySelector('[data-testid="card-root"]');
    await host!.bridge.sendToolResult(answer('Same'));
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="card-root"]')).not.toBe(
        card,
      ),
    );
    const tokens = seen.flatMap((state) =>
      state.kind === 'answer' ? [state.presentation] : [],
    );
    expect([...new Set(tokens)]).toEqual([1, 2]);
  });

  it('refuses a second start on a running container and keeps the first view intact; restarts after dispose', async () => {
    const first = await start();
    await first.ready;
    await host!.bridge.sendToolResult(answer('First view'));
    await vi.waitFor(() => expect(cardText()).toContain('First view'));

    expect(() =>
      startFaithfulCardAppOn(host!.connect, definition, {
        container,
        sizing: 'host',
      }),
    ).toThrow(/container-busy/);
    expect(host!.connects()).toBe(1);
    expect(cardText()).toContain('First view');

    await first.dispose();
    expect(container.childNodes).toHaveLength(0);

    await host!.close();
    const second = await start();
    await second.ready;
    await host!.bridge.sendToolResult(answer('Second view'));
    await vi.waitFor(() => expect(cardText()).toContain('Second view'));
  });

  it('throws before connecting when the container is missing or detached', async () => {
    host = await startTestHost();
    const detached = document.createElement('div');
    for (const bad of [null, undefined, detached] as const) {
      expect(() =>
        startFaithfulCardAppOn(host!.connect, definition, {
          container: bad as never,
          sizing: 'host',
        }),
      ).toThrow(/container-missing/);
    }
    expect(host.connects()).toBe(0);
  });

  it('dispose during startup drops the held result, rejects with disposed and ignores a late readiness outcome', async () => {
    const fonts = gate();
    const aborted = vi.fn();
    const view = await start(
      {
        readyWhen: (signal) => {
          signal.addEventListener('abort', aborted);
          return fonts.promise;
        },
      },
      { onInitialized: (bridge) => void bridge.sendToolResult(answer('Held')) },
    );
    await settle(40);
    await view.dispose();
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(await kindOf(view.ready)).toBe('disposed');
    fonts.resolve();
    await settle(60);
    expect(container.childNodes).toHaveLength(0); // nothing shown, nothing remounted
    expect(cardText()).toBe('');

    await host!.close();
    const again = await start(); // the container is free
    await again.ready;
  });

  it('a late readiness failure after dispose reports nothing new', async () => {
    const fonts = gate();
    const view = await start({ readyWhen: () => fonts.promise });
    await view.dispose();
    fonts.reject(new Error('too late'));
    await settle(60);
    expect(await kindOf(view.ready)).toBe('disposed');
    expect(container.childNodes).toHaveLength(0);
  });

  it('a host teardown while a result is held shows nothing afterwards', async () => {
    const fonts = gate();
    const teardowns: string[] = [];
    const view = await start(
      {
        readyWhen: () => fonts.promise,
        chrome: (props: CardChromeProps) => {
          teardowns.push(props.state.kind);
          return props.card;
        },
      },
      { onInitialized: (bridge) => void bridge.sendToolResult(answer('Held')) },
    );
    await settle(40);
    await host!.bridge.teardownResource({});
    expect(await kindOf(view.ready)).toBe('disposed');
    fonts.resolve();
    await settle(60);
    expect(teardowns).not.toContain('answer');
    expect(container.childNodes).toHaveLength(0);
  });

  it('applies a host-context callback that changes the page and then throws: reported, change left, cleanup intact', async () => {
    const errors: Array<[unknown, string]> = [];
    const view = await start(
      {
        onError: (error, phase) => errors.push([error, phase]),
        hostContext: (context) => {
          if (context?.userAgent === 'mutate-then-throw') {
            document.documentElement.style.setProperty('--ink', 'white');
            throw new Error('theme broke halfway');
          }
        },
      },
      { hostContext: { theme: 'light' } },
    );
    await view.ready;
    await host!.bridge.sendHostContextChange({
      userAgent: 'mutate-then-throw',
    });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]![1]).toBe('host-context');
    expect(document.documentElement.style.getPropertyValue('--ink')).toBe(
      'white',
    );

    await host!.bridge.sendToolResult(answer('Still works'));
    await vi.waitFor(() => expect(cardText()).toContain('Still works'));

    await host!.bridge.teardownResource({});
    await vi.waitFor(() => expect(container.childNodes).toHaveLength(0));
    // The container is free again: cleanup was not skipped by the earlier throw.
    await host!.close();
    const again = await start();
    await again.ready;
  });

  it('an application hostContext callback that throws during startup fails startup as application, after cleanup', async () => {
    const view = await start({
      hostContext: () => {
        throw new Error('theme broke');
      },
    });
    expect(await kindOf(view.ready)).toBe('application');
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    await view.dispose();
    expect(container.childNodes).toHaveLength(0);
  });

  it('an initial chrome that throws returns a running view whose ready rejects as application, after cleanup; no window error, container free again', async () => {
    const windowErrors: unknown[] = [];
    const onWindowError = (event: ErrorEvent) => {
      windowErrors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onWindowError);
    try {
      const errors: unknown[] = [];
      const view = await start({
        chrome: () => {
          throw new Error('chrome broke');
        },
        onError: (error) => errors.push(error),
      });
      await expect(view.ready).rejects.toBeInstanceOf(StartFailure);
      await expect(view.ready).rejects.toMatchObject({
        kind: 'application',
        cause: expect.objectContaining({ message: 'chrome broke' }),
      });
      await settle(40);
      expect(container.childNodes).toHaveLength(0);
      expect(windowErrors).toEqual([]);
      // The failure is the startup's own: the later-failure channel did not also hear it.
      expect(errors).toEqual([]);
      await view.dispose();

      // The first view never connected, and the container may be started again at once.
      const again = await start();
      await again.ready;
      await vi.waitFor(() => expect(status()).toBe(TEXTS.waiting));
    } finally {
      window.removeEventListener('error', onWindowError);
    }
  });

  it('a chrome that throws while showing the policy failure also fails startup as application', async () => {
    embedPolicy('{"not": "a policy"');
    const view = await start({
      chrome: () => {
        throw new Error('chrome broke on the policy text');
      },
    });
    await expect(view.ready).rejects.toMatchObject({
      kind: 'application',
      cause: expect.objectContaining({
        message: 'chrome broke on the policy text',
      }),
    });
    expect(container.childNodes).toHaveLength(0);
    document.head.replaceChildren();
    const again = await start();
    await again.ready;
  });

  it('a chrome that throws after the view was ready is reported through onError (phase result); ready stays resolved and disposal is intact', async () => {
    const windowErrors: unknown[] = [];
    const onWindowError = (event: ErrorEvent) => {
      windowErrors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onWindowError);
    try {
      const errors: Array<[unknown, string]> = [];
      const view = await start({
        chrome: (props: CardChromeProps) => {
          if (props.state.kind === 'answer') throw new Error('late chrome');
          return props.card;
        },
        onError: (error, phase) => errors.push([error, phase]),
      });
      await view.ready;
      await host!.bridge.sendToolResult(answer('Shown'));
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(errors[0]![0]).toEqual(
        expect.objectContaining({ message: 'late chrome' }),
      );
      expect(errors[0]![1]).toBe('result');
      await settle(20);
      // The stack reported it; React's own channel did not hear it as well.
      expect(windowErrors).toEqual([]);
      await expect(view.ready).resolves.toBeUndefined();
      await view.dispose();
      expect(container.childNodes).toHaveLength(0);
    } finally {
      window.removeEventListener('error', onWindowError);
    }
  });

  it('a late chrome throw goes to the console when no onError is given, and a throwing onError does not stop disposal', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const chrome = (props: CardChromeProps) => {
      if (props.state.kind === 'answer') throw new Error('late chrome');
      return props.card;
    };
    const view = await start({ chrome });
    await view.ready;
    await host!.bridge.sendToolResult(answer('Shown'));
    await vi.waitFor(() =>
      expect(
        logged.mock.calls.some((call) =>
          call.some((a) => a instanceof Error && a.message === 'late chrome'),
        ),
      ).toBe(true),
    );
    await view.dispose();
    expect(container.childNodes).toHaveLength(0);

    // A reporter that throws is the end of the line: it does not stop cleanup either.
    document.body.replaceChildren(container);
    const again = await start({
      chrome,
      onError: () => {
        throw new Error('reporter broke');
      },
    });
    await again.ready;
    await host!.bridge.sendToolResult(answer('Shown again'));
    await settle(40);
    await expect(again.dispose()).resolves.toBeUndefined();
    expect(container.childNodes).toHaveLength(0);
  });

  it('pagehide retires a ready view once and unmounts it', async () => {
    const view = await start();
    await view.ready;
    await host!.bridge.sendToolResult(answer('On screen'));
    await vi.waitFor(() => expect(cardText()).toContain('On screen'));
    dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(container.childNodes).toHaveLength(0));
    await view.dispose();
  });

  it('removes the card before the connection closes when it is disposed while starting, and the container restarts', async () => {
    const fonts = gate();
    const view = await start({ readyWhen: () => fonts.promise });
    const closing = watchClose(host!.connection.app, container);
    await view.dispose();
    expect(await kindOf(view.ready)).toBe('disposed');
    expect(closing.held()).toBe(0);
    await host!.close();
    const again = await start(); // the container is free
    await again.ready;
  });

  it('keeps the connect failure on screen until the view is disposed, then restarts', async () => {
    const view = startFaithfulCardAppOn(unreachableHost, definition, {
      container,
      sizing: 'host',
    });
    views.push(view);
    expect(await kindOf(view.ready)).toBe('connect');
    await vi.waitFor(() => expect(status()).toBe(TEXTS.connectFailure));
    await settle();
    expect(status()).toBe(TEXTS.connectFailure); // not readyFailure, and still shown
    await view.dispose();
    expect(container.childNodes).toHaveLength(0);
    const again = await start();
    await again.ready;
  });

  it('removes its pagehide listener when a ready view’s callbacks and reporter throw, and a later pagehide is inert', async () => {
    const listening = pagehideListeners();
    const view = await start(
      {
        onError: () => {
          throw new Error('reporter broke');
        },
        hostContext: (context) => {
          if (context?.userAgent === 'throw-now') throw new Error('broke');
        },
      },
      { hostContext: { theme: 'light' } },
    );
    await view.ready;
    expect(listening()).toBe(1);
    await host!.bridge.sendHostContextChange({ userAgent: 'throw-now' });
    await settle();
    expect(listening()).toBe(1); // a throwing callback does not end the view
    await view.dispose();
    expect(listening()).toBe(0);
    expect(container.childNodes).toHaveLength(0);
    dispatchEvent(new Event('pagehide'));
    await settle();
    await host!.close();
    const again = await start();
    await again.ready;
  });

  it('removes its pagehide listener when a callback throws while starting, and keeps the failure text until disposed', async () => {
    const listening = pagehideListeners();
    const view = await start({
      onError: () => {
        throw new Error('reporter broke');
      },
      hostContext: () => {
        throw new Error('theme broke');
      },
    });
    expect(await kindOf(view.ready)).toBe('application');
    expect(listening()).toBe(0);
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    dispatchEvent(new Event('pagehide'));
    await settle();
    expect(status()).toBe(TEXTS.problem); // a later pagehide changes nothing
    await view.dispose();
    expect(container.childNodes).toHaveLength(0);
    await host!.close();
    const again = await start();
    await again.ready;
  });

  it('keeps createElement chrome working: the chrome is a component receiving card and state', async () => {
    const view = await start({
      chrome: (props: CardChromeProps) =>
        createElement(
          'section',
          { 'data-testid': 'frame' },
          createElement('b', null, props.state.kind),
          props.card,
        ),
    });
    await view.ready;
    await vi.waitFor(() =>
      expect(
        container.querySelector('[data-testid="frame"] b')?.textContent,
      ).toBe('waiting'),
    );
  });
});

// The application's reading of the whole result. The stack owns what happens next: the
// card is cleared or presented, consent and link state follow the presentation, and a throw is
// reported. The wording and the envelope below are the fixture's, never the stack's.
describe('startFaithfulCardApp with an application reader of the whole result', () => {
  const FENCED = '```\nfirst line\n  second line\n```\n';
  const ERROR_TEXT = 'The service could not answer.';
  const envelope = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    question: 'Is it so?',
    answer: 'It is so.',
    ...overrides,
  });
  const text = (value: string) => ({
    content: [{ type: 'text' as const, text: value }],
  });
  const withStructured = (structuredContent: unknown, value = 'ignored') => ({
    ...text(value),
    structuredContent: structuredContent as Record<string, unknown>,
  });
  const heading = () => container.querySelector('h2')?.textContent;

  const startClassified = async (
    options: Partial<StartFaithfulCardOptions> = {},
    read: CardResultReader = readEnvelopeOrText,
  ) => {
    const view = await start(options, {}, definitionReading(read));
    await view.ready;
    return view;
  };

  it('shows the heading and Markdown of valid structured content', async () => {
    await startClassified();
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() => expect(cardText()).toContain('It is so.'));
    expect(heading()).toBe('Is it so?');
  });

  it('shows the exact text of a result without structured content, under an empty heading', async () => {
    await startClassified();
    await host!.bridge.sendToolResult(text(FENCED));
    await vi.waitFor(() =>
      expect(cardText()).toBe('first line\n  second line\n'),
    );
    expect(heading()).toBe('');
  });

  it('treats null structured content like absent: usable text is shown, otherwise the supplied wording', async () => {
    await startClassified();
    await host!.bridge.sendToolResult({
      ...text(FENCED),
      structuredContent: null as never,
    });
    await vi.waitFor(() => expect(cardText()).toContain('first line'));
    expect(heading()).toBe('');

    await host!.bridge.sendToolResult({
      content: [],
      structuredContent: null as never,
    });
    await vi.waitFor(() => expect(status()).toBe(UNSUPPORTED_WORDING));
    expect(cardText()).toBe('');
  });

  it('rejects a result with neither structured content nor usable text with the supplied wording', async () => {
    await startClassified();
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() => expect(cardText()).toContain('It is so.'));

    await host!.bridge.sendToolResult({ content: [] });
    await vi.waitFor(() => expect(status()).toBe(UNSUPPORTED_WORDING));
    expect(status()).not.toBe(TEXTS.problem);
    expect(cardText()).toBe('');
  });

  it('reads only the first text block, then checks that string: a later block is not a fallback', async () => {
    await startClassified();
    await host!.bridge.sendToolResult({
      content: [
        { type: 'text' as const, text: '' },
        { type: 'text' as const, text: 'a later block' },
      ],
    });
    await vi.waitFor(() => expect(status()).toBe(UNSUPPORTED_WORDING));
    expect(cardText()).toBe('');

    // A block of another type before it does not count as the first text block.
    await host!.bridge.sendToolResult({
      content: [
        { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' },
        { type: 'text' as const, text: 'after an image' },
      ],
    });
    await vi.waitFor(() => expect(cardText()).toContain('after an image'));
  });

  it('rejects present but malformed structured content even when fallback text exists', async () => {
    await startClassified();
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() => expect(cardText()).toContain('It is so.'));
    for (const malformed of [
      envelope({ version: 2 }),
      envelope({ version: '1' }),
      envelope({ version: undefined }),
      envelope({ question: undefined }),
      envelope({ question: 7 }),
      envelope({ answer: undefined }),
      envelope({ answer: 7 }),
      envelope({ answer: '' }),
      { unexpected: true },
      {},
      [],
      'a string',
      42,
    ]) {
      await host!.bridge.sendToolResult(
        withStructured(malformed, 'Usable fallback text'),
      );
      await vi.waitFor(() => expect(status()).toBe(UNSUPPORTED_WORDING));
      expect(cardText()).toBe('');
      expect(status()).not.toBe(TEXTS.problem);
      // The next valid result recovers from each of them.
      await host!.bridge.sendToolResult(withStructured(envelope()));
      await vi.waitFor(() => expect(cardText()).toContain('It is so.'));
      expect(status()).toBeUndefined();
    }
  });

  it('hands an error result to the application whole: its text is the rejection wording, even beside valid structured content', async () => {
    await startClassified();
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() => expect(cardText()).toContain('It is so.'));

    await host!.bridge.sendToolResult({
      ...withStructured(envelope(), ERROR_TEXT),
      isError: true,
    });
    // A rejection carrying the error's exact text: no card, the chrome told it as the problem.
    await vi.waitFor(() => expect(status()).toBe(ERROR_TEXT));
    expect(cardText()).toBe('');
    expect(ERROR_TEXT).not.toBe(UNSUPPORTED_WORDING);
    expect(ERROR_TEXT).not.toBe(TEXTS.problem);

    // Without usable text the application's unsupported wording is shown instead.
    await host!.bridge.sendToolResult({
      ...withStructured(envelope()),
      content: [],
      isError: true,
    });
    await vi.waitFor(() => expect(status()).toBe(UNSUPPORTED_WORDING));
    expect(cardText()).toBe('');

    // Only the first text block counts, here empty: a later block is not a fallback.
    await host!.bridge.sendToolResult({
      content: [
        { type: 'text' as const, text: '' },
        { type: 'text' as const, text: ERROR_TEXT },
      ],
      isError: true,
    });
    await vi.waitFor(() => expect(status()).toBe(UNSUPPORTED_WORDING));
    expect(cardText()).toBe('');

    // The error text keeps its whitespace and terminal newline.
    await host!.bridge.sendToolResult({
      ...text(`  ${ERROR_TEXT}\n`),
      isError: true,
    });
    await vi.waitFor(() => expect(status()).toBe(`  ${ERROR_TEXT}\n`));
  });

  it('recovers with a valid result after an error and after an unsupported result', async () => {
    await startClassified();
    await host!.bridge.sendToolResult({
      ...text(ERROR_TEXT),
      isError: true,
    });
    await vi.waitFor(() => expect(status()).toBe(ERROR_TEXT));
    await host!.bridge.sendToolResult(
      withStructured(envelope({ answer: 'Back.' })),
    );
    await vi.waitFor(() => expect(cardText()).toContain('Back.'));
    expect(status()).toBeUndefined();

    await host!.bridge.sendToolResult(withStructured({ unexpected: true }));
    await vi.waitFor(() => expect(status()).toBe(UNSUPPORTED_WORDING));
    await host!.bridge.sendToolResult(
      withStructured(envelope({ answer: 'Again.' })),
    );
    await vi.waitFor(() => expect(cardText()).toContain('Again.'));
  });

  it('tells the chrome an error result’s text as the problem, never as an answer', async () => {
    const seen: CardViewState[] = [];
    await startClassified({
      chrome: (props: CardChromeProps) => {
        seen.push(props.state);
        return props.card;
      },
    });
    await host!.bridge.sendToolResult({
      ...withStructured(envelope(), ERROR_TEXT),
      isError: true,
    });
    await vi.waitFor(() =>
      expect(seen).toContainEqual({ kind: 'problem', text: ERROR_TEXT }),
    );
    expect(seen.some((state) => state.kind === 'answer')).toBe(false);
  });

  it('presents an equal answer again as a new presentation', async () => {
    const seen: CardViewState[] = [];
    await startClassified({
      chrome: (props: CardChromeProps) => {
        seen.push(props.state);
        return props.card;
      },
    });
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() => expect(cardText()).toContain('It is so.'));
    const card = container.querySelector('[data-testid="card-root"]');
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="card-root"]')).not.toBe(
        card,
      ),
    );
    expect([
      ...new Set(
        seen.flatMap((state) =>
          state.kind === 'answer' ? [state.presentation] : [],
        ),
      ),
    ]).toEqual([1, 2]);
  });

  it('tells the chrome the supplied wording as the problem text', async () => {
    const seen: CardViewState[] = [];
    await startClassified({
      chrome: (props: CardChromeProps) => {
        seen.push(props.state);
        return props.card;
      },
    });
    await host!.bridge.sendToolResult({ content: [] });
    await vi.waitFor(() =>
      expect(seen).toContainEqual({
        kind: 'problem',
        text: UNSUPPORTED_WORDING,
      }),
    );
  });

  it('shows the definition’s problem text for a rejection that supplies none', async () => {
    await startClassified({}, () => ({ kind: 'rejected' }));
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
  });

  it('reports a reader that throws (phase result), clears the answer, shows the definition’s problem text and recovers', async () => {
    const errors: Array<[unknown, string]> = [];
    await startClassified(
      { onError: (error, phase) => errors.push([error, phase]) },
      (result) => {
        if (
          result.content.some(
            (block) => block.type === 'text' && block.text === 'throw',
          )
        )
          throw new Error('the reader broke');
        return readEnvelopeOrText(result);
      },
    );
    await host!.bridge.sendToolResult(withStructured(envelope()));
    await vi.waitFor(() => expect(cardText()).toContain('It is so.'));

    await host!.bridge.sendToolResult(text('throw'));
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    expect(cardText()).toBe('');
    expect(errors).toHaveLength(1);
    expect(errors[0]![1]).toBe('result');
    expect((errors[0]![0] as Error).message).toBe('the reader broke');

    await host!.bridge.sendToolResult(
      withStructured(envelope({ answer: 'Recovered.' })),
    );
    await vi.waitFor(() => expect(cardText()).toContain('Recovered.'));
  });

  it('shows the definition’s texts.problem when its reader rejects without wording', async () => {
    const view = await start();
    await view.ready;
    await host!.bridge.sendToolResult(text('only text, no structured content'));
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    await host!.bridge.sendToolResult({
      ...withStructured({ answer: 'ignored' }),
      isError: true,
    });
    await vi.waitFor(() => expect(status()).toBe(TEXTS.problem));
    expect(cardText()).toBe('');
  });
});
