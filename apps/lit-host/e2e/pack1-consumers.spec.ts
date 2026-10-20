import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Client } from '@modelcontextprotocol/client';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import type * as Pack1Server from '../../../examples/pack1-consumer/server/index.js';
import { startTestHost, type TestHost } from '../../../packages/mcp/src/server/http-host.test-support.js';
import type { HostedResource } from './host-fixture/host.js';

// PACK1: two separately installed consumers of one notes application, qualified through the page
// and the server that each one's own build produced from packed SDK tarballs alone
// (scripts/build-pack1-consumers.ts):
//
//   own   the application's catalog alone (no optional component installed)
//   card  the same catalog and behaviors plus the optional FaithfulCard
//
// The page under test is the one the consumer's server serves over a real MCP connection. It is
// mounted in the sandboxed iframe of the local host fixture under the CSP the server declared,
// and every result reaches it over the fixture's real AppBridge. The consumer's session check,
// its protected archive operation and its listing all go through that bridge to a real
// Streamable HTTP MCP server, so a prerequisite request is counted apart from the protected one.
// The local host fixture is not evidence of any actual assistant host.

type ServerModule = typeof Pack1Server;
type Call = 'isSignedIn' | 'archive';

const AUTH: Record<string, AuthInfo> = {
  alice: { token: 't', clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId: 'acct-alice' } },
  bob: { token: 't', clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId: 'acct-bob' } },
};

const TEXT = {
  cannotArchive: 'This note cannot be archived.',
  signInRequired: 'Sign in to see your notes.',
};
const MISMATCH_TEXT = 'Your notes could not be shown: this view and its server are from different builds. Reopen the notes; if this continues, the maintainer must update the server and the view together.';

interface Environment {
  readonly backend: Pack1Server.FixtureBackend;
  readonly host: TestHost;
  readonly alice: Client;
  readonly bob: Client;
  readonly anonymous: Client;
  /** Makes every later call of that kind wait until the test releases it. */
  readonly hold: Record<Call, boolean>;
  readonly held: Record<Call, (() => void)[]>;
  /** When set, an archive is applied and then the backend fails before it can answer. */
  readonly fault: { failAfterArchive: boolean };
  readonly bytes: Buffer;
  readonly server: ServerModule;
}

// The candidate rehearsal (scripts/candidate-rehearsal.ts) points SAGA_PACK1_DIR at the consumers it
// rebuilt for one stage of an install, update or rollback; otherwise these are the PACK1 build.
const pack1Dist = process.env.SAGA_PACK1_DIR === undefined ? new URL('../dist/pack1/', import.meta.url) : pathToFileURL(`${resolve(process.env.SAGA_PACK1_DIR)}/`);

// The candidate rehearsal rebuilds the combinations a candidate records, the two Lit consumers; the
// React consumer (REACT1) is not a recorded combination yet, so a rehearsal's directory has none.
const consumers = process.env.SAGA_PACK1_DIR === undefined ? (['own', 'card', 'react'] as const) : (['own', 'card'] as const);

