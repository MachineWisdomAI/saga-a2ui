import { expect, test, type Page } from '@playwright/test';

// The built React consumer (dist/react-action-consumer): a real React 19 root in a real browser,
// `A2uiSurface` from the published @a2ui/react, the application's own catalog (upstream Column,
// Row, List, Text and Button contracts plus the opt-in ActionButton) and the public
// `@saga-a2ui/react/actions` exports. React is the development build and the root is wrapped in
// Strict Mode, as in an application under development. Every assertion goes through what a user
// or the application can observe. This is ACT2's browser qualification of the shared action seam;
// it is not React parity and not evidence for any named host.

const SURFACE = 'actions';

test.beforeEach(async ({ page }) => {
  await page.goto('/react-action-consumer/index.html');
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});

const log = (page: Page) => page.evaluate(() => window.reactActionConsumer.log);
const upstream = (page: Page) =>
  page.evaluate(() => window.reactActionConsumer.upstream);
const send = (page: Page, input: unknown) =>
  page.evaluate((payload) => window.reactActionConsumer.send(payload), input);
const button = (page: Page, label: string) =>
  page.getByRole('button', { name: label, exact: true });
const components = (list: Record<string, unknown>[]) => [
  {
    version: 'v0.9',
    updateComponents: { surfaceId: SURFACE, components: list },
  },
];
const rows = (...ids: string[]) => [
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE,
      path: '/rows',
      value: ids.map((id) => ({ id, title: id.toUpperCase() })),
    },
  },
];
/** The binding phases recorded for one component (and, optionally, one data path). */
const phasesOf = (page: Page, prefix: string) =>
  page.evaluate(
    (p) =>
      window.reactActionConsumer.phases.filter((entry) => entry.startsWith(p)),
    prefix,
  );
const liveBindings = (page: Page, componentId: string) =>
  page.evaluate(
    (id) =>
      window.reactActionConsumer.bindings.filter(
        (b) => b.componentId === id && b.binding.state.phase !== 'disposed',
      ).length,
    componentId,
  );
/** Ids of the bindings that are live now, optionally for one data path. Strict Mode leaves disposed first-pass ones behind. */
const liveIds = (page: Page, componentId: string, dataPath?: string) =>
  page.evaluate(
    ([id, path]) =>
      window.reactActionConsumer.bindings
        .filter(
          (b) =>
            b.componentId === id &&
            (path === undefined || b.dataPath === path) &&
            b.binding.state.phase !== 'disposed',
        )
        .map((b) => b.binding.id),
    [componentId, dataPath] as const,
  );
const totalBindings = (page: Page, componentId: string) =>
  page.evaluate(
    (id) =>
      window.reactActionConsumer.bindings.filter((b) => b.componentId === id)
        .length,
    componentId,
  );

test('records the exact runtime the qualification ran on', async ({
  page,
  browser,
  browserName,
}, testInfo) => {
  const identities = await page.evaluate(
    () => window.reactActionConsumer.identities,
  );
  const recorded = {
    ...identities,
    browser: `${browserName} ${browser.version()}`,
    playwright: testInfo.config.version,
  };
  await testInfo.attach('identities.json', {
    body: JSON.stringify(recorded, null, 2),
    contentType: 'application/json',
  });
  console.log(`react-action-consumer identities: ${JSON.stringify(recorded)}`);

  expect(identities).toMatchObject({
    '@a2ui/react': '0.13.0',
    '@a2ui/web_core': '0.13.0',
    react: '19.3.1',
    'react-dom': '19.3.1',
    reactBuild: 'development',
    runtimeReact: '19.3.1',
    runtimeReactDom: '19.3.1',
  });
  expect(browser.version()).toMatch(/^\d+\./);
});

