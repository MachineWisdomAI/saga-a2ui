import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9';
import { CommonSchemas, Catalog } from '@a2ui/web_core/v0_9';
import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { createA2uiAppElement, defineElements } from '@saga-a2ui/lit';
import { html, nothing } from 'lit';

// A minimal consumer with its own catalog. It is copied out of the repository and built against
// the packed SDK artifacts (see packed-consumer.test.ts), so it must use only public exports.

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
  [Note],
);

defineElements([Note]);
customElements.define(
  'own-notes-app',
  createA2uiAppElement({
    catalog: catalog,
    layout: defineSurface({
      surfaceId: 'notes',
      catalogId: catalog.id,
      data: z.object({}),
      initial: {},
      root: { component: 'Note', bind: {}, props: { text: 'Hello' } },
    }),
  }),
);
