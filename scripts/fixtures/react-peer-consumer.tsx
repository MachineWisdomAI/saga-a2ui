import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { runToolResultView } from '@saga-a2ui/mcp/view';
import { createServerBudgets } from '@saga-a2ui/mcp/server';
import {
  createMessageSession,
  a2uiV0_9Decoder,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import {
  Catalog,
  A2uiSurface,
  type ReactCatalogComponent,
} from '@saga-a2ui/react/a2ui';
import { faithfulCardEntry } from '@saga-a2ui/react/faithful-card';
import { z } from 'zod';

// Compile real A2UI and MCP public contracts together. No casts, aliases or skipLibCheck.
const catalog = new Catalog<ReactCatalogComponent>('urn:test:card', 'v0.9', [
  faithfulCardEntry,
]);
const session = createMessageSession({
  catalogs: [catalog],
  decoder: a2uiV0_9Decoder,
});
session.onSurfaceCreated((surface) => {
  const element = <A2uiSurface surface={surface} />;
  void element;
});
const app = new App({ name: 'synthetic', version: '1' }, {});
void runToolResultView({
  app,
  transport: new PostMessageTransport(window.parent, window.parent),
  onToolResult: () => {},
  onTeardown: () => {},
});
void createServerBudgets();
void z.object({ question: z.string() });
