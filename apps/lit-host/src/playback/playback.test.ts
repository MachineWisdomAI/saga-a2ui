import { afterEach, describe, expect, it } from 'vitest';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../mcp/dev-auth.js';
import { captureOrdinaryLogs } from './ordinary-logs.js';
import { PLAYBACK_RESULT_META, RECIPIENT_KEY_META } from './playback.js';
import {
  callToolOverHttp,
  createRecipientKey,
  PLAYER_VIEW_HTML,
  PRIVATE_CANARY,
  rpcOverHttp,
  startPlaybackHarness,
  type PlaybackHarness,
} from './playback-fixture.js';

// The playback endpoint, exercised through the real listener over HTTP with real bearer
// credentials. Names and sentences are written out literally: the requirement, not the
// implementation, decides them.

type Harness = PlaybackHarness;

const cleanup: { listener?: PlaybackHarness['listener'] } = {};

async function harness(
  entitlements: Readonly<Record<string, readonly string[]>> = {
    [DEV_ACCOUNTS.alice]: ['ep-1'],
  },
): Promise<Harness> {
  const started = await startPlaybackHarness(entitlements);
  cleanup.listener = started.listener;
  return started;
}

afterEach(async () => {
  await cleanup.listener?.close();
  cleanup.listener = undefined;
});

interface ListedTool {
  readonly name: string;
  readonly inputSchema: {
    readonly properties?: Record<string, unknown>;
    readonly additionalProperties?: unknown;
  };
  readonly _meta?: {
    readonly ui?: { readonly visibility?: readonly string[] };
  };
}

async function listTools(
  url: string | undefined,
  token: string,
): Promise<ListedTool[]> {
  expect(
    url,
    'the listener exposes a playback endpoint when the application configures one',
  ).toBeDefined();
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
  return ((await response.json()) as { result: { tools: ListedTool[] } }).result
    .tools;
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
    expect(Object.keys(play?.inputSchema.properties ?? {})).toEqual([
      'episodeId',
    ]);
    expect(play?.inputSchema.additionalProperties).toBe(false);
  });
});

interface PlayWireResult {
  readonly isError?: boolean;
  readonly content?: readonly {
    readonly type: string;
    readonly text?: string;
  }[];
  readonly structuredContent?: unknown;
  readonly _meta?: Record<string, unknown>;
}

const resultOf = (body: unknown): PlayWireResult =>
  (body as { result: PlayWireResult }).result;

describe('Play for the entitled listener', () => {
  it('hands the capability to the view only, never to a model-visible field', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();

    const response = await callToolOverHttp(
      h.listener.playbackUrl,
      DEV_TOKENS.alice,
      {
        name: 'play_episode',
        arguments: { episodeId: 'ep-1' },
        _meta: { [RECIPIENT_KEY_META]: publicJwk },
      },
    );

    expect(response.status).toBe(200);
    const result = resultOf(response.body);
    expect(result.isError).toBeFalsy();
    const view = result._meta?.[PLAYBACK_RESULT_META] as {
      episodeId: string;
      capability: string;
    };
    expect(view.episodeId).toBe('ep-1');
    expect(view.capability).toMatch(/^[A-Za-z0-9_-]{43,}$/);

    // Everything the model can see: content and structuredContent. The capability and the
    // private backend field must appear in neither.
    const modelVisible = JSON.stringify({
      content: result.content,
      structuredContent: result.structuredContent,
    });
    expect(modelVisible).not.toContain(view.capability);
    expect(modelVisible).not.toContain(PRIVATE_CANARY);
    expect(JSON.stringify(response.body).split(view.capability)).toHaveLength(
      2,
    ); // exactly one occurrence: the view's
    expect(h.playback.entitlementChecks).toEqual([
      { accountId: DEV_ACCOUNTS.alice, episodeId: 'ep-1' },
    ]);
    expect(h.playback.mediaReads).toEqual([]); // authorization is not acquisition
  });
});

