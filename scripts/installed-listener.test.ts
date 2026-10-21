import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_ACCOUNTS, DEV_TOKENS } from '../apps/lit-host/src/mcp/dev-auth.js';
import {
  acquireMedia,
  createRecipientKey,
  rpcOverHttp,
  signMediaProof,
  type WireResponse,
} from '../apps/lit-host/src/playback/playback-fixture.js';
import {
  buildInstalledHost,
  LIT_HOST_OWN_DEPENDENCIES,
  startInstalledListener,
  type BuiltInstalledHost,
  type RunningInstalledListener,
} from './build-installed-lit-host.js';
import {
  createWorkDirectory,
  repoRoot,
  type PackedManifest,
} from './packed-consumer.js';

// PACK1 (#154): the application's own synthetic browse/Play listener, built and run as an application
// outside this repository would be. The listener is bundled from a copy of the application source in a
// clean directory beside the pages, against the same packed SDK tarballs, and started as its own
// Node process there with the real built views. Everything below talks to that process over HTTP.
//
// Scope: one representative case of each seam of the joined path (installed packages, readiness, served
// resource identity, browse, opener, Play, media). The exhaustive timing and security matrices stay
// with their own suites against the in-process listener (playback.test.ts, media.test.ts,
// subscriptions.test.ts and request-*.test.ts) and are not copied.
//
// The helpers imported from playback-fixture.ts are client code (a key pair, a proof signer, a fetch);
// the listener under test is the spawned process, not the module that file also imports.
//
// Authentication is the application's own `OAuthTokenVerifier` seam, here the development-only
// verifier with its fixed public tokens. A request with a header token is not an OAuth flow
// observation, and no DCR is involved.

