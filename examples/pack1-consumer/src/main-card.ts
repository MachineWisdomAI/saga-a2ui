import {
  createContentPolicy,
  createFaithfulCardReader,
  createImageConsentScope,
  establishImageEnforcement,
  type HostLinks,
} from '@saga-a2ui/components/faithful-card';
import { documentContentSecurityPolicies, faithfulCardEntry, provideContentView, registerFaithfulCard, type ContentView } from '@saga-a2ui/lit/faithful-card';
import { startNotesView } from './notes-view.js';

// The second consumer: the same catalog, behaviors and server as main-own.ts, plus the optional
// FaithfulCard for each note's body. The trusted settings are the application's; a note's body can
// change none of them.

await startNotesView((app) => {
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
  const reader = createFaithfulCardReader({ dialect: 'commonmark-tables-strikethrough', maxLength: 50_000 });
  const policy = createContentPolicy({ level: 'standard', imageHosts: [] });
  if (!reader.ok) throw new Error(reader.failure.message);
  if (!policy.ok) throw new Error(policy.failure.message);
  const content: ContentView = {
    reader: reader.reader,
    policy: policy.policy,
    hostLinks,
    imageEnforcement: establishImageEnforcement(policy.policy, documentContentSecurityPolicies(document)),
    consent: createImageConsentScope(),
  };
  registerFaithfulCard();
  const body = { id: 'note-body', component: 'FaithfulCard', contractVersion: 1, markdown: { path: 'body' } } as const;
  return { entries: [faithfulCardEntry], body, connected: (element) => provideContentView(element, content) };
});
