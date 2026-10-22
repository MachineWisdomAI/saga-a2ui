import { createContentPolicy } from '@saga-a2ui/components/faithful-card';
import {
  createFaithfulCardView,
  faithfulCardEntry,
  provideContentView,
  registerFaithfulCard,
} from '@saga-a2ui/lit/faithful-card';
import { documentContentSecurityPolicies } from '@saga-a2ui/lit-mcp-stack/faithful-card';
import { startNotesView } from './notes-view.js';

// The second consumer: the same catalog, behaviors and server as main-own.ts, plus the optional
// FaithfulCard for each note's body. The trusted settings are the application's; a note's body can
// change none of them.

await startNotesView((hostLinks) => {
  const policy = createContentPolicy({ level: 'standard', imageHosts: [] });
  if (!policy.ok) throw new Error(policy.failure.message);
  const content = createFaithfulCardView({
    dialect: 'commonmark-tables-strikethrough',
    maxLength: 50_000,
    policy: policy.policy,
    contentSecurityPolicies: documentContentSecurityPolicies(document),
    hostLinks,
  });
  registerFaithfulCard();
  const body = {
    id: 'note-body',
    component: 'FaithfulCard',
    contractVersion: 1,
    markdown: { path: 'body' },
  } as const;
  return {
    entries: [faithfulCardEntry],
    body,
    connected: (container) => provideContentView(container, content),
  };
});
