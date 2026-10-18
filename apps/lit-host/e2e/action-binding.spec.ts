import { expect, test, type Page } from '@playwright/test';

// The built synthetic consumer (dist/action-consumer): its own catalog with upstream Column, Row,
// List, Text and Button plus the opt-in ActionButton, and two app elements ("one" and "two").
// Layout carries only IDs and types; application setup attaches the actions to the rendered
// instances. Every assertion goes through what a user or the application can observe.

test.beforeEach(async ({ page }) => {
  await page.goto('/action-consumer/index.html');
  await expect(page.locator('[data-app="one"]').getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(page.locator('[data-app="two"]').getByRole('button', { name: 'Save' })).toBeVisible();
});

const app = (page: Page, name: 'one' | 'two') => page.locator(`[data-app="${name}"]`);
const log = (page: Page) => page.evaluate(() => window.actionConsumer.log);
const send = (page: Page, name: string, input: unknown) =>
  page.evaluate(([target, payload]) => window.actionConsumer.send(target as string, payload), [name, input] as const);

const SURFACE = 'actions';
const components = (list: Record<string, unknown>[]) => [
  { version: 'v0.9', updateComponents: { surfaceId: SURFACE, components: list } },
];

test('pressing a control runs its attached callable once, and only that app\'s', async ({ page }) => {
  await app(page, 'one').getByRole('button', { name: 'Save' }).click();

  expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
});

test('the control carries no action payload and an unbound control does nothing when pressed', async ({ page }) => {
  await app(page, 'one').getByRole('button', { name: 'Unbound' }).click();

  expect(await log(page)).toEqual([]);
  expect(await page.evaluate(() => window.actionConsumer.upstream)).toEqual([]);
});

test('a synchronous invocation is idle again before the event handler returns', async ({ page }) => {
  const control = app(page, 'one').locator('saga-action-button').filter({ hasText: 'Toggle details' });

  const sequence = await control.evaluate((host) => {
    const phases = window.actionConsumer.phases;
    const before = phases.length;
    host.shadowRoot?.querySelector('button')?.click(); // one synchronous dispatch; nothing awaited before the reads below
    const entry = window.actionConsumer.bindings.find((b) => b.app === 'one' && b.componentId === 'details-toggle');
    return { phases: phases.slice(before), now: entry?.binding.state.phase };
  });

  expect(sequence.now).toBe('idle');
  expect(sequence.phases.map((entry) => entry.split('|').at(-1))).toEqual(['running', 'settling', 'idle']);
  expect(await log(page)).toEqual([{ app: 'one', action: 'toggle-details' }]);
});

test('two controls sharing one definition keep separate binding state', async ({ page }) => {
  const before = (await page.evaluate(() => window.actionConsumer.phases)).length;
  await app(page, 'one').getByRole('button', { name: 'Mark A' }).click();

  const changed = (await page.evaluate(() => window.actionConsumer.phases)).slice(before);
  expect(changed.every((entry) => entry.startsWith('one|mark-a|'))).toBe(true);
  expect(await log(page)).toEqual([{ app: 'one', action: 'mark', componentId: 'mark-a' }]);

  await app(page, 'one').getByRole('button', { name: 'Mark B' }).click();
  expect(await log(page)).toEqual([
    { app: 'one', action: 'mark', componentId: 'mark-a' },
    { app: 'one', action: 'mark', componentId: 'mark-b' },
  ]);
  const ids = await page.evaluate(() =>
    window.actionConsumer.bindings.filter((b) => b.app === 'one' && b.componentId.startsWith('mark-')).map((b) => b.binding.id),
  );
  expect(new Set(ids).size).toBe(2);
});

test('repeated component IDs: each row acts on its own data, and getById refuses the ambiguity', async ({ page }) => {
  const rows = app(page, 'one').getByRole('button', { name: 'Archive' });
  await expect(rows).toHaveCount(2);

  await rows.nth(1).click();
  await rows.nth(0).click();

  expect(await log(page)).toEqual([
    { app: 'one', action: 'archive-note', noteId: 'n-2', at: '/rows/1' },
    { app: 'one', action: 'archive-note', noteId: 'n-1', at: '/rows/0' },
  ]);
  const [ambiguous, missing, unique] = await page.evaluate(() =>
    ['row-archive', 'nothing-here', 'save'].map((id) => window.actionConsumer.getById('one', id)),
  );
  expect(ambiguous).toMatch(/2 rendered instances.*'row-archive'/);
  expect(missing).toMatch(/'nothing-here'/);
  expect(unique).toBe('ok');
});

const phasesOf = (page: Page, prefix: string) =>
  page.evaluate((p) => window.actionConsumer.phases.filter((entry) => entry.startsWith(p)), prefix);
const buttons = (page: Page, name: 'one' | 'two', label: string) => app(page, name).getByRole('button', { name: label });

test('on the default surface path the control element has no node and is not wrapped by one', async ({ page }) => {
  const nodes = await app(page, 'one')
    .locator('saga-action-button')
    .evaluateAll((elements) => elements.map((element) => (element as unknown as { node?: unknown }).node));

  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes.every((node) => node === undefined)).toBe(true);
});

