import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test';

// CARD2 on the built Lit pages (dist/card-workflow): two instances of the CARD1 composition in one
// document, with different trusted content policies. Each instance is a separate A2UI surface with its
// own view (policy, host callback, consent scope), its own Archive environment and its own binding of
// the authored Archive control to its own rendered instances. The spec answers every prerequisite and
// protected request itself, observes the network and each host callback where they happen, and then
// interleaves: it updates one description and ends one instance while the other is mid-request. Local
// Chromium through Playwright is not an actual host.
//
// Consent keeps its one owner (the view's image-consent scope); source and consent controls are the
// card's, the Archive control is the application's, and neither stands in for the other. The client's
// content policy and a reader's consent never replace the server's authorization.

const IMAGE_HOST = 'images.example.com';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
const GUIDE = 'https://docs.example.com/guide';

let requests: string[] = [];

test.beforeEach(async ({ page }) => {
  requests = [];
  await page.route(/^https:\/\//, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, contentType: 'image/svg+xml', body: SVG });
  });
  await page.goto('/card-workflow/index.html');
  await expect(cardContent(page, 'one', 0)).toHaveText('Alpha description.');
  await page.evaluate((host) => void window.cardInstances.add('two', { level: 'standard', imageHosts: [host] }), IMAGE_HOST);
  await expect(cardContent(page, 'two', 0)).toHaveText('Alpha description.');
});

type Name = 'one' | 'two';
const imageRequests = () => requests.filter((url) => new URL(url).pathname.endsWith('.png'));
const root = (page: Page, name: Name): Locator => page.locator(name === 'one' ? '#one' : '#inst-two');
const app = (page: Page, name: Name): Locator => root(page, name).locator(name === 'one' ? 'episodes-app' : 'episodes-app-two');
const card = (page: Page, name: Name, row: number): Locator => app(page, name).locator('saga-faithful-card-content').nth(row);
const cardContent = (page: Page, name: Name, row: number): Locator => card(page, name, row).getByTestId('card-content');
const archiveButton = (page: Page, name: Name, row: number): Locator => app(page, name).getByRole('button', { name: 'Archive', exact: true }).nth(row);
const line = (page: Page, name: Name, noteId: string): Locator => root(page, name).locator(`[data-note="${noteId}"]`);

const requestCount = (page: Page, name: Name) =>
  page.evaluate((n) => {
    const workflow = window.cardInstances.get(n);
    if (!workflow) throw new Error(`no instance ${n}`);
    return workflow.archive.requests.length;
  }, name);
const requestInfo = (page: Page, name: Name, index: number) =>
  page.evaluate(
    ([n, i]) => {
      const request = window.cardInstances.get(n as string)?.archive.requests[i as number];
      return request === undefined ? undefined : { noteId: request.noteId, aborted: request.aborted() };
    },
    [name, index] as const,
  );
const answerOk = (page: Page, name: Name, index = 0) =>
  page.evaluate(([n, i]) => window.cardInstances.get(n as string)?.archive.requests[i as number]?.answer({ content: [], structuredContent: { archivedAt: 7 } }), [name, index] as const);
const counts = (page: Page, name: Name) => page.evaluate((n) => ({ ...window.cardInstances.get(n)?.archive.counts }), name);
const linkCalls = (page: Page, name: Name) => page.evaluate((n) => [...(window.cardInstances.get(n)?.linkCalls ?? [])], name);
const attached = (page: Page, name: Name) => page.evaluate((n) => window.cardInstances.get(n)?.setup.attached, name);
const upstreamActions = (page: Page, name: Name) => page.evaluate((n) => window.cardInstances.get(n)?.upstream.length, name);
const setRow = (page: Page, name: Name, row: number, field: string, value: unknown) =>
  page.evaluate(
    ([n, index, key, given]) =>
      window.cardInstances.get(n as string)?.send([{ version: 'v0.9', updateDataModel: { surfaceId: 'episodes', path: `/rows/${index as number}/${key as string}`, value: given } }]),
    [name, row, field, value] as const,
  );
const press = (handle: ElementHandle | null) => handle?.evaluate((button) => (button as HTMLElement).click());
const chart = (name: string) => `Chart ![${name}](https://${IMAGE_HOST}/${name}.png) and [the guide](${GUIDE})`;

