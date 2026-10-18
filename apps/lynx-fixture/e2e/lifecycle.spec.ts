import { expect, test } from '@playwright/test';
import { Fixture } from './fixture.js';
import { longListLayout, notesLayout, ORDERS, ordersLayout, text, updateComponents } from './messages.js';

// Keyed session reset, unmount, and scrolling, on the real renderer. Measuring native removal
// against cleanup does not prevent a stale presentation write; the approved contract is that a
// hook's presentation write goes to a target keyed by item identity, never to a handle on a view.

const FIXED = ['cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/'] as const;
// A new mount shows `<A2UI>`'s empty state, which this fixture renders as one inert control.
const EMPTY_STATE = ['first-screen-control@/'];

test.describe('keyed session reset', () => {
  test('a new session closes every instance, disposes every binding and starts unbound until its own setup runs', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive(...FIXED);
    await fixture.send('capture-tap', { label: 'submit-order@/', name: 'old-session' });
    const first = (await fixture.state()).generation;

    const reset = await fixture.send<{ generation: number }>('reset');
    expect(reset.generation).toBe(first + 1);

    // The old mount unmounted: its instances closed (their bindings were disposed by retirement),
    // and the old closure is refused. The new mount has no surface until messages arrive.
    await fixture.untilLive(...EMPTY_STATE);
    expect(await fixture.send('fire-captured', { name: 'old-session' })).toEqual({ outcome: 'stale' });
    expect((await fixture.recordsOf('binding-state')).filter((record) => record['label'] === 'submit-order@/').map((record) => record['phase'])).toContain('disposed');

    // The new session's setup ran against its own host and binds fresh instances.
    await fixture.push(...ordersLayout);
    await fixture.untilLive(...FIXED);
    await fixture.tap('submit-order');
    expect((await fixture.untilInvocations(1))[0]).toMatchObject({ definition: 'submit-order', item: 'order-1' });
    // Still refused: the closure belongs to the previous installation, whatever the item shows.
    expect(await fixture.send('fire-captured', { name: 'old-session' })).toEqual({ outcome: 'stale' });
    await fixture.stillInvocations(1);
  });

  test('replacing the store without changing the key is not a reset: nothing closes and the old surface stays', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive(...FIXED);
    // `store.clear()` empties the buffer but leaves the processor's surfaces and mounted bindings.
    await fixture.send('clear-store');
    await page.waitForTimeout(300);
    expect((await fixture.state()).instances.filter((instance) => instance.live).map((instance) => instance.label).sort()).toEqual([...FIXED].sort());
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);
  });
});

test.describe('unmount', () => {
  test('replacing a control with another component type unmounts it: its binding is disposed and a queued tap is refused', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive(...FIXED);
    await fixture.send('capture-tap', { label: 'cancel-order@/', name: 'before-unmount' });

    await fixture.push(updateComponents(ORDERS, [text('cancel-order', 'Cancel is now plain text')]));
    await expect.poll(async () => (await fixture.state()).instances.filter((instance) => instance.label === 'cancel-order@/' && instance.live).length).toBe(0);
    expect((await fixture.recordsOf('binding-state')).filter((record) => record['label'] === 'cancel-order@/').map((record) => record['phase'])).toContain('disposed');
    expect(await fixture.send('fire-captured', { name: 'before-unmount' })).toEqual({ outcome: 'stale' });
    await fixture.stillInvocations(0);
    // The siblings are untouched.
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);
  });

  test('an omitted ID in a later update is not a removal: the control keeps its binding', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive(...FIXED);
    await fixture.push(updateComponents(ORDERS, [{ id: 'root', component: 'Column', children: ['submit-order', 'help'] }]));
    await expect.poll(async () => (await fixture.state()).instances.filter((instance) => instance.live).map((instance) => instance.label).sort()).toEqual(['submit-order@/']);
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);
  });

  test('deleting the surface retires every instance', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive(...FIXED);
    await fixture.push({ version: 'v0.9', deleteSurface: { surfaceId: ORDERS } });
    await expect.poll(async () => (await fixture.state()).instances.filter((instance) => instance.live).length).toBe(0);
    const phases = (await fixture.recordsOf('binding-state')).filter((record) => record['phase'] === 'disposed').map((record) => record['label']);
    expect(new Set(phases)).toEqual(new Set(['submit-order@/', 'cancel-order@/', 'flaky@/']));
  });
});

