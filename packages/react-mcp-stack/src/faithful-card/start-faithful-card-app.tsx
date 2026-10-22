import {
  readCardResult,
  type CardResultClassifier,
  type CardResultOutcome,
  type FaithfulCardAppDefinition,
} from '@saga-a2ui/components/faithful-card';
import type { HostContext, ToolResult } from '@saga-a2ui/mcp/view';
import { hostLinksFromApp, readStructuredResult } from '@saga-a2ui/mcp/view';
import {
  createFaithfulCardView,
  FaithfulCardProvider,
  FaithfulCardSurface,
  openFaithfulCardSurface,
  type CardSurface,
  type FaithfulCardView,
} from '@saga-a2ui/react/faithful-card';
import {
  createElement,
  Fragment,
  useSyncExternalStore,
  type ComponentType,
  type ReactElement,
} from 'react';
import { claimContainer } from '../container-claim.js';
import { connectToHost, type HostConnection } from '../host-connection.js';
import { openStackRoot } from '../initial-render.js';
import {
  runView,
  viewFailedBeforeConnecting,
  viewThatNeverStarted,
  type RunningView,
} from '../running-view.js';
import { StartFailure, type ErrorPhase } from '../start-failure.js';
import {
  contentPolicyFromDocument,
  documentContentSecurityPolicies,
} from './document-policy.js';

/** What the application’s chrome is told about the card, and what to say beside it. */
export type CardViewState =
  | { readonly kind: 'waiting'; readonly text: string }
  | {
      readonly kind: 'answer';
      readonly heading: string | undefined;
      /** Advances with every presented answer, including one whose text equals the last. */
      readonly presentation: number;
    }
  | { readonly kind: 'problem'; readonly text: string };

/** What the chrome component receives: the card to place, and the state to word around it. */
export interface CardChromeProps {
  /** The card. Place it exactly once; it is empty until the first answer. */
  readonly card: ReactElement;
  readonly state: CardViewState;
}

export interface StartFaithfulCardOptions {
  /** The element the view is rendered into. Must be attached to the document and free. */
  readonly container: Element;
  /** `own`: the view tells the host its size. `host`: the bridge reports it. */
  readonly sizing: 'own' | 'host';
  /** Optional. Work the view needs before it shows anything (for example fonts); `signal` aborts when the view ends. */
  readonly readyWhen?: (signal: AbortSignal) => Promise<void>;
  /** Optional. The negotiated host context and the host’s name, before the first answer and on change. */
  readonly hostContext?: (
    context: HostContext | undefined,
    hostName: string | undefined,
  ) => void;
  /**
   * Optional. The application’s reading of each whole delivered result, in place of the
   * definition’s `structuredContent`-only parse. It receives the result as delivered, `isError`
   * included, and returns the content to present or a rejection that may carry the words to show
   * (otherwise `texts.problem` shows). A throw is reported (phase `result`) and rejects the result.
   * The stack still owns clearing, presenting, consent and link state, and error reporting.
   */
  readonly classifyResult?: CardResultClassifier<ToolResult>;
  /** Optional. The application’s chrome around the card. By default the status text, then the card. */
  readonly chrome?: ComponentType<CardChromeProps>;
  /** Optional. Receives a throw from a callback after the view was ready. Defaults to `console.error`. */
  readonly onError?: (error: unknown, phase: ErrorPhase) => void;
}

const DefaultChrome = (props: CardChromeProps): ReactElement => {
  const { state } = props;
  return createElement(
    Fragment,
    null,
    state.kind === 'answer'
      ? state.heading === undefined
        ? null
        : createElement('h2', null, state.heading)
      : createElement('p', { role: 'status' }, state.text),
    props.card,
  );
};

/** The state the chrome renders, readable by React and settable by the stack. */
function createStateStore(initial: CardViewState) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    set(next: CardViewState): void {
      current = next;
      for (const listener of [...listeners]) listener();
    },
    get: (): CardViewState => current,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
type StateStore = ReturnType<typeof createStateStore>;

function CardApp(props: {
  readonly view: FaithfulCardView | undefined;
  readonly card: CardSurface | undefined;
  readonly store: StateStore;
  readonly Chrome: ComponentType<CardChromeProps>;
}): ReactElement {
  const state = useSyncExternalStore(props.store.subscribe, props.store.get);
  const { view, card, Chrome } = props;
  const cardElement =
    card === undefined
      ? createElement(Fragment)
      : createElement(FaithfulCardSurface, { of: card });
  const chrome = createElement(Chrome, { card: cardElement, state });
  return view === undefined
    ? chrome
    : createElement(FaithfulCardProvider, { view, children: chrome });
}

/**
 * Starts a card application in `options.container` and returns it at once. The embedded policy is
 * read from the container’s document, the host is connected with its handlers installed first,
 * and each delivered result is read with the definition’s `parse` and shown in the card: a new
 * presentation each time, even for equal text. Throws `StartError` (`container-missing`,
 * `container-busy`) before connecting to anything. The first render happens before the host is
 * connected: a `chrome` that throws in it does not throw out of `start`, it fails startup (`ready`
 * rejects with `StartFailure` of kind `application`) after the stack took back what it made and
 * freed the container. A throw in a later render goes to `onError` with phase
 * `result`, the render a delivered result caused (default `console.error`); `ready` stays resolved.
 */