test.describe('upstream behavior is unrelated to the attached actions', () => {
  test('an upstream Button keeps its protocol path and delivers exactly once', async ({ page }) => {
    await buttons(page, 'one', 'Upstream').click();

    expect(await page.evaluate(() => window.actionConsumer.upstream)).toEqual([
      { app: 'one', action: expect.objectContaining({ name: 'upstream-press', sourceComponentId: 'upstream-button' }) },
    ]);
    expect(await log(page)).toEqual([]);
  });

  test('pressing an attached control dispatches no upstream action', async ({ page }) => {
    await buttons(page, 'one', 'Save').click();
    await buttons(page, 'one', 'Archive').first().click();

    expect(await page.evaluate(() => window.actionConsumer.upstream)).toEqual([]);
    expect(await log(page)).toHaveLength(2);
  });
});

test.describe('the opt-in control is strict', () => {
  const save = { id: 'conflict', component: 'ActionButton', child: 'save-label' };

  test('rejects an upstream action, a function call or a handler name before anything is evaluated', async ({ page }) => {
    // Control: the function is reachable through an upstream Button, so a count of zero below means something.
    const upstreamButton = { id: 'upstream-button', component: 'Button', child: 'upstream-label' };
    await send(page, 'one', components([{ ...upstreamButton, action: { functionCall: { call: 'spy', args: {} } } }]));
    await buttons(page, 'one', 'Upstream').click();
    expect(await page.evaluate(() => window.actionConsumer.spyCalls)).toBe(1);
    await page.evaluate(() => (window.actionConsumer.spyCalls = 0));

    const results = [
      await send(page, 'one', components([{ ...save, action: { functionCall: { call: 'spy', args: {} } } }])),
      await send(page, 'one', components([{ ...save, action: { event: { name: 'save' } } }])),
      await send(page, 'one', components([{ ...save, handler: 'save' }])),
    ];

    expect(results.map((result) => result?.ok)).toEqual([false, false, false]);
    for (const [result, property] of [
      [results[0], 'action'],
      [results[1], 'action'],
      [results[2], 'handler'],
    ] as const) {
      expect(result?.ok === false && result.failure.message).toContain(property);
    }
    expect(await page.evaluate(() => window.actionConsumer.spyCalls)).toBe(0);
    expect(await page.evaluate(() => window.actionConsumer.upstream)).toEqual([]);
  });

  test('a failing check disables the control and no invocation starts', async ({ page }) => {
    const result = await send(
      page,
      'one',
      components([
        {
          id: 'save',
          component: 'ActionButton',
          child: 'save-label',
          checks: [{ condition: { call: 'required', args: { value: '' } }, message: 'Required' }],
        },
      ]),
    );
    expect(result).toEqual({ ok: true });

    await expect(buttons(page, 'one', 'Save')).toBeDisabled();
    await buttons(page, 'one', 'Save').click({ force: true });
    expect(await log(page)).toEqual([]);
  });
});

