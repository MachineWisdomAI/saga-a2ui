import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import {
  Action,
  componentKind,
  createInstanceHost,
  prerequisite,
  proceed,
  refuse,
  type InstanceEvent,
  type ServerTransport,
} from '@saga-a2ui/core/actions';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type {
  Listener,
  ListenerOptions,
} from '../templates/lit-node/server/listener.js';
import {
  buildStarter,
  prepareStarter,
  typecheckStarter,
  type BuiltStarter,
} from './build-starter.js';
import { createWorkDirectory } from './packed-consumer.js';
import type { QualifiedStarter } from './qualified-starters.js';

// Qualifies a server pair of the `lit-mcp` stack: a maintained starter template (templates/lit-node
// on the official `@modelcontextprotocol/node` adapter, templates/lit-express on the official
// `@modelcontextprotocol/express` adapter, templates/lit-fastify on the official `@modelcontextprotocol/fastify`
// adapter, templates/lit-hono on the official `@modelcontextprotocol/hono` adapter). The starter is exported as a developer receives it, the
// SDK packages are installed into it from packed candidate tarballs (scripts/build-starter.ts), it is
// type-checked and built with its own scripts' configuration, and then a real MCP client talks to it
// over HTTP. Every template runs the same cases through the same listener interface; a template's
// own server framework adds its cases through `framework`.
//
// The test identities, credentials and policy below exist only in this file. They reach the
// starter through its public listener options, so nothing of them is in the starter's output, and
// the last case checks that. The browser behavior of the built view is qualified separately by
// apps/lit-host/e2e/starter.spec.ts.

/** What a template's own cases need from the shared suite: its listener, credentials and client. */
export interface StarterHarness {
  readonly template: QualifiedStarter;
  /** The exported, installed and built starter; available inside a case, not while cases are registered. */
  built(): BuiltStarter;
  /** Starts the built listener with the suite's test application. */
  start(options?: { budgets?: ListenerOptions['budgets'] }): Promise<{
    readonly listener: Listener;
    readonly calls: { verifier: number; authorize: number };
  }>;
  /** A raw protected request, so a refusal can be read as the HTTP answer it is. */
  rawCall(url: string, authorization?: string): Promise<Response>;
  /** The bearer credential the suite's verifier accepts for its allowed account. */
  readonly allowedToken: string;
}

/**
 * Qualifies one maintained template (see qualified-starters.ts) from packed artifacts: a call from
 * a test file registers the whole headless suite for that template. `framework` registers the
 * cases only that template's server framework has, with the same listener and credentials.
 */