test.describe('native removal versus cleanup', () => {
  // This measures the interval; it does not close it. Between native removal and the effect
  // cleanup `installation.live` is still true and a hook's `current()` could still be true, so the
  // approved contract is item-keyed, retirement-tolerant presentation, not "prevent the write".
  test('records when each element left the tree and when its instance was retired', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.watchRemovals();
    await fixture.push(...ordersLayout);
    await fixture.untilLive(...FIXED);

    const intervals: number[] = [];
    for (const id of ['cancel-order', 'refund-order', 'flaky']) {
      await fixture.push(updateComponents(ORDERS, [text(id, 'gone')]));
      await expect
        .poll(async () => (await fixture.recordsOf('probe')).filter((record) => record['label'] === `${id}@/` && record['type'] === 'closed').length)
        .toBe(1);
      const removed = (await fixture.removals()).filter((entry) => entry.id === id);
      const closed = (await fixture.recordsOf('probe')).find((record) => record['label'] === `${id}@/` && record['type'] === 'closed');
      expect(removed.length).toBeGreaterThan(0);
      expect(typeof closed?.['at']).toBe('number');
      intervals.push((closed?.['at'] as number) - (removed[0]?.at ?? 0));
    }
    // Reported, not constrained: a measurement of this run on one runtime, in milliseconds
    // (negative: cleanup was recorded before the page observed the removal). It must be finite.
    console.log(`native removal -> cleanup intervals on the Lynx Web runtime (ms): ${JSON.stringify(intervals)}`);
    expect(intervals.every(Number.isFinite)).toBe(true);
  });

  test('presentation keyed by item identity is unaffected by retirement; a write after cleanup still lands on the item', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...notesLayout([{ id: 'n1', title: 'One' }, { id: 'n2', title: 'Two' }]));
    await fixture.untilLive('row-archive@/notes/0', 'row-archive@/notes/1');
    await fixture.tap('row-archive:0');
    await fixture.untilInvocations(1);
    expect((await fixture.state()).presentation).toEqual({ n1: 'archived' });

    await fixture.send('reset');
    await fixture.untilLive(...EMPTY_STATE);
    // The write the first instance made is keyed by the item, so it neither depended on nor was
    // lost with the retired view. `current()` was never consulted as proof of native presence.
    expect((await fixture.state()).presentation).toEqual({ n1: 'archived' });
  });
});

test.describe('scrolling', () => {
  test('scrolling the native list neither opens nor closes an instance, and a row tapped afterwards keeps its item', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.watchRemovals();
    await fixture.push(...longListLayout(40));
    await fixture.untilLive(...Array.from({ length: 40 }, (_, index) => `row-archive@/notes/${index}`));
    await fixture.watchLog();
    const before = (await fixture.recordsOf('probe')).filter((record) => record['type'] === 'opened' || record['type'] === 'closed').length;
    const removalsBefore = (await fixture.removals()).length;

    for (const top of [400, 900, 1400, 0]) await fixture.scrollList(top);

    const after = (await fixture.recordsOf('probe')).filter((record) => record['type'] === 'opened' || record['type'] === 'closed').length;
    expect(after).toBe(before);
    expect((await fixture.state()).instances.filter((instance) => instance.live)).toHaveLength(40);
    expect((await fixture.state()).instances.every((instance) => instance.epoch === 0)).toBe(true);
    // Observation, not a requirement: on the Web runtime the list keeps its row elements, so no
    // native node was removed or recycled by scrolling. A native `<list>` reuses nodes while its
    // logical instances persist; this run could not reproduce that reuse.
    console.log(`DOM removals during scrolling on the Lynx Web runtime: ${(await fixture.removals()).length - removalsBefore}`);

    await fixture.tap('row-archive:7');
    expect((await fixture.untilInvocations(1))[0]).toMatchObject({ definition: 'archive-note', item: 'note-7' });
  });

  test('a data change to a row that is scrolled away is observed by its still-live instance', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...longListLayout(40));
    await fixture.untilLive(...Array.from({ length: 40 }, (_, index) => `row-archive@/notes/${index}`));
    await fixture.send('capture-tap', { label: 'row-archive@/notes/35', name: 'far-row' });
    await fixture.scrollList(0);

    await fixture.send('set-store', { label: 'row-archive@/notes/35', updates: [{ path: '/notes/35/id', value: 'note-replaced' }] });
    await expect.poll(async () => (await fixture.instance('row-archive@/notes/35')).epoch).toBe(1);
    expect(await fixture.send('fire-captured', { name: 'far-row' })).toEqual({ outcome: 'stale' });
    expect(await fixture.send('read-prop', { label: 'row-archive@/notes/35', prop: 'noteId' })).toEqual({ value: 'note-replaced' });
  });
});
