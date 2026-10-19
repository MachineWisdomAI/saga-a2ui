import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import { basicCatalog, ButtonApi, ColumnApi, ListApi, RowApi, TextApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { a2uiV0_9Decoder, createMessageSession, type MessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createElement, Fragment, StrictMode, useLayoutEffect, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { InstanceView, Limits } from '@saga-a2ui/core/actions';
import { ActionButtonEntry } from './action-button.js';
import { InstanceHostProvider, useActionSetup } from './instance-host.js';

// Test-only. A synthetic application over the published `@a2ui/react` 0.13.0 runtime. That
// package ships no basic catalog, so the layout components below are built the way an
// application builds its own: `createComponentImplementation` over the upstream component
// contracts from `@a2ui/web_core`. The `Button` is the upstream `ButtonApi` contract with the
// behavior of an upstream renderer's Button: pressing it calls the resolved `action`, which
// dispatches on the surface (the protocol path).

export const CATALOG_ID = 'https://saga-a2ui.local/catalogs/react-action-consumer/v1';
export const SURFACE_ID = 'actions';

type ChildReference = string | { readonly id: string; readonly basePath: string };

// The generated view hands a child list over as tokens, or `{ id, basePath }` for a template item.
function childrenOf(buildChild: (id: string, basePath?: string) => ReactNode, value: unknown): ReactNode[] {
  const list = Array.isArray(value) ? (value as ChildReference[]) : [];
  return list.map((child) => (typeof child === 'string' ? buildChild(child) : buildChild(child.id, child.basePath)));
}

const Text = createComponentImplementation(TextApi, ({ props }) => createElement('span', null, String(props.text ?? '')));
/**
 * A parent's layout effect runs after its children's in the same commit. The Column reports when
 * it does, so a test can see what the children had already done by the end of the layout phase.
 */
export const columnHooks: { afterLayout?: () => void } = {};
const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) => {
  useLayoutEffect(() => columnHooks.afterLayout?.());
  return createElement('div', { 'data-layout': 'column' }, ...childrenOf(buildChild, props.children));
});
const Row = createComponentImplementation(RowApi, ({ props, buildChild }) =>
  createElement('div', { 'data-layout': 'row' }, ...childrenOf(buildChild, props.children)),
);
const List = createComponentImplementation(ListApi, ({ props, buildChild }) =>
  createElement('div', { 'data-layout': 'list' }, ...childrenOf(buildChild, props.children)),
);
const Button = createComponentImplementation(ButtonApi, ({ props, buildChild }) =>
  createElement(
    'button',
    { type: 'button', 'data-upstream': 'true', onClick: () => (props.action as (() => void) | undefined)?.() },
    typeof props.child === 'string' ? buildChild(props.child) : null,
  ),
);

export const components: ReactCatalogComponent[] = [Text, Column, Row, List, Button, ActionButtonEntry];
export const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', components, [
  ...basicCatalog.functions.values(),
]);

/** The messages that create the surface with the consumer's layout and data. */
export function layout(surfaceId = SURFACE_ID, extraComponents: readonly object[] = []): unknown[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['mark-a', 'mark-b', 'orphan', 'upstream-button', 'rows'] },
          { id: 'mark-a', component: 'ActionButton', child: 'mark-a-label' },
          { id: 'mark-a-label', component: 'Text', text: 'Mark A' },
          { id: 'mark-b', component: 'ActionButton', child: 'mark-b-label' },
          { id: 'mark-b-label', component: 'Text', text: 'Mark B' },
          { id: 'orphan', component: 'ActionButton', child: 'orphan-label' },
          { id: 'orphan-label', component: 'Text', text: 'Unbound' },
          {
            id: 'upstream-button',
            component: 'Button',
            child: 'upstream-label',
            action: { event: { name: 'upstream-press' } },
          },
          { id: 'upstream-label', component: 'Text', text: 'Upstream' },
          { id: 'rows', component: 'List', children: { componentId: 'row', path: '/rows' } },
          { id: 'row', component: 'Row', children: ['row-title', 'row-archive'] },
          { id: 'row-title', component: 'Text', text: { path: 'title' } },
          { id: 'row-archive', component: 'ActionButton', child: 'row-archive-label' },
          { id: 'row-archive-label', component: 'Text', text: 'Archive' },
          ...extraComponents,
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId,
        value: {
          rows: [
            { id: 'n-1', title: 'Alpha' },
            { id: 'n-2', title: 'Beta' },
          ],
        },
      },
    },
  ];
}