// The denial sentence is quoted from the Blueprint, not imported, so the test cannot drift with the code.
const DENIED_TEXT =
  'Playback denied: this account does not have access to this episode.';
const UNSUPPORTED_TEXT = 'Playback is not supported here.';

const play = (
  h: Harness,
  token: string | undefined,
  args: unknown,
  meta?: Record<string, unknown>,
) =>
  callToolOverHttp(h.listener.playbackUrl, token, {
    name: 'play_episode',
    arguments: args,
    ...(meta === undefined ? {} : { _meta: meta }),
  });

describe('Play for a listener who is not entitled', () => {
  it('denies B with a safe tool failure: no capability, no media fetch', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();

    const response = await play(
      h,
      DEV_TOKENS.bob,
      { episodeId: 'ep-1' },
      { [RECIPIENT_KEY_META]: publicJwk },
    );

    expect(response.status).toBe(200);
    const result = resultOf(response.body);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: DENIED_TEXT }]);
    expect(result._meta?.[PLAYBACK_RESULT_META]).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE_CANARY);
    expect(h.playback.entitlementChecks).toEqual([
      { accountId: DEV_ACCOUNTS.bob, episodeId: 'ep-1' },
    ]);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('denies an unknown episode exactly like a denied one, so ids cannot be probed', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();
    const response = await play(
      h,
      DEV_TOKENS.alice,
      { episodeId: 'ep-does-not-exist' },
      { [RECIPIENT_KEY_META]: publicJwk },
    );
    expect(resultOf(response.body)).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: DENIED_TEXT }],
    });
  });
});

describe('Play when the host cannot route the private result', () => {
  it.each([
    ['no recipient key in the call metadata', undefined],
    [
      'a recipient key that is really a private key',
      {
        kty: 'EC',
        crv: 'P-256',
        x: 'A'.repeat(43),
        y: 'A'.repeat(43),
        d: 'B'.repeat(43),
      },
    ],
    ['a recipient key of the wrong type', { kty: 'RSA', n: 'abc', e: 'AQAB' }],
  ])(
    'returns a safe unsupported failure with zero entitlement checks for %s',
    async (_name, key) => {
      const h = await harness();
      const response = await play(
        h,
        DEV_TOKENS.alice,
        { episodeId: 'ep-1' },
        key === undefined ? undefined : { [RECIPIENT_KEY_META]: key },
      );

      expect(response.status).toBe(200);
      expect(resultOf(response.body)).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: UNSUPPORTED_TEXT }],
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /zod|invalid_type|Required/i,
      );
      expect(h.playback.entitlementChecks).toEqual([]);
      expect(h.playback.mediaReads).toEqual([]);
    },
  );
});

describe('Play argument handling', () => {
  it('rejects a forged account id as invalid input before any entitlement check', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();
    const response = await play(
      h,
      DEV_TOKENS.bob,
      { episodeId: 'ep-1', accountId: DEV_ACCOUNTS.alice },
      { [RECIPIENT_KEY_META]: publicJwk },
    );
    const result = resultOf(response.body);
    expect(result.isError).toBe(true);
    expect(result._meta?.[PLAYBACK_RESULT_META]).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(DEV_ACCOUNTS.alice);
    expect(h.playback.entitlementChecks).toEqual([]);
  });

  it('rechecks current permission on a valid replay: access revoked between presses is denied', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();
    const press = () =>
      play(
        h,
        DEV_TOKENS.alice,
        { episodeId: 'ep-1' },
        { [RECIPIENT_KEY_META]: publicJwk },
      );

    expect(resultOf((await press()).body).isError).toBeFalsy();
    h.playback.setEntitled(DEV_ACCOUNTS.alice, []);
    const replay = resultOf((await press()).body);

    expect(replay.isError).toBe(true);
    expect(replay._meta?.[PLAYBACK_RESULT_META]).toBeUndefined();
    expect(h.playback.entitlementChecks).toHaveLength(2);
  });
});