test.describe('each instance binds the authored control to its own rendered instances', () => {
  test('pressing Archive in either surface reaches only that surface\'s protected environment, for the row the press came from', async ({ page }) => {
    expect(await attached(page, 'one')).toBe(1);
    expect(await attached(page, 'two')).toBe(1);

    await archiveButton(page, 'one', 1).click();
    await expect.poll(() => requestCount(page, 'one')).toBe(1);
    expect(await requestInfo(page, 'one', 0)).toMatchObject({ noteId: 'n-2', aborted: false });
    expect(await requestCount(page, 'two')).toBe(0);
    expect(await counts(page, 'two')).toEqual({ sessions: 0, confirms: 0, audits: 0, records: 0 });

    await archiveButton(page, 'two', 0).click();
    await expect.poll(() => requestCount(page, 'two')).toBe(1);
    expect(await requestInfo(page, 'two', 0)).toMatchObject({ noteId: 'n-1', aborted: false });
    expect(await requestCount(page, 'one')).toBe(1);

    await answerOk(page, 'two');
    await expect(line(page, 'two', 'n-1')).toHaveText('Archived at 7');
    await expect(line(page, 'one', 'n-1')).toHaveCount(0);
    await expect(line(page, 'one', 'n-2')).toHaveCount(0);
    await answerOk(page, 'one');
    await expect(line(page, 'one', 'n-2')).toHaveText('Archived at 7');
    expect(await upstreamActions(page, 'one')).toBe(0);
    expect(await upstreamActions(page, 'two')).toBe(0);
  });
});

test.describe('interleaving: one description updated, one instance ended', () => {
  test('consent, callbacks, pending work and kept controls stay with their own instance and cannot revive anything', async ({ page }) => {
    await setRow(page, 'one', 0, 'description', chart('one-a'));
    await setRow(page, 'one', 1, 'description', chart('one-b'));
    await setRow(page, 'two', 0, 'description', chart('two-a'));

    // Standard loads its listed image and opens its link through its own callback; Strict needs the reader's consent.
    await expect(card(page, 'two', 0).getByTestId('md-image')).toHaveCount(1);
    await expect(card(page, 'one', 0).getByTestId('md-image')).toHaveCount(0);
    await card(page, 'two', 0).getByRole('button', { name: /the guide/ }).click();
    await expect.poll(() => linkCalls(page, 'two')).toEqual([GUIDE]);
    expect(await linkCalls(page, 'one')).toEqual([]);
    await card(page, 'one', 0).getByRole('button', { name: 'Show images' }).click();
    await expect(card(page, 'one', 0).getByTestId('md-image')).toHaveCount(1);
    await expect.poll(imageRequests).toEqual([`https://${IMAGE_HOST}/two-a.png`, `https://${IMAGE_HOST}/one-a.png`]);

    // Both instances are mid-request, each through its own environment.
    await archiveButton(page, 'one', 0).click();
    await archiveButton(page, 'two', 0).click();
    await expect.poll(() => requestCount(page, 'one')).toBe(1);
    await expect.poll(() => requestCount(page, 'two')).toBe(1);

    // Keep controls that will be left behind: Strict row 1's Show images and instance one's Archive button.
    const keptShowImages = await card(page, 'one', 1).getByRole('button', { name: 'Show images' }).elementHandle();
    const keptHide = await card(page, 'one', 0).getByRole('button', { name: 'Hide images' }).elementHandle();
    const keptArchive = await archiveButton(page, 'one', 0).elementHandle();

    // Update one description in instance one to text with nothing to consent to. Its consent ends and its controls leave;
    // its pending archive is another thing's business, and instance two is untouched.
    await setRow(page, 'one', 0, 'description', 'One, updated: plain text.');
    await expect(cardContent(page, 'one', 0)).toHaveText('One, updated: plain text.');
    await expect(card(page, 'one', 0).getByTestId('md-image')).toHaveCount(0);
    expect((await requestInfo(page, 'one', 0))?.aborted).toBe(false);
    expect((await requestInfo(page, 'two', 0))?.aborted).toBe(false);
    await expect(card(page, 'two', 0).getByTestId('md-image')).toHaveCount(1);
    await press(keptHide); // a control of the old render
    await expect(cardContent(page, 'one', 0)).toHaveText('One, updated: plain text.');
    expect(imageRequests().length).toBe(2);

    // End instance one. Its work is cancelled by its own cleanup, nothing of it is reachable, and two goes on.
    const held = await app(page, 'one').elementHandle();
    await page.evaluate(() => document.querySelector('episodes-app')?.remove());
    await expect(app(page, 'one')).toHaveCount(0);
    await expect.poll(async () => (await requestInfo(page, 'one', 0))?.aborted).toBe(true);
    await expect(line(page, 'one', 'n-1')).toHaveText('The archive status is unknown');
    expect((await requestInfo(page, 'two', 0))?.aborted).toBe(false);

    const before = { requests: await requestCount(page, 'one'), counts: await counts(page, 'one'), images: imageRequests().length };
    await press(keptShowImages);
    await press(keptArchive);
    await page.waitForTimeout(150);
    expect(await requestCount(page, 'one')).toBe(before.requests);
    expect(await counts(page, 'one')).toEqual(before.counts);
    expect(imageRequests().length).toBe(before.images);
    expect(await linkCalls(page, 'one')).toEqual([]);

    // Instance two is exactly as it was: its image, its pending request, its callback and its own control.
    await expect(card(page, 'two', 0).getByTestId('md-image')).toHaveCount(1);
    await answerOk(page, 'two');
    await expect(line(page, 'two', 'n-1')).toHaveText('Archived at 7');
    await card(page, 'two', 0).getByRole('button', { name: /the guide/ }).click();
    await expect.poll(() => linkCalls(page, 'two')).toEqual([GUIDE, GUIDE]);
    await archiveButton(page, 'two', 1).click();
    await expect.poll(() => requestCount(page, 'two')).toBe(2);
    expect((await requestInfo(page, 'two', 1))?.noteId).toBe('n-2');

    // Putting instance one back starts a new presentation from its own initial surface, with its own setup and no consent or text from before; kept controls stay dead.
    await page.evaluate((element) => document.querySelector('#one')?.prepend(element as Element), held);
    await expect(cardContent(page, 'one', 1)).toHaveText('Beta description.'); // a fresh session: nothing that was set before comes back
    await expect(cardContent(page, 'one', 0)).toHaveText('Alpha description.');
    await expect(app(page, 'one')).not.toContainText('One, updated');
    expect(await attached(page, 'one')).toBe(2);
    await expect(app(page, 'one').getByTestId('md-image')).toHaveCount(0);
    await press(keptShowImages);
    await press(keptArchive);
    await press(keptHide);
    await page.waitForTimeout(150);
    await expect(app(page, 'one').getByTestId('md-image')).toHaveCount(0);
    expect(await requestCount(page, 'one')).toBe(before.requests);
    expect(imageRequests().length).toBe(before.images);
    await archiveButton(page, 'one', 1).click();
    await expect.poll(() => requestCount(page, 'one')).toBe(before.requests + 1);
    expect((await requestInfo(page, 'one', before.requests))?.noteId).toBe('n-2');
  });
});

