import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';
import { CommonSchemas, Catalog } from '@a2ui/web_core/v0_9';
import { Action } from '@saga-a2ui/core/actions';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  defineSurface,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { createA2uiAppElement, defineElements } from '@saga-a2ui/lit';
import {
  ActionButton,
  actionButtonEntry,
  createLitActions,
} from '@saga-a2ui/lit/actions';
import { html, nothing } from 'lit';

// Like consumer.ts, but it opts in to direct action attachment. It is copied out of the repository
// and built against the packed SDK artifacts (see packed-consumer.test.ts), so it must use only
// the public exports, including `@saga-a2ui/core/actions` and `@saga-a2ui/lit/actions`.

const NoteApi = {
  name: 'Note',
  schema: z.object({ text: CommonSchemas.DynamicString }).strict(),
};

class NoteElement extends A2uiLitElement<typeof NoteApi> {
  protected readonly api = NoteApi;
  render() {
    const text = this.controller?.props?.text;
    return text === undefined
      ? nothing
      : html`<p data-testid="note">${String(text)}</p>`;
  }
}

const Note: LitComponentApi = {
  ...NoteApi,
  tagName: 'own-note',
  element: NoteElement,
};
const catalog = new Catalog<LitComponentApi>(
  'https://consumer.test/catalogs/notes/v1',
  'v0.9',
  [Note, actionButtonEntry],
);

const open = Action.local('open')
  .run(() => undefined)
  .build();

defineElements([Note, actionButtonEntry]);
customElements.define(
  'own-actions-app',
  createA2uiAppElement({
    createSession: () =>
      createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder }),
    layout: defineSurface({
      surfaceId: 'notes',
      catalogId: catalog.id,
      data: z.object({ label: z.string() }),
      initial: { label: 'Open' },
      root: { component: 'ActionButton', bind: {}, props: { child: 'label' } },
      components: [
        { id: 'label', component: 'Note', text: { path: '/label' } },
      ],
    }),
    actions: createLitActions({
      attach: (view) =>
        void view.watchById(
          'root',
          ActionButton,
          (handle) => void handle.bindAction('activate', open),
        ),
      onSetupError: (error) => console.error(error),
    }),
  }),
);
