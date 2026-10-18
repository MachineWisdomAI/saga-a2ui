import { expect, test } from '@playwright/test';
import { Fixture } from './fixture.js';
import { NOTES, notesLayout, ORDERS, ordersLayout, updateComponents, updateData } from './messages.js';

// Repeated controls, relative paths, replacement of what an instance shows, replacement of the
// binding it reads, and the notifications that actually arrive. The runtime under test is the real
// GenUI 0.7.0 processor and ReactLynx 0.128.0 on the Lynx Web runtime.

const ROW = (index: number) => `row-archive@/notes/${index}`;
const THREE = [
  { id: 'n1', title: 'One' },
  { id: 'n2', title: 'Two' },
  { id: 'n3', title: 'Three' },
];

async function openNotes(page: import('@playwright/test').Page, notes = THREE): Promise<Fixture> {
  const fixture = await Fixture.open(page);
  await fixture.push(...notesLayout(notes));
  await fixture.untilLive(...notes.map((_, index) => ROW(index)));
  return fixture;
}

/** What the last render of an instance showed for its item key. */
async function shown(fixture: Fixture, label: string): Promise<unknown> {
  const renders = (await fixture.recordsOf('probe')).filter((record) => record['label'] === label && record['type'] === 'render');
  return renders.at(-1)?.['shownKey'];
}

test.describe('repeated and template controls', () => {
  test('rows share the layout ID, have distinct expanded IDs, and each reads its own relative path', async ({ page }) => {
    const fixture = await openNotes(page);

    for (const [index, note] of THREE.entries()) {
      expect(await fixture.send('describe', { label: ROW(index) })).toEqual({
        componentId: `row-archive:${index}`,
        sourceComponentId: 'row-archive',
        dataContextPath: `/notes/${index}`,
      });
      // The live reader and the renderer's own resolved prop agree for a relative path.
      expect(await fixture.send('read-prop', { label: ROW(index), prop: 'noteId' })).toEqual({ value: note.id });
      expect(await shown(fixture, ROW(index))).toBe(note.id);
    }

    await fixture.tap('row-archive:1');
    const invocations = await fixture.untilInvocations(1);
    expect(invocations[0]).toMatchObject({ definition: 'archive-note', item: 'n2' });
    await fixture.tap('row-archive:2');
    expect((await fixture.untilInvocations(2))[1]).toMatchObject({ item: 'n3' });
  });

  test('the live reader agrees with the resolved prop for a literal, an absolute path and a relative path', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive('cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/');

    // absolute path
    expect(await fixture.send('read-prop', { label: 'submit-order@/', prop: 'orderId' })).toEqual({ value: 'order-1' });
    expect(await shown(fixture, 'submit-order@/')).toBe('order-1');

    // literal
    await fixture.push(updateComponents(ORDERS, [{ id: 'cancel-order', component: 'ActionButton', child: 'cancel-order-label', orderId: 'order-literal' }]));
    await expect.poll(async () => fixture.send('read-prop', { label: 'cancel-order@/', prop: 'orderId' })).toEqual({ value: 'order-literal' });
    await expect.poll(() => shown(fixture, 'cancel-order@/')).toBe('order-literal');

    // a function-call binding is unreadable to the live reader and is never executed by it
    await fixture.push(
      updateComponents(ORDERS, [{ id: 'cancel-order', component: 'ActionButton', child: 'cancel-order-label', orderId: { call: 'sagaProbe', args: { value: 'from-call' } } }]),
    );
    await expect.poll(async () => fixture.send('read-prop', { label: 'cancel-order@/', prop: 'orderId' })).toEqual({ value: null });
    const before = (await fixture.recordsOf('function-call')).length;
    await fixture.send('read-prop', { label: 'cancel-order@/', prop: 'orderId' });
    expect((await fixture.recordsOf('function-call')).length).toBe(before);
  });
});

