import { expect, test, type Page } from '@playwright/test';

// ACT6 on the built Lit consumer (dist/action-consumer, `?scenario=server`): the Archive server
// action from the Blueprint, with two rows that render one component id, an upstream protocol
// Button in the same surface, and a transport, prerequisites and success work that the spec
// answers one at a time. The real Lit adapter, the real data model and real DOM clicks. Protected-
// operation requests (the transport) and prerequisite requests are counted apart. Local Chromium
// through Playwright is not an actual host, and nothing here shows a server stopped or rolled back.

const SURFACE = 'actions';

test.beforeEach(async ({ page }) => {
  await page.goto('/action-consumer/index.html?scenario=server');
  await expect(archiveButtons(page)).toHaveCount(2);
});

const app = (page: Page) => page.locator('[data-app="one"]');
const archiveButtons = (page: Page) => app(page).getByRole('button', { name: 'Archive' });
const alpha = (page: Page) => archiveButtons(page).nth(0);
const beta = (page: Page) => archiveButtons(page).nth(1);
const line = (page: Page, noteId: string) => page.locator(`[data-note="one:${noteId}"]`);
const requestCount = (page: Page) => page.evaluate(() => window.actionConsumer.archive.one?.requests.length ?? 0);
const counts = (page: Page) => page.evaluate(() => ({ ...window.actionConsumer.archive.one?.counts }));
const heldSessions = (page: Page) => page.evaluate(() => window.actionConsumer.archive.one?.heldSessions.length ?? 0);
const requestInfo = (page: Page, index: number) =>
  page.evaluate((i) => {
    const request = window.actionConsumer.archive.one?.requests[i];
    return request === undefined ? undefined : { noteId: request.noteId, toolName: request.toolName, timeout: request.timeout, aborted: request.aborted() };
  }, index);
const answerOk = (page: Page, index = 0) =>
  page.evaluate((i) => window.actionConsumer.archive.one?.requests[i]?.answer({ content: [], structuredContent: { archivedAt: 7 } }), index);
const answerToolError = (page: Page, index = 0) =>
  page.evaluate((i) => window.actionConsumer.archive.one?.requests[i]?.answer({ content: [], isError: true }), index);
const rejectRequest = (page: Page, message: string, index = 0) =>
  page.evaluate(([i, text]) => window.actionConsumer.archive.one?.requests[i as number]?.reject(text as string), [index, message] as const);
const setLab = (page: Page, change: Partial<Window['actionConsumer']['archive'][string]>) =>
  page.evaluate((given) => void Object.assign(window.actionConsumer.archive.one ?? {}, given), change);
const phases = (page: Page) =>
  page.evaluate(() => window.actionConsumer.phases.filter((entry) => entry.startsWith('one|row-archive|')).map((entry) => entry.split('|').at(-1)));
const upstream = (page: Page) => page.evaluate(() => window.actionConsumer.upstream.length);
const shown = (page: Page) =>
  page.evaluate(() => (window.actionConsumer.archive.one?.shown ?? []).map((entry) => `${entry.noteId}:${entry.kind}`));

test.describe('the Archive server action on repeated rows', () => {
  test('archives the note each row shows from its own data scope, one protected request per activation', async ({ page }) => {
    await beta(page).click();
    await expect.poll(() => requestCount(page)).toBe(1);

    const first = await requestInfo(page, 0);
    expect(first).toMatchObject({ noteId: 'n-2', toolName: 'archive_note', aborted: false });
    // The request carries what is left of the 30 s work deadline, never more.
    expect(first?.timeout).toBeGreaterThan(0);
    expect(first?.timeout).toBeLessThanOrEqual(30_000);
    // Each prerequisite ran once for this activation and is counted apart from the protected request.
    expect(await counts(page)).toMatchObject({ sessions: 1, confirms: 1, audits: 1, records: 0 });

    await answerOk(page);
    await expect(line(page, 'n-2')).toHaveText('Archived at 7');
    await expect(line(page, 'n-1')).toHaveCount(0); // the other row, with the same component id, was not touched
    expect(await shown(page)).toEqual(['n-2:archived']);

    await alpha(page).click();
    await expect.poll(() => requestCount(page)).toBe(2);
    expect((await requestInfo(page, 1))?.noteId).toBe('n-1');
    await answerOk(page, 1);
    await expect(line(page, 'n-1')).toHaveText('Archived at 7');
    expect(await requestCount(page)).toBe(2);
    // Each row's binding followed its own phases.
    expect(await phases(page)).toEqual(['running', 'settling', 'idle', 'running', 'settling', 'idle']);
  });

  test('reaches the callable once per activation even though the surface also dispatches upstream protocol actions', async ({ page }) => {
    await app(page).getByRole('button', { name: 'Upstream' }).click();
    await expect.poll(() => upstream(page)).toBe(1);
    // The upstream path is another purpose: it neither starts the callable nor is dropped.
    expect(await requestCount(page)).toBe(0);
    expect((await counts(page)).sessions).toBe(0);

    await alpha(page).click();
    await alpha(page).click(); // busy under the default `ignore`: no second invocation
    await expect.poll(() => requestCount(page)).toBe(1);
    expect(await upstream(page)).toBe(1); // the direct attachment did not become an upstream action
    expect((await counts(page)).sessions).toBe(1);
    await answerOk(page);
    await expect(line(page, 'n-1')).toHaveText('Archived at 7');
    expect(await requestCount(page)).toBe(1);

    // A protocol action on the bound control is rejected whole, so no second path can reach the callable.
    const rejected = await page.evaluate(
      (surface) =>
        window.actionConsumer.send('one', [
          {
            version: 'v0.9',
            updateComponents: {
              surfaceId: surface,
              components: [{ id: 'row-archive', component: 'ActionButton', child: 'row-archive-label', action: { event: { name: 'upstream-press' } } }],
            },
          },
        ]),
      SURFACE,
    );
    expect(rejected?.ok).toBe(false);
    expect(await requestCount(page)).toBe(1); // the rejection started nothing
  });
});