export function startFaithfulCardApp(
  definition: FaithfulCardAppDefinition,
  options: StartFaithfulCardOptions,
): RunningView {
  return startFaithfulCardAppOn(
    () => connectToHost(definition.identity, options.sizing),
    definition,
    options,
  );
}

/** {@link startFaithfulCardApp} over a connection the caller supplies: the seam the stack’s own tests use. */
export function startFaithfulCardAppOn(
  connect: () => HostConnection,
  definition: FaithfulCardAppDefinition,
  options: StartFaithfulCardOptions,
): RunningView {
  const claim = claimContainer(options.container);
  let root: ReturnType<typeof openStackRoot> | undefined;
  try {
    const { texts } = definition;
    const Chrome = options.chrome ?? DefaultChrome;
    const store = createStateStore({ kind: 'waiting', text: texts.waiting });
    const mounted = (root = openStackRoot(claim.container, options.onError));
    const unmount = (): void => mounted.root.unmount();
    /** The first render, now: the chrome is the application's, and a throw in it fails the start. */
    const renderInitially = (view?: FaithfulCardView, card?: CardSurface) =>
      mounted.renderInitially(
        createElement(CardApp, { view, card, store, Chrome }),
      );

    const policy = contentPolicyFromDocument(claim.container.ownerDocument);
    if (!policy.ok) {
      store.set({ kind: 'problem', text: texts.policyFailure });
      const failed = renderInitially();
      if (failed !== undefined) {
        // The chrome threw while showing why the start failed: that is the failure to report.
        unmount();
        claim.release();
        return viewThatNeverStarted(failed.cause);
      }
      return viewFailedBeforeConnecting({
        failure: new StartFailure('policy', policy.failure),
        unmount,
        releaseContainer: claim.release,
        ...(options.onError === undefined ? {} : { onError: options.onError }),
      });
    }

    const connection = connect();
    const lifetime = new AbortController();
    const view = createFaithfulCardView({
      ...definition.reader,
      policy: policy.policy,
      contentSecurityPolicies: documentContentSecurityPolicies(
        claim.container.ownerDocument,
      ),
      hostLinks: hostLinksFromApp(connection.app, lifetime.signal),
    });
    const card = openFaithfulCardSurface();
    const failed = renderInitially(view, card);
    if (failed !== undefined) {
      // The chrome threw on its first render. Nothing connected: take back what this start made.
      lifetime.abort();
      view.consent.retire();
      card.dispose();
      unmount();
      claim.release();
      return viewThatNeverStarted(failed.cause);
    }

    const report =
      options.onError ?? ((error: unknown) => console.error(error));
    let presentation = 0;
    const problem = (text: string): void => {
      card.clear();
      store.set({ kind: 'problem', text });
    };
    /** The application’s reading of the result; a throw is reported, and the result is rejected. */
    const read = (result: ToolResult): CardResultOutcome =>
      readCardResult(result, {
        // The delivery's default: MCP's error flag and structured content, decided once in the
        // MCP package. The application's `classifyResult`, when given, replaces it.
        read: (delivered) =>
          readStructuredResult(delivered, (structured) =>
            definition.parse(structured),
          ),
        classify: options.classifyResult,
        reportError(error) {
          try {
            report(error, 'result');
          } catch {
            // A reporter that throws must not stop the answer from clearing.
          }
        },
      });

    return runView({
      connection,
      lifetime,
      releaseContainer: claim.release,
      sizing: options.sizing,
      ...(options.readyWhen === undefined
        ? {}
        : { readyWhen: options.readyWhen }),
      ...(options.hostContext === undefined
        ? {}
        : { hostContext: options.hostContext }),
      // Every result is a new selection: `present` ends the earlier presentation, image consent
      // included, even when the Markdown equals the previous one.
      onToolResult(result) {
        const outcome = read(result);
        if (outcome.kind === 'rejected') {
          // The application's wording for this rejection, else the definition's.
          problem(outcome.text ?? texts.problem);
          return;
        }
        if (!card.present(outcome.content).ok) {
          problem(texts.problem);
          return;
        }
        presentation += 1;
        store.set({
          kind: 'answer',
          heading: outcome.content.heading,
          presentation,
        });
      },
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      retire() {
        view.consent.retire();
        card.dispose();
      },
      unmount,
      showFailure(failure) {
        const text = {
          policy: texts.policyFailure,
          connect: texts.connectFailure,
          ready: texts.readyFailure,
          application: texts.problem,
          disposed: texts.problem,
        }[failure.kind];
        store.set({ kind: 'problem', text });
        return true;
      },
    });
  } catch (error) {
    // Nothing connected: take back what this start rendered and free the container.
    root?.root.unmount();
    claim.release();
    throw error;
  }
}
