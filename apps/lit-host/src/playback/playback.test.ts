import { afterEach, describe, expect, it } from 'vitest';
import { createDevelopmentVerifier, DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import { startEpisodeListener, type EpisodeListener } from '../mcp/listener.js';
import { countingPlayback, type CountingPlayback } from './playback-fixture.js';

// The playback endpoint, exercised through the real listener over HTTP with real bearer
// credentials. Names and sentences are written out literally: the requirement, not the
// implementation, decides them.

const VIEW_HTML = '<!doctype html><title>player</title>';

interface Harness {
  readonly listener: EpisodeListener;
  readonly playback: CountingPlayback;
}

const cleanup: { listener?: EpisodeListener } = {};

async function harness(
  entitlements: Readonly<Record<string, readonly string[]>> = { [DEV_ACCOUNTS.alice]: ['ep-1'] },
): Promise<Harness> {
  const playback = countingPlayback(entitlements);
  const listener = await startEpisodeListener({
    viewHtml: VIEW_HTML,
    catalog: { find: () => undefined },
    port: 0,
    playback: {
      viewHtml: VIEW_HTML,
      backend: playback.backend,
      mediaStore: playback.store,
      verifier: createDevelopmentVerifier(),
    },
  });
  cleanup.listener = listener;
  return { listener, playback };
}

afterEach(async () => {
  await cleanup.listener?.close();
  cleanup.listener = undefined;
});

interface ListedTool {
  readonly name: string;
  readonly inputSchema: { readonly properties?: Record<string, unknown>; readonly additionalProperties?: unknown };
  readonly _meta?: { readonly ui?: { readonly visibility?: readonly string[] } };
}

async function listTools(url: string | undefined, token: string): Promise<ListedTool[]> {
  expect(url, 'the listener exposes a playback endpoint when the application configures one').toBeDefined();
  const response = await fetch(url ?? '', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: { tools: ListedTool[] } }).result.tools;
}

describe('the Play operation declaration', () => {
  it('is app-only: the embedded view may call it and the model is not offered it', async () => {
    const h = await harness();
    const tools = await listTools(h.listener.playbackUrl, DEV_TOKENS.alice);

    const appOnly = tools.filter((tool) => {
      const visibility = tool._meta?.ui?.visibility ?? ['model', 'app'];
      return visibility.includes('app') && !visibility.includes('model');
    });
    expect(appOnly.map((tool) => tool.name)).toEqual(['play_episode']);
    expect(appOnly[0]?._meta?.ui?.visibility).toEqual(['app']);
  });

  it('accepts only an episode id: nothing in its input can name an account', async () => {
    const h = await harness();
    const tools = await listTools(h.listener.playbackUrl, DEV_TOKENS.alice);
    const play = tools.find((tool) => tool.name === 'play_episode');
    expect(Object.keys(play?.inputSchema.properties ?? {})).toEqual(['episodeId']);
    expect(play?.inputSchema.additionalProperties).toBe(false);
  });
});