describe('Play identity failures', () => {
  it.each([
    [
      'a missing credential',
      undefined,
      401,
      /^Bearer realm="saga-a2ui-playback"$/,
    ],
    ['an unknown credential', 'dev-token-nobody', 401, /error="invalid_token"/],
    [
      'an expired credential',
      DEV_TOKENS.expired,
      401,
      /error="invalid_token".*expired/,
    ],
    [
      'a service-only credential',
      DEV_TOKENS.service,
      403,
      /error="insufficient_scope"/,
    ],
  ])(
    'refuses %s with the HTTP status and challenge before any backend work',
    async (_name, token, status, challenge) => {
      const h = await harness();
      const { publicJwk } = await createRecipientKey();
      const response = await play(
        h,
        token,
        { episodeId: 'ep-1' },
        { [RECIPIENT_KEY_META]: publicJwk },
      );

      expect(response.status).toBe(status);
      expect(response.challenge).toMatch(challenge);
      expect(JSON.stringify(response.body)).not.toContain('capability');
      expect(h.playback.entitlementChecks).toEqual([]);
      expect(h.playback.mediaReads).toEqual([]);
    },
  );
});

const UNAVAILABLE_TEXT = 'Playback is unavailable.';
const INVALID_RESULT_TEXT = 'The playback result could not be shown.';
const UNREADABLE_REQUEST_TEXT = 'That play request could not be read.';
const FAULT_CANARY = 'canary-backend-fault-detail';

