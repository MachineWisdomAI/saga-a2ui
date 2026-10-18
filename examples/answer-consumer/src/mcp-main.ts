import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { registerFaithfulCard, type HostLinks } from '@saga-a2ui/lit/faithful-card';
import { connectToolResultView } from '@saga-a2ui/mcp/view';
import { createAnswerViewElement } from './answer-view.js';
import { brandings } from './branding.js';
import { createContentView } from './content-view.js';

// Composition root of the page an MCP host mounts (mcp.html, served by server/answer-server.ts).
// No server code and no answer function: the host's bridge delivers each tool result and this page
// shows it in the shared FaithfulCard. The host's Content-Security-Policy governs the page, so it
// loads no image; a link leaves only as a request the host may refuse.

const app = new App({ name: 'answer-consumer-view', version: '0.0.0' });

const hostLinks: HostLinks = {
  async open(url) {
    if (app.getHostCapabilities()?.openLinks === undefined) return 'unavailable';
    try {
      return (await app.openLink({ url })).isError === true ? 'denied' : 'opened';
    } catch {
      return 'failed';
    }
  },
};

registerFaithfulCard();
const AnswerView = createAnswerViewElement({
  branding: brandings.nur,
  content: createContentView({ level: 'standard', imageHosts: [], hostLinks }),
});
customElements.define('answer-view', AnswerView);

const view = document.querySelector<InstanceType<typeof AnswerView>>('answer-view');
if (!view) throw new Error('mcp.html has no answer-view element');

const connection = await connectToolResultView({
  app,
  transport: new PostMessageTransport(window.parent, window.parent),
  onToolResult: (result) => view.show(result),
});
// The page going away ends the connection, so a late delivery reaches nothing.
addEventListener('pagehide', () => connection.dispose());
