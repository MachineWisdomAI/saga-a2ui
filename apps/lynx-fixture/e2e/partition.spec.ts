import { expect, test } from '@playwright/test';
import { builtBundle, contains, readTemplate } from './bundle.js';
import { Fixture } from './fixture.js';
import { ordersLayout } from './messages.js';

// Where code lives and where it runs. The Lynx Web target runs the background thread in a Web
// Worker and the main thread in a same-origin iframe realm of the `<lynx-view>`.

test.describe('bundle partition', () => {
  // Read when a test runs, never while Playwright imports this file: test discovery must not
  // depend on a generated bundle, so a fresh checkout can list its tests before `npm run build`.
  let cached: ReturnType<typeof readTemplate> | undefined;
  const loadTemplate = (): ReturnType<typeof readTemplate> => (cached ??= readTemplate(builtBundle));

  test('the template has one background chunk and one main-thread chunk', () => {
    const template = loadTemplate();
    expect(Object.keys(template.background)).toEqual(['/app-service.js']);
    expect(Object.keys(template.mainThread)).toEqual(['root']);
    expect(template.configuration['cardType']).toBe('react');
  });

  test("a 'background only' function body is removed from the main-thread chunk; ordinary module code is in both", () => {
    const template = loadTemplate();
    // Removed by the compiler from the main-thread layer.
    expect({
      setupBodyInBackground: contains(template.background, 'SAGA_MARKER_SETUP_BODY'),
      setupBodyInMainThread: contains(template.mainThread, 'SAGA_MARKER_SETUP_BODY'),
    }).toEqual({ setupBodyInBackground: true, setupBodyInMainThread: false });

    // Observed, not required: module-scope code is shipped to both layers. The shared runtime, the
    // adapter and the definitions are present in the main-thread chunk as code. Whether they run
    // there is a different question, answered by the runtime test below.
    expect({
      definitionInBackground: contains(template.background, 'SAGA_MARKER_DEFINITION_SUBMIT'),
      definitionInMainThread: contains(template.mainThread, 'SAGA_MARKER_DEFINITION_SUBMIT'),
      runtimeInBackground: contains(template.background, 'already has a live binding'),
      runtimeInMainThread: contains(template.mainThread, 'already has a live binding'),
      adapterInBackground: contains(template.background, 'ActionControlView'),
      adapterInMainThread: contains(template.mainThread, 'ActionControlView'),
    }).toEqual({
      definitionInBackground: true,
      definitionInMainThread: true,
      runtimeInBackground: true,
      runtimeInMainThread: true,
      adapterInBackground: true,
      adapterInMainThread: true,
    });
  });
});

test.describe('where the code runs', () => {
  test('the background thread is a worker; the main thread rendered an inert control and nothing more', async ({ page }) => {
    const fixture = await Fixture.open(page);

    // The first screen rendered the control on the main thread; only the background effect opened it.
    await fixture.untilLive('first-screen-control@/');
    expect(await fixture.send('fire-current', { label: 'first-screen-control@/' })).toEqual({ outcome: 'unbound' });
    const main = await page.evaluate(() => {
      const frame = document.querySelector('lynx-view')?.shadowRoot?.querySelector('iframe');
      return (frame?.contentWindow as unknown as { __sagaMainThread?: Record<string, number> } | null)?.__sagaMainThread ?? null;
    });
    // On the main thread: the root and the control rendered and an inert slot was constructed. No
    // token was captured (the first render is unbound), nothing opened or closed there.
    expect(main?.['roots']).toBeGreaterThan(0);
    expect(main?.['renders']).toBeGreaterThan(0);
    expect(main?.['slotsConstructed']).toBeGreaterThan(0);
    expect(main).toMatchObject({ tokensCaptured: 0, opens: 0, closes: 0 });

    await fixture.push(...ordersLayout);
    await fixture.untilLive('cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/');
    const facts = await fixture.send<Record<string, unknown>>('runtime-facts');
    expect(facts).toMatchObject({ background: true, mainThread: false, typeofDocument: 'undefined', typeofWindow: 'undefined', selfIsWorker: true });
    expect(page.workers().map((worker) => worker.url()).some((url) => url.includes('web-core-worker-chunk'))).toBe(true);

    // After the messages arrived, every further render ran in the background: the main-thread
    // counters, read from the main thread's own realm by the page (no bridge in application code),
    // did not move. `<A2UI>` builds its surfaces from messages in a background effect, and the main
    // thread only applies the resulting element operations.
    const after = await page.evaluate(() => {
      const frame = document.querySelector('lynx-view')?.shadowRoot?.querySelector('iframe');
      return (frame?.contentWindow as unknown as { __sagaMainThread?: Record<string, number> } | null)?.__sagaMainThread ?? null;
    });
    expect(after).toEqual(main);
  });

  test('input extraction and the handler both run in the background event call stack', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive('cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/');
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);
    const phases = (await fixture.records()).filter((record) => record.ev === 'input' || record.ev === 'invoke');
    expect(phases.map((record) => [record.ev, record['background']])).toEqual([
      ['input', true],
      ['invoke', true],
    ]);
  });
});

test.describe('cancellation primitive', () => {
  test('AbortController exists in the background runtime and delivers abort once', async ({ page }) => {
    const fixture = await Fixture.open(page);
    const facts = await fixture.send<Record<string, unknown>>('runtime-facts');
    expect(facts).toMatchObject({
      typeofAbortController: 'function',
      typeofAbortSignal: 'function',
      abortSignalAborted: true,
      abortEventsDelivered: 1,
      abortReasonName: 'AbortError',
    });
  });

  // A separate fact: a network API honors the signal. This request is never answered, so the only
  // way it can end is the abort, and the server reports whether its connection was dropped.
  test('fetch in the background runtime honors the signal and drops the connection', async ({ page, request }) => {
    const fixture = await Fixture.open(page);
    const facts = await fixture.send<Record<string, unknown>>('runtime-facts');
    expect(facts['typeofFetch']).toBe('function');

    const origin = new URL(page.url()).origin;
    const result = await fixture.send<{ outcome: string; signalAborted: boolean; elapsedMs: number }>('abort-fetch', { url: `${origin}/slow`, afterMs: 150 });
    expect(result).toMatchObject({ outcome: 'AbortError', signalAborted: true });
    expect(result.elapsedMs).toBeLessThan(5000);

    await expect
      .poll(async () => (await (await request.get('/__slow-state')).json()) as { opened: number; closedBeforeAnswer: number })
      .toEqual({ opened: 1, closedBeforeAnswer: 1 });
  });
});

test.describe('event-turn environment tagging', () => {
  // UNRESOLVED BY DESIGN. No mechanism has been selected, so none is checked. This only records
  // why one is needed: a built definition carries no record of the environment its callbacks were
  // written for, so nothing at bind time could tell a background callback from a main-thread one.
  test('a definition value carries no environment marker (mechanism still unselected)', async ({ page }) => {
    const fixture = await Fixture.open(page);
    const shape = await fixture.send<{ definitionKeys: string[]; planKeys: string[]; frozen: boolean }>('definition-shape');
    expect(shape.definitionKeys).toEqual(['label', 'plan']);
    // What a definition carries grows with the module (prerequisites, limits, hooks); none of it
    // names an environment, thread or bundle, which is what a bind-time check would need.
    expect(shape.planKeys).toContain('label');
    expect(shape.planKeys.filter((key) => /environment|thread|background|main|bundle|runtime/i.test(key))).toEqual([]);
    expect(shape.frozen).toBe(true);
  });
});
