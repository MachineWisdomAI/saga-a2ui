import {
  readCardResult,
  type CardResultClassifier,
  type CardResultOutcome,
  type FaithfulCardAppDefinition,
} from '@saga-a2ui/components/faithful-card';
import {
  createFaithfulCardView,
  openFaithfulCardSurface,
  provideContentView,
  registerFaithfulCard,
} from '@saga-a2ui/lit/faithful-card';
import type { CardSurface, ContentView } from '@saga-a2ui/lit/faithful-card';
import { hostLinksFromApp, readStructuredResult } from '@saga-a2ui/mcp/view';
import type { HostContext, ToolResult } from '@saga-a2ui/mcp/view';
import { html, render, type TemplateResult } from 'lit';
import { applicationFailureOf, callApplication } from '../application-call.js';
import { claimContainer } from '../container-claim.js';
import { connectToHost, type HostConnection } from '../host-connection.js';
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

/** What the chrome function receives: the card to place, and the state to word around it. */
export interface CardChromeParts {
  /** The card. Place it exactly once; it is empty until the first answer. */
  readonly card: Node;
  readonly state: CardViewState;
}

/** The application’s chrome: renders the card and the words around it. Called again on every change of state. */
export type CardChrome = (parts: CardChromeParts) => TemplateResult;

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
  readonly chrome?: CardChrome;
  /** Optional. Receives a throw from a callback after the view was ready. Defaults to `console.error`. */
  readonly onError?: (error: unknown, phase: ErrorPhase) => void;
}

const defaultChrome: CardChrome = ({ card, state }) =>
  html`${
    state.kind === 'answer'
      ? state.heading === undefined
        ? ''
        : html`<h2>${state.heading}</h2>`
      : html`<p role="status">${state.text}</p>`
  }${card}`;

/**
 * Starts a card application in `options.container` and returns it at once. The embedded policy is
 * read from the container’s document, the host is connected with its handlers installed first,
 * and each delivered result is read with the definition’s `parse` and shown in the card: a new
 * presentation each time, even for equal text. Throws `StartError` (`container-missing`,
 * `container-busy`) before connecting to anything.
 * An application callback that throws while the view is being set up (the initial `chrome` call) does not
 * throw out of `start`: the stack takes back what it made, frees the container and returns a
 * view whose `ready` rejects with `StartFailure` of kind `application`.
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
  // The view renders into an element of its own, so removing it leaves the container as it was.
  const mount = document.createElement('div');
  mount.style.display = 'contents';
  let stopProviding: (() => void) | undefined;
  let view: ContentView | undefined;
  let surface: CardSurface | undefined;
  try {
    const { texts } = definition;
    const chrome = options.chrome ?? defaultChrome;
    let state: CardViewState = { kind: 'waiting', text: texts.waiting };
    let card: Node = document.createDocumentFragment();
    const show = (next: CardViewState): void => {
      state = next;
      render(chrome({ card, state }), mount);
    };
    const unmount = (): void => {
      stopProviding?.();
      mount.remove();
    };
    claim.container.append(mount);

    const policy = contentPolicyFromDocument(claim.container.ownerDocument);
    if (!policy.ok) {
      callApplication(() =>
        show({ kind: 'problem', text: texts.policyFailure }),
      );
      return viewFailedBeforeConnecting({
        failure: new StartFailure('policy', policy.failure),
        unmount,
        releaseContainer: claim.release,
        ...(options.onError === undefined ? {} : { onError: options.onError }),
      });
    }

    const connection = connect();
    const lifetime = new AbortController();
    const cardView = (view = createFaithfulCardView({
      ...definition.reader,
      policy: policy.policy,
      contentSecurityPolicies: documentContentSecurityPolicies(
        claim.container.ownerDocument,
      ),
      hostLinks: hostLinksFromApp(connection.app, lifetime.signal),
    }));
    registerFaithfulCard();
    const opened = (surface = openFaithfulCardSurface());
    card = opened.element;
    // The card asks the nearest view for its settings when it connects, so the view is provided first.
    stopProviding = provideContentView(mount, cardView);
    callApplication(() => show(state));

    const report =
      options.onError ?? ((error: unknown) => console.error(error));
    let presentation = 0;
    const problem = (text: string): void => {
      opened.clear();
      show({ kind: 'problem', text });
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
        if (!opened.present(outcome.content).ok) {
          problem(texts.problem);
          return;
        }
        presentation += 1;
        show({
          kind: 'answer',
          heading: outcome.content.heading,
          presentation,
        });
      },
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      retire() {
        cardView.consent.retire();
        opened.dispose();
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
        show({ kind: 'problem', text });
        return true;
      },
    });
  } catch (error) {
    // Nothing connected: take back what this start made and free the container.
    stopProviding?.();
    mount.remove();
    view?.consent.retire();
    surface?.dispose();
    claim.release();
    const failed = applicationFailureOf(error);
    if (failed === undefined) throw error;
    // The application's chrome threw before a view existed: `ready` carries the failure.
    return viewThatNeverStarted(failed.cause);
  }
}