test.describe('what stops the protected request before it is sent', () => {
  test('a refusing session prerequisite sends none, and the message says only that none was sent', async ({ page }) => {
    await setLab(page, { signedIn: false });
    await alpha(page).click();

    await expect(line(page, 'n-1')).toHaveText('No archive request was sent (session: sign-in-required)');
    expect(await requestCount(page)).toBe(0);
    // The session check made its own request; the later prerequisites never ran.
    expect(await counts(page)).toMatchObject({ sessions: 1, confirms: 0, audits: 0 });
  });

  test('cancellation while a prerequisite is pending sends none, even after the prerequisite later answers', async ({ page }) => {
    await setLab(page, { holdSession: true });
    await alpha(page).click();
    await expect.poll(() => heldSessions(page)).toBe(1);

    await app(page).evaluate((element) => element.remove()); // the surface and its bindings are retired
    await page.evaluate(() => window.actionConsumer.archive.one?.releaseSession());
    await page.waitForTimeout(100);

    expect(await requestCount(page)).toBe(0);
    expect(await counts(page)).toMatchObject({ sessions: 1, confirms: 0, audits: 0 });
  });

  test('a row that now shows another note sends nothing for the old one', async ({ page }) => {
    await setLab(page, { holdSession: true });
    await alpha(page).click();
    await expect.poll(() => heldSessions(page)).toBe(1);

    await page.evaluate(
      (surface) =>
        window.actionConsumer.send('one', [{ version: 'v0.9', updateDataModel: { surfaceId: surface, path: '/rows/0', value: { id: 'n-9', title: 'Gamma' } } }]),
      SURFACE,
    );
    await page.evaluate(() => window.actionConsumer.archive.one?.releaseSession());
    await page.waitForTimeout(100);

    expect(await requestCount(page)).toBe(0);
    expect(await shown(page)).toEqual(['n-1:not-sent']);
    await expect(line(page, 'n-9')).toHaveCount(0);
  });
});

test.describe('how the request ends', () => {
  test('a returned tool-level failure is declined, and a rejected transport leaves the effect unknown without inviting a retry', async ({ page }) => {
    await alpha(page).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    await answerToolError(page);
    await expect(line(page, 'n-1')).toHaveText('The server declined the request');

    await beta(page).click();
    await expect.poll(() => requestCount(page)).toBe(2);
    await rejectRequest(page, 'connection lost', 1);
    await expect(line(page, 'n-2')).toHaveText('The archive status is unknown');
    await expect(line(page, 'n-2')).not.toContainText(/retry|try again/i);

    const retries = await page.evaluate(() =>
      (window.actionConsumer.archive.one?.shown ?? []).map((entry) => `${entry.kind}:${String(entry.retry)}`),
    );
    expect(retries).toEqual(['declined:true', 'status-unknown:false']);
    expect(await requestCount(page)).toBe(2); // no automatic retry
  });

  test('keeps the archived result when the required client work fails, and sends nothing again', async ({ page }) => {
    await setLab(page, { failRecord: true });
    await alpha(page).click();
    await expect.poll(() => requestCount(page)).toBe(1);
    await answerOk(page);

    await expect(line(page, 'n-1')).toHaveText('Archived at 7, but this view could not be updated');
    expect(await requestCount(page)).toBe(1);
    expect((await counts(page)).records).toBe(1);
  });

  test('retiring the surface after the request was sent aborts the client’s wait and claims nothing about the server', async ({ page }) => {
    await alpha(page).click();
    await expect.poll(() => requestCount(page)).toBe(1);

    await app(page).evaluate((element) => element.remove());
    await expect.poll(async () => (await requestInfo(page, 0))?.aborted).toBe(true);

    // The late answer is dropped: nothing is archived on screen, and no further request exists.
    await answerOk(page);
    await page.waitForTimeout(100);
    expect(await shown(page)).not.toContain('n-1:archived');
    expect(await requestCount(page)).toBe(1);
  });
});
