import { afterEach, describe, expect, it } from 'vitest';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import {
  acquireMedia,
  createRecipientKey,
  MEDIA_BYTES,
  playAndGetGrant,
  signMediaProof,
  startPlaybackHarness,
  type PlaybackHarness,
  type PlaybackHarnessOptions,
} from './playback-fixture.js';

// The synthetic media service, reached the way the built player reaches it: an HTTP GET carrying
// the capability and a proof signed by the key the capability was bound to. A capability alone
// is never enough, so every refusal below must return no bytes and read no protected media.

const cleanup: { harness?: PlaybackHarness } = {};

async function harness(options?: PlaybackHarnessOptions): Promise<PlaybackHarness> {
  cleanup.harness = await startPlaybackHarness({ [DEV_ACCOUNTS.alice]: ['ep-1', 'ep-2'], [DEV_ACCOUNTS.bob]: ['ep-1'] }, options);
  return cleanup.harness;
}

afterEach(async () => {
  await cleanup.harness?.listener.close();
  cleanup.harness = undefined;
});

describe('media acquisition by the authorized recipient', () => {
  it('returns the episode bytes to the key the capability was bound to, without allowing caching', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    expect(new URL(grant.mediaUrl).origin).toBe(new URL(h.listener.url).origin);

    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof });

    expect(attempt.status).toBe(200);
    expect([...attempt.bytes]).toEqual([...MEDIA_BYTES]);
    expect(attempt.headers.get('content-type')).toBe('audio/wav');
    expect(attempt.headers.get('cache-control')).toMatch(/no-store/);
    expect(h.playback.mediaReads).toEqual(['ep-1']);
  });
});

describe('media acquisition refused', () => {
  it('refuses another user holding A’s capability, even with a valid proof of their own key', async () => {
    const h = await harness();
    const aliceKey = await createRecipientKey();
    const bobKey = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, aliceKey);

    const proof = await signMediaProof({ key: bobKey, capability: grant.capability, url: grant.mediaUrl });
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof });

    expect(attempt.status).toBe(403);
    expect(Buffer.from(attempt.bytes).includes(Buffer.from(MEDIA_BYTES))).toBe(false);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('refuses the capability without any proof: possessing it is not enough', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);

    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability });

    expect(attempt.status).toBe(403);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('refuses a capability for ep-1 used on ep-2, even when the recipient proves its key for ep-2', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key, 'ep-1');
    const otherEpisodeUrl = grant.mediaUrl.replace('/ep-1', '/ep-2');

    const proof = await signMediaProof({ key, capability: grant.capability, url: otherEpisodeUrl });
    const attempt = await acquireMedia({ url: otherEpisodeUrl, capability: grant.capability, proof });

    expect(attempt.status).toBe(403);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('refuses a proof made for another URL, another method or another capability', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const other = await playAndGetGrant(h, DEV_TOKENS.alice, key, 'ep-2');

    const wrongUrl = await signMediaProof({ key, capability: grant.capability, url: other.mediaUrl });
    const wrongMethod = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl, method: 'POST' });
    const wrongCapability = await signMediaProof({ key, capability: other.capability, url: grant.mediaUrl });

    for (const proof of [wrongUrl, wrongMethod, wrongCapability]) {
      const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof });
      expect(attempt.status).toBe(403);
    }
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('refuses a replayed proof: each acquisition needs a fresh signature', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });

    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof })).status).toBe(200);
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof })).status).toBe(403);
    expect(h.playback.mediaReads).toEqual(['ep-1']);
  });

  it('refuses a stale proof and an unknown capability', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const stale = await signMediaProof({
      key,
      capability: grant.capability,
      url: grant.mediaUrl,
      issuedAt: Math.floor(Date.now() / 1000) - 3600,
    });
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof: stale })).status).toBe(403);

    const forged = 'A'.repeat(43);
    const proof = await signMediaProof({ key, capability: forged, url: grant.mediaUrl });
    expect((await acquireMedia({ url: grant.mediaUrl, capability: forged, proof })).status).toBe(403);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('refuses an expired capability even with a valid proof', async () => {
    let now = 1_800_000_000;
    const h = await harness({ capabilityTtlSeconds: 30, nowSeconds: () => now });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    now += 31;

    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl, issuedAt: now });
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof });

    expect(attempt.status).toBe(403);
    expect(h.playback.mediaReads).toEqual([]);
  });
});

describe('media acquisition after access is revoked', () => {
  it('refuses an already-issued capability once the account is no longer entitled, with no protected read', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const first = await acquireMedia({
      url: grant.mediaUrl,
      capability: grant.capability,
      proof: await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl }),
    });
    expect(first.status).toBe(200);
    h.playback.mediaReads.length = 0;

    h.playback.setEntitled(DEV_ACCOUNTS.alice, []); // the subscription lapses after the capability was issued
    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof });

    expect(attempt.status).toBe(403);
    expect(Buffer.from(attempt.bytes).includes(Buffer.from(MEDIA_BYTES))).toBe(false);
    expect(h.playback.mediaReads).toEqual([]);
  });
});

describe('media responses for a sandboxed view in another origin', () => {
  it('answers a CORS preflight for the two proof headers without reading any protected media', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);

    const preflight = await fetch(grant.mediaUrl, {
      method: 'OPTIONS',
      headers: {
        origin: 'null', // what an opaque-origin sandboxed iframe sends
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-saga-capability, x-saga-proof',
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET');
    const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(/,\s*/);
    expect(allowed).toEqual(expect.arrayContaining(['x-saga-capability', 'x-saga-proof']));
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull(); // no cookie ever authorizes media
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('lets the view read a refusal, so an expired capability is distinguishable from a network failure', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);

    const refused = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability }); // no proof
    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });
    const delivered = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof });

    expect(refused.status).toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBe('*');
    expect(delivered.status).toBe(200);
    expect(delivered.headers.get('access-control-allow-origin')).toBe('*');
  });
});
