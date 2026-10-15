import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { connectSubscriptionsView, type SubscriptionsViewState } from './mcp/subscriptions-view.js';

// Composition root of the subscriptions view. No server code: data arrives only through the
// host's bridge, and every value is written with textContent so it stays inert text.
function element<T extends HTMLElement>(testId: string): T {
  const found = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`subscriptions.html has no ${testId} element`);
  return found;
}
const root = element<HTMLElement>('subscriptions-root');
const status = element<HTMLElement>('subscriptions-status');
const list = element<HTMLUListElement>('subscriptions-list');

function show(state: SubscriptionsViewState): void {
  list.replaceChildren(); // never leave a previous user's rows beside a new state
  list.hidden = true;
  root.dataset.state = state.kind;
  switch (state.kind) {
    case 'subscriptions': {
      status.textContent = `Signed in as ${state.subscriptions.displayName}`;
      for (const item of state.subscriptions.subscriptions) {
        const row = document.createElement('li');
        row.textContent = `${item.creator} — ${item.tier} (${item.status})`;
        list.append(row);
      }
      list.hidden = false;
      return;
    }
    case 'sign-in-required':
      status.textContent = 'Sign in to see your subscriptions.';
      return;
    case 'problem':
      status.textContent = state.message;
      return;
  }
}

await connectSubscriptionsView({
  app: new App({ name: 'saga-a2ui-subscriptions-view', version: '0.0.0' }),
  transport: new PostMessageTransport(window.parent, window.parent),
  show,
});
