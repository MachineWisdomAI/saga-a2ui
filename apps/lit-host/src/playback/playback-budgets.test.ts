import { createServer, get as httpGet, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createServerBudgets } from '@saga-a2ui/mcp/server';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_ACCOUNTS, DEV_TOKENS, createDevelopmentVerifier } from '../mcp/dev-auth.js';
import type { RequestOutcome } from '../mcp/listener.js';
import type { MediaService } from './media-service.js';
import {
  acquireMedia,
  callToolOverHttp,
  countingPlayback,
  createRecipientKey,
  playAndGetGrant,
  signMediaProof,
  startPlaybackHarness,
  type PlaybackHarness,
} from './playback-fixture.js';
import { createPlaybackServer } from './playback-server.js';
import { PLAYBACK_UNAVAILABLE_TEXT } from './playback.js';

// Playback's server side under the request lifetime: the Play tool and each media acquisition are
// separate requests with separate clocks. Lookups and storage reads that stall, answer late or are
// abandoned must leave no capability, no storage read and no grant change behind.

const open: { harness?: PlaybackHarness; mini?: Server } = {};
// Replaced for each harness, so a late close from one test cannot be read by the next.
let outcomes: RequestOutcome[] = [];

afterEach(async () => {
  await open.harness?.listener.close();
  open.harness = undefined;
  await new Promise<void>((resolve) => (open.mini ? open.mini.close(() => resolve()) : resolve()));
  open.mini?.closeAllConnections();
  open.mini = undefined;
});

async function harness(options: Parameters<typeof startPlaybackHarness>[1] = {}): Promise<PlaybackHarness> {
  const mine: RequestOutcome[] = [];
  outcomes = mine;
  open.harness = await startPlaybackHarness(
    { [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'], [DEV_ACCOUNTS.bob]: [] },
    { observe: (outcome) => void mine.push(outcome), ...options },
  );
  return open.harness;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freshProof(h: PlaybackHarness, key: Awaited<ReturnType<typeof createRecipientKey>>, grant: Awaited<ReturnType<typeof playAndGetGrant>>) {
  return signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });
}

describe('a media acquisition is its own bounded request', () => {
  it('answers 503 unavailable when the entitlement lookup never settles, reading no storage', async () => {
    const h = await harness({ playbackBudgets: { operationMs: 100, requestMs: 1_500 } });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const lookup = h.playback.holdNextEntitlement();

    const begun = Date.now();
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) });

    expect(attempt.status).toBe(503);
    expect(JSON.parse(Buffer.from(attempt.bytes).toString('utf8'))).toEqual({ error: 'unavailable' });
    expect(attempt.headers.get('cache-control')).toMatch(/no-store/);
    expect(Date.now() - begun).toBeLessThan(1_200);
    expect(h.playback.mediaReads).toEqual([]);
    expect(lookup.signal()?.aborted).toBe(true);
    lookup.release('entitled'); // answers after the request ended: nothing starts
    await sleep(40);
    expect(h.playback.mediaReads).toEqual([]);
    expect(outcomes.at(-1)?.causes).toMatchObject([{ kind: 'operation-timeout', stage: 'acquisition' }]);
  });

  it('keeps the grant when a denial arrives only after the request ended, and refuses nothing it did not decide', async () => {
    const h = await harness({ playbackBudgets: { operationMs: 100, requestMs: 1_500 } });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const lookup = h.playback.holdNextEntitlement();

    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) })).status).toBe(503);
    lookup.release('denied'); // too late to delete anything
    await sleep(40);

    // The grant is intact and every later acquisition asks the lookup again: entitled still gets bytes.
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) })).status).toBe(200);
  });

  it('still refuses a revoked entitlement on the next acquisition after a late denial', async () => {
    const h = await harness({ playbackBudgets: { operationMs: 100, requestMs: 1_500 } });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const lookup = h.playback.holdNextEntitlement();
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) })).status).toBe(503);
    lookup.release('denied');
    h.playback.setEntitled(DEV_ACCOUNTS.alice, []); // the entitlement really was revoked
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) })).status).toBe(403);
  });

  it('answers 503 unavailable when the storage read never settles, and delivers no late bytes', async () => {
    const h = await harness({ playbackBudgets: { operationMs: 100, requestMs: 1_500 } });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const read = h.playback.holdNextRead();

    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) });
    expect(attempt.status).toBe(503);
    read.release();
    await sleep(40);
    expect(Buffer.from(attempt.bytes).toString('utf8')).not.toContain('RIFF');
    // The spent proof stays spent; a fresh proof on the same grant works.
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) })).status).toBe(200);
  });

  it('charges the lookup to the aggregate, so the storage read gets only what remains', async () => {
    const h = await harness({ playbackBudgets: { operationMs: 5_000, requestMs: 300 } });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const read = h.playback.holdNextRead();
    const begun = Date.now();
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) });
    read.release();
    expect(attempt.status).toBe(503);
    expect(Date.now() - begun).toBeLessThan(1_500); // the request limit, not the 5,000 ms operation limit
  });

  it('closes a finite response whose delivery stalls at the request deadline and leaves other requests alone', async () => {
    const h = await harness({
      playbackBudgets: { operationMs: 1_000, requestMs: 400 },
      mediaBytes: new Uint8Array(48 * 1024 * 1024),
    });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const proof = await freshProof(h, key, grant);

    // A reader that never reads: the response is ready, so only delivery can hold the request open.
    const stalled = httpGet(grant.mediaUrl, { headers: { 'x-saga-capability': grant.capability, 'x-saga-proof': proof } });
    stalled.on('error', () => undefined);
    stalled.once('response', (response) => {
      response.pause();
      response.on('error', () => undefined);
    });
    await expect.poll(() => outcomes.find((outcome) => outcome.path.startsWith('/playback/media/')), { timeout: 5_000 }).toMatchObject({
      status: 200,
      finished: false,
      causes: [{ kind: 'request-timeout' }],
    });
    stalled.destroy();

    // The next acquisition, on a new connection, is unaffected.
    const second = await playAndGetGrant(h, DEV_TOKENS.alice, key, 'ep-2');
    const quick = await acquireMedia({ url: second.mediaUrl, capability: second.capability, proof: await freshProof(h, key, second) });
    expect(quick.status).toBe(200);
  }, 20_000);

  it('records a successful finish with no cause and no pending timer', async () => {
    const h = await harness({ playbackBudgets: { operationMs: 1_000, requestMs: 1_000 } });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: await freshProof(h, key, grant) })).status).toBe(200);
    await expect.poll(() => outcomes.find((outcome) => outcome.path.startsWith('/playback/media/'))).toMatchObject({ status: 200, finished: true, causes: [] });
  });
});

