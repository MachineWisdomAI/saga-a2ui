import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';
import { componentKind, type InstanceEvent, type OpenInstance } from '@saga-a2ui/core/actions';
import { html, nothing } from 'lit';
import { ActionButtonApi } from '@saga-a2ui/core/actions/action-button-schema';
import { hostOf } from './mount-owner.js';

/** The event an `ActionButton` delivers: the instance's data scope plus the DOM click. */
export type ActionButtonActivation = InstanceEvent<Event>;

export interface ActionButtonEvents {
  readonly activate: ActionButtonActivation;
}

/** The kind token application setup passes to `getById` and `watchById`. */
export const ActionButton = componentKind<ActionButtonEvents>('ActionButton');

/**
 * One element class serves every instance of the kind. The instance belongs to the element
 * together with the component model and data path it currently shows: the directive reuses
 * elements, and parents replace `context` on every render, so neither alone is an identity.
 *
 * Upstream decides when a binding changed: `willUpdate` keeps the controller while the same
 * component is shown at the same path and calls `createController()` otherwise, which is the
 * supported seam this override uses. It never relies on `element.node`, which stays unset under
 * `a2ui-surface`.
 *
 * The control has no upstream `action`, so its single click handler is the only activation site.
 * Do not add another click listener to a rendered button as a shortcut: for an upstream Button it
 * would run in addition to the Button's own action.
 */
export class ActionButtonElement extends A2uiLitElement<typeof ActionButtonApi> {
  protected readonly api = ActionButtonApi;
  #instance: OpenInstance<ActionButtonEvents> | undefined;

  protected override createController() {
    this.#retire();
    const controller = super.createController();
    this.#open();
    return controller;
  }

  override connectedCallback() {
    super.connectedCallback();
    // Reconnecting keeps upstream's controller, so no createController call opens a new instance.
    if (this.controller) this.#open();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#retire();
  }

  #open() {
    if (this.#instance) return;
    const context = this.context;
    const { surface, path } = context.dataContext;
    // `DataContext.surface` is optional in the 0.13.0 types: without it the control stays unbound.
    if (!surface) return;
    const host = hostOf(this, surface);
    if (!host) return; // not presented by an app element with actions: stay unbound
    const model = context.componentModel;
    // A fresh pull on every call, never a stored answer. Each line closes a different window: the
    // element left the document; the model was removed, replaced or its surface disposed; a parent
    // already gave this element another component's context before its willUpdate has run.
    const isLive = () =>
      this.isConnected &&
      surface.componentsModel.get(model.id) === model &&
      this.context.componentModel === model &&
      this.context.dataContext.path === path;
    this.#instance = host.open<ActionButtonEvents>({
      kind: ActionButton,
      componentId: model.id,
      dataPath: path,
      events: ['activate'],
      isLive,
      // This instance's own scope, not this.context, which a same-tag reuse may already have replaced.
      read: (dataPath) => (isLive() ? context.dataContext.resolveDynamicValue<unknown>({ path: dataPath }) : undefined),
      // The runtime holds this only while an invocation is not settled. `DataModel.subscribe` calls
      // back synchronously inside `set` and also for an ancestor or descendant of the scope's path;
      // the microtask lets the whole change finish before the runtime reads the application's
      // subject, so an A, B, A inside one call stack is not seen, and it runs before the next click.
      // A subject that reads state outside the data model gets no wake-up here, only the runtime's
      // own checkpoints.
      watchScope: (revalidate) => {
        const subscription = surface.dataModel.subscribe(path, () => queueMicrotask(revalidate));
        return () => subscription.unsubscribe();
      },
    });
  }

  #retire() {
    this.#instance?.retire();
    this.#instance = undefined;
  }

  protected override render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    return html`<button type="button" ?disabled=${props.isValid === false} @click=${this.#onClick}>
      ${props.child ? this.renderNode(props.child) : nothing}
    </button>`;
  }

  #onClick = (event: Event) => {
    if (this.controller?.props?.isValid === false) return; // the same check the upstream Button makes
    this.#instance?.activate('activate', event);
  };
}

/** The catalog entry. An application lists it in its own catalog and passes it to `defineElements`. */
export const actionButtonEntry = {
  ...ActionButtonApi,
  tagName: 'saga-action-button',
  element: ActionButtonElement,
} satisfies LitComponentApi;
