import type {
  AuthInfo,
  OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import {
  authenticate,
  playbackRequirement,
  subscriptionsRequirement,
  SUBSCRIPTIONS_SCOPE,
} from './request-auth.js';

// The authentication gate decides, before any application authority exists, whether a credential
// the verifier accepted was issued for THIS protected resource.

const SUBSCRIPTIONS = new URL('https://saga.example/subscriptions/mcp');
const PLAYBACK = new URL('https://saga.example/playback/mcp');
const NOW = 1_000_000;
const gate = new AbortController().signal;

const info = (resource: unknown): AuthInfo =>
  ({
    token: 'token',
    clientId: 'client',
    scopes: [SUBSCRIPTIONS_SCOPE],
    expiresAt: NOW + 3600,
    ...(resource === undefined ? {} : { resource }),
    extra: { accountId: 'acct-1', signInId: 'sign-in-1' },
  }) as AuthInfo;

const verifierOf = (authInfo: AuthInfo): OAuthTokenVerifier => ({
  verifyAccessToken: async () => authInfo,
});

const run = (authInfo: AuthInfo, resource: URL = SUBSCRIPTIONS) =>
  authenticate(
    { headers: { authorization: 'Bearer token' } },
    verifierOf(authInfo),
    subscriptionsRequirement(resource),
    gate,
    () => NOW,
  );

describe('protected resource binding', () => {
  it('accepts a credential issued for exactly this resource', async () => {
    const decision = await run(info(new URL(SUBSCRIPTIONS)));
    expect(decision.ok).toBe(true);
  });

  it('compares identifiers, not spellings: scheme and host case and default port', async () => {
    const decision = await run(
      info(new URL('HTTPS://SAGA.example:443/subscriptions/mcp')),
    );
    expect(decision.ok).toBe(true);
  });

  it.each([
    ['a fragment', 'https://saga.example/subscriptions/mcp#section'],
    ['an empty fragment', 'https://saga.example/subscriptions/mcp#'],
  ])(
    'refuses a credential whose resource carries %s, even though it names this endpoint',
    async (_name, spelled) => {
      const decision = await run(info(new URL(spelled)));
      expect(decision).toMatchObject({ ok: false, status: 401 });
      if (decision.ok) return;
      expect(decision.challenge).toMatch(/error="invalid_token"/);
      expect(decision).not.toHaveProperty('authInfo');
    },
  );

  it.each([
    ['a fragment', 'https://saga.example/subscriptions/mcp#section'],
    ['an empty fragment', 'https://saga.example/subscriptions/mcp#'],
  ])(
    'refuses every credential when the endpoint requirement carries %s',
    async (_name, spelled) => {
      const decision = await run(
        info(new URL(SUBSCRIPTIONS)),
        new URL(spelled),
      );
      expect(decision).toMatchObject({ ok: false, status: 401 });
    },
  );

  it.each([
    ['a credential that names no resource', undefined],
    ['a credential issued for another endpoint of the same host', PLAYBACK],
    [
      'a credential issued for another host',
      new URL('https://other.example/subscriptions/mcp'),
    ],
    [
      'a credential issued for another scheme',
      new URL('http://saga.example/subscriptions/mcp'),
    ],
    [
      'a credential issued for another port',
      new URL('https://saga.example:8443/subscriptions/mcp'),
    ],
    [
      'a credential issued for a path prefix',
      new URL('https://saga.example/subscriptions'),
    ],
    ['a credential issued for the origin', new URL('https://saga.example/')],
    [
      'a resource that differs only by a query',
      new URL('https://saga.example/subscriptions/mcp?x=1'),
    ],
    [
      'a resource given as a string, not a URL',
      'https://saga.example/subscriptions/mcp',
    ],
  ])(
    'refuses %s with 401 invalid_token and creates no authority',
    async (_name, resource) => {
      const decision = await run(info(resource));
      expect(decision).toMatchObject({ ok: false, status: 401 });
      if (decision.ok) return;
      expect(decision.challenge).toMatch(/error="invalid_token"/);
      expect(decision).not.toHaveProperty('authInfo');
      // The answer never names the resource the endpoint expected.
      expect(decision.challenge).not.toContain('saga.example');
    },
  );

  it('judges the resource before the scope, so a wrong-resource credential learns nothing about scopes', async () => {
    const decision = await run({ ...info(PLAYBACK), scopes: [] });
    expect(decision).toMatchObject({ ok: false, status: 401 });
  });

  it('binds each endpoint to its own resource', async () => {
    const forSubscriptions = info(new URL(SUBSCRIPTIONS));
    const asPlayback = await authenticate(
      { headers: { authorization: 'Bearer token' } },
      verifierOf({ ...forSubscriptions, scopes: ['playback:play'] }),
      playbackRequirement(PLAYBACK),
      gate,
      () => NOW,
    );
    expect(asPlayback).toMatchObject({ ok: false, status: 401 });
  });
});

describe('token expiration', () => {
  const withExpiry = (expiresAt: unknown): AuthInfo =>
    ({ ...info(new URL(SUBSCRIPTIONS)), expiresAt }) as AuthInfo;

  it('accepts a credential that expires in the future (control)', async () => {
    expect((await run(withExpiry(NOW + 1))).ok).toBe(true);
  });

  it.each([
    ['now', NOW],
    ['the past', NOW - 1],
    ['a missing expiry', undefined],
    ['a string', String(NOW + 3600)],
    ['positive infinity', Infinity],
    ['negative infinity', -Infinity],
    ['NaN', NaN],
    ['an unsafe magnitude', Number.MAX_SAFE_INTEGER + 2],
    ['a beyond-range finite number', 1e300],
  ])('refuses a credential whose expiry is %s', async (_name, expiresAt) => {
    const decision = await run(withExpiry(expiresAt));
    expect(decision).toMatchObject({ ok: false, status: 401 });
    if (decision.ok) return;
    expect(decision.challenge).toMatch(/error="invalid_token"/);
    expect(decision).not.toHaveProperty('authInfo');
  });

  it.each([
    ['NaN', NaN],
    ['positive infinity', Infinity],
    ['negative infinity', -Infinity],
  ])(
    'refuses every credential, as a server fault, when the clock reads %s',
    async (_name, reading) => {
      const decision = await authenticate(
        { headers: { authorization: 'Bearer token' } },
        verifierOf(withExpiry(Infinity)),
        subscriptionsRequirement(SUBSCRIPTIONS),
        gate,
        () => reading,
      );
      expect(decision).toMatchObject({ ok: false, status: 500 });
      expect(decision).not.toHaveProperty('authInfo');
    },
  );
});

describe('verifier work is bounded independently of the request', () => {
  const request = { headers: { authorization: 'Bearer token' } };

  it('gives the verifier the gate as its cancellation signal', () => {
    let received: AbortSignal | undefined;
    const controller = new AbortController();
    const verifier = {
      verifyAccessToken: (_token: string, signal?: AbortSignal) => {
        received = signal;
        return new Promise<AuthInfo>(() => undefined);
      },
    } as OAuthTokenVerifier;
    void authenticate(
      request,
      verifier,
      subscriptionsRequirement(SUBSCRIPTIONS),
      controller.signal,
      () => NOW,
    );
    expect(received?.aborted).toBe(false);
    controller.abort();
    expect(received?.aborted).toBe(true);
  });

  it('stops calling a verifier that ignores its signal once too many abandoned calls are running, and answers 500, not 401', async () => {
    let calls = 0;
    const verifier: OAuthTokenVerifier = {
      verifyAccessToken: () => {
        calls += 1;
        return new Promise<AuthInfo>(() => undefined);
      },
    };
    const requirement = subscriptionsRequirement(SUBSCRIPTIONS);
    for (let n = 0; n < 64; n += 1)
      void authenticate(request, verifier, requirement, gate, () => NOW);
    expect(calls).toBe(64);

    const refused = await authenticate(
      request,
      verifier,
      requirement,
      gate,
      () => NOW,
    );
    expect(refused).toMatchObject({ ok: false, status: 500 });
    expect(calls).toBe(64); // the 65th credential never reached the application
  });

  it('keeps serving a verifier that honors its signal after many abandoned requests, because each stopped call frees its slot', async () => {
    let running = 0;
    const verifier = {
      verifyAccessToken: (_token: string, signal?: AbortSignal) => {
        running += 1;
        return new Promise<AuthInfo>((_resolve, rejectCall) => {
          signal?.addEventListener('abort', () => {
            running -= 1;
            rejectCall(new Error('stopped'));
          });
        });
      },
    } as OAuthTokenVerifier;
    const requirement = subscriptionsRequirement(SUBSCRIPTIONS);
    for (let n = 0; n < 200; n += 1) {
      const stage = new AbortController();
      const pending = authenticate(
        request,
        verifier,
        requirement,
        stage.signal,
        () => NOW,
      );
      stage.abort(); // the request's stage ended
      expect(await pending).toMatchObject({ ok: false, status: 500 }); // not 401: the wait merely ended
    }
    expect(running).toBe(0); // no abandoned call is still running
  });

  it('answers 500, never 401, when a call is abandoned at its limit, and the abandoned call keeps its slot', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const verifier: OAuthTokenVerifier = {
        verifyAccessToken: () => {
          calls += 1;
          return new Promise<AuthInfo>(() => undefined); // ignores its signal, never answers
        },
      };
      const requirement = subscriptionsRequirement(SUBSCRIPTIONS);
      const answers = Array.from({ length: 64 }, () =>
        authenticate(request, verifier, requirement, gate, () => NOW),
      );
      await vi.advanceTimersByTimeAsync(31_000); // past the default abandonment limit
      for (const answer of await Promise.all(answers))
        expect(answer).toMatchObject({ ok: false, status: 500 });

      const after = await authenticate(
        request,
        verifier,
        requirement,
        gate,
        () => NOW,
      );
      expect(after).toMatchObject({ ok: false, status: 500 });
      expect(calls).toBe(64); // the stuck calls still run, so the slots were not recycled
    } finally {
      vi.useRealTimers();
    }
  });

  it('never starts verifier work for a request whose gate has already aborted, and leaves the whole cap to live requests', async () => {
    const tokens: string[] = [];
    const verifier: OAuthTokenVerifier = {
      verifyAccessToken: (token: string) => {
        tokens.push(token);
        return new Promise<AuthInfo>(() => undefined); // ignores its signal, never answers
      },
    };
    const requirement = subscriptionsRequirement(SUBSCRIPTIONS);
    for (let n = 0; n < 100; n += 1)
      expect(
        await authenticate(
          request,
          verifier,
          requirement,
          AbortSignal.abort(),
          () => NOW,
        ),
      ).toMatchObject({ ok: false, status: 500 });
    expect(tokens).toEqual([]); // the application verifier was never called

    for (let n = 0; n < 64; n += 1)
      void authenticate(request, verifier, requirement, gate, () => NOW);
    expect(tokens).toHaveLength(64); // all 64 slots were still free
  });

  it('keeps accepting credentials from a verifier that answers, however many requests came before', async () => {
    const verifier = verifierOf(info(new URL(SUBSCRIPTIONS)));
    for (let n = 0; n < 200; n += 1) {
      const decision = await authenticate(
        request,
        verifier,
        subscriptionsRequirement(SUBSCRIPTIONS),
        gate,
        () => NOW,
      );
      expect(decision.ok).toBe(true);
    }
  });
});