export function qualifyStarter(
  template: QualifiedStarter,
  framework?: (harness: StarterHarness) => void,
): void {
  interface Entry {
    startListener(options: ListenerOptions): Promise<Listener>;
    readonly ACCOUNT_SCOPE: string;
    readonly ViewArtifactMissing: new () => Error;
  }

  const ACCOUNT_A = 'qualification-account-a';
  const ACCOUNT_B = 'qualification-account-b';
  const ACCOUNT_DENIED = 'qualification-account-denied';
  const TOKEN = {
    a: 'qualification-token-a',
    b: 'qualification-token-b',
    denied: 'qualification-token-denied',
    service: 'qualification-token-service',
    otherScope: 'qualification-token-other-scope',
    expired: 'qualification-token-expired',
  } as const;

  const work = createWorkDirectory('saga-starter-test-');
  let built: BuiltStarter;
  let entry: Entry;
  let html: string;

  beforeAll(async () => {
    const prepared = prepareStarter(work, template);
    // Type-check before building: the starter's own `npm run typecheck`, against the installed packages.
    typecheckStarter(prepared.consumer);
    built = await buildStarter(prepared);
    entry = (await import(
      pathToFileURL(built.qualificationServer).href
    )) as Entry;
    html = fs.readFileSync(built.view, 'utf8');
  }, 180_000);
  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  // ---------------------------------------------------------------------------------------------
  // The test application: who the credentials belong to, and what each account may see.
  // ---------------------------------------------------------------------------------------------

  interface Hooks {
    beforeVerify?(token: string): Promise<void> | void;
    beforeAuthorize?(accountId: string): Promise<void> | void;
  }

  interface Running {
    readonly listener: Listener;
    readonly calls: { verifier: number; authorize: number };
    readonly hooks: Hooks;
  }

  const running: Running[] = [];
  afterEach(async () => {
    for (const one of running.splice(0)) await one.listener.close();
    for (const client of clients.splice(0))
      await client.close().catch(() => undefined);
  });

  const nowSeconds = (): number => Date.now() / 1000;

  function credentialFor(token: string, scope: string): AuthInfo | undefined {
    const user = (
      accountId: string | undefined,
      scopes: string[],
      expiresAt = nowSeconds() + 3600,
    ): AuthInfo => ({
      token,
      clientId: 'qualification-client',
      scopes,
      expiresAt,
      ...(accountId === undefined ? {} : { extra: { accountId } }),
    });
    switch (token) {
      case TOKEN.a:
        return user(ACCOUNT_A, [scope]);
      case TOKEN.b:
        return user(ACCOUNT_B, [scope]);
      case TOKEN.denied:
        return user(ACCOUNT_DENIED, [scope]);
      case TOKEN.service:
        return user(undefined, [scope]); // a valid credential for the application itself, naming no account
      case TOKEN.otherScope:
        return user(ACCOUNT_A, ['something:else']);
      case TOKEN.expired:
        return user(ACCOUNT_A, [scope], nowSeconds() - 60);
      default:
        return undefined;
    }
  }

  async function start(
    options: {
      hooks?: Hooks;
      verifier?: (calls: Running['calls'], hooks: Hooks) => OAuthTokenVerifier;
      budgets?: ListenerOptions['budgets'];
      html?: string;
    } = {},
  ): Promise<Running> {
    const calls = { verifier: 0, authorize: 0 };
    const hooks: Hooks = options.hooks ?? {};
    const verifier: OAuthTokenVerifier = options.verifier?.(calls, hooks) ?? {
      async verifyAccessToken(token) {
        calls.verifier += 1;
        await hooks.beforeVerify?.(token);
        const credential = credentialFor(token, entry.ACCOUNT_SCOPE);
        if (credential === undefined)
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            'unknown credential',
          );
        return credential;
      },
    };
    const listener = await entry.startListener({
      html: options.html ?? html,
      verifier,
      authorize: async (identity) => {
        calls.authorize += 1;
        await hooks.beforeAuthorize?.(identity.accountId);
        return identity.accountId !== ACCOUNT_DENIED;
      },
      port: 0,
      ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
    });
    const one = { listener, calls, hooks };
    running.push(one);
    return one;
  }

  const clients: Client[] = [];
  async function connect(url: string, token?: string): Promise<Client> {
    const client = new Client({
      name: 'starter-qualification',
      version: '0.0.0',
    });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit:
          token === undefined
            ? {}
            : { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  }

  const callAccount = (client: Client) =>
    client.callTool({ name: 'get_account', arguments: {} });
  const textOf = (result: { content?: unknown }): string =>
    JSON.stringify(result.content);

  /** A raw protected request, so a refusal can be read as the HTTP answer it is. */
  async function rawCall(
    url: string,
    authorization?: string,
  ): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_account', arguments: {} },
      }),
    });
  }

  // ---------------------------------------------------------------------------------------------

  describe('the public operation', () => {
    it('answers without any credential, links the built page, and serves exactly those bytes', async () => {
      const { listener, calls } = await start();
      const client = await connect(listener.statusUrl);

      const result = await client.callTool({
        name: 'get_status',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ status: 'running' });
      const uri = (result._meta as { ui: { resourceUri: string } }).ui
        .resourceUri;
      expect(uri).toBe(viewUriForHtml(html));

      const { contents } = await client.readResource({ uri });
      const [content] = contents;
      expect(content && 'text' in content ? content.text : undefined).toBe(
        html,
      );
      expect(calls).toEqual({ verifier: 0, authorize: 0 }); // no identity was asked for, none was fabricated
    });
  });

  describe('the protected operation', () => {
    it('shows an allowed account only its own account', async () => {
      const { listener } = await start();
      const result = await callAccount(
        await connect(listener.accountUrl, TOKEN.a),
      );
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ accountId: ACCOUNT_A });
    });

    it('refuses an account the application denies, with a fixed sentence that names no account', async () => {
      const { listener, calls } = await start();
      const result = await callAccount(
        await connect(listener.accountUrl, TOKEN.denied),
      );
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(textOf(result)).toBe(
        JSON.stringify([
          { type: 'text', text: 'This account may not see this.' },
        ]),
      );
      expect(calls.authorize).toBe(1); // the policy was asked, for this request's identity
    });

    it.each([
      ['no credential', undefined, 401],
      ['a malformed credential', 'Token abc', 401],
      ['a credential the verifier does not know', 'Bearer nobody', 401],
      ['an expired credential', `Bearer ${TOKEN.expired}`, 401],
      [
        'a credential without the required scope',
        `Bearer ${TOKEN.otherScope}`,
        403,
      ],
      [
        'a service credential that names no account',
        `Bearer ${TOKEN.service}`,
        403,
      ],
    ] as const)(
      'fails closed for %s: it is refused at HTTP with a challenge and no protected work starts',
      async (_label, authorization, status) => {
        const { listener, calls } = await start();
        const response = await rawCall(listener.accountUrl, authorization);
        expect(response.status).toBe(status);
        expect(response.headers.get('www-authenticate')).toMatch(
          /^Bearer realm="saga-starter"/,
        );
        expect(await response.text()).toBe('');
        expect(calls.authorize).toBe(0);
      },
    );

    it('does not so much as ask the verifier when there is no credential', async () => {
      const { listener, calls } = await start();
      await rawCall(listener.accountUrl);
      expect(calls.verifier).toBe(0);
    });

    it('keeps overlapping requests apart: each handler sees only its own identity', async () => {
      const arrived: string[] = [];
      let release!: () => void;
      const together = new Promise<void>((resolve) => (release = resolve));
      const { listener } = await start({
        hooks: {
          // Neither request is answered until both handlers are inside the policy at once.
          beforeAuthorize: async (accountId) => {
            arrived.push(accountId);
            if (arrived.length === 2) release();
            await together;
          },
        },
      });
      const clientA = await connect(listener.accountUrl, TOKEN.a);
      const clientB = await connect(listener.accountUrl, TOKEN.b);

      const [a, b] = await Promise.all([
        callAccount(clientA),
        callAccount(clientB),
      ]);

      expect([...arrived].sort()).toEqual([ACCOUNT_A, ACCOUNT_B]);
      expect(a.structuredContent).toEqual({ accountId: ACCOUNT_A });
      expect(b.structuredContent).toEqual({ accountId: ACCOUNT_B });
    });

    it('is not changed by a verifier that reuses and rewrites the object it returned', async () => {
      // One record, rewritten for every credential. The first request's body is still arriving when
      // the second request is verified, so a request that kept the verifier's own object would read
      // the second request's account.
      const record: AuthInfo = {
        token: 'shared',
        clientId: 'qualification-client',
        scopes: [],
        expiresAt: nowSeconds() + 3600,
        extra: {},
      };
      const { listener } = await start({
        verifier: () => ({
          async verifyAccessToken(token) {
            record.scopes = [entry.ACCOUNT_SCOPE];
            record.extra = {
              accountId: token === TOKEN.a ? ACCOUNT_A : ACCOUNT_B,
            };
            return record;
          },
        }),
      });
      const url = new URL(listener.accountUrl);
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_account', arguments: {} },
      });

      const slow = http.request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${TOKEN.a}`,
          'content-length': String(Buffer.byteLength(body)),
        },
      });
      const answered = new Promise<string>((resolve, reject) => {
        slow.on('response', (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve(Buffer.concat(chunks).toString('utf8')),
          );
        });
        slow.on('error', reject);
      });
      slow.write(body.slice(0, 10)); // verified now; the rest of the body is still to come
      await new Promise((resolve) => setTimeout(resolve, 100));

      const second = await rawCall(listener.accountUrl, `Bearer ${TOKEN.b}`);
      expect(await second.text()).toContain(ACCOUNT_B);
      slow.end(body.slice(10));

      const first = await answered;
      expect(first).toContain(ACCOUNT_A);
      expect(first).not.toContain(ACCOUNT_B);
    });
  });

  describe('the request and operation clocks', () => {
    it('a verifier that never answers is cut off by the authentication budget, and the public endpoint keeps working', async () => {
      const { listener } = await start({
        budgets: { operationMs: 150, requestMs: 1_000 },
        verifier: () => ({
          verifyAccessToken: () => new Promise<AuthInfo>(() => undefined),
        }),
      });
      const began = Date.now();
      const response = await rawCall(listener.accountUrl, `Bearer ${TOKEN.a}`);
      expect(response.status).toBe(503);
      expect(Date.now() - began).toBeLessThan(900); // the operation limit, not the request's

      const result = await (
        await connect(listener.statusUrl)
      ).callTool({ name: 'get_status', arguments: {} });
      expect(result.structuredContent).toEqual({ status: 'running' });
    });

    it('refuses an invalid budget before it opens a port', async () => {
      await expect(
        entry.startListener({
          html,
          verifier: {
            verifyAccessToken: () => Promise.reject(new Error('unused')),
          },
          authorize: async () => true,
          port: 0,
          budgets: { operationMs: 0 },
        }),
      ).rejects.toMatchObject({
        name: 'BudgetConfigurationError',
      });
    });
  });

  describe('the request lifetime at the HTTP body and delivery boundary', () => {
    const JSON_HEADERS = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    } as const;

    interface Raw {
      status: number | undefined;
      /** True when the connection closed (or was never held open) within the window. */
      closed: boolean;
      /** True when the response body arrived whole. */
      complete: boolean;
      elapsedMs: number;
    }

    /**
     * POSTs with a declared length that is never fulfilled: only `sent` is written, then nothing. It
     * resolves when the connection closes, or `windowMs` passes, and says what the client saw.
     */
    async function stalledBody(
      url: string,
      sent: string,
      headers: Record<string, string>,
      windowMs: number,
    ): Promise<Raw> {
      const began = Date.now();
      return new Promise<Raw>((resolve) => {
        const raw: Raw = {
          status: undefined,
          closed: false,
          complete: false,
          elapsedMs: 0,
        };
        const request = http.request(url, {
          method: 'POST',
          headers: { ...JSON_HEADERS, 'content-length': '1000', ...headers },
        });
        const done = () => {
          clearTimeout(timer);
          raw.elapsedMs = Date.now() - began;
          request.destroy();
          resolve(raw);
        };
        const timer = setTimeout(done, windowMs);
        request.on('response', (response) => {
          raw.status = response.statusCode;
          response.on('data', () => undefined);
          response.on('end', () => (raw.complete = true));
        });
        request.on('error', () => undefined);
        request.on('close', () => {
          raw.closed = true;
          done();
        });
        request.write(sent);
      });
    }

    it.each([
      ['the operation limit', { operationMs: 50, requestMs: 100 }],
      ['the request limit alone', { operationMs: 5_000, requestMs: 100 }],
    ] as const)(
      'a public body that stalls is bounded by %s: one 408 and a closed connection',
      async (_label, budgets) => {
        const { listener } = await start({ budgets });
        const raw = await stalledBody(listener.statusUrl, '{', {}, 1_500);
        expect(raw.status).toBe(408);
        expect(raw.closed).toBe(true);
        expect(raw.elapsedMs).toBeLessThan(700);
      },
    );

    it('a protected body that stalls does no protected work and releases the connection', async () => {
      const { listener, calls } = await start({
        budgets: { operationMs: 50, requestMs: 100 },
      });
      const raw = await stalledBody(
        listener.accountUrl,
        '{',
        { authorization: `Bearer ${TOKEN.a}` },
        1_500,
      );
      expect(raw.status).toBe(408);
      expect(raw.closed).toBe(true);
      expect(raw.elapsedMs).toBeLessThan(700);
      expect(calls.verifier).toBe(1); // authentication ran before the body, as its own stage
      expect(calls.authorize).toBe(0); // nothing was built or called for a request that never finished arriving
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(calls.authorize).toBe(0); // and nothing started after the budget ran out
    });

    it('a caller that goes away mid-body leaves the listener serving others', async () => {
      const { listener } = await start({
        budgets: { operationMs: 5_000, requestMs: 10_000 },
      });
      const url = new URL(listener.statusUrl);
      const request = http.request(url, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'content-length': '1000' },
      });
      request.on('error', () => undefined);
      request.write('{');
      await new Promise((resolve) => setTimeout(resolve, 50));
      request.destroy();
      const result = await (
        await connect(listener.statusUrl)
      ).callTool({ name: 'get_status', arguments: {} });
      expect(result.structuredContent).toEqual({ status: 'running' });
    });

    it('refuses a declared body that is too large, and a body that is not JSON, without building a server', async () => {
      const { listener } = await start();
      const tooLarge = await stalledBody(
        listener.statusUrl,
        '{',
        { 'content-length': String(2 * 1024 * 1024) },
        1_000,
      );
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.closed).toBe(true);

      const notJson = await fetch(listener.statusUrl, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{not json',
      });
      expect(notJson.status).toBe(400);
      expect(await notJson.json()).toMatchObject({
        jsonrpc: '2.0',
        error: { code: -32700 },
      });
    });

    it('a finite response that cannot be delivered in time is destroyed, not left holding the connection', async () => {
      // A built page padded to tens of megabytes, read by a client that stops reading: the answer is
      // committed, but the transport can never finish it inside the 600 ms request budget.
      const padded = `${html}<!--${'x'.repeat(48 * 1024 * 1024)}-->`;
      const { listener } = await start({
        html: padded,
        budgets: { operationMs: 500, requestMs: 600 },
      });
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: viewUriForHtml(padded) },
      });

      const outcome = await new Promise<{
        status: number | undefined;
        complete: boolean;
        received: number;
        closedAfterMs: number;
      }>((resolve) => {
        const began = Date.now();
        const request = http.request(listener.statusUrl, {
          method: 'POST',
          headers: {
            ...JSON_HEADERS,
            'content-length': String(Buffer.byteLength(body)),
          },
        });
        request.on('error', () => undefined);
        request.on('response', (response) => {
          let received = 0;
          response.on('data', (chunk: Buffer) => (received += chunk.length));
          response.on('error', () => undefined);
          response.pause(); // the peer stops reading while the answer is still being delivered
          setTimeout(() => response.resume(), 1_200); // and picks up whatever is left after the budget has gone
          response.on('close', () =>
            resolve({
              status: response.statusCode,
              complete: response.complete,
              received,
              closedAfterMs: Date.now() - began,
            }),
          );
        });
        request.end(body);
      });

      expect(outcome.status).toBe(200); // committed before the deadline; a second status is never written
      expect(outcome.complete).toBe(false); // the deadline ended delivery
      expect(outcome.received).toBeLessThan(padded.length);
      expect(outcome.closedAfterMs).toBeLessThan(4_000);

      // The listener is unharmed.
      const result = await (
        await connect(listener.statusUrl)
      ).callTool({ name: 'get_status', arguments: {} });
      expect(result.structuredContent).toEqual({ status: 'running' });
    }, 30_000);
  });

  describe('the built view is required', () => {
    it('will not start without the built page', async () => {
      await expect(
        start({ html: '<!doctype html><title>not the view</title>' }),
      ).rejects.toBeInstanceOf(entry.ViewArtifactMissing);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The action runtime with an asynchronous prerequisite, ahead of a protected request.
  // ---------------------------------------------------------------------------------------------

  describe('a prerequisite that refuses stops the action before a protected request', () => {
    interface PressEvents {
      readonly activate: InstanceEvent<string>;
    }
    const Press = componentKind<PressEvents>('Press');

    /** One rendered control bound to a server action that shows the account, behind `session`. */
    async function press(
      client: Client,
      session: ReturnType<typeof prerequisite>,
    ) {
      type Reply = Awaited<ReturnType<Client['callTool']>>;
      const transport: ServerTransport<Reply> = {
        callServerTool: (request, options) =>
          client.callTool(
            { name: request.name, arguments: { ...request.arguments } },
            options?.signal === undefined ? {} : { signal: options.signal },
          ),
      };
      const failures: string[] = [];
      const results: unknown[] = [];
      const show = Action.server<InstanceEvent<string>, Reply>(
        'show-account',
        transport,
      )
        .before(session)
        .run(({ call }) => call('get_account', {}))
        .onSuccess(({ result }) => void results.push(result.structuredContent))
        .onFailure((context) => void failures.push(context.stage))
        .build();

      const host = createInstanceHost({
        onSetupError: (error) => void failures.push(`setup: ${String(error)}`),
      });
      let settled!: () => void;
      const done = new Promise<void>((resolve) => (settled = resolve));
      host.register((view) => {
        view.watchById('show', Press, (handle) => {
          const binding = handle.bindAction('activate', show);
          binding.subscribe(() => {
            if (binding.state.phase === 'idle') settled();
          });
        });
      });
      const control = host.open<PressEvents>({
        kind: Press,
        componentId: 'show',
        dataPath: '/',
        events: ['activate'],
        isLive: () => true,
        read: () => undefined,
      });
      control.activate('activate', 'click');
      await done;
      host.close();
      return { failures, results };
    }

    it('sends no request when the prerequisite refuses, and sends exactly one when it proceeds', async () => {
      const { listener, calls } = await start();
      const client = await connect(listener.accountUrl, TOKEN.a);
      const before = { ...calls };

      const refused = await press(
        client,
        prerequisite('session', async () => refuse('not-signed-in')),
      );
      expect(refused.failures).toEqual(['prerequisites']);
      expect(refused.results).toEqual([]);
      expect(calls).toEqual(before); // the protected handler was never asked, and neither was the verifier

      const allowed = await press(
        client,
        prerequisite('session', async () => proceed()),
      );
      expect(allowed.failures).toEqual([]);
      expect(allowed.results).toEqual([{ accountId: ACCOUNT_A }]);
      expect(calls.authorize).toBe(before.authorize + 1);
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The starter as it runs by itself, and what it contains.
  // ---------------------------------------------------------------------------------------------

  describe('the starter, as a developer runs it', () => {
    let child: ChildProcess | undefined;
    afterEach(() => void child?.kill());

    it('serves the public status and refuses every protected request, because it ships no identity provider', async () => {
      child = spawn(process.execPath, [built.server], {
        cwd: built.consumer,
        env: { ...process.env, PORT: '0' },
      });
      let output = '';
      const urls = await new Promise<{ status: string; account: string }>(
        (resolve, reject) => {
          child?.stdout?.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
            const status = /Public status endpoint: (\S+)/.exec(output)?.[1];
            const account = /Protected account endpoint[^:]*: (\S+)/.exec(
              output,
            )?.[1];
            if (status !== undefined && account !== undefined)
              resolve({ status, account });
          });
          child?.on('error', reject);
          child?.on('exit', (code) =>
            reject(
              new Error(
                `the starter's server exited with ${String(code)} before it listened`,
              ),
            ),
          );
        },
      );

      const result = await (
        await connect(urls.status)
      ).callTool({ name: 'get_status', arguments: {} });
      expect(result.structuredContent).toEqual({ status: 'running' });
      for (const token of Object.values(TOKEN))
        expect((await rawCall(urls.account, `Bearer ${token}`)).status).toBe(
          401,
        );
    });

    it('contains no test identity, no demo verifier and no copy of an SDK implementation', () => {
      const exported = built.exported.files.map((file) => ({
        file,
        text: fs.readFileSync(
          path.join(built.exported.directory, file),
          'utf8',
        ),
      }));
      const artifacts = [built.view, built.server].map((file) => ({
        file: path.relative(built.consumer, file),
        text: fs.readFileSync(file, 'utf8'),
      }));

      for (const { file, text } of [...exported, ...artifacts]) {
        expect(text, file).not.toMatch(/qualification-(account|token|client)/);
        expect(text, file).not.toMatch(
          /vitest|playwright|dev-only|DEV_TOKENS/i,
        );
      }
      // The only way identity enters is the application's verifier: a file that refuses every credential.
      expect(
        exported.find((one) => one.file === 'server/verifier.ts')?.text,
      ).toMatch(/throw\s+new\s+OAuthError\(\s*OAuthErrorCode\.InvalidToken/);
      // SDK behavior is imported, not reimplemented: no copy of the runtime's modules in the starter's own source.
      const own = exported
        .filter((one) => one.file.endsWith('.ts'))
        .map((one) => one.text)
        .join('\n');
      expect(own).toMatch(/from '@saga-a2ui\/core\/actions'/);
      expect(own).not.toMatch(
        /function\s+(createBinding|createInstanceHost|registerProtectedOperation|createMessageSession)\b/,
      );
      // Every SDK package in the exported manifest is the exact installed build, and nothing resolves outside a registry.
      const manifest = JSON.parse(
        exported.find((one) => one.file === 'package.json')?.text ?? '{}',
      ) as { dependencies: Record<string, string> };
      for (const [name, range] of Object.entries(manifest.dependencies)) {
        if (name.startsWith('@saga-a2ui/'))
          expect(range, name).toBe(built.sdk.version);
        expect(range, name).not.toMatch(
          /^(workspace:|file:|link:|git|https?:|\.|\/)/,
        );
      }
    });

    it('keeps server code out of the view: the built page carries the view connection and no listener, transport or verifier', () => {
      expect(html).not.toMatch(
        /NodeStreamableHTTPServerTransport|verifyAccessToken|registerProtectedOperation|@modelcontextprotocol\/(node|express)|localhostHostValidation/,
      );
      expect(html).not.toMatch(/(?:from|import|require)\s*\(?\s*["']node:/);
      expect(html).toContain('<starter-app');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The cases only this template's server framework has.
  // ---------------------------------------------------------------------------------------------
  framework?.({
    template,
    built: () => built,
    start,
    rawCall,
    allowedToken: TOKEN.a,
  });
}