test.describe('discovery and later instances', () => {
  const rows = (...ids: string[]) => [
    {
      version: 'v0.9',
      updateDataModel: { surfaceId: SURFACE, path: '/rows', value: ids.map((id) => ({ id, title: id.toUpperCase() })) },
    },
  ];

  test('a row that appears later is discovered and bound once; existing rows keep their bindings', async ({ page }) => {
    const before = await page.evaluate(() => window.actionConsumer.bindings.length);

    await send(page, 'one', rows('n-1', 'n-2', 'n-3'));
    await expect(buttons(page, 'one', 'Archive')).toHaveCount(3);

    expect(await page.evaluate(() => window.actionConsumer.bindings.length)).toBe(before + 1);
    await buttons(page, 'one', 'Archive').nth(2).click();
    expect(await log(page)).toEqual([{ app: 'one', action: 'archive-note', noteId: 'n-3', at: '/rows/2' }]);
  });

  test('replacing the item at a position changes the input of the next press without rebinding', async ({ page }) => {
    const before = await page.evaluate(() => window.actionConsumer.bindings.length);

    await send(page, 'one', rows('n-9', 'n-2'));
    await expect(app(page, 'one').getByText('N-9')).toBeVisible();
    await buttons(page, 'one', 'Archive').first().click();

    expect(await log(page)).toEqual([{ app: 'one', action: 'archive-note', noteId: 'n-9', at: '/rows/0' }]);
    expect(await page.evaluate(() => window.actionConsumer.bindings.length)).toBe(before);
  });

  test('a row that disappears has its binding disposed and nothing else is touched', async ({ page }) => {
    await send(page, 'one', rows('n-1'));
    await expect(buttons(page, 'one', 'Archive')).toHaveCount(1);

    expect(await phasesOf(page, 'one|row-archive|/rows/1|')).toEqual([expect.stringMatching(/\|disposed$/)]);
    expect(await phasesOf(page, 'one|row-archive|/rows/0|')).toEqual([]);
  });

  test('unsubscribing discovery disposes nothing; it only stops delivering later instances', async ({ page }) => {
    await page.evaluate(() => window.actionConsumer.stopDiscovery('one'));
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);

    await send(page, 'one', rows('n-1', 'n-2', 'n-3'));
    await expect(buttons(page, 'one', 'Archive')).toHaveCount(3);
    await buttons(page, 'one', 'Archive').nth(2).click(); // discovered by nobody: inert
    await buttons(page, 'one', 'Archive').nth(0).click(); // bound before discovery stopped: still works
    expect(await log(page)).toEqual([
      { app: 'one', action: 'save' },
      { app: 'one', action: 'archive-note', noteId: 'n-1', at: '/rows/0' },
    ]);
  });
});