test.describe('attached, unbound and protocol controls', () => {
  test('a press runs only the definition attached to that control, once', async ({
    page,
  }) => {
    await button(page, 'Save').click();
    expect(await log(page)).toEqual([{ action: 'save' }]);

    await button(page, 'Mark A').click();
    await button(page, 'Mark B').click();
    expect(await log(page)).toEqual([
      { action: 'save' },
      { action: 'mark', componentId: 'mark-a' },
      { action: 'mark', componentId: 'mark-b' },
    ]);
    expect(await upstream(page)).toEqual([]);
  });

  test('an unbound control does nothing and carries no action payload', async ({
    page,
  }) => {
    await button(page, 'Unbound').click();

    expect(await log(page)).toEqual([]);
    expect(await upstream(page)).toEqual([]);
  });

  test('an upstream Button keeps its protocol path and delivers exactly once; an attached press dispatches nothing upstream', async ({
    page,
  }) => {
    await button(page, 'Upstream').click();
    expect(await upstream(page)).toEqual([
      expect.objectContaining({
        name: 'upstream-press',
        sourceComponentId: 'upstream-button',
      }),
    ]);
    expect(await log(page)).toEqual([]);

    await page.evaluate(() => (window.reactActionConsumer.upstream.length = 0));
    await button(page, 'Save').click();
    await button(page, 'Archive').first().click();
    expect(await upstream(page)).toEqual([]);
    expect(await log(page)).toHaveLength(2);
  });

  test('the opt-in control is strict, and a failing check disables it with no invocation', async ({
    page,
  }) => {
    const save = {
      id: 'conflict',
      component: 'ActionButton',
      child: 'save-label',
    };
    const results = [
      await send(
        page,
        components([{ ...save, action: { event: { name: 'save' } } }]),
      ),
      await send(page, components([{ ...save, handler: 'save' }])),
    ];
    expect(results.map((result) => result.ok)).toEqual([false, false]);
    expect(results[0]?.ok === false && results[0].failure.message).toContain(
      'action',
    );
    expect(results[1]?.ok === false && results[1].failure.message).toContain(
      'handler',
    );

    // Rejection leaves the surface usable; the next valid message is accepted.
    const checked = await send(
      page,
      components([
        {
          id: 'save',
          component: 'ActionButton',
          child: 'save-label',
          checks: [
            {
              condition: { call: 'required', args: { value: '' } },
              message: 'Required',
            },
          ],
        },
      ]),
    );
    expect(checked).toEqual({ ok: true });
    await expect(button(page, 'Save')).toBeDisabled();
    await button(page, 'Save').click({ force: true });
    expect(await log(page)).toEqual([]);
  });
});

test.describe('Strict Mode in a browser', () => {
  test('the development build ran setup more than once, and exactly one binding per control is live', async ({
    page,
  }) => {
    // Strict Mode set up, cleaned up and set up again, so a discarded first pass delivered handles too.
    expect(await totalBindings(page, 'save')).toBeGreaterThan(1);
    expect(await liveBindings(page, 'save')).toBe(1);
    expect(await liveBindings(page, 'mark-a')).toBe(1);

    // Handles from the discarded pass cannot bind; the live one is refused only because its slot is taken.
    const outcomes = await page.evaluate(() =>
      window.reactActionConsumer.bindings
        .map((b, index) => ({ componentId: b.componentId, index }))
        .filter((entry) => entry.componentId === 'save')
        .map((entry) => window.reactActionConsumer.bindAgain(entry.index)),
    );
    expect(
      outcomes.filter((outcome) => outcome.includes('is stale')),
    ).toHaveLength(outcomes.length - 1);
    expect(outcomes.filter((outcome) => !outcome.includes('is stale'))).toEqual(
      [expect.stringContaining('already has a live binding')],
    );

    await button(page, 'Save').click();
    expect(await log(page)).toEqual([{ action: 'save' }]);
  });
});