test.describe('what an instance shows changes without a remount', () => {
  test('same-position replacement: the instance stays, its epoch steps, an old closure is stale, a fresh tap uses current data', async ({ page }) => {
    const fixture = await openNotes(page);
    await fixture.send('capture-tap', { label: ROW(0), name: 'shows-n1' });
    await fixture.watchLog();

    await fixture.push(updateData(NOTES, '/', { notes: [{ id: 'n9', title: 'Nine' }, THREE[1], THREE[2]] }));
    await expect.poll(async () => (await fixture.instance(ROW(0))).epoch).toBe(1);

    const log = await fixture.watchLog();
    expect(log.filter((event) => event.label === ROW(0) && (event.type === 'opened' || event.type === 'closed'))).toEqual([]);
    expect((await fixture.instance(ROW(1))).epoch).toBe(0);

    expect(await fixture.send('fire-captured', { name: 'shows-n1' })).toEqual({ outcome: 'stale' });
    await expect.poll(() => shown(fixture, ROW(0))).toBe('n9');
    expect(await fixture.send('fire-current', { label: ROW(0) })).toEqual({ outcome: 'delivered' });
    expect((await fixture.untilInvocations(1))[0]).toMatchObject({ definition: 'archive-note', item: 'n9' });
  });

  test('reorder: every instance keeps its ID and path, and each sees a different item', async ({ page }) => {
    const fixture = await openNotes(page);
    for (const index of [0, 1, 2]) await fixture.send('capture-tap', { label: ROW(index), name: `row-${index}` });

    await fixture.push(updateData(NOTES, '/', { notes: [THREE[2], THREE[0], THREE[1]] }));
    await expect.poll(async () => (await fixture.state()).instances.map((instance) => instance.epoch)).toEqual([1, 1, 1]);

    for (const index of [0, 1, 2]) {
      expect(await fixture.send('fire-captured', { name: `row-${index}` })).toEqual({ outcome: 'stale' });
    }
    expect(await fixture.send('read-prop', { label: ROW(0), prop: 'noteId' })).toEqual({ value: 'n3' });
    await fixture.stillInvocations(0);
  });

  test('checkpoint freshness: the live key comparison alone refuses a closure whose key no longer matches', async ({ page }) => {
    const fixture = await openNotes(page);
    await fixture.push(updateData(NOTES, '/', { notes: [{ id: 'n9', title: 'Nine' }, THREE[1], THREE[2]] }));
    await expect.poll(async () => (await fixture.instance(ROW(0))).epoch).toBe(1);

    // A token with the current epoch and installation but the key the first render showed.
    expect(await fixture.send('fire-forged', { label: ROW(0), shownKey: 'n1' })).toEqual({ outcome: 'stale' });
    expect(await fixture.send('fire-forged', { label: ROW(0), shownKey: 'n9' })).toEqual({ outcome: 'delivered' });
  });

  test('observed A, B, A: the epoch records the round trip that the key comparison cannot see', async ({ page }) => {
    const fixture = await openNotes(page);
    await fixture.send('capture-tap', { label: ROW(0), name: 'A' });

    await fixture.push(updateData(NOTES, '/', { notes: [{ id: 'n9', title: 'Nine' }, THREE[1], THREE[2]] }));
    await expect.poll(async () => (await fixture.instance(ROW(0))).epoch).toBe(1);
    await fixture.push(updateData(NOTES, '/', { notes: THREE }));
    await expect.poll(async () => (await fixture.instance(ROW(0))).epoch).toBe(2);
    expect(await fixture.send('read-prop', { label: ROW(0), prop: 'noteId' })).toEqual({ value: 'n1' });

    // Checkpoint freshness: the key now equals the one the old render showed, so a token that
    // carries the current epoch is admitted. The old closure is refused only because its epoch is old.
    expect(await fixture.send('fire-forged', { label: ROW(0), shownKey: 'n1' })).toEqual({ outcome: 'delivered' });
    expect(await fixture.send('fire-captured', { name: 'A' })).toEqual({ outcome: 'stale' });
  });

  test('limit: B set and reverted inside one signal batch is never observed, so the old closure is admitted', async ({ page }) => {
    const fixture = await openNotes(page);
    await fixture.send('capture-tap', { label: ROW(0), name: 'A' });

    await fixture.send('set-store', {
      label: ROW(0),
      updates: [
        { path: '/notes/0/id', value: 'n8' },
        { path: '/notes/0/id', value: 'n1' },
      ],
    });
    expect((await fixture.instance(ROW(0))).epoch).toBe(0);
    expect(await fixture.send('fire-captured', { name: 'A' })).toEqual({ outcome: 'delivered' });
  });

  test('two update messages in one push are two observed batches', async ({ page }) => {
    const fixture = await openNotes(page);
    await fixture.push(
      updateData(NOTES, '/notes/0/id', 'n8'),
      updateData(NOTES, '/notes/0/id', 'n1'),
    );
    await expect.poll(async () => (await fixture.instance(ROW(0))).epoch).toBe(2);
  });
});

