import { afterEach, describe, expect, it } from 'vitest';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import { captureOrdinaryLogs } from './ordinary-logs.js';
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

describe('a later byte-range request repeats every check', () => {
  const RANGE = 'bytes=0-3';
  const noBytes = (attempt: { bytes: Uint8Array }) => Buffer.from(attempt.bytes).includes(Buffer.from(MEDIA_BYTES.subarray(0, 4)));

  it('refuses a range for an account whose entitlement was revoked after the capability was issued', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    h.playback.setEntitled(DEV_ACCOUNTS.alice, []);

    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof, range: RANGE });

    expect(attempt.status).toBe(403);
    expect(noBytes(attempt)).toBe(false);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('refuses a range once the capability expired, even with a fresh proof', async () => {
    let now = 1_800_000_000;
    const h = await harness({ capabilityTtlSeconds: 30, nowSeconds: () => now });
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    now += 31;

    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl, issuedAt: now });
    const attempt = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof, range: RANGE });

    expect(attempt.status).toBe(403);
    expect(noBytes(attempt)).toBe(false);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('refuses a range from another user holding A’s capability and from a capability used on another episode', async () => {
    const h = await harness();
    const aliceKey = await createRecipientKey();
    const bobKey = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, aliceKey);
    const otherEpisodeUrl = grant.mediaUrl.replace('/ep-1', '/ep-2');

    const asBob = await acquireMedia({
      url: grant.mediaUrl,
      capability: grant.capability,
      proof: await signMediaProof({ key: bobKey, capability: grant.capability, url: grant.mediaUrl }),
      range: RANGE,
    });
    const otherEpisode = await acquireMedia({
      url: otherEpisodeUrl,
      capability: grant.capability,
      proof: await signMediaProof({ key: aliceKey, capability: grant.capability, url: otherEpisodeUrl }),
      range: RANGE,
    });

    for (const attempt of [asBob, otherEpisode]) {
      expect(attempt.status).toBe(403);
      expect(noBytes(attempt)).toBe(false);
    }
    expect(h.playback.mediaReads).toEqual([]);
  });
});

/** One acquisition exactly as the player makes it: the capability plus a fresh proof, optionally with a Range. */
async function acquireWithFreshProof(
  key: Awaited<ReturnType<typeof createRecipientKey>>,
  grant: { readonly capability: string; readonly mediaUrl: string },
  range?: string,
) {
  const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });
  return acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof, ...(range === undefined ? {} : { range }) });
}

describe('a supported byte range', () => {
  // MEDIA_BYTES is the ten bytes of "RIFFcanary", so every expected slice below is read off the
  // requirement (RFC 9110 range semantics), not recomputed by the service.
  const cases = [
    { range: 'bytes=2-5', first: 2, last: 5 },
    { range: 'bytes=6-', first: 6, last: 9 },
    { range: 'bytes=-3', first: 7, last: 9 },
    { range: 'bytes=0-99', first: 0, last: 9 }, // an end past the data is clamped, not an error
  ];

  for (const { range, first, last } of cases) {
    it(`answers ${range} with 206 and exactly those bytes, after the same authorization`, async () => {
      const h = await harness();
      const key = await createRecipientKey();
      const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);

      const attempt = await acquireWithFreshProof(key, grant, range);

      expect(attempt.status).toBe(206);
      expect([...attempt.bytes]).toEqual([...MEDIA_BYTES.subarray(first, last + 1)]);
      expect(attempt.headers.get('content-range')).toBe(`bytes ${first}-${last}/${MEDIA_BYTES.length}`);
      expect(attempt.headers.get('content-length')).toBe(String(last - first + 1));
      expect(attempt.headers.get('cache-control')).toMatch(/private/);
      expect(attempt.headers.get('cache-control')).toMatch(/no-store/);
      expect(h.playback.entitlementChecks.at(-1)).toEqual({ accountId: DEV_ACCOUNTS.alice, episodeId: 'ep-1' });
    });
  }

  it('is announced on the whole-body answer, so a client knows ranges are supported', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);

    const attempt = await acquireWithFreshProof(key, grant);

    expect(attempt.status).toBe(200);
    expect(attempt.headers.get('accept-ranges')).toBe('bytes');
  });

  it('needs its own fresh proof: reusing the proof of an earlier whole-body fetch is refused', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
    const proof = await signMediaProof({ key, capability: grant.capability, url: grant.mediaUrl });
    expect((await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof })).status).toBe(200);

    const replay = await acquireMedia({ url: grant.mediaUrl, capability: grant.capability, proof, range: 'bytes=0-3' });

    expect(replay.status).toBe(403);
    expect(Buffer.from(replay.bytes).includes(Buffer.from(MEDIA_BYTES.subarray(0, 4)))).toBe(false);
  });
});