test.describe('data scopes', () => {
  test('repeated component IDs: each row acts on its own data, and getById refuses the ambiguity', async ({
    page,
  }) => {
    const archive = button(page, 'Archive');
    await expect(archive).toHaveCount(2);

    await archive.nth(1).click();
    await archive.nth(0).click();

    expect(await log(page)).toEqual([
      { action: 'archive-note', noteId: 'n-2', at: '/rows/1' },
      { action: 'archive-note', noteId: 'n-1', at: '/rows/0' },
    ]);
    const [ambiguous, missing, unique] = await page.evaluate(() =>
      ['row-archive', 'nothing-here', 'save'].map((id) =>
        window.reactActionConsumer.getById(id),
      ),
    );
    expect(ambiguous).toMatch(/2 rendered instances.*'row-archive'/);
    expect(missing).toMatch(/'nothing-here'/);
    expect(unique).toBe('ok');
  });

  test('a row that appears later is bound once; replacing the item at a position keeps its binding and changes the next input', async ({
    page,
  }) => {
    const first = await liveIds(page, 'row-archive', '/rows/0');
    expect(first).toHaveLength(1);
    expect(await liveIds(page, 'row-archive')).toHaveLength(2);

    await send(page, rows('n-1', 'n-2', 'n-3'));
    await expect(button(page, 'Archive')).toHaveCount(3);
    expect(await liveIds(page, 'row-archive')).toHaveLength(3);
    expect(await liveIds(page, 'row-archive', '/rows/2')).toHaveLength(1);
    await button(page, 'Archive').nth(2).click();
    expect(await log(page)).toEqual([
      { action: 'archive-note', noteId: 'n-3', at: '/rows/2' },
    ]);

    const before = await liveIds(page, 'row-archive');
    const totalBefore = await totalBindings(page, 'row-archive');
    await send(page, rows('n-9', 'n-2', 'n-3'));
    await expect(page.getByText('N-9')).toBeVisible();
    await button(page, 'Archive').first().click();
    expect((await log(page)).at(-1)).toEqual({
      action: 'archive-note',
      noteId: 'n-9',
      at: '/rows/0',
    });
    // The same instances and bindings serve the new item: nothing was re-delivered or rebound.
    expect(await liveIds(page, 'row-archive')).toEqual(before);
    expect(await totalBindings(page, 'row-archive')).toBe(totalBefore);
    expect(await liveIds(page, 'row-archive', '/rows/0')).toEqual(first);
  });

  test('a row that disappears has its binding disposed and nothing else is touched', async ({
    page,
  }) => {
    const survivor = await liveIds(page, 'row-archive', '/rows/0');
    expect(survivor).toHaveLength(1);
    expect(await liveIds(page, 'row-archive', '/rows/1')).toHaveLength(1);

    await send(page, rows('n-1'));
    await expect(button(page, 'Archive')).toHaveCount(1);

    expect(await liveIds(page, 'row-archive', '/rows/1')).toEqual([]);
    expect((await phasesOf(page, 'row-archive|/rows/1|')).at(-1)).toMatch(
      /\|disposed$/,
    );
    expect(await liveIds(page, 'row-archive', '/rows/0')).toEqual(survivor);
    await button(page, 'Archive').click();
    expect(await log(page)).toEqual([
      { action: 'archive-note', noteId: 'n-1', at: '/rows/0' },
    ]);
  });
});