test.describe('the card\'s controls and the authored control are different things', () => {
  test('source and consent controls send no protected request, and the Archive control changes no content setting', async ({ page }) => {
    await setRow(page, 'one', 0, 'description', chart('strict-a'));
    const view = card(page, 'one', 0);
    await view.getByRole('button', { name: 'Reveal source' }).click();
    await view.getByRole('button', { name: 'Show images' }).click();
    await expect(view.getByTestId('md-image')).toHaveCount(1);
    await view.getByRole('button', { name: 'Hide images' }).click();
    await page.waitForTimeout(100);
    expect(await requestCount(page, 'one')).toBe(0);
    expect(await counts(page, 'one')).toEqual({ sessions: 0, confirms: 0, audits: 0, records: 0 });

    // The authored control sends its request without touching the card's reveal or consent.
    await view.getByRole('button', { name: 'Show images' }).click();
    await archiveButton(page, 'one', 0).click();
    await expect.poll(() => requestCount(page, 'one')).toBe(1);
    await expect(view.getByTestId('md-image')).toHaveCount(1);
    await expect(view.getByRole('button', { name: 'Hide source' })).toBeVisible();
    // The set of buttons is the card's two controls and the application's Archive control, nothing from the text.
    await expect(app(page, 'one').getByRole('button', { name: 'Archive', exact: true })).toHaveCount(2);
    await expect(view.locator('[data-testid="card-content"] button, [data-testid="card-content"] a')).toHaveCount(0);
  });

  test('the server\'s decision stands apart from the client\'s: a Standard card with a listed image and a link does not authorize Archive, and a Strict card without consent does not block it', async ({ page }) => {
    await setRow(page, 'two', 0, 'description', chart('standard-a'));
    await setRow(page, 'one', 0, 'description', chart('strict-b'));
    await expect(card(page, 'two', 0).getByTestId('md-image')).toHaveCount(1);
    await card(page, 'two', 0).getByRole('button', { name: /the guide/ }).click();
    await expect.poll(() => linkCalls(page, 'two')).toEqual([GUIDE]);

    // Instance two's session is signed out: everything the card shows still works, but no protected request is sent.
    await page.evaluate(() => void (window.cardInstances.get('two')!.archive.signedIn = false));
    await archiveButton(page, 'two', 0).click();
    await expect(line(page, 'two', 'n-1')).toHaveText('No archive request was sent (session: sign-in-required)');
    expect(await requestCount(page, 'two')).toBe(0);
    await expect(card(page, 'two', 0).getByTestId('md-image')).toHaveCount(1);

    // Instance one's reader has not consented to any image, yet its authorized control acts.
    await expect(card(page, 'one', 0).getByTestId('md-image')).toHaveCount(0);
    await archiveButton(page, 'one', 0).click();
    await expect.poll(() => requestCount(page, 'one')).toBe(1);
    expect(await requestInfo(page, 'one', 0)).toMatchObject({ noteId: 'n-1', aborted: false });
    expect(imageRequests().map((url) => new URL(url).pathname)).toEqual(['/standard-a.png']);
  });
});