describe('Play result projections and faults', () => {
  it('answers a record that breaks the view contract with a sanitized contract-fault failure and no success data', async () => {
    const h = await startPlaybackHarness(
      { [DEV_ACCOUNTS.alice]: ['ep-big'] },
      {
        episodes: [{ id: 'ep-big', title: 'T'.repeat(500), description: 'd' }],
      },
    );
    cleanup.listener = h.listener;
    const { publicJwk } = await createRecipientKey();

    const response = await play(
      h,
      DEV_TOKENS.alice,
      { episodeId: 'ep-big' },
      { [RECIPIENT_KEY_META]: publicJwk },
    );

    // The pinned MCP SDK turns a handler's failure into an isError result (it has no JSON-RPC
    // internal-error path for a registered tool), so a contract fault is a fixed sentence that is
    // distinct from the retryable "unavailable" failure, with no success data of any kind.
    const result = resultOf(response.body);
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: INVALID_RESULT_TEXT },
    ]);
    expect(result.structuredContent).toBeUndefined();
    expect(result._meta?.[PLAYBACK_RESULT_META]).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('TTTTTTTT');
    expect(JSON.stringify(response.body)).not.toMatch(/capability/i);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('does not forward a backend failure: a generic sentence on the wire and nothing in the logs', async () => {
    const h = await startPlaybackHarness(
      { [DEV_ACCOUNTS.alice]: ['ep-1'] },
      { failEntitlementWith: `backend status 503 ${FAULT_CANARY}` },
    );
    cleanup.listener = h.listener;
    const { publicJwk } = await createRecipientKey();
    const logs = captureOrdinaryLogs();
    let response;
    try {
      response = await play(
        h,
        DEV_TOKENS.alice,
        { episodeId: 'ep-1' },
        { [RECIPIENT_KEY_META]: publicJwk },
      );
    } finally {
      logs.restore();
    }

    expect(resultOf(response.body)).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: UNAVAILABLE_TEXT }],
    });
    expect(
      resultOf(response.body)._meta?.[PLAYBACK_RESULT_META],
    ).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(FAULT_CANARY);
    expect(logs.text()).not.toContain(FAULT_CANARY);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('keeps the capability and the credential out of every ordinary log line, granted or refused', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();
    const logs = captureOrdinaryLogs();
    let granted;
    try {
      granted = await play(
        h,
        DEV_TOKENS.alice,
        { episodeId: 'ep-1' },
        { [RECIPIENT_KEY_META]: publicJwk },
      );
      await play(
        h,
        DEV_TOKENS.bob,
        { episodeId: 'ep-1' },
        { [RECIPIENT_KEY_META]: publicJwk },
      );
    } finally {
      logs.restore();
    }
    const capability = (
      resultOf(granted.body)._meta?.[PLAYBACK_RESULT_META] as {
        capability: string;
      }
    ).capability;
    expect(logs.text()).not.toContain(capability);
    expect(logs.text()).not.toContain(DEV_TOKENS.alice);
    expect(logs.text()).not.toContain(PRIVATE_CANARY);
  });

  it('answers a malformed call and an unknown tool with JSON-RPC errors, not tool failures', async () => {
    const h = await harness();
    const url = h.listener.playbackUrl ?? '';
    const post = (body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${DEV_TOKENS.alice}`,
        },
        body: JSON.stringify(body),
      }).then(async (response) => ({
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      }));

    const malformed = await post({
      id: 'm-1',
      method: 'tools/call',
      params: { name: 'play_episode', arguments: { episodeId: 'ep-1' } },
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'm-1',
      error: { code: -32600 },
    });
    expect(malformed.body.result).toBeUndefined();

    const unknown = await post({
      jsonrpc: '2.0',
      id: 'u-1',
      method: 'tools/call',
      params: { name: 'play_episode_admin', arguments: { note: FAULT_CANARY } },
    });
    expect(unknown.body).toMatchObject({
      jsonrpc: '2.0',
      id: 'u-1',
      error: { code: -32602, message: 'Unknown tool' },
    });
    expect(JSON.stringify(unknown.body)).not.toContain(FAULT_CANARY);
    expect(h.playback.entitlementChecks).toEqual([]);
  });

  it.each([
    ['a missing episode id', {}],
    ['an episode id that is not a slug', { episodeId: 'EP 1; DROP' }],
    [
      'a forged account carrying a recognizable value',
      { episodeId: 'ep-1', accountId: FAULT_CANARY },
    ],
  ])(
    'answers %s as a safe tool failure that does not echo the input',
    async (_name, args) => {
      const h = await harness();
      const { publicJwk } = await createRecipientKey();
      const response = await play(h, DEV_TOKENS.alice, args, {
        [RECIPIENT_KEY_META]: publicJwk,
      });

      // The SDK validates arguments and reports a known tool's invalid input as an isError result.
      // What matters here is that its wording is fixed: no rejected key name or value comes back.
      const result = resultOf(response.body);
      expect(response.status).toBe(200);
      expect(result.isError).toBe(true);
      const text = JSON.stringify(result.content);
      expect(text).toContain(UNREADABLE_REQUEST_TEXT);
      expect(text).not.toContain(FAULT_CANARY);
      expect(text).not.toContain('accountId');
      expect(text).not.toContain('EP 1');
      expect(h.playback.entitlementChecks).toEqual([]);
    },
  );
});

describe('Play view projection validation', () => {
  it('refuses to serialize a media URL built from a record id that is not a plain episode slug', async () => {
    // The lookup key is the validated `ep-1`, but the backend record names a different id with a
    // path in it. Publishing it would point the player's fetch at a URL nobody authorized.
    const h = await startPlaybackHarness(
      { [DEV_ACCOUNTS.alice]: ['ep-1'] },
      {
        recordFor: {
          'ep-1': {
            id: 'ep-1/../ep-2',
            title: 'Tampered record',
            description: 'd',
          },
        },
      },
    );
    cleanup.listener = h.listener;
    const { publicJwk } = await createRecipientKey();

    const response = await play(
      h,
      DEV_TOKENS.alice,
      { episodeId: 'ep-1' },
      { [RECIPIENT_KEY_META]: publicJwk },
    );

    const result = resultOf(response.body);
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: INVALID_RESULT_TEXT }],
    });
    expect(result._meta?.[PLAYBACK_RESULT_META]).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('ep-2');
  });
});

describe('Play view session label', () => {
  it('tells the view which sign-in granted playback with an opaque, stable, per-sign-in label', async () => {
    const h = await harness({
      [DEV_ACCOUNTS.alice]: ['ep-1'],
      [DEV_ACCOUNTS.bob]: ['ep-1'],
    });
    const { publicJwk } = await createRecipientKey();
    const labelFor = async (token: string) => {
      const response = await play(
        h,
        token,
        { episodeId: 'ep-1' },
        { [RECIPIENT_KEY_META]: publicJwk },
      );
      return (
        resultOf(response.body)._meta?.[PLAYBACK_RESULT_META] as {
          viewSession: string;
        }
      ).viewSession;
    };

    const alice = await labelFor(DEV_TOKENS.alice);
    expect(alice).toMatch(/^vs_[A-Za-z0-9_-]{22}$/);
    expect(alice).not.toContain(DEV_TOKENS.alice);
    expect(alice).not.toContain(DEV_ACCOUNTS.alice);
    expect(await labelFor(DEV_TOKENS.alice)).toBe(alice);
    expect(await labelFor(DEV_TOKENS.bob)).not.toBe(alice);
  });
});

describe('the model-visible opener that mounts the player view', () => {
  const open = (h: Harness, token: string | undefined, args: unknown) =>
    callToolOverHttp(h.listener.playbackUrl, token, {
      name: 'get_playable_episode',
      arguments: args,
    });

  it('is offered to the model, links the player view, and is the only tool that is', async () => {
    const h = await harness();
    const tools = await listTools(h.listener.playbackUrl, DEV_TOKENS.alice);
    const modelVisible = tools.filter((tool) =>
      (tool._meta?.ui?.visibility ?? ['model', 'app']).includes('model'),
    );
    expect(modelVisible.map((tool) => tool.name)).toEqual([
      'get_playable_episode',
    ]);
    expect(
      (modelVisible[0]?._meta?.ui as { resourceUri?: string } | undefined)
        ?.resourceUri,
    ).toBe('ui://saga-a2ui/playback-view.html');
  });

  it('shows the public episode and the sign-in label without checking access, issuing a capability or reading media', async () => {
    const h = await harness();
    const response = await open(h, DEV_TOKENS.bob, { episodeId: 'ep-1' }); // bob is not entitled: browsing is not playing

    const result = resultOf(response.body);
    expect(result.isError).toBeFalsy();
    expect(Object.keys(result.structuredContent as object).sort()).toEqual([
      'description',
      'episodeId',
      'title',
      'viewSession',
    ]);
    expect(result.structuredContent).toMatchObject({
      episodeId: 'ep-1',
      title: 'The protected episode',
      description: 'A public description.',
    });
    expect(
      (result.structuredContent as { viewSession: string }).viewSession,
    ).toMatch(/^vs_[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(response.body)).not.toMatch(/capability|expiresAt/);
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE_CANARY);
    expect(h.playback.entitlementChecks).toEqual([]);
    expect(h.playback.mediaReads).toEqual([]);
  });

  it('gives the opener and Play the same label for one sign-in, so the view can tell they belong together', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();
    const opened = resultOf(
      (await open(h, DEV_TOKENS.alice, { episodeId: 'ep-1' })).body,
    ).structuredContent as { viewSession: string };
    const played = resultOf(
      (
        await play(
          h,
          DEV_TOKENS.alice,
          { episodeId: 'ep-1' },
          { [RECIPIENT_KEY_META]: publicJwk },
        )
      ).body,
    )._meta?.[PLAYBACK_RESULT_META] as { viewSession: string };
    expect(played.viewSession).toBe(opened.viewSession);
  });

  it('answers an unknown episode as a safe failure and an unauthenticated caller with 401', async () => {
    const h = await harness();
    expect(
      resultOf(
        (await open(h, DEV_TOKENS.alice, { episodeId: 'ep-nope' })).body,
      ),
    ).toMatchObject({ isError: true });
    const anonymous = await open(h, undefined, { episodeId: 'ep-1' });
    expect(anonymous.status).toBe(401);
  });
});

describe('the player view resource', () => {
  const VIEW_URI = 'ui://saga-a2ui/playback-view.html';
  const readView = async (h: Harness, token: string) => {
    const response = await rpcOverHttp(h.listener.playbackUrl, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: VIEW_URI },
    });
    return (
      response.body as {
        result: {
          contents: {
            text: string;
            _meta: { ui: { csp: Record<string, string[]> } };
          }[];
        };
      }
    ).result.contents[0];
  };

  it('is one static document for every caller, with no per-user secret, even after a capability was issued', async () => {
    const h = await harness();
    const { publicJwk } = await createRecipientKey();
    const granted = await play(
      h,
      DEV_TOKENS.alice,
      { episodeId: 'ep-1' },
      { [RECIPIENT_KEY_META]: publicJwk },
    );
    const capability = (
      resultOf(granted.body)._meta?.[PLAYBACK_RESULT_META] as {
        capability: string;
      }
    ).capability;

    const forAlice = await readView(h, DEV_TOKENS.alice);
    const forBob = await readView(h, DEV_TOKENS.bob);

    expect(forAlice?.text).toBe(PLAYER_VIEW_HTML);
    expect(forBob?.text).toBe(PLAYER_VIEW_HTML);
    for (const secret of [
      capability,
      DEV_TOKENS.alice,
      DEV_TOKENS.bob,
      DEV_ACCOUNTS.alice,
      PRIVATE_CANARY,
    ]) {
      expect(JSON.stringify([forAlice, forBob])).not.toContain(secret);
    }
  });

  it('lets the view connect to the media origin and nothing else', async () => {
    const h = await harness();
    const mediaOrigin = new URL(h.listener.url).origin;

    const view = await readView(h, DEV_TOKENS.alice);

    expect(view?._meta.ui.csp).toEqual({
      connectDomains: [mediaOrigin],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    });
  });
});

describe('the declared output contract on the wire', () => {
  interface ListedWithOutput extends ListedTool {
    readonly outputSchema?: {
      readonly properties?: Record<string, unknown>;
      readonly additionalProperties?: unknown;
    };
  }
  const listWithOutput = async (h: Harness) =>
    (
      await rpcOverHttp(h.listener.playbackUrl, DEV_TOKENS.alice, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      })
    ).body as {
      result: { tools: ListedWithOutput[] };
    };

  it('declares a strict output schema only for the opener: Play declares none because its success data is view-only', async () => {
    const h = await harness();
    const { tools } = (await listWithOutput(h)).result;
    const opener = tools.find((tool) => tool.name === 'get_playable_episode');
    const playTool = tools.find((tool) => tool.name === 'play_episode');

    expect(Object.keys(opener?.outputSchema?.properties ?? {}).sort()).toEqual([
      'description',
      'episodeId',
      'title',
      'viewSession',
    ]);
    expect(opener?.outputSchema?.additionalProperties).toBe(false);
    // A declared output schema would make the SDK demand model-visible structuredContent from every
    // success. Play's success carries only a fixed sentence and a `_meta` projection.
    expect(playTool?.outputSchema).toBeUndefined();
  });

  it('refuses an opener result that breaks its declared schema instead of sending it', async () => {
    const h = await startPlaybackHarness(
      { [DEV_ACCOUNTS.alice]: ['ep-1'] },
      {
        recordFor: {
          'ep-1': { id: 'ep-1', title: 'x', description: 'D'.repeat(2000) },
        },
      },
    );
    cleanup.listener = h.listener;

    const response = await callToolOverHttp(
      h.listener.playbackUrl,
      DEV_TOKENS.alice,
      { name: 'get_playable_episode', arguments: { episodeId: 'ep-1' } },
    );

    expect(resultOf(response.body)).toMatchObject({ isError: true });
    expect(resultOf(response.body).structuredContent).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('DDDDDDDD');
  });
});