for (const consumer of consumers) {
  const page_ = new URL(`${consumer}/${consumer}.html`, pack1Dist);
  const server_ = new URL(`${consumer}/server.mjs`, pack1Dist);

  test.describe(`${consumer} consumer, installed from packed artifacts`, () => {
    let server: ServerModule;
    let bytes: Buffer;
    let environment: Environment;

    test.beforeAll(async () => {
      bytes = await readFile(page_);
      server = (await import(pathToFileURL(server_.pathname).href)) as ServerModule;
    });

    test.beforeEach(async () => {
      const hold: Record<Call, boolean> = { isSignedIn: false, archive: false };
      const held: Record<Call, (() => void)[]> = { isSignedIn: [], archive: [] };
      const fault = { failAfterArchive: false };
      const backend = server.createFixtureBackend({
        before: async (call) => {
          if (call === 'notesFor' || !hold[call]) return;
          await new Promise<void>((resolve) => held[call].push(resolve));
        },
        afterArchive: () => {
          if (fault.failAfterArchive) throw new Error('the backend failed after applying the archive');
        },
      });
      const host = await startTestHost({
        jsonResponse: true,
        buildServer: () => server.createNotesServer({ html: bytes.toString('utf8'), backend }),
        authenticate: (credential) => (credential === undefined ? undefined : AUTH[credential]),
      });
      environment = { backend, host, alice: await host.connect('alice'), bob: await host.connect('bob'), anonymous: await host.connect(), hold, held, fault, bytes, server };
    });

    test.afterEach(async () => {
      for (const resolvers of Object.values(environment.held)) for (const resolve of resolvers.splice(0)) resolve();
      await environment.host.close();
    });

    const toolResult = (client: Client = environment.alice) => client.callTool({ name: 'list_notes', arguments: {} });

    async function servedResource(): Promise<HostedResource & { uri: string }> {
      const { tools } = await environment.alice.listTools();
      const uri = (tools.find((tool) => tool.name === 'list_notes')?._meta as { ui: { resourceUri: string } } | undefined)?.ui.resourceUri;
      if (uri === undefined) throw new Error('list_notes is not linked to a view');
      const { contents } = await environment.alice.readResource({ uri });
      const [content] = contents;
      if (!content || !('text' in content)) throw new Error('resources/read returned no text');
      return { uri, html: content.text, csp: (content._meta as { ui: { csp: HostedResource['csp'] } }).ui.csp };
    }

    interface Opened {
      readonly page: Page;
      readonly view: FrameLocator;
      readonly requests: string[];
      readonly opened: string[];
    }

    /** Mounts the served page in the host fixture, proxies its server calls as Alice, and delivers her notes. */
    async function open(page: Page, options: { deliver?: boolean } = {}): Promise<Opened> {
      const requests: string[] = [];
      const opened: string[] = [];
      page.on('request', (request) => void requests.push(request.url()));
      await page.goto('/host-fixture/index.html');
      await page.exposeFunction('hostCall', (params: { name: string; arguments?: Record<string, unknown> }) => environment.alice.callTool(params));
      await page.exposeFunction('recordOpen', (url: string) => void opened.push(url));
      await page.evaluate(() => {
        const bridge = window as unknown as { hostCall: NonNullable<Window['handleToolCall']>; recordOpen: (url: string) => Promise<void> };
        window.handleToolCall = (params) => bridge.hostCall(params);
        window.handleOpenLink = async ({ url }) => {
          await bridge.recordOpen(url);
          return {};
        };
      });
      const { html, csp } = await servedResource();
      await page.evaluate((resource) => window.mountView?.(resource), { html, csp });
      const view = page.frameLocator('iframe[title="MCP App view"]');
      if (options.deliver !== false) {
        await deliver(page, await toolResult());
        await expect(view.getByTestId('view-status')).toHaveText('Your notes');
      }
      return { page, view, requests, opened };
    }

    const deliver = (page: Page, result: unknown) => page.evaluate((payload) => window.deliverToolResult?.(payload as never), result);
    const statusLine = (view: FrameLocator, row: number) => view.getByTestId('line-status').nth(row);
    const archiveButton = (view: FrameLocator, row: number) => view.getByRole('button', { name: 'Archive' }).nth(row);
    const release = async (call: Call, index = 0) => {
      await expect.poll(() => environment.held[call].length).toBeGreaterThan(index);
      environment.held[call].splice(index, 1)[0]?.();
    };

    test('serves the built page byte for byte, linked from the result, under a closed policy; the server will not start without the page', async () => {
      const served = await servedResource();
      const result = await toolResult();
      expect((result._meta as { ui: { resourceUri: string } }).ui.resourceUri).toBe(served.uri);
      expect(served.uri).toBe(`ui://sha256/${createHash('sha256').update(bytes).digest('hex')}.html`);
      expect(Buffer.from(served.html, 'utf8').equals(bytes)).toBe(true);
      expect(served.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] });

      // The two operations the view calls are offered to the view only.
      const { tools } = await environment.alice.listTools();
      const visibility = Object.fromEntries(tools.map((tool) => [tool.name, (tool._meta as { ui: { visibility?: string[] } }).ui.visibility]));
      expect(visibility).toEqual({ list_notes: undefined, check_session: ['app'], archive_note: ['app'] });

      // UI artifact first: without the built page no server is built, whatever else is configured.
      for (const missing of ['', '<!doctype html><title>not the notes view</title>']) {
        expect(() => environment.server.createNotesServer({ html: missing, backend: environment.backend })).toThrow(environment.server.ViewArtifactMissing);
      }
    });

    test('shows only the public fields, only to the account that owns them', async ({ page }) => {
      const mine = await toolResult();
      expect(mine.isError).toBeFalsy();
      expect(mine.structuredContent).toEqual({
        notes: [
          { id: 'n-1', title: 'Alpha', body: expect.stringContaining('First **note**') },
          { id: 'n-2', title: 'Beta', body: expect.stringContaining('Second note') },
        ],
      });
      const wire = JSON.stringify(mine);
      for (const secret of [environment.server.CANARY, 'acct-', 'Gamma', 'n-3']) expect(wire, secret).not.toContain(secret);

      const bobs = await toolResult(environment.bob);
      expect((bobs.structuredContent as { notes: { id: string }[] }).notes.map((note) => note.id)).toEqual(['n-3']);
      const nobody = await toolResult(environment.anonymous);
      expect(nobody.isError).toBe(true);
      expect(nobody.content).toEqual([{ type: 'text', text: TEXT.signInRequired }]);
      expect(nobody.structuredContent).toBeUndefined();

      const { view } = await open(page);
      await expect(view.getByTestId('line-title')).toHaveText(['Alpha', 'Beta']);
      const shown = await view.locator('body').innerText();
      for (const secret of [environment.server.CANARY, 'Gamma', 'acct-']) expect(shown, secret).not.toContain(secret);
    });

    test('a result from a server of another build is refused with guidance and renders none of it', async ({ page }) => {
      // The view and its server must be updated together. A server of another build answers with a
      // shape this view's contract does not know (a renamed list, an added field); the view reads
      // nothing from it, shows the repair, and the fields it does recognize do not appear either.
      const { view } = await open(page, { deliver: false });
      const strange = {
        content: [{ type: 'text', text: '2 notes' }],
        structuredContent: { notes: [{ id: 'n-1', title: 'Alpha from another build', body: 'body', privateMemo: 'MEMO-CANARY' }], schemaVersion: 2 },
      };
      await deliver(page, strange);
      await expect(view.getByTestId('view-status')).toHaveText(MISMATCH_TEXT);
      await expect(view.getByTestId('line-title')).toHaveCount(0);
      const shown = await view.locator('body').innerText();
      for (const leaked of ['Alpha from another build', 'MEMO-CANARY']) expect(shown, leaked).not.toContain(leaked);

      // The view is not left broken: a result of its own server's build still shows.
      await deliver(page, await toolResult());
      await expect(view.getByTestId('view-status')).toHaveText('Your notes');
      await expect(view.getByTestId('line-title')).toHaveText(['Alpha', 'Beta']);
    });

    test('shows the body the way the installed catalog provides it, and a hostile body does nothing', async ({ page }) => {
      const { view, requests, opened } = await open(page);
      const body = view.getByTestId('line-body');
      if (consumer !== 'card') {
        // Only the application's own component is installed (in either renderer): the body is text, markup characters included.
        await expect(view.locator('saga-faithful-card')).toHaveCount(0);
        await expect(body.filter({ hasText: 'First **note** with a [link](https://docs.example.com/alpha).' })).toHaveCount(1);
        await expect(view.getByRole('button', { name: /link/ })).toHaveCount(0);
      } else {
        // The optional card is installed and listed in the catalog: Markdown is read, links go to the host.
        await expect(view.locator('saga-faithful-card')).toHaveCount(2);
        await expect(view.locator('saga-faithful-card').first().locator('strong')).toHaveText('note');
        await view.getByRole('button', { name: /link/ }).click();
        await expect.poll(() => opened).toEqual(['https://docs.example.com/alpha']);
        // A refused image is described, not fetched.
        await expect(view.locator('saga-faithful-card').nth(1)).toContainText('tracker');
      }
      // In both consumers the body fetched nothing and drew no image.
      await expect(view.locator('img')).toHaveCount(0);
      await page.waitForTimeout(200);
      expect(requests.filter((url) => url.includes('tracker.example.com'))).toEqual([]);
      expect(requests.filter((url) => !/^(http:\/\/127\.0\.0\.1:4173\/|data:|about:|blob:)/.test(url))).toEqual([]);
    });

    test('runs inside a sandboxed iframe with an opaque origin and refuses network, image and eval under the declared policy', async ({ page }) => {
      const { view } = await open(page);
      await expect(page.locator('iframe[title="MCP App view"]')).toHaveAttribute('sandbox', 'allow-scripts');
      const frame = page.frames().find((one) => one.parentFrame() === page.mainFrame());
      if (!frame) throw new Error('the view has no frame');

      const probe = await frame.evaluate(async () => {
        const violations: string[] = [];
        document.addEventListener('securitypolicyviolation', (event) => void violations.push(event.violatedDirective));
        const network = await fetch('https://tracker.example.com/x').then(
          () => 'allowed',
          () => 'blocked',
        );
        const image = await new Promise<string>((resolve) => {
          const element = new Image();
          element.onload = () => resolve('allowed');
          element.onerror = () => resolve('blocked');
          element.src = 'https://tracker.example.com/pixel.png';
        });
        let script = 'allowed';
        try {
          new Function('return 1')();
        } catch {
          script = 'blocked';
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { origin: location.origin, network, image, script, violations };
      });
      expect(probe).toMatchObject({ origin: 'null', network: 'blocked', image: 'blocked', script: 'blocked' });
      expect(probe.violations).toEqual(expect.arrayContaining(['connect-src', 'img-src']));
      expect(probe.violations.some((directive) => directive.startsWith('script-src'))).toBe(true);

      // What the policy allows still works: the host bridge delivers results, and the view calls the server through it.
      await archiveButton(view, 0).click();
      await expect(statusLine(view, 0)).toHaveText(/^Archived at \d+$/);
    });

    test('one archive definition on two rendered rows keeps each row’s pending state, request and result apart', async ({ page }) => {
      const { view } = await open(page);
      environment.hold.archive = true;

      await archiveButton(view, 0).click();
      await expect.poll(() => environment.held.archive.length).toBe(1);
      await archiveButton(view, 1).click();
      await expect.poll(() => environment.held.archive.length).toBe(2);

      // Prerequisite requests are counted apart from the protected operation, and each press made one of each.
      expect(environment.backend.calls).toMatchObject({ isSignedIn: 2, archive: 2 });
      await expect(view.getByTestId('holds-pending')).toHaveText('n-1,n-2');
      await expect(statusLine(view, 0)).toHaveText('');
      await expect(statusLine(view, 1)).toHaveText('');

      // A pending row ignores a second press; the other row is unaffected by it.
      await archiveButton(view, 0).click();
      await page.waitForTimeout(150);
      expect(environment.backend.calls).toMatchObject({ isSignedIn: 2, archive: 2 });

      // Answer the second row first: only its status changes, and its hold is handed to the application's owner.
      await release('archive', 1);
      await expect(statusLine(view, 1)).toHaveText('Archived at 1001');
      await expect(statusLine(view, 0)).toHaveText('');
      await expect(view.getByTestId('holds-pending')).toHaveText('n-1');
      await expect(view.getByTestId('holds-confirmed')).toHaveText('n-2');

      await release('archive', 0);
      await expect(statusLine(view, 0)).toHaveText('Archived at 1002');
      await expect(view.getByTestId('holds-pending')).toHaveText('');
      await expect(view.getByTestId('holds-confirmed')).toHaveText('n-1,n-2'); // in the order the holds began, not the order the server answered
      expect(environment.backend.archived).toEqual(['n-2', 'n-1']);
    });

    // The Lit app element offers `ingest`; the React page offers no such handle, and its strict
    // control schema is checked on the real React runtime in packages/react (actions.test.ts).
    if (consumer !== 'react') test('a layout that names an action or a handler is refused by the installed catalog, and a press sends nothing', async ({ page }) => {
      // A resource that routed actions by name would need the layout to carry one. The installed
      // control accepts none, so such a layout is rejected whole, before anything is evaluated.
      const { view } = await open(page);
      const named = (control: Record<string, unknown>) => [
        { version: 'v0.9', updateComponents: { surfaceId: 'notes', components: [{ id: 'row-archive', component: 'ActionButton', child: 'row-archive-label', ...control }] } },
      ];
      type Ingest = { ok: boolean; failure?: { message: string } };
      const ingest = (messages: unknown[]) => view.locator('notes-app').evaluate((element, input) => (element as unknown as { ingest(i: unknown): Ingest }).ingest(input), messages);

      const byEvent = await ingest(named({ action: { event: { name: 'archive_note' } } }));
      expect(byEvent.ok).toBe(false);
      expect(byEvent.failure?.message).toContain('action');
      const byHandler = await ingest(named({ handler: 'archive_note' }));
      expect(byHandler.ok).toBe(false);
      expect(byHandler.failure?.message).toContain('handler');
      expect(environment.backend.calls).toMatchObject({ isSignedIn: 0, archive: 0 });
      expect(environment.backend.archived).toEqual([]);
    });

    test('a local action on the same rows sends no request', async ({ page }) => {
      const { view } = await open(page);
      const before = { ...environment.backend.calls };
      await view.getByRole('button', { name: 'Mark read' }).nth(1).click();
      await expect(view.getByTestId('read-log')).toHaveText('n-2');
      await view.getByRole('button', { name: 'Mark read' }).nth(0).click();
      await expect(view.getByTestId('read-log')).toHaveText('n-2,n-1');
      expect(environment.backend.calls).toEqual(before);
    });

    test('an asynchronous session prerequisite refuses before the protected request is sent', async ({ page }) => {
      const { view } = await open(page);
      environment.backend.signedOut.add('acct-alice');
      environment.hold.isSignedIn = true;

      await archiveButton(view, 0).click();
      await expect.poll(() => environment.held.isSignedIn.length).toBe(1);
      // The prerequisite is still undecided: nothing protected has been requested, and the row's hold is already taken.
      expect(environment.backend.calls.archive).toBe(0);
      await expect(view.getByTestId('holds-pending')).toHaveText('n-1');
      await release('isSignedIn');

      await expect(statusLine(view, 0)).toHaveText('Not archived: sign-in-required');
      expect(environment.backend.calls).toMatchObject({ isSignedIn: 1, archive: 0 });
      expect(environment.backend.archived).toEqual([]);
      await expect(view.getByTestId('holds-pending')).toHaveText('');
    });

    test('the server authorizes every protected request itself, whatever the client checked first', async ({ page }) => {
      const { view } = await open(page);
      // The session check passes, then permission is withdrawn: the protected request is still decided on its own.
      environment.backend.revoked.add('acct-alice');
      await archiveButton(view, 0).click();
      await expect(statusLine(view, 0)).toHaveText('The server declined; nothing changed');
      expect(environment.backend.calls).toMatchObject({ isSignedIn: 1, archive: 1 });
      expect(environment.backend.archived).toEqual([]);
      await expect(view.getByTestId('holds-pending')).toHaveText('');
      await expect(view.getByTestId('holds-confirmed')).toHaveText('');

      // Calls that skip the view entirely meet the same decision.
      environment.backend.revoked.clear();
      const archive = (client: Client, noteId: string) => client.callTool({ name: 'archive_note', arguments: { noteId } });
      const absent = await archive(environment.alice, 'n-999');
      const othersNote = await archive(environment.alice, 'n-3');
      for (const refused of [absent, othersNote, await archive(environment.bob, 'n-1')]) {
        expect(refused.isError).toBe(true);
        expect(refused.content).toEqual([{ type: 'text', text: TEXT.cannotArchive }]); // nothing tells absent from not-yours
      }
      const anonymous = await archive(environment.anonymous, 'n-1');
      expect(anonymous.content).toEqual([{ type: 'text', text: TEXT.signInRequired }]);
      // An account named in the arguments is not a way to act as someone.
      const forged = await environment.bob.callTool({ name: 'archive_note', arguments: { noteId: 'n-1', accountId: 'acct-alice' } }).catch(() => ({ isError: true }));
      expect(forged.isError).toBe(true);
      expect(environment.backend.archived).toEqual([]);
    });

    test('a failure that may follow an applied archive stays unknown, while a known refusal says nothing changed', async ({ page }) => {
      const { view } = await open(page);
      // The backend applies the archive, then throws: the server answers with a generic failure.
      environment.fault.failAfterArchive = true;
      await archiveButton(view, 0).click();
      await expect(statusLine(view, 0)).toHaveText('Archive status unknown');
      expect(environment.backend.archived).toEqual(['n-1']); // it was applied, and the view did not claim otherwise
      await expect(view.getByTestId('holds-pending')).toHaveText('');
      await expect(view.getByTestId('holds-confirmed')).toHaveText('');

      // The generic failure carries no no-effect declaration, unlike a refusal.
      environment.fault.failAfterArchive = false;
      const refused = await environment.alice.callTool({ name: 'archive_note', arguments: { noteId: 'n-3' } });
      expect(refused._meta).toMatchObject({ 'pack1/no-effect': true });

      // Known success and a known refusal on the other row are unchanged.
      await archiveButton(view, 1).click();
      await expect(statusLine(view, 1)).toHaveText('Archived at 1002');
      environment.backend.revoked.add('acct-alice');
      await archiveButton(view, 0).click();
      await expect(statusLine(view, 0)).toHaveText('The server declined; nothing changed');
      expect(environment.backend.archived).toEqual(['n-1', 'n-2']);
    });

    test('a late result does not present on another item after the item changes', async ({ page }) => {
      const { view } = await open(page);
      environment.hold.archive = true;
      await archiveButton(view, 0).click();
      await expect.poll(() => environment.held.archive.length).toBe(1);
      await expect(view.getByTestId('holds-pending')).toHaveText('n-1');

      // Row 0 now shows another note.
      await deliver(page, { content: [], structuredContent: { notes: [{ id: 'n-2', title: 'Beta', body: 'Second note' }] } });
      await expect(view.getByTestId('line-title')).toHaveText(['Beta']);
      await expect(view.getByTestId('holds-pending')).toHaveText(''); // the invocation ended, so its hold was given back

      await release('archive');
      await expect.poll(() => environment.backend.archived).toEqual(['n-1']); // the server applied it; the view is not told on another row
      await page.waitForTimeout(200);
      await expect(statusLine(view, 0)).toHaveText('');
      await expect(view.getByTestId('holds-confirmed')).toHaveText('');

      // The row works for its own note.
      environment.hold.archive = false;
      await archiveButton(view, 0).click();
      await expect(statusLine(view, 0)).toHaveText('Archived at 1002');
      expect(environment.backend.archived).toEqual(['n-1', 'n-2']);
    });

    test('disposing the view prevents a late result from presenting anywhere', async ({ page }) => {
      const { view } = await open(page);
      environment.hold.archive = true;
      await archiveButton(view, 0).click();
      await expect.poll(() => environment.held.archive.length).toBe(1);

      await page.evaluate(() => window.teardownView?.());
      await expect(view.getByTestId('view-status')).toHaveText('This view was closed.');
      await expect(view.getByTestId('line-status')).toHaveCount(0);
      await expect(view.getByTestId('holds-pending')).toHaveText('');

      await release('archive');
      await expect.poll(() => environment.backend.archived).toEqual(['n-1']);
      await page.waitForTimeout(200);
      await expect(view.getByText(/Archived at/)).toHaveCount(0);
      await expect(view.getByTestId('holds-confirmed')).toHaveText('');
    });

    test('the page going away ends the application bindings and the connection, and a retained button does nothing', async ({ page }) => {
      const { view } = await open(page);
      const markRead = view.getByRole('button', { name: 'Mark read' }).nth(0);
      const archive = archiveButton(view, 0);
      const retained = await Promise.all([markRead.elementHandle(), archive.elementHandle()]);
      const callsBefore = { ...environment.backend.calls };

      // pagehide, not the host's teardown request: the connection is disposed and the bindings must end with it.
      await view.locator('body').evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await expect(view.getByTestId('view-status')).toHaveText('This view was closed.');
      await expect(view.getByTestId('line-title')).toHaveCount(0);

      // The detached controls that were retained no longer act.
      await Promise.all(retained.map((handle) => handle?.evaluate((button) => (button as HTMLElement).click())));
      await page.waitForTimeout(200);
      await expect(view.getByTestId('read-log')).toHaveText('');
      expect(environment.backend.calls).toEqual(callsBefore);
      expect(environment.backend.archived).toEqual([]);
    });
  });
}
