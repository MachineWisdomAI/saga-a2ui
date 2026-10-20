import type { EpisodeCatalog, EpisodeRecord } from '../../../apps/lit-host/src/mcp/server.js';
import { DEV_ACCOUNTS } from '../../../apps/lit-host/src/mcp/dev-auth.js';
import type { AccountSubscriptions, SubscriptionBackend } from '../../../apps/lit-host/src/mcp/subscriptions-server.js';
import type { EntitlementDecision, MediaStore } from '../../../apps/lit-host/src/playback/media-service.js';
import type { PlaybackBackend } from '../../../apps/lit-host/src/playback/playback-server.js';
import { toneWav } from '../../../apps/lit-host/src/playback/synthetic-media.js';
import { createFixtureBackend, type FixtureBackend } from '../../../examples/pack1-consumer/server/index.js';
import { syntheticNotes } from './notes.js';

// DEMO-OWNED synthetic business data: the fictional podcast service the demonstration runs. Nothing
// here is an SDK export and none of it belongs in the clean starter (templates/lit-node). The
// accounts are the application's development accounts (apps/lit-host/src/mcp/dev-auth.ts); the
// "protected media" is a generated tone; no real person, subscriber, recording or service is involved.

export const EPISODE_IDS = { entitled: 'ep-001', unavailable: 'ep-002' } as const;

/**
 * Descriptions are Markdown, read under the listener's content policy. The first carries each kind
 * of content the two levels treat differently (a link, an image, raw markup), so Standard and
 * Strict visibly differ on the same text.
 */
const episodes: readonly EpisodeRecord[] = [
  {
    id: EPISODE_IDS.entitled,
    title: 'The first synthetic episode',
    description: [
      'A **synthetic** episode about *safe* links.',
      '',
      'Read the [show notes](https://docs.example.com/notes) or look at the cover: ![cover art](https://images.example.com/cover.png)',
      '',
      '<b>Raw markup</b> is shown as the characters written.',
    ].join('\n'),
  },
  {
    id: EPISODE_IDS.unavailable,
    title: 'The second synthetic episode',
    description: 'No synthetic account may play this one, so Play always ends in the same safe denial.',
  },
];

const subscriptions: Readonly<Record<string, AccountSubscriptions>> = {
  [DEV_ACCOUNTS.alice]: {
    displayName: 'Alice (synthetic)',
    subscriptions: [
      { subscriptionId: 'sub-a1', creator: 'Synthetic Creator One', tier: 'Gold', status: 'active' },
      { subscriptionId: 'sub-a2', creator: 'Synthetic Creator Two', tier: 'Basic', status: 'paused' },
    ],
  },
  [DEV_ACCOUNTS.bob]: {
    displayName: 'Bob (synthetic)',
    subscriptions: [{ subscriptionId: 'sub-b1', creator: 'Synthetic Creator Three', tier: 'Silver', status: 'active' }],
  },
};

/**
 * Changes a person makes to the synthetic business while the demonstration runs, standing in for
 * the real backend changing state under a signed-in view. Each name is one button of the host page.
 */