describe('an invalid or unsatisfiable byte range', () => {
  // Decision: a `bytes=` range the service cannot honour as one slice is answered 416 with the body
  // length (RFC 9110 §14.4) and no bytes. It is answered only to a caller who passed every check, so
  // the length is never a probe for an unauthorized caller. A range in another unit is not ours to
  // interpret and gets the whole body, which RFC 9110 permits.
  const unsatisfiable = [
    { why: 'starts at the end of the body', range: 'bytes=10-' },
    { why: 'starts beyond the body', range: 'bytes=50-60' },
    { why: 'is reversed', range: 'bytes=5-2' },
    { why: 'asks for a zero-length suffix', range: 'bytes=-0' },
    { why: 'names neither end', range: 'bytes=-' },
    { why: 'asks for several ranges at once', range: 'bytes=0-1,4-5' },
    { why: 'is not numeric', range: 'bytes=a-b' },
  ];

  for (const { why, range } of unsatisfiable) {
    it(`answers 416 with the length and no bytes when the range ${why} (${range})`, async () => {
      const h = await harness();
      const key = await createRecipientKey();
      const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);

      const attempt = await acquireWithFreshProof(key, grant, range);

      expect(attempt.status).toBe(416);
      expect(attempt.headers.get('content-range')).toBe(`bytes */${MEDIA_BYTES.length}`);
      expect(attempt.bytes.length).toBe(0);
      expect(attempt.headers.get('cache-control')).toMatch(/no-store/);
    });
  }

  it('does not tell an unauthorized caller the length: a bad range from another user is the same bodiless 403', async () => {
    const h = await harness();
    const aliceKey = await createRecipientKey();
    const bobKey = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, aliceKey);

    const attempt = await acquireWithFreshProof(bobKey, grant, 'bytes=50-60');

    expect(attempt.status).toBe(403);
    expect(attempt.headers.get('content-range')).toBeNull();
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('gives the whole body for a range in a unit the service does not interpret', async () => {
    const h = await harness();
    const key = await createRecipientKey();
    const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);

    const attempt = await acquireWithFreshProof(key, grant, 'items=0-1');

    expect(attempt.status).toBe(200);
    expect([...attempt.bytes]).toEqual([...MEDIA_BYTES]);
  });
});

describe('media acquisition when a dependency of the service fails', () => {
  // Decision: a failed entitlement lookup or storage read is not a refusal (the caller may be
  // entitled) and is never a grant. It is a bodiless 503, distinct from the 403 that means
  // expired/revoked/misused, so the view can tell "try again" from "ask for access again". The body
  // and the logs carry no dependency text.
  const FAULT = 'canary-media-dependency-detail';

  for (const [dependency, fail] of [
    ['entitlement lookup', (h: PlaybackHarness) => h.playback.failEntitlementWith(FAULT)],
    ['protected storage read', (h: PlaybackHarness) => h.playback.failReadsWith(FAULT)],
  ] as const) {
    it(`answers a failed ${dependency} with a readable, uncacheable 503 and no bytes, text or log line`, async () => {
      const h = await harness();
      const key = await createRecipientKey();
      const grant = await playAndGetGrant(h, DEV_TOKENS.alice, key);
      fail(h);
      const logs = captureOrdinaryLogs();
      let attempt;
      try {
        attempt = await acquireWithFreshProof(key, grant);
      } finally {
        logs.restore();
      }

      expect(attempt.status).toBe(503);
      expect(attempt.headers.get('cache-control')).toMatch(/no-store/);
      expect(attempt.headers.get('access-control-allow-origin')).toBe('*'); // the sandboxed view can read it
      expect(Buffer.from(attempt.bytes).includes(Buffer.from(MEDIA_BYTES))).toBe(false);
      expect(Buffer.from(attempt.bytes).toString('utf8')).not.toContain(FAULT);
      expect(logs.text()).not.toContain(FAULT);
      expect(h.playback.mediaReads).toEqual([]);
    });
  }
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
