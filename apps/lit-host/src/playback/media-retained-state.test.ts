import { createHash, randomUUID } from 'node:crypto';
import { calculateJwkThumbprint, SignJWT } from 'jose';
import { createServerBudgets } from '@saga-a2ui/mcp/server';
import { describe, expect, it } from 'vitest';
import { MEDIA_PROOF_TYP } from './media-proof.js';
import {
  createMediaService,
  type MediaService,
  type MediaServiceOptions,
} from './media-service.js';
import {
  createRecipientKey,
  signMediaProof,
  startPlaybackHarness,
} from './playback-fixture.js';

// The media service keeps two tables for its whole life: issued capabilities and spent proof ids.
// Both must hold finite, validated, bounded state whatever the clock, the lifetime setting or the
// caller sends, and a bound may never weaken a check: a full table forgets old capabilities (the
// holder plays again) but never lets a spent proof be accepted twice.

const START = 1_800_000_000;
const URL_FOR = (episodeId: string) =>
  `https://media.invalid/playback/media/${episodeId}`;

async function setup(
  options: Partial<MediaServiceOptions> & {
    readonly maxGrants?: number;
    readonly maxProofs?: number;
  } = {},
) {
  let now = START;
  const reads: string[] = [];
  const key = await createRecipientKey();
  const recipientThumbprint = await calculateJwkThumbprint({
    kty: key.publicJwk.kty as string,
    crv: key.publicJwk.crv as string,
    x: key.publicJwk.x as string,
    y: key.publicJwk.y as string,
  });
  const clock = { now: () => now };
  const service: MediaService = createMediaService({
    store: {
      read: async (episodeId) => {
        reads.push(episodeId);
        return { contentType: 'audio/wav', bytes: new Uint8Array([1, 2, 3]) };
      },
    },
    entitlement: async () => 'entitled',
    nowSeconds: () => clock.now(),
    ...options,
  } as MediaServiceOptions);
  const budgets = createServerBudgets();

  const issue = (episodeId = 'ep-1', accountId = 'acct-1') =>
    service.issue({ accountId, episodeId, recipientThumbprint });

  /** One acquisition with its own request scope, a fresh proof and the given `jti` (default: a UUID). */
  async function acquire(
    capability: string,
    options: { episodeId?: string; jti?: string; proof?: string } = {},
  ) {
    const episodeId = options.episodeId ?? 'ep-1';
    const url = URL_FOR(episodeId);
    const proof =
      options.proof ??
      (await signMediaProof({
        key,
        capability,
        url,
        issuedAt: now,
        ...(options.jti === undefined ? {} : { jti: options.jti }),
      }));
    return service.acquire(
      {
        episodeId,
        url,
        method: 'GET',
        capability,
        proof,
        range: undefined,
      },
      budgets.startRequest(),
    );
  }

  return {
    service,
    issue,
    acquire,
    key,
    reads,
    advance: (seconds: number) => (now += seconds),
    setClock: (value: number) => (now = value),
  };
}

describe('capability lifetime setting', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 3_601, 1e300])(
    'refuses %s before the service is built',
    (ttlSeconds) => {
      expect(() =>
        createMediaService({
          store: {
            read: async () => ({ contentType: 'x', bytes: new Uint8Array() }),
          },
          entitlement: async () => 'entitled',
          ttlSeconds,
        }),
      ).toThrow(/ttl/i);
    },
  );

  it('keeps the listener from opening when the setting is unusable', async () => {
    for (const capabilityTtlSeconds of [0, Number.POSITIVE_INFINITY, 86_400])
      await expect(
        startPlaybackHarness({}, { capabilityTtlSeconds }),
      ).rejects.toThrow(/ttl/i);
    const h = await startPlaybackHarness({}, { capabilityTtlSeconds: 30 });
    await h.listener.close();
  });

  it('accepts the default and a whole number of seconds up to an hour', async () => {
    for (const ttlSeconds of [undefined, 1, 60, 3_600]) {
      const h = await setup(ttlSeconds === undefined ? {} : { ttlSeconds });
      const issued = h.issue();
      expect(issued.expiresAt).toBe(START + (ttlSeconds ?? 60));
    }
  });
});

describe('an unusable clock', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'issues and retains nothing when the clock reads %s',
    async (bad) => {
      const h = await setup();
      const before = h.issue();
      const proof = await signMediaProof({
        key: h.key,
        capability: before.capability,
        url: URL_FOR('ep-1'),
        issuedAt: START,
      });
      h.setClock(bad);
      expect(() => h.issue()).toThrow(/clock/i);
      await expect(h.acquire(before.capability, { proof })).rejects.toThrow(
        /clock/i,
      );

      // The earlier capability, and the proof the unusable reading could not spend, still work.
      h.setClock(START + 1);
      expect((await h.acquire(before.capability, { proof })).kind).toBe(
        'delivered',
      );
      expect(h.reads).toEqual(['ep-1']);
    },
  );
});

