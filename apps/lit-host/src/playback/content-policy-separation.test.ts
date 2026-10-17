import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createContentPolicy } from '../content/policy.js';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import { PLAYBACK_RESULT_META, RECIPIENT_KEY_META } from './playback.js';
import {
  callToolOverHttp,
  createRecipientKey,
  rpcOverHttp,
  startPlaybackHarness,
  type PlaybackHarness,
} from './playback-fixture.js';

// Authored Play has its own authorization and resource permissions. Choosing a content level or
// an image host for description content must not change either, and a content image host must not
// inherit the media permission. Every case runs under both levels: Strict alone neither disables
// the valid authored action nor widens what it may reach.

const IMAGE_ORIGIN = 'https://images.example.com';
// The episode view needs a head to carry its policy; the playback resource is served verbatim.
const VIEW_HTML = '<!doctype html><html><head><title>view</title></head><body></body></html>';
let harness: PlaybackHarness | undefined;

afterEach(async () => {
  await harness?.listener.close();
  harness = undefined;
});

async function startWith(level: 'standard' | 'strict'): Promise<PlaybackHarness> {
  const created = createContentPolicy({ level, imageHosts: ['images.example.com'] });
  if (!created.ok) throw new Error(created.failure.message);
  harness = await startPlaybackHarness(
    { [DEV_ACCOUNTS.alice]: ['ep-1'] },
    { contentPolicy: created.policy, viewHtml: VIEW_HTML },
  );
  return harness;
}

const play = (h: PlaybackHarness, token: string, publicJwk: unknown) =>
  callToolOverHttp(h.listener.playbackUrl, token, {
    name: 'play_episode',
    arguments: { episodeId: 'ep-1' },
    _meta: { [RECIPIENT_KEY_META]: publicJwk as Record<string, unknown> },
  });

interface ResourceContents {
  readonly result: { readonly contents: { readonly text: string; readonly _meta: { readonly ui: { readonly csp: Record<string, string[]> } } }[] };
}

describe.each(['standard', 'strict'] as const)('authored Play beside a %s content policy with an image host', (level) => {
  it('still denies a listener without access and still issues a capability to an entitled one', async () => {
    const h = await startWith(level);
    const { publicJwk } = await createRecipientKey();

    const denied = (await play(h, DEV_TOKENS.bob, publicJwk)).body as { result: { isError?: boolean } };
    expect(denied.result.isError).toBe(true);
    expect(h.playback.mediaReads).toEqual([]);

    const granted = (await play(h, DEV_TOKENS.alice, publicJwk)).body as { result: { _meta?: Record<string, unknown> } };
    expect(granted.result._meta?.[PLAYBACK_RESULT_META]).toBeDefined();
    expect(h.playback.entitlementChecks.length).toBeGreaterThan(0);
  });

  it('keeps the player resource unchanged: no image origin, and only the media origin for connections', async () => {
    const h = await startWith(level);
    const response = await rpcOverHttp(h.listener.playbackUrl, DEV_TOKENS.alice, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'ui://saga-a2ui/playback-view.html' },
    });
    const [content] = (response.body as ResourceContents).result.contents;
    expect(content?.text).toBe(VIEW_HTML);
    expect(content?._meta.ui.csp.resourceDomains).toEqual([]);
    expect(JSON.stringify(content?._meta)).not.toContain(IMAGE_ORIGIN);
    expect(content?._meta.ui.csp.connectDomains).toEqual([new URL(h.listener.url).origin]);
  });

  it('serves the episode view of the chosen level beside it, with the image origin and no connection permission', async () => {
    const h = await startWith(level);
    const client = new Client({ name: 'separation-test', version: '0.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(h.listener.url)));
      const { tools } = await client.listTools();
      const uri = (tools[0]?._meta as { ui: { resourceUri: string } }).ui.resourceUri;
      const [content] = (await client.readResource({ uri })).contents;
      expect(content && 'text' in content ? content.text : '').toContain(`"level":"${level}"`);
      const csp = (content?._meta as { ui: { csp: Record<string, string[]> } }).ui.csp;
      expect(csp.resourceDomains).toEqual([IMAGE_ORIGIN]);
      expect(csp.connectDomains).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