test.describe('binding lifetime', () => {
  const indexOf = (page: Page, app: string, componentId: string) =>
    page.evaluate(
      ([a, c]) => window.actionConsumer.bindings.findIndex((b) => b.app === a && b.componentId === c),
      [app, componentId] as const,
    );

  test('dispose is idempotent, detaches only its own installation, and the same live handle can bind again', async ({ page }) => {
    const index = await indexOf(page, 'one', 'save');
    await page.evaluate((i) => {
      const entry = window.actionConsumer.bindings[i]!;
      entry.binding.dispose();
      entry.binding.dispose();
    }, index);
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([]);

    expect(await page.evaluate((i) => window.actionConsumer.bindAgain(i), index)).toBe('ok');
    expect(await page.evaluate((i) => window.actionConsumer.bindAgain(i), index)).toMatch(/already has a live binding/);
    // The first binding's cleanup running late must not detach its successor.
    await page.evaluate((i) => window.actionConsumer.bindings[i]!.binding.dispose(), index);
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([{ app: 'one', action: 'probe', componentId: 'save' }]);
  });

  test('a subscriber that disposes the binding on running stops the handler, and every listener sees disposed once', async ({ page }) => {
    const index = await indexOf(page, 'one', 'save');

    const control = app(page, 'one').locator('saga-action-button').filter({ hasText: 'Save' });
    const observed = await control.evaluate((host, i) => {
      const entry = window.actionConsumer.bindings[i]!;
      const seen: string[] = [];
      entry.binding.subscribe(() => {
        if (entry.binding.state.phase === 'running') entry.binding.dispose();
      });
      entry.binding.subscribe(() => seen.push(entry.binding.state.phase));
      host.shadowRoot?.querySelector('button')?.click(); // one synchronous dispatch; nothing awaited
      const disposedNotifications = window.actionConsumer.phases.filter(
        (phase) => phase.includes(`|${entry.binding.id}|`) && phase.endsWith('|disposed'),
      ).length;
      return { seen, state: entry.binding.state.phase, disposedNotifications };
    }, index);

    expect(observed).toEqual({ seen: ['disposed'], state: 'disposed', disposedNotifications: 1 });
    expect(await log(page)).toEqual([]);
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([]);
  });

  test('in the gap between model replacement and renderer cleanup, the old handle cannot bind and nothing is discovered', async ({ page }) => {
    const index = await indexOf(page, 'one', 'save');

    const gap = await page.evaluate(
      ([i, replacement]) => {
        window.actionConsumer.bindings[i]!.binding.dispose();
        const ingested = window.actionConsumer.send('one', replacement); // synchronous: the old model is gone, its element is not yet cleaned up
        return {
          ingested,
          bindAgain: window.actionConsumer.bindAgain(i),
          getById: window.actionConsumer.getById('one', 'save'),
        };
      },
      [index, components([{ id: 'save', component: 'Row', children: ['save-label'] }])] as const,
    );

    expect(gap.ingested).toEqual({ ok: true });
    expect(gap.bindAgain).toMatch(/stale/);
    expect(gap.getById).toMatch(/No rendered instance/);

    // The later fresh instance binds normally, and a press reaches only its own callable.
    await send(page, 'one', components([{ id: 'save', component: 'ActionButton', child: 'save-label' }]));
    await expect(buttons(page, 'one', 'Save')).toBeVisible();
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
    expect(await page.evaluate(() => window.actionConsumer.bindings.filter((b) => b.app === 'one' && b.componentId === 'save').length)).toBe(2);
  });

  test('a replaced component retires its binding; its stale handle and a stale button event do nothing', async ({ page }) => {
    const index = await indexOf(page, 'one', 'save');
    const oldButton = await app(page, 'one')
      .locator('saga-action-button')
      .filter({ hasText: 'Save' })
      .evaluateHandle((host) => host.shadowRoot?.querySelector('button') as HTMLButtonElement);

    await send(page, 'one', components([{ id: 'save', component: 'Text', text: 'Plain text now' }]));
    await expect(buttons(page, 'one', 'Save')).toHaveCount(0);
    expect((await phasesOf(page, 'one|save|')).at(-1)).toMatch(/\|disposed$/);

    await oldButton.evaluate((button: HTMLButtonElement) => button.click());
    expect(await log(page)).toEqual([]);
    expect(await page.evaluate((i) => window.actionConsumer.bindAgain(i), index)).toMatch(/stale/);

    await send(page, 'one', components([{ id: 'save', component: 'ActionButton', child: 'save-label' }]));
    await expect(buttons(page, 'one', 'Save')).toBeVisible();
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
    expect(await page.evaluate((i) => window.actionConsumer.bindAgain(i), index)).toMatch(/stale/);
    expect(await page.evaluate(() => window.actionConsumer.bindings.filter((b) => b.app === 'one' && b.componentId === 'save').length)).toBe(2);
  });
});