export const CONTROL_NAMES = [
  'revoke-play-access',
  'restore-play-access',
  'revoke-play-access-after-next-grant',
  'end-notes-session',
  'restore-notes-session',
  'revoke-archive-permission',
  'restore-archive-permission',
  /** The backend takes its time over the next archives, so a view can be seen waiting. */
  'hold-archives',
  'release-archives',
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

export const isControlName = (value: unknown): value is ControlName => typeof value === 'string' && (CONTROL_NAMES as readonly string[]).includes(value);

export interface ControlState {
  /** Alice's right to play the first episode. `after-next-grant` revokes it right after the next Play is granted. */
  readonly playAccess: 'granted' | 'revoked' | 'revoke-after-next-grant';
  readonly notesSession: 'signed-in' | 'signed-out';
  readonly archivePermission: 'granted' | 'revoked';
  readonly archives: 'immediate' | 'held';
}

export interface DemoWorld {
  readonly catalog: EpisodeCatalog;
  readonly subscriptions: SubscriptionBackend;
  readonly playback: PlaybackBackend;
  readonly media: MediaStore;
  readonly notes: FixtureBackend;
  /** Applies one named change and returns the state afterwards. */
  control(name: ControlName): ControlState;
  state(): ControlState;
}

/** One world per process: the demonstration is a single local application, not a multi-tenant service. */
export function createDemoWorld(): DemoWorld {
  const entitlements = new Map<string, Set<string>>([
    [DEV_ACCOUNTS.alice, new Set<string>([EPISODE_IDS.entitled])],
    [DEV_ACCOUNTS.bob, new Set<string>()],
  ]);
  let revokeAfterNextGrant = false;
  // While held, an archive reaches the backend and waits there; releasing lets every waiting one go on.
  let held = false;
  const release: Array<() => void> = [];
  const backend = createFixtureBackend(
    {
      before: async (call) => {
        if (call === 'archive' && held) await new Promise<void>((resolve) => release.push(resolve));
      },
    },
    syntheticNotes(DEV_ACCOUNTS),
  );
  const aliceMay = (): boolean => entitlements.get(DEV_ACCOUNTS.alice)?.has(EPISODE_IDS.entitled) === true;

  const state = (): ControlState => ({
    playAccess: revokeAfterNextGrant ? 'revoke-after-next-grant' : aliceMay() ? 'granted' : 'revoked',
    notesSession: backend.signedOut.has(DEV_ACCOUNTS.alice) ? 'signed-out' : 'signed-in',
    archivePermission: backend.revoked.has(DEV_ACCOUNTS.alice) ? 'revoked' : 'granted',
    archives: held ? 'held' : 'immediate',
  });

  return {
    catalog: { find: (id) => episodes.find((episode) => episode.id === id) },
    subscriptions: { listSubscriptions: async (accountId) => subscriptions[accountId] },
    playback: {
      findEpisode: (episodeId) => episodes.find((episode) => episode.id === episodeId),
      // Asked again on every protected acquisition, so a change here reaches an issued capability.
      checkEntitlement: async (accountId, episodeId): Promise<EntitlementDecision> => {
        const entitled = entitlements.get(accountId)?.has(episodeId) === true;
        if (entitled && revokeAfterNextGrant && accountId === DEV_ACCOUNTS.alice && episodeId === EPISODE_IDS.entitled) {
          // This answer grants; the next lookup (the media acquisition for that grant) is refused.
          revokeAfterNextGrant = false;
          entitlements.get(accountId)?.delete(episodeId);
        }
        return entitled ? 'entitled' : 'denied';
      },
    },
    media: { read: async () => ({ contentType: 'audio/wav', bytes: toneWav() }) },
    notes: backend,
    state,
    control(name) {
      switch (name) {
        case 'revoke-play-access':
          revokeAfterNextGrant = false;
          entitlements.get(DEV_ACCOUNTS.alice)?.delete(EPISODE_IDS.entitled);
          break;
        case 'restore-play-access':
          revokeAfterNextGrant = false;
          entitlements.get(DEV_ACCOUNTS.alice)?.add(EPISODE_IDS.entitled);
          break;
        case 'revoke-play-access-after-next-grant':
          entitlements.get(DEV_ACCOUNTS.alice)?.add(EPISODE_IDS.entitled);
          revokeAfterNextGrant = true;
          break;
        case 'end-notes-session':
          backend.signedOut.add(DEV_ACCOUNTS.alice);
          break;
        case 'restore-notes-session':
          backend.signedOut.delete(DEV_ACCOUNTS.alice);
          break;
        case 'revoke-archive-permission':
          backend.revoked.add(DEV_ACCOUNTS.alice);
          break;
        case 'restore-archive-permission':
          backend.revoked.delete(DEV_ACCOUNTS.alice);
          break;
        case 'hold-archives':
          held = true;
          break;
        case 'release-archives':
          held = false;
          for (const go of release.splice(0)) go();
          break;
      }
      return state();
    },
  };
}
