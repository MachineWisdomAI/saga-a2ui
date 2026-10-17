import { afterEach, describe, expect, it } from 'vitest';
import { createContentPolicy } from '../content/policy.js';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import { PLAYBACK_RESULT_META, RECIPIENT_KEY_META } from './playback.js';
import {
  callToolOverHttp,
  createRecipientKey,
  PLAYER_VIEW_HTML,
  rpcOverHttp,
  startPlaybackHarness,
  type PlaybackHarness,
} from './playback-fixture.js';

// Authored Play has its own authorization and resource permissions. Choosing an image host for
// description content must not change either, and a content image host must not inherit the
// media permission.

const IMAGE_ORIGIN = 'https://images.example.com';
let harness: PlaybackHarness | undefined;

afterEach(async () => {
  await harness?.listener.close();
  harness = undefined;
});

async function startWithImageHost(): Promise<PlaybackHarness> {
  const created = createContentPolicy({ imageHosts: ['images.example.com'] });
  if (!created.ok) throw new Error(created.failure.message);
  harness = await startPlaybackHarness({ [DEV_ACCOUNTS.alice]: ['ep-1'] }, { contentPolicy: created.policy });
  return harness;
}

const play = (h: PlaybackHarness, token: string, publicJwk: unknown) =>
  callToolOverHttp(h.listener.playbackUrl, token, {
    name: 'play_episode',
    arguments: { episodeId: 'ep-1' },
    _meta: { [RECIPIENT_KEY_META]: publicJwk as Record<string, unknown> },
  });

describe('authored Play beside a content image host', () => {
  it('still denies a listener without access and still issues a capability to an entitled one', async () => {
    const h = await startWithImageHost();
    const { publicJwk } = await createRecipientKey();

    const denied = (await play(h, DEV_TOKENS.bob, publicJwk)).body as { result: { isError?: boolean } };
    expect(denied.result.isError).toBe(true);
    expect(h.playback.mediaReads).toEqual([]);

    const granted = (await play(h, DEV_TOKENS.alice, publicJwk)).body as { result: { _meta?: Record<string, unknown> } };
    expect(granted.result._meta?.[PLAYBACK_RESULT_META]).toBeDefined();
    expect(h.playback.entitlementChecks.length).toBeGreaterThan(0);
  });

  it('keeps the player resource unchanged: no image origin, and only the media origin for connections', async () => {
    const h = await startWithImageHost();
    const response = await rpcOverHttp(h.listener.playbackUrl, DEV_TOKENS.alice, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'ui://saga-a2ui/playback-view.html' },
    });
    const [content] = (
      response.body as { result: { contents: { text: string; _meta: { ui: { csp: Record<string, string[]> } } }[] } }
    ).result.contents;
    expect(content?.text).toBe(PLAYER_VIEW_HTML);
    expect(content?._meta.ui.csp.resourceDomains).toEqual([]);
    expect(JSON.stringify(content?._meta)).not.toContain(IMAGE_ORIGIN);
    expect(content?._meta.ui.csp.connectDomains).toEqual([new URL(h.listener.url).origin]);
  });
});