describe('issued capabilities are bounded', () => {
  it('forgets the oldest capability first when the table is full', async () => {
    const h = await setup({ maxGrants: 3 });
    const issued = [h.issue(), h.issue(), h.issue(), h.issue(), h.issue()];

    const outcomes = [];
    for (const { capability } of issued)
      outcomes.push((await h.acquire(capability)).kind);

    expect(outcomes).toEqual([
      'refused',
      'refused',
      'delivered',
      'delivered',
      'delivered',
    ]);
    expect(h.reads).toHaveLength(3);
  });

  it('keeps every capability while the table has room (legitimate use is unchanged)', async () => {
    const h = await setup({ maxGrants: 3 });
    const issued = [h.issue(), h.issue(), h.issue()];
    for (const { capability } of issued)
      expect((await h.acquire(capability)).kind).toBe('delivered');
  });

  it('drops expired capabilities before it evicts a live one', async () => {
    const h = await setup({ maxGrants: 2, ttlSeconds: 30 });
    h.issue();
    h.issue();
    h.advance(31);
    const live = h.issue();
    const next = h.issue();
    expect((await h.acquire(live.capability)).kind).toBe('delivered');
    expect((await h.acquire(next.capability)).kind).toBe('delivered');
  });

  it('refuses to record a grant whose fields are not finite, short identifiers', async () => {
    const h = await setup();
    expect(() => h.issue('ep-1', 'a'.repeat(100_000))).toThrow(/grant/i);
    expect(() => h.issue('not a slug')).toThrow(/grant/i);
    expect(() => h.issue('ep-1', '')).toThrow(/grant/i);
    expect((await h.acquire(h.issue('ep-1', 'acct-ok').capability)).kind).toBe(
      'delivered',
    );
  });
});

describe('spent proofs are bounded without weakening replay protection', () => {
  it('refuses a new proof while the table of spent proofs is full, never a replay of a spent one', async () => {
    const h = await setup({ maxProofs: 3 });
    const { capability } = h.issue();
    const jtis = ['proof-a', 'proof-b', 'proof-c'];
    for (const jti of jtis)
      expect((await h.acquire(capability, { jti })).kind).toBe('delivered');
    const reads = h.reads.length;

    // Full: a fresh proof is refused and reads nothing, and so is every replay.
    expect((await h.acquire(capability, { jti: 'proof-d' })).kind).toBe(
      'refused',
    );
    expect((await h.acquire(capability, { jti: 'proof-a' })).kind).toBe(
      'refused',
    );
    expect(h.reads).toHaveLength(reads);

    // Once the proofs age out of the accepted window they are forgotten and room returns.
    h.advance(66);
    const again = h.issue();
    expect((await h.acquire(again.capability, { jti: 'proof-d' })).kind).toBe(
      'delivered',
    );
  });

  it('refuses a proof id that is not a short identifier, before it is retained or storage is read', async () => {
    const h = await setup();
    const { capability } = h.issue();
    for (const jti of ['x'.repeat(5_000), 'has space', 'ünïcode', '']) {
      expect((await h.acquire(capability, { jti })).kind).toBe('refused');
    }
    expect(h.reads).toEqual([]);
    // A UUID, which is what the player sends, is accepted.
    expect((await h.acquire(capability, { jti: randomUUID() })).kind).toBe(
      'delivered',
    );
  });

  it('refuses an oversized proof before verifying it', async () => {
    const h = await setup();
    const { capability } = h.issue();
    const url = URL_FOR('ep-1');
    const { privateKey, publicJwk } = h.key;
    const proof = await new SignJWT({
      htm: 'GET',
      htu: url,
      cap: createHash('sha256').update(capability).digest('base64url'),
      padding: 'p'.repeat(20_000),
    })
      .setProtectedHeader({
        alg: 'ES256',
        typ: MEDIA_PROOF_TYP,
        jwk: {
          kty: publicJwk.kty,
          crv: publicJwk.crv,
          x: publicJwk.x,
          y: publicJwk.y,
        } as never,
      })
      .setJti(randomUUID())
      .setIssuedAt(START)
      .sign(privateKey);

    expect((await h.acquire(capability, { proof })).kind).toBe('refused');
    expect(h.reads).toEqual([]);
  });
});