test.describe('each mount owns its host, bindings and subscriptions', () => {
  test('two mounts invoke only their own callables', async ({ page }) => {
    await buttons(page, 'two', 'Save').click();
    await buttons(page, 'one', 'Save').click();

    expect(await log(page)).toEqual([
      { app: 'two', action: 'save' },
      { app: 'one', action: 'save' },
    ]);
  });

  for (const placement of ['outside any app element', 'inside the owner\'s own shadow tree'] as const) {
    test(`a second <a2ui-surface> for the same model stays unbound (${placement})`, async ({ page }) => {
      const before = await page.evaluate(() => window.actionConsumer.bindings.length);
      await page.evaluate((where) => {
        const raw = document.createElement('a2ui-surface') as HTMLElement & { surface?: unknown };
        raw.id = 'raw-mount';
        raw.surface = window.actionConsumer.surfaces.one;
        const owner = document.querySelector('[data-app="one"]');
        (where === 'outside any app element' ? document.body : owner?.shadowRoot)?.append(raw);
      }, placement);
      const raw = page.locator('#raw-mount');
      await expect(raw.getByRole('button', { name: 'Save' })).toBeVisible();

      await raw.getByRole('button', { name: 'Save' }).click();
      await raw.getByRole('button', { name: 'Archive' }).first().click();

      expect(await log(page)).toEqual([]);
      expect(await page.evaluate(() => window.actionConsumer.bindings.length)).toBe(before);
      await buttons(page, 'one', 'Save').first().click(); // the managed mount is unaffected
      expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
    });
  }

  test('disconnect retires every binding of that mount only; reconnecting starts fresh', async ({ page }) => {
    const handle = await app(page, 'one').elementHandle();
    const oldIds = await page.evaluate(() =>
      window.actionConsumer.bindings.filter((b) => b.app === 'one').map((b) => b.binding.id),
    );
    await handle?.evaluate((element) => element.remove());

    const states = await page.evaluate(() =>
      window.actionConsumer.bindings.filter((b) => b.app === 'one').map((b) => b.binding.state.phase),
    );
    expect(states.length).toBe(oldIds.length);
    expect(states.every((phase) => phase === 'disposed')).toBe(true);
    await buttons(page, 'two', 'Save').click();
    expect(await log(page)).toEqual([{ app: 'two', action: 'save' }]);

    await page.evaluate((element) => document.querySelector('#one')?.append(element), handle);
    await expect(buttons(page, 'one', 'Save')).toBeVisible();
    await buttons(page, 'one', 'Save').click();

    expect(await page.evaluate(() => window.actionConsumer.attachCalls.one)).toBe(2);
    const freshIds = await page.evaluate(() =>
      window.actionConsumer.bindings.filter((b) => b.app === 'one' && b.binding.state.phase !== 'disposed').map((b) => b.binding.id),
    );
    expect(freshIds.length).toBeGreaterThan(0);
    expect(freshIds.some((id) => oldIds.includes(id))).toBe(false);
    expect(await log(page)).toEqual([
      { app: 'two', action: 'save' },
      { app: 'one', action: 'save' },
    ]);
  });

  test('deleting the surface retires its bindings; creating it again attaches fresh', async ({ page }) => {
    await send(page, 'one', [{ version: 'v0.9', deleteSurface: { surfaceId: SURFACE } }]);
    await expect(buttons(page, 'one', 'Save')).toHaveCount(0);
    const states = await page.evaluate(() =>
      window.actionConsumer.bindings.filter((b) => b.app === 'one').map((b) => b.binding.state.phase),
    );
    expect(states.every((phase) => phase === 'disposed')).toBe(true);

    await send(page, 'one', await page.evaluate(() => window.actionConsumer.layout()));
    await expect(buttons(page, 'one', 'Save')).toBeVisible();
    await buttons(page, 'one', 'Save').click();

    expect(await page.evaluate(() => window.actionConsumer.attachCalls.one)).toBe(2);
    expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
  });

  test('a setup that fails shows the fallback with nothing bound, and a later surface recovers', async ({ page }) => {
    await page.evaluate(() => (window.actionConsumer.failSetupFor = 'one'));
    await send(page, 'one', [
      { version: 'v0.9', deleteSurface: { surfaceId: SURFACE } },
      ...(await page.evaluate(() => window.actionConsumer.layout())),
    ]);

    await expect(app(page, 'one').getByTestId('failure')).toContainText('could not be attached');
    // The error itself goes to the application's sink and not into the page.
    expect(await page.evaluate(() => window.actionConsumer.setupErrors)).toEqual(['Error: setup failed on purpose']);
    await expect(app(page, 'one').getByTestId('failure')).not.toContainText('on purpose');
    await expect(buttons(page, 'one', 'Save')).toHaveCount(0);
    await buttons(page, 'two', 'Save').click(); // the other mount is unaffected
    expect(await log(page)).toEqual([{ app: 'two', action: 'save' }]);

    await send(page, 'one', [
      { version: 'v0.9', deleteSurface: { surfaceId: SURFACE } },
      ...(await page.evaluate(() => window.actionConsumer.layout())),
    ]);
    await expect(app(page, 'one').getByTestId('failure')).toHaveCount(0);
    await buttons(page, 'one', 'Save').click();
    expect(await log(page)).toEqual([
      { app: 'two', action: 'save' },
      { app: 'one', action: 'save' },
    ]);
  });
});

test('session rejection and recovery are preserved, and the controls bind again once without a second setup', async ({ page }) => {
  const rejected = await send(page, 'one', components([{ id: 'extra', component: 'NotInTheCatalog' }]));
  expect(rejected).toMatchObject({ ok: false, failure: { kind: 'rejected' } });
  await expect(app(page, 'one').getByTestId('failure')).toBeVisible();
  await expect(buttons(page, 'one', 'Save')).toHaveCount(0);

  const recovered = await send(page, 'one', components([{ id: 'save-label', component: 'Text', text: 'Save' }]));
  expect(recovered).toEqual({ ok: true });
  await expect(buttons(page, 'one', 'Save')).toBeVisible();
  await buttons(page, 'one', 'Save').click();

  expect(await log(page)).toEqual([{ app: 'one', action: 'save' }]);
  expect(await page.evaluate(() => window.actionConsumer.attachCalls.one)).toBe(1);
});