test.describe('replacing the source of a binding', () => {
  test('the watch follows the new signal, ignores the retired one and counts only a changed key', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive('cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/');
    await fixture.push(updateData(ORDERS, '/order', { id: 'order-1', other: 'order-2', same: 'order-3' }));
    await fixture.send('capture-tap', { label: 'submit-order@/', name: 'old-source' });

    const rebind = (path: string) =>
      fixture.push(updateComponents(ORDERS, [{ id: 'submit-order', component: 'ActionButton', child: 'submit-order-label', orderId: { path } }]));

    // 1. /order/id -> /order/other: the key shown changes from order-1 to order-2, counted once.
    await rebind('/order/other');
    await expect.poll(async () => (await fixture.instance('submit-order@/')).epoch).toBe(1);
    expect(await fixture.send('read-prop', { label: 'submit-order@/', prop: 'orderId' })).toEqual({ value: 'order-2' });
    expect(await fixture.send('fire-captured', { name: 'old-source' })).toEqual({ outcome: 'stale' });

    // 2. The retired source changes: not a change of this item.
    await fixture.push(updateData(ORDERS, '/order/id', 'order-X'));
    await page.waitForTimeout(300);
    expect((await fixture.instance('submit-order@/')).epoch).toBe(1);
    expect(await fixture.send('fire-current', { label: 'submit-order@/' })).toEqual({ outcome: 'delivered' });
    expect((await fixture.untilInvocations(1))[0]).toMatchObject({ definition: 'submit-order', item: 'order-2' });

    // 3. The new source changes: counted.
    await fixture.push(updateData(ORDERS, '/order/other', 'order-4'));
    await expect.poll(async () => (await fixture.instance('submit-order@/')).epoch).toBe(2);

    // 4. Another path holding the same key: the epoch does not move.
    await fixture.push(updateData(ORDERS, '/order/same', 'order-4'));
    await rebind('/order/same');
    await page.waitForTimeout(300);
    expect((await fixture.instance('submit-order@/')).epoch).toBe(2);
    expect(await fixture.send('read-prop', { label: 'submit-order@/', prop: 'orderId' })).toEqual({ value: 'order-4' });
  });
});

test.describe('notifications that actually arrive', () => {
  const kinds = (log: Array<{ label: string; type: string }>, label: string) => log.filter((event) => event.label === label).map((event) => event.type);

  test('a data change: the signal callback runs first, inside the processor, before any Resource notification or render', async ({ page }) => {
    const fixture = await openNotes(page);
    await fixture.watchLog();
    await fixture.push(updateData(NOTES, '/', { notes: [{ id: 'n9', title: 'Nine' }, THREE[1], THREE[2]] }));
    await expect.poll(async () => (await fixture.instance(ROW(0))).epoch).toBe(1);
    await page.waitForTimeout(300);
    const log = await fixture.watchLog();

    expect(kinds(log, ROW(0))).toEqual(['signal', 'resource', 'render']);
    // The first event of the whole message is the signal callback of the item that changed.
    expect(log[0]).toMatchObject({ label: ROW(0), type: 'signal', value: 'n9', counted: true });
    // One signal callback for the one changed key; the unchanged rows saw none.
    expect(kinds(log, ROW(1))).toEqual(['resource', 'render']);
    expect(kinds(log, ROW(2))).toEqual(['resource', 'render']);
  });

  test('a replaced binding: the Resource callback moves the watch and the new signal reports its first value', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(...ordersLayout);
    await fixture.untilLive('cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/');
    await fixture.push(updateData(ORDERS, '/order', { id: 'order-1', other: 'order-2' }));
    await fixture.watchLog();
    await fixture.push(updateComponents(ORDERS, [{ id: 'submit-order', component: 'ActionButton', child: 'submit-order-label', orderId: { path: '/order/other' } }]));
    await expect.poll(async () => (await fixture.instance('submit-order@/')).epoch).toBe(1);
    await page.waitForTimeout(300);

    const events = (await fixture.watchLog()).filter((event) => event.label === 'submit-order@/');
    expect(events.map((event) => event.type)).toEqual(['signal', 'resource', 'render']);
    expect(events[0]).toMatchObject({ value: 'order-2', counted: true });
    expect(events[1]).toMatchObject({ moved: true });
  });
});