test.describe('replacement and cleanup', () => {
  test('a replaced control retires synchronously, before React updates the screen; its stale handle and button do nothing', async ({
    page,
  }) => {
    const index = await page.evaluate(() =>
      window.reactActionConsumer.bindings.findIndex(
        (b) => b.componentId === 'save' && b.binding.state.phase !== 'disposed',
      ),
    );
    const oldButton = await button(page, 'Save').elementHandle();

    // One synchronous task: the resolver disposes the node while the old element is still in the document.
    const gap = await page.evaluate(
      ([i, replacement]) => {
        const consumer = window.reactActionConsumer;
        const element = [...document.querySelectorAll('button')].find(
          (candidate) => candidate.textContent === 'Save',
        );
        const ingested = consumer.send(replacement);
        return {
          ingested,
          phase: consumer.bindings[i!]!.binding.state.phase,
          stillInDocument: element?.isConnected,
          bindAgain: consumer.bindAgain(i!),
        };
      },
      [
        index,
        components([
          { id: 'save', component: 'Column', children: ['save-label'] },
        ]),
      ] as const,
    );
    expect(gap.ingested).toEqual({ ok: true });
    expect(gap.phase).toBe('disposed');
    expect(gap.stillInDocument).toBe(true);
    expect(gap.bindAgain).toMatch(/is stale/);

    await expect(button(page, 'Save')).toHaveCount(0);
    await oldButton?.evaluate((element: HTMLElement) => element.click());
    expect(await log(page)).toEqual([]);

    // The same ID rendered again is a new instance: it starts unbound until discovery delivers it, then runs once.
    await send(
      page,
      components([
        { id: 'save', component: 'ActionButton', child: 'save-label' },
      ]),
    );
    await expect(button(page, 'Save')).toBeVisible();
    await button(page, 'Save').click();
    expect(await log(page)).toEqual([{ action: 'save' }]);
    expect(
      await page.evaluate(
        (i) => window.reactActionConsumer.bindAgain(i),
        index,
      ),
    ).toMatch(/is stale/);
  });

  test('swapping the surface retires the old instances; the registration binds the new ones', async ({
    page,
  }) => {
    const oldButton = await button(page, 'Save').elementHandle();
    const liveBefore = await liveBindings(page, 'save');
    expect(liveBefore).toBe(1);

    await page.evaluate(() => window.reactActionConsumer.newSurface());
    await expect(button(page, 'Save')).toBeVisible();

    expect(await oldButton?.evaluate((element) => element.isConnected)).toBe(
      false,
    );
    expect(await liveBindings(page, 'save')).toBe(1);
    await button(page, 'Save').click();
    expect(await log(page)).toEqual([{ action: 'save' }]);
  });

  test('unmounting disposes every binding and ends the setup view; mounting again starts fresh', async ({
    page,
  }) => {
    const oldIds = await page.evaluate(() =>
      window.reactActionConsumer.bindings.map((b) => b.binding.id),
    );
    expect(oldIds.length).toBeGreaterThan(0);

    await page.evaluate(() => window.reactActionConsumer.unmount());
    await expect(button(page, 'Save')).toHaveCount(0);

    const after = await page.evaluate(() => ({
      phases: window.reactActionConsumer.bindings.map(
        (b) => b.binding.state.phase,
      ),
      ended: window.reactActionConsumer.getById('save'),
    }));
    expect(after.phases.every((phase) => phase === 'disposed')).toBe(true);
    expect(after.ended).toMatch(/has ended/);

    await page.evaluate(() => window.reactActionConsumer.mount());
    await expect(button(page, 'Save')).toBeVisible();
    await button(page, 'Save').click();
    expect(await log(page)).toEqual([{ action: 'save' }]);
    const freshIds = await page.evaluate(() =>
      window.reactActionConsumer.bindings
        .filter((b) => b.binding.state.phase !== 'disposed')
        .map((b) => b.binding.id),
    );
    expect(freshIds.length).toBeGreaterThan(0);
    expect(freshIds.some((id) => oldIds.includes(id))).toBe(false);
  });
});

test.describe('failure', () => {
  test('a setup that throws is reported, leaves nothing bound and reaches the error boundary; a later mount recovers', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.reactActionConsumer.failSetup = true;
      window.reactActionConsumer.unmount();
      window.reactActionConsumer.mount();
    });

    await expect(page.getByTestId('failure')).toContainText(
      'could not be attached',
    );
    // The error goes to the application's sink and the boundary, not into the page.
    await expect(page.getByTestId('failure')).not.toContainText('on purpose');
    expect(
      await page.evaluate(() =>
        window.reactActionConsumer.setupErrors.map((e) =>
          e.replace(/^Error: /, ''),
        ),
      ),
    ).toContain('setup failed on purpose');
    expect(
      await page.evaluate(() => window.reactActionConsumer.caught.length),
    ).toBeGreaterThan(0);
    await expect(button(page, 'Save')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.reactActionConsumer.bindings.every(
          (b) => b.binding.state.phase === 'disposed',
        ),
      ),
    ).toBe(true);

    await page.evaluate(() => {
      window.reactActionConsumer.unmount();
      window.reactActionConsumer.mount();
    });
    await expect(page.getByTestId('failure')).toHaveCount(0);
    await button(page, 'Save').click();
    expect(await log(page)).toEqual([{ action: 'save' }]);
  });

  test('a discovery callback that throws loses only its own bindings and is reported without disturbing the tree', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.reactActionConsumer.failDiscovery = 'mark-a';
      window.reactActionConsumer.unmount();
      window.reactActionConsumer.mount();
    });
    await expect(button(page, 'Mark A')).toBeVisible();

    expect(
      await page.evaluate(() =>
        window.reactActionConsumer.setupErrors.map(String),
      ),
    ).toContain('Error: callback failed');
    await expect(page.getByTestId('failure')).toHaveCount(0);
    await button(page, 'Mark A').click();
    await button(page, 'Mark B').click();
    expect(await log(page)).toEqual([
      { action: 'mark', componentId: 'mark-b' },
    ]);
  });
});
