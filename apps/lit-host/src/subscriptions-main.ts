import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import {
  connectSubscriptionsView,
  type SubscriptionsViewState,
} from './mcp/subscriptions-view.js';
import { SIGN_IN_REQUIRED_TEXT } from './mcp/subscriptions.js';

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
const retryButton = element<HTMLButtonElement>('subscriptions-retry');

let connection:
  { retry(): void; select(subscriptionId: string): void } | undefined;
retryButton.addEventListener('click', () => connection?.retry());

function show(state: SubscriptionsViewState): void {
  list.replaceChildren(); // never leave a previous user's rows beside a new state
  list.hidden = true;
  retryButton.hidden =
    state.kind !== 'empty' &&
    state.kind !== 'retry' &&
    state.kind !== 'problem';
  root.dataset.state = state.kind;
  switch (state.kind) {
    case 'subscriptions': {
      status.textContent = `Signed in as ${state.subscriptions.displayName}`;
      for (const item of state.subscriptions.subscriptions) {
        const row = document.createElement('li');
        row.textContent = `${item.creator} — ${item.tier} (${item.status})`;
        row.dataset.subscriptionId = item.subscriptionId;
        if (state.selectedId === item.subscriptionId)
          row.dataset.selected = 'true';
        row.addEventListener('click', () =>
          connection?.select(item.subscriptionId),
        );
        list.append(row);
      }
      list.hidden = false;
      return;
    }
    case 'empty':
      status.textContent = `Signed in as ${state.displayName}. ${state.message}`;
      return;
    case 'sign-in-required':
      status.textContent = SIGN_IN_REQUIRED_TEXT;
      return;
    case 'retry':
    case 'problem':
      status.textContent = state.message;
      return;
  }
}

connection = await connectSubscriptionsView({
  app: new App({ name: 'saga-a2ui-subscriptions-view', version: '0.0.0' }),
  transport: new PostMessageTransport(window.parent, window.parent),
  show,
});