const work = createWorkDirectory('saga-installed-listener-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
const EPISODE = 'ep-001';
const DENIED =
  'Playback denied: this account does not have access to this episode.';
const UNSUPPORTED = 'Playback is not supported here.';

interface ToolResult {
  readonly isError?: boolean;
  readonly content?: readonly {
    readonly type: string;
    readonly text: string;
  }[];
  readonly structuredContent?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

const resultOf = (response: WireResponse): ToolResult => {
  expect(response.status).toBe(200);
  return (response.body as { result: ToolResult }).result;
};

const textOf = (result: ToolResult): string =>
  result.content?.map((part) => part.text).join('\n') ?? '';

describe('the application listener installed from the packed packages and run outside the repository', () => {
  let built: BuiltInstalledHost;
  let listener: RunningInstalledListener;
  const views = (): string => path.join(built.consumer, 'dist');
  const call = (
    url: string,
    token: string | undefined,
    name: string,
    args: unknown,
    meta?: Record<string, unknown>,
  ): Promise<WireResponse> =>
    rpcOverHttp(url, token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
        ...(meta === undefined ? {} : { _meta: meta }),
      },
    });

  beforeAll(async () => {
    built = await buildInstalledHost(work);
    listener = await startInstalledListener(built);
  }, 300_000);

  afterAll(async () => {
    await listener?.stop();
  });

  describe('installation and provenance', () => {
    it('keeps the consumer, its bundled listener and the process working directory outside the repository', () => {
      for (const location of [built.consumer, built.server.file]) {
        expect(
          path.relative(repoRoot, fs.realpathSync(location)).startsWith('..'),
          location,
        ).toBe(true);
      }
      expect(path.dirname(path.dirname(built.server.file))).toBe(
        built.consumer,
      );
    });

    it('installs the owned packages as unpacked tarballs, not links, and declares no workspace, file, link or relative dependency', () => {
      const installed = path.join(built.consumer, 'node_modules', '@saga-a2ui');
      expect(fs.readdirSync(installed).sort()).toEqual([
        'components',
        'core',
        'lit',
        'mcp',
      ]);
      for (const name of fs.readdirSync(installed)) {
        expect(
          fs.lstatSync(path.join(installed, name)).isSymbolicLink(),
          name,
        ).toBe(false);
        expect(built.sdk.tarballSha256[name], name).toMatch(/^[0-9a-f]{64}$/);
      }
      // The consumer's own manifest names no dependency at all: every package is resolved from what was installed.
      expect(
        JSON.parse(
          fs.readFileSync(path.join(built.consumer, 'package.json'), 'utf8'),
        ),
      ).toEqual({ private: true, type: 'module' });
      const LEAK =
        /^(workspace:|file:|link:|portal:|git[+:]|github:|https?:|\.{1,2}\/|\/|~\/)/;
      for (const [name, manifest] of Object.entries(built.sdk.manifests)) {
        const declared = manifest as PackedManifest & {
          optionalDependencies?: Record<string, string>;
        };
        for (const group of [
          declared.dependencies,
          declared.peerDependencies,
          declared.optionalDependencies,
        ]) {
          for (const [dependency, range] of Object.entries(group ?? {}))
            expect(range, `${name} -> ${dependency}`).not.toMatch(LEAK);
        }
      }
    });

    it('links each third-party package at the exact version the installed manifests declare, on an engine the repository states', () => {
      const linked = (name: string): string =>
        (
          JSON.parse(
            fs.readFileSync(
              path.join(built.consumer, 'node_modules', name, 'package.json'),
              'utf8',
            ),
          ) as { version: string }
        ).version;
      let compared = 0;
      for (const [name, manifest] of Object.entries(built.sdk.manifests)) {
        for (const [dependency, range] of Object.entries(
          manifest.dependencies ?? {},
        )) {
          if (dependency.startsWith('@saga-a2ui/')) continue;
          const exact = /^(?:npm:[^@]+@)?(\d+\.\d+\.\d+)$/.exec(range)?.[1];
          if (exact === undefined) continue;
          expect(linked(dependency), `${name} -> ${dependency}`).toBe(exact);
          compared += 1;
        }
      }
      expect(compared).toBeGreaterThan(5);
      const engines = (
        JSON.parse(
          fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
        ) as { engines: { node: string } }
      ).engines.node;
      const [major = 0, minor = 0] = engines
        .replace(/^>=/, '')
        .split('.')
        .map(Number);
      const [runMajor = 0, runMinor = 0] = process.versions.node
        .split('.')
        .map(Number);
      expect(
        runMajor > major || (runMajor === major && runMinor >= minor),
        `Node ${process.version} against ${engines}`,
      ).toBe(true);
    });

    it('bundles the listener from installed copies alone: no workspace SDK or application module, and every run-time import is a declared package', () => {
      const { provenance, externalImports } = built.server;
      expect(provenance.unexpected).toEqual([]);
      expect(provenance.applicationModules).toBeGreaterThan(0);
      expect(provenance.installedSdkFiles).toEqual(
        expect.arrayContaining([
          '@saga-a2ui/mcp/src/server/operation.ts',
          '@saga-a2ui/mcp/src/server/lifetime.ts',
          '@saga-a2ui/components/src/faithful-card/index.ts',
        ]),
      );
      // The packages whose modules the listener carries are the installed ones, and only those.
      expect(
        [
          ...new Set(
            provenance.installedSdkFiles.map((file) =>
              file.split('/').slice(0, 2).join('/'),
            ),
          ),
        ].sort(),
      ).toEqual(['@saga-a2ui/components', '@saga-a2ui/core', '@saga-a2ui/mcp']);
      const code = fs.readFileSync(built.server.file, 'utf8');
      for (const workspace of ['packages', 'apps'])
        expect(code, workspace).not.toContain(
          path.join(repoRoot, workspace) + path.sep,
        );
      expect(
        externalImports.filter((name) => name.startsWith('@saga-a2ui/')),
      ).toEqual([]);
      const declared = new Set<string>(LIT_HOST_OWN_DEPENDENCIES);
      for (const manifest of Object.values(built.sdk.manifests))
        for (const name of Object.keys(manifest.dependencies ?? {}))
          declared.add(name);
      expect(externalImports.filter((name) => !declared.has(name))).toEqual([]);
      expect(sha256(fs.readFileSync(built.server.file))).toBe(
        built.server.sha256,
      );
    });

    it('is not ready until the real built views exist: a missing view ends the process before it listens', async () => {
      const incomplete = path.join(work, 'incomplete-views');
      fs.cpSync(views(), incomplete, { recursive: true });
      fs.rmSync(path.join(incomplete, 'playback-view'), { recursive: true });
      await expect(startInstalledListener(built, incomplete)).rejects.toThrow(
        /ended before it was ready[\s\S]*playback/,
      );
      const empty = path.join(work, 'empty-views');
      fs.mkdirSync(empty);
      await expect(startInstalledListener(built, empty)).rejects.toThrow(
        /ended before it was ready/,
      );
    }, 60_000);
  });

  describe('resource identity', () => {
    const read = async (
      url: string,
      token: string,
      uri: string,
    ): Promise<{
      text: string;
      uri: string;
      csp: { connectDomains: string[] };
    }> => {
      const response = await rpcOverHttp(url, token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri },
      });
      const content = (
        response.body as {
          result: {
            contents: {
              uri: string;
              text: string;
              _meta: { ui: { csp: { connectDomains: string[] } } };
            }[];
          };
        }
      ).result.contents[0];
      if (!content) throw new Error('resources/read returned no contents');
      return {
        text: content.text,
        uri: content.uri,
        csp: content._meta.ui.csp,
      };
    };

    it('serves the exact bytes of the views built beside it, and the playback document is the one the host mounts', async () => {
      const playback = await read(
        listener.playbackUrl,
        DEV_TOKENS.alice,
        'ui://saga-a2ui/playback-view.html',
      );
      const built_ = fs.readFileSync(
        path.join(views(), 'playback-view', 'playback.html'),
        'utf8',
      );
      expect(playback.text).toBe(built_);
      expect(playback.csp.connectDomains).toEqual([listener.origin]); // the media origin and nothing else
      const subscriptions = await read(
        listener.subscriptionsUrl,
        DEV_TOKENS.alice,
        'ui://saga-a2ui/subscriptions-view.html',
      );
      expect(subscriptions.text).toBe(
        fs.readFileSync(
          path.join(views(), 'subscriptions-view', 'subscriptions.html'),
          'utf8',
        ),
      );
      // The public episode view is addressed by the digest of the document it serves, which is the
      // built view with the content policy's restrictions inserted into its head and nothing else.
      const tools = (
        await rpcOverHttp(listener.mcpUrl, undefined, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        })
      ).body as {
        result: { tools: { _meta?: { ui?: { resourceUri?: string } } }[] };
      };
      const uri = tools.result.tools.find((tool) => tool._meta?.ui?.resourceUri)
        ?._meta?.ui?.resourceUri;
      if (uri === undefined)
        throw new Error('get_episode is not linked to a view');
      const episode = await read(listener.mcpUrl, DEV_TOKENS.alice, uri);
      expect(uri).toBe(
        `ui://views/view.${sha256(episode.text).slice(0, 32)}.html`,
      );
      const withoutPolicy = episode.text
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
        .replace(
          /<script type="application\/json" id="saga-content-policy">[\s\S]*?<\/script>/,
          '',
        );
      expect(withoutPolicy).toBe(
        fs.readFileSync(path.join(views(), 'view', 'view.html'), 'utf8'),
      );
    });

    it('serves browser documents with no server code, no credential and no backend implementation', async () => {
      const FORBIDDEN = [
        'NodeStreamableHTTPServerTransport',
        'node:http',
        'createDevelopmentVerifier',
        'createPlaybackServer',
        'createSubscriptionsServer',
        'registerProtectedOperation',
        'dev-only-token',
        'process.env',
        'Bearer ',
        DEV_ACCOUNTS.alice,
        DEV_ACCOUNTS.bob,
      ];
      const served = [
        (
          await read(
            listener.playbackUrl,
            DEV_TOKENS.alice,
            'ui://saga-a2ui/playback-view.html',
          )
        ).text,
        (
          await read(
            listener.subscriptionsUrl,
            DEV_TOKENS.alice,
            'ui://saga-a2ui/subscriptions-view.html',
          )
        ).text,
      ];
      for (const html of served) {
        expect(FORBIDDEN.filter((marker) => html.includes(marker))).toEqual([]);
        expect(html).not.toMatch(/(?:from|import|require)\s*\(?\s*["']node:/);
        expect(html).not.toMatch(/<script[^>]+\bsrc=/);
      }
    });
  });

  describe('browse', () => {
    it('refuses every request without a user credential before any tool runs, with the documented status and challenge', async () => {
      for (const [token, status] of [
        [undefined, 401],
        ['not-a-credential', 401],
        [DEV_TOKENS.expired, 401],
        [DEV_TOKENS.service, 403],
      ] as const) {
        const response = await call(
          listener.subscriptionsUrl,
          token,
          'list_subscriptions',
          {},
        );
        expect(response.status, String(token)).toBe(status);
        expect(response.challenge, String(token)).toMatch(/^Bearer /);
        expect(JSON.stringify(response.body), String(token)).not.toContain(
          'subscriptions":[',
        );
      }
    });

    it('shows each signed-in user only their own subscriptions, whatever account the arguments name', async () => {
      const alice = resultOf(
        await call(
          listener.subscriptionsUrl,
          DEV_TOKENS.alice,
          'list_subscriptions',
          {},
        ),
      );
      const aliceIds = (
        alice.structuredContent as {
          subscriptions: { subscriptionId: string }[];
        }
      ).subscriptions.map((one) => one.subscriptionId);
      expect(aliceIds).toEqual(['sub-a1', 'sub-a2']);
      const forged = resultOf(
        await call(
          listener.subscriptionsUrl,
          DEV_TOKENS.bob,
          'list_subscriptions',
          { accountId: DEV_ACCOUNTS.alice },
        ),
      );
      const bobIds = (
        forged.structuredContent as {
          subscriptions: { subscriptionId: string }[];
        }
      ).subscriptions.map((one) => one.subscriptionId);
      expect(bobIds).toEqual(['sub-b1']);
      expect(JSON.stringify(forged)).not.toContain('Synthetic Creator One');
      const paused = resultOf(
        await call(
          listener.subscriptionsUrl,
          DEV_TOKENS.alice,
          'list_subscriptions',
          { status: 'paused' },
        ),
      );
      expect(
        (
          paused.structuredContent as {
            subscriptions: { subscriptionId: string }[];
          }
        ).subscriptions.map((one) => one.subscriptionId),
      ).toEqual(['sub-a2']);
    });
  });

  describe('opener, Play and protected media', () => {
    it('declares Play app-only and offers the model only the opener', async () => {
      const response = await rpcOverHttp(
        listener.playbackUrl,
        DEV_TOKENS.alice,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      );
      const tools = (
        response.body as {
          result: {
            tools: {
              name: string;
              _meta?: { ui?: { visibility?: string[] } };
            }[];
          };
        }
      ).result.tools;
      const visibility = (name: string): string[] =>
        tools.find((tool) => tool.name === name)?._meta?.ui?.visibility ?? [
          'model',
          'app',
        ];
      expect(visibility('play_episode')).toEqual(['app']);
      expect(visibility('get_playable_episode')).toContain('model');
    });

    it('opens a fresh view for the signed-in user with the public episode and an opaque label, and checks no access', async () => {
      const first = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'get_playable_episode',
          { episodeId: EPISODE },
        ),
      );
      expect(first.structuredContent).toMatchObject({
        episodeId: EPISODE,
        title: 'The first synthetic episode',
      });
      const label = (first.structuredContent as { viewSession: string })
        .viewSession;
      expect(label).toMatch(/^vs_[A-Za-z0-9_-]{22}$/);
      // The same sign-in gets the same label on a new opener; another user's differs. The label never names an account.
      const again = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'get_playable_episode',
          { episodeId: EPISODE },
        ),
      );
      expect(
        (again.structuredContent as { viewSession: string }).viewSession,
      ).toBe(label);
      const bob = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.bob,
          'get_playable_episode',
          { episodeId: EPISODE },
        ),
      );
      expect(
        (bob.structuredContent as { viewSession: string }).viewSession,
      ).not.toBe(label);
      expect(label).not.toContain('alice');
      expect(
        textOf(
          resultOf(
            await call(
              listener.playbackUrl,
              DEV_TOKENS.alice,
              'get_playable_episode',
              { episodeId: 'ep-999' },
            ),
          ),
        ),
      ).toBe('No playable episode has that id.');
      expect(
        (
          await call(listener.playbackUrl, undefined, 'get_playable_episode', {
            episodeId: EPISODE,
          })
        ).status,
      ).toBe(401);
    });

    it('plays for the entitled user directly with the recipient key in _meta and only the episode id as arguments', async () => {
      const key = await createRecipientKey();
      const meta = { 'saga-a2ui/recipient-key': key.publicJwk };
      const opened = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'get_playable_episode',
          { episodeId: EPISODE },
        ),
      );
      const played = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'play_episode',
          { episodeId: EPISODE },
          meta,
        ),
      );
      expect(played.isError).toBeUndefined();
      // The model-visible projection is one fixed sentence; the capability lives only in the private `_meta`.
      expect(textOf(played)).toBe('Playback authorized.');
      expect(played.structuredContent).toBeUndefined();
      const grant = played._meta?.['saga-a2ui/playback'] as {
        episodeId: string;
        capability: string;
        mediaUrl: string;
        viewSession: string;
        expiresAt: number;
      };
      expect(grant).toMatchObject({
        episodeId: EPISODE,
        mediaUrl: `${listener.origin}/playback/media/${EPISODE}`,
        viewSession: (opened.structuredContent as { viewSession: string })
          .viewSession,
      });
      expect(JSON.stringify(played.content)).not.toContain(grant.capability);
      // Authority is the verified user: an account named in the arguments is rejected, not obeyed, and not echoed.
      const forged = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'play_episode',
          { episodeId: EPISODE, accountId: DEV_ACCOUNTS.bob },
          meta,
        ),
      );
      expect(forged.isError).toBe(true);
      expect(forged._meta?.['saga-a2ui/playback']).toBeUndefined();
      expect(JSON.stringify(forged)).not.toContain(DEV_ACCOUNTS.bob);
      // Without a usable recipient key nothing is issued.
      const noKey = resultOf(
        await call(listener.playbackUrl, DEV_TOKENS.alice, 'play_episode', {
          episodeId: EPISODE,
        }),
      );
      expect(noKey.isError).toBe(true);
      expect(textOf(noKey)).toBe(UNSUPPORTED);
      expect(noKey._meta?.['saga-a2ui/playback']).toBeUndefined();
    });

    it('refuses Play to a user without access with one sentence that does not tell an unknown episode apart, and to any request without a user credential', async () => {
      const key = await createRecipientKey();
      const meta = { 'saga-a2ui/recipient-key': key.publicJwk };
      const bob = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.bob,
          'play_episode',
          { episodeId: EPISODE },
          meta,
        ),
      );
      const unknown = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'play_episode',
          { episodeId: 'ep-999' },
          meta,
        ),
      );
      const notEntitled = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'play_episode',
          { episodeId: 'ep-002' },
          meta,
        ),
      );
      for (const result of [bob, unknown, notEntitled]) {
        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(DENIED);
        expect(result._meta?.['saga-a2ui/playback']).toBeUndefined();
      }
      for (const [token, status] of [
        [undefined, 401],
        [DEV_TOKENS.expired, 401],
        [DEV_TOKENS.service, 403],
      ] as const) {
        expect(
          (
            await call(
              listener.playbackUrl,
              token,
              'play_episode',
              { episodeId: EPISODE },
              meta,
            )
          ).status,
          String(token),
        ).toBe(status);
      }
    });

    it('releases media only for the capability with a fresh proof from the key it was issued to, and refuses every other combination alike', async () => {
      const key = await createRecipientKey();
      const stranger = await createRecipientKey();
      const play = async () => {
        const result = resultOf(
          await call(
            listener.playbackUrl,
            DEV_TOKENS.alice,
            'play_episode',
            { episodeId: EPISODE },
            { 'saga-a2ui/recipient-key': key.publicJwk },
          ),
        );
        return result._meta?.['saga-a2ui/playback'] as {
          capability: string;
          mediaUrl: string;
        };
      };
      const grant = await play();
      const proofFor = (
        signer: typeof key,
        url = grant.mediaUrl,
        capability = grant.capability,
      ) => signMediaProof({ key: signer, capability, url });
      const refusals = async (): Promise<number[]> => {
        const fresh = await play();
        return [
          (await acquireMedia({ url: fresh.mediaUrl })).status, // neither capability nor proof
          (
            await acquireMedia({
              url: fresh.mediaUrl,
              capability: fresh.capability,
            })
          ).status, // a copied capability alone
          (
            await acquireMedia({
              url: fresh.mediaUrl,
              capability: fresh.capability,
              proof: await proofFor(stranger, fresh.mediaUrl, fresh.capability),
            })
          ).status, // another holder's key
          (
            await acquireMedia({
              url: fresh.mediaUrl,
              capability: fresh.capability,
              proof: await proofFor(
                key,
                `${listener.origin}/playback/media/ep-002`,
                fresh.capability,
              ),
            })
          ).status, // a proof aimed elsewhere
          (
            await acquireMedia({
              url: `${listener.origin}/playback/media/ep-002`,
              capability: fresh.capability,
              proof: await proofFor(
                key,
                `${listener.origin}/playback/media/ep-002`,
                fresh.capability,
              ),
            })
          ).status, // another episode
        ];
      };
      expect(await refusals()).toEqual([403, 403, 403, 403, 403]);

      const granted = await acquireMedia({
        url: grant.mediaUrl,
        capability: grant.capability,
        proof: await proofFor(key),
      });
      expect(granted.status).toBe(200);
      expect(granted.headers.get('content-type')).toBe('audio/wav');
      expect(granted.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(granted.bytes.slice(0, 4)).toString('ascii')).toBe(
        'RIFF',
      );
      expect(Buffer.from(granted.bytes.slice(8, 12)).toString('ascii')).toBe(
        'WAVE',
      );
      // A proof is single-use: the same one again is refused with the same fixed answer.
      const proof = await proofFor(key);
      expect(
        (
          await acquireMedia({
            url: grant.mediaUrl,
            capability: grant.capability,
            proof,
          })
        ).status,
      ).toBe(200);
      const replay = await acquireMedia({
        url: grant.mediaUrl,
        capability: grant.capability,
        proof,
      });
      expect(replay.status).toBe(403);
      expect(Buffer.from(replay.bytes).toString('utf8')).toBe(
        '{"error":"forbidden"}',
      );
    });

    it('writes no credential, capability or key to its output', async () => {
      const key = await createRecipientKey();
      const result = resultOf(
        await call(
          listener.playbackUrl,
          DEV_TOKENS.alice,
          'play_episode',
          { episodeId: EPISODE },
          { 'saga-a2ui/recipient-key': key.publicJwk },
        ),
      );
      const grant = result._meta?.['saga-a2ui/playback'] as {
        capability: string;
      };
      const output = listener.output();
      for (const secret of [
        grant.capability,
        key.publicJwk.x ?? 'x',
        ...Object.values(DEV_TOKENS),
      ])
        expect(output).not.toContain(secret);
    });
  });
});
