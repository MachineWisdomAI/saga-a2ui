import { expect, test, type Page } from '@playwright/test';

// VIEW2: the view lifecycle through the public Lit adapter, on the built synthetic consumer
// (dist/action-consumer). The page wraps the sessions its app elements create only to count how
// they are released; every assertion is about what the page shows, what the application's
// callables did, or the state the application's own bindings report. Local Chromium through
// Playwright is not an actual host.

const SURFACE = 'actions';

const app = (page: Page, name: 'one' | 'two') => page.locator(`[data-app="${name}"]`);
const buttons = (page: Page, name: 'one' | 'two', label: string) => app(page, name).getByRole('button', { name: label });
const log = (page: Page) => page.evaluate(() => window.actionConsumer.log);
const send = (page: Page, name: string, input: unknown) =>
  page.evaluate(([target, payload]) => window.actionConsumer.send(target as string, payload), [name, input] as const);
const sessions = (page: Page, name: string) => page.evaluate((target) => ({ ...window.actionConsumer.sessions[target]! }), name);
const rows = (...ids: string[]) => [
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE, path: '/rows', value: ids.map((id) => ({ id, title: id.toUpperCase() })) } },
];

test.describe('the default scenario', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/action-consumer/index.html');
    await expect(buttons(page, 'one', 'Save')).toBeVisible();
    await expect(buttons(page, 'two', 'Save')).toBeVisible();
  });

  test('each connect creates one session; each disconnect releases that session and the element\'s listeners exactly once', async ({ page }) => {
    expect(await sessions(page, 'one')).toEqual({ created: 1, disposed: 0, listeners: 2 });

    const element = await app(page, 'one').elementHandle();
    await element?.evaluate((node) => node.remove());
    expect(await sessions(page, 'one')).toEqual({ created: 1, disposed: 1, listeners: 0 });

    await page.evaluate((node) => document.querySelector('#one')?.append(node), element);
    await expect(buttons(page, 'one', 'Save')).toBeVisible();
    expect(await sessions(page, 'one')).toEqual({ created: 2, disposed: 1, listeners: 2 });

    await element?.evaluate((node) => node.remove());
    expect(await sessions(page, 'one')).toEqual({ created: 2, disposed: 2, listeners: 0 });
    expect(await sessions(page, 'two')).toEqual({ created: 1, disposed: 0, listeners: 2 }); // the other mount is untouched
  });

  test('input to the retired session or to the disconnected element cannot revive content, and the fresh instance shows only its own', async ({ page }) => {
    const element = await app(page, 'one').elementHandle();
    await element?.evaluate((node) => node.remove());

    const whileDisconnected = await element?.evaluate(
      (node, input) => (node as HTMLElement & { ingest(i: unknown): unknown }).ingest(input),
      rows('n-late'),
    );
    expect(whileDisconnected).toMatchObject({ ok: false });

    await page.evaluate((node) => document.querySelector('#one')?.append(node), element);
    await expect(buttons(page, 'one', 'Save')).toBeVisible();
    await expect(app(page, 'one').getByTestId('failure')).toHaveCount(0); // the refused late input left no stale fallback

    // A late result for the retired session, delivered after the fresh one is showing.
    await page.evaluate((input) => {
      window.actionConsumer.sessionHistory.one![0]!.ingest(input);
    }, rows('n-late'));
    await expect(app(page, 'one').getByText('Alpha')).toBeVisible();
    await expect(app(page, 'one').getByText('N-LATE')).toHaveCount(0);

    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
  });

  test('a control moved within the mount is retired where it left and bound once where it arrives', async ({ page }) => {
    const save = app(page, 'one').locator('saga-action-button').filter({ hasText: 'Save' });
    const before = await page.evaluate(() => window.actionConsumer.bindings.filter((b) => b.app === 'one' && b.componentId === 'save').map((b) => b.binding.id));
    expect(before.length).toBe(1);

    await save.evaluate((node) => node.parentElement?.append(node));

    await expect
      .poll(() =>
        page.evaluate(() => window.actionConsumer.bindings.filter((b) => b.app === 'one' && b.componentId === 'save').map((b) => b.binding.state.phase)),
      )
      .toEqual(['disposed', 'idle']);
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
  });

  test('a discovery callback that throws loses only its own binding; the error reaches the sink and the surface stays', async ({ page }) => {
    await page.evaluate(() => (window.actionConsumer.throwOnDiscoveryAt = '/rows/2'));
    await send(page, 'one', rows('n-1', 'n-2', 'n-3'));
    await expect(buttons(page, 'one', 'Archive')).toHaveCount(3);

    expect(await page.evaluate(() => window.actionConsumer.setupErrors)).toEqual(['Error: discovery failed at /rows/2']);
    await expect(app(page, 'one').getByTestId('failure')).toHaveCount(0);
    await buttons(page, 'one', 'Archive').nth(2).click(); // its binding was disposed with the callback
    await buttons(page, 'one', 'Archive').nth(1).click();
    await buttons(page, 'two', 'Save').click();
    expect(await log(page)).toEqual([
      { app: 'one', action: 'archive-note', noteId: 'n-2', at: '/rows/1' },
      { app: 'two', action: 'save' },
    ]);
  });
});

test.describe('the async scenario', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/action-consumer/index.html?scenario=async');
    await expect(buttons(page, 'one', 'Save draft')).toBeVisible();
    await expect(buttons(page, 'one', 'Stage')).toHaveCount(2);
  });

  test('a rejection while work is pending cancels it, the late answer starts nothing, and valid input recovers with a fresh binding', async ({ page }) => {
    await buttons(page, 'one', 'Save draft').click();
    expect(await page.evaluate(() => window.actionConsumer.pendingSessions.length)).toBe(1);

    const rejected = await send(page, 'one', [
      { version: 'v0.9', updateComponents: { surfaceId: SURFACE, components: [{ id: 'extra', component: 'NotInTheCatalog' }] } },
    ]);
    expect(rejected).toMatchObject({ ok: false });
    await expect(app(page, 'one').getByTestId('failure')).toBeVisible();

    await page.evaluate(() => window.actionConsumer.pendingSessions.shift()?.('signed-in'));
    expect((await log(page)).map((entry) => entry.action)).toEqual(['save-draft-canceled']);
    expect(await page.evaluate(() => window.actionConsumer.bindings.filter((b) => b.app === 'one').map((b) => b.binding.state.phase))).not.toContain('running');

    const recovered = await send(page, 'one', [
      { version: 'v0.9', updateComponents: { surfaceId: SURFACE, components: [{ id: 'save-draft-label', component: 'Text', text: 'Save draft' }] } },
    ]);
    expect(recovered).toEqual({ ok: true });
    await expect(buttons(page, 'one', 'Save draft')).toBeVisible();
    await buttons(page, 'one', 'Save draft').click();
    await page.evaluate(() => window.actionConsumer.pendingSessions.shift()?.('signed-in'));
    await expect.poll(() => log(page).then((entries) => entries.map((entry) => entry.action))).toEqual(['save-draft-canceled', 'save-draft']);
  });
});