describe('Play is a bounded handler', () => {
  async function playUnder(lifetimeBudgets: { operationMs: number; requestMs: number }, labelViewSession: () => string = () => `vs_${'a'.repeat(22)}`) {
    const playback = countingPlayback({ [DEV_ACCOUNTS.alice]: ['ep-1'] });
    const issued: unknown[] = [];
    const mediaService: MediaService = {
      issue(grant) {
        issued.push(grant);
        return { capability: 'c'.repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 60 };
      },
      acquire: async () => ({ kind: 'refused' }),
    };
    const budgets = createServerBudgets(lifetimeBudgets);
    const lifetimes: ReturnType<typeof budgets.startRequest>[] = [];
    const identity = await createDevelopmentVerifier().verifyAccessToken(DEV_TOKENS.alice);
    const mini = createServer((req, res) => {
      const lifetime = budgets.startRequest();
      lifetimes.push(lifetime);
      res.once('close', () => (res.writableFinished ? lifetime.finish() : lifetime.disconnect()));
      const server = createPlaybackServer({
        viewHtml: '<!doctype html>',
        backend: playback.backend,
        mediaService,
        labelViewSession,
        mediaOrigin: 'http://127.0.0.1:1',
        lifetime,
      });
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => void transport.close());
      Object.assign(req, { auth: identity });
      void server.connect(transport).then(() => transport.handleRequest(req, res));
    });
    await new Promise<void>((resolve) => mini.listen(0, '127.0.0.1', resolve));
    open.mini = mini;
    const url = `http://127.0.0.1:${(mini.address() as AddressInfo).port}/`;
    const key = await createRecipientKey();
    return { playback, issued, lifetimes, url, key };
  }

  const play = (url: string, key: { publicJwk: JsonWebKey }, signal?: AbortSignal) =>
    fetch(url, {
      method: 'POST',
      ...(signal ? { signal } : {}),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'play_episode', arguments: { episodeId: 'ep-1' }, _meta: { 'saga-a2ui/recipient-key': key.publicJwk } },
      }),
    });

  it('answers the fixed unavailable sentence when the lookup stalls, and issues no capability for a late answer', async () => {
    const { playback, issued, lifetimes, url, key } = await playUnder({ operationMs: 100, requestMs: 2_000 });
    const lookup = playback.holdNextEntitlement();
    const response = await play(url, key);
    const body = (await response.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toBe(PLAYBACK_UNAVAILABLE_TEXT);
    lookup.release('entitled'); // permitted, but the request is over
    await sleep(60);
    expect(issued).toEqual([]);
    expect(lifetimes.flatMap((lifetime) => lifetime.causes)).toMatchObject([{ kind: 'operation-timeout', stage: 'handler' }]);
  });

  it('issues nothing when the caller disconnects before the lookup answers', async () => {
    const { playback, issued, url, key } = await playUnder({ operationMs: 5_000, requestMs: 5_000 });
    const lookup = playback.holdNextEntitlement();
    const controller = new AbortController();
    const call = play(url, key, controller.signal).catch(() => undefined);
    await lookup.reached;
    controller.abort();
    await call;
    await sleep(30);
    expect(lookup.signal()?.aborted).toBe(true);
    lookup.release('entitled');
    await sleep(60);
    expect(issued).toEqual([]);
  });

  it('answers a generic failure even though a capability was already issued, so an error never shows that nothing was', async () => {
    const { issued, url, key } = await playUnder({ operationMs: 1_000, requestMs: 2_000 }, () => {
      throw new Error('label service down');
    });
    const response = await play(url, key);
    const body = (await response.json()) as { result: { isError: boolean; content: { text: string }[]; _meta?: Record<string, unknown> } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toBe(PLAYBACK_UNAVAILABLE_TEXT); // the same sentence a pre-issue failure gets
    expect(body.result._meta?.['saga-a2ui/playback']).toBeUndefined(); // the caller is given no grant
    expect(issued).toHaveLength(1); // yet the capability exists
  });

  it('still issues one capability for a lookup that answers in time', async () => {
    const { issued, url, key } = await playUnder({ operationMs: 1_000, requestMs: 2_000 });
    const response = await play(url, key);
    const body = (await response.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).toBeUndefined();
    expect(issued).toHaveLength(1);
  });
});

describe('the listener still answers Play for the entitled listener with default budgets', () => {
  it('plays under the SDK defaults', async () => {
    const h = await harness();
    const response = await callToolOverHttp(h.listener.playbackUrl, DEV_TOKENS.alice, {
      name: 'play_episode',
      arguments: { episodeId: 'ep-1' },
      _meta: { 'saga-a2ui/recipient-key': (await createRecipientKey()).publicJwk },
    });
    expect(response.status).toBe(200);
  });
});