export interface Session {
  readonly surface: SurfaceModel<ReactCatalogComponent>;
  /** Upstream protocol actions the surface dispatched. */
  readonly upstream: unknown[];
  ingest(input: unknown): void;
  dispose(): void;
}

/** A real message session over the application's catalog, with the layout already ingested. */
export function openSession(messages: unknown[] = layout()): Session {
  const session: MessageSession<ReactCatalogComponent> = createMessageSession({
    catalogs: [catalog],
    decoder: a2uiV0_9Decoder,
  });
  let surface: SurfaceModel<ReactCatalogComponent> | undefined;
  const upstream: unknown[] = [];
  session.onSurfaceCreated((created) => {
    surface = created;
    created.onAction.subscribe((action) => {
      upstream.push(action);
    });
  });
  const ingest = (input: unknown): void => {
    const result = session.ingest(input);
    if (!result.ok) throw new Error(`ingest failed: ${result.failure.message}`);
  };
  ingest(messages);
  if (!surface) throw new Error('the layout created no surface');
  return { surface, upstream, ingest, dispose: () => session.dispose() };
}

function Setup(props: { readonly setup: (view: InstanceView) => void }): null {
  useActionSetup(props.setup);
  return null;
}

/** What a surface view looks like in an application: a provider, the setup, the upstream surface. */
export function surfaceView(options: {
  readonly surface: SurfaceModel<ReactCatalogComponent>;
  readonly setup: (view: InstanceView) => void;
  readonly onSetupError?: (error: unknown) => void;
  /** The application's action limits, handed to the provider. */
  readonly limits?: Limits;
  /** Rendered after the surface, so its layout effects run after the surface's own. */
  readonly after?: ReactNode;
}): ReactElement {
  return createElement(InstanceHostProvider, {
    onSetupError: options.onSetupError ?? (() => undefined),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    children: createElement(
      Fragment,
      null,
      createElement(Setup, { setup: options.setup }),
      createElement(A2uiSurface, { surface: options.surface }),
      options.after,
    ),
  });
}

export interface Mounted {
  readonly container: HTMLElement;
  render(element: ReactElement): void;
  unmount(): void;
  /** The `<button>` whose text is exactly `label`; throws when there is none or several. */
  button(label: string): HTMLButtonElement;
  buttons(label: string): HTMLButtonElement[];
  press(button: HTMLButtonElement): void;
  /** Lets promises the surface started settle (the protocol action path is asynchronous upstream). */
  settle(): Promise<void>;
}

declare global {
  // React's flag that says state updates in this environment are wrapped in `act`.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Renders into the document with a real React root. Strict Mode is the default, as in development. */
export function mount(options: { readonly strict?: boolean } = {}): Mounted {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  const strict = options.strict ?? true;
  const buttons = (label: string): HTMLButtonElement[] =>
    [...container.querySelectorAll('button')].filter((candidate) => candidate.textContent === label);
  return {
    container,
    render(element) {
      act(() => root.render(strict ? createElement(StrictMode, null, element) : element));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
    buttons,
    button(label) {
      const found = buttons(label);
      if (found.length !== 1) throw new Error(`${found.length} buttons are labelled '${label}'`);
      return found[0]!;
    },
    async settle() {
      await act(async () => {});
    },
    press(button) {
      act(() => button.click());
    },
  };
}
