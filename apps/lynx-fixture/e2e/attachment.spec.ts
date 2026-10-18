import { expect, test } from '@playwright/test';
import { Fixture, type ProbeRecord } from './fixture.js';
import { ORDERS, ordersLayout, updateComponents } from './messages.js';

// Direct attachment on the real ReactLynx renderer under the Lynx Web runtime (Chromium). The
// background thread is a Web Worker; every observation below arrives as a record from it.

const FIXED = ['cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/'] as const;

async function openOrders(page: import('@playwright/test').Page): Promise<Fixture> {
  const fixture = await Fixture.open(page);
  await fixture.push(...ordersLayout);
  await fixture.untilLive(...FIXED);
  return fixture;
}

const refusals = (records: ProbeRecord[]) => records.filter((record) => record.ev === 'probe' && record['type'] === 'refused');

test.describe('direct attachment', () => {
  test('two definitions on one control kind: each tap runs its own definition once', async ({ page }) => {
    const fixture = await openOrders(page);

    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);
    await fixture.tap('cancel-order');
    const invocations = await fixture.untilInvocations(2);

    expect(invocations.map((record) => [record['definition'], record['item']])).toEqual([
      ['submit-order', 'order-1'],
      ['cancel-order', 'order-1'],
    ]);
    // Both instances are one catalog component type, discovered by the layout's own IDs.
    const state = await fixture.state();
    expect(state.presentation).toEqual({ 'order-1': 'cancelled' });
  });

  test('one invocation per tap, in the background thread, input before handler', async ({ page }) => {
    const fixture = await openOrders(page);
    for (let tap = 0; tap < 3; tap += 1) await fixture.tap('submit-order');
    const invocations = await fixture.untilInvocations(3);
    await fixture.stillInvocations(3);

    expect(invocations.every((record) => record['background'] === true)).toBe(true);
    const sequence = (await fixture.records()).filter((record) => record.ev === 'input' || record.ev === 'invoke').map((record) => record.ev);
    expect(sequence).toEqual(['input', 'invoke', 'input', 'invoke', 'input', 'invoke']);
    expect((await fixture.records()).filter((record) => record.ev === 'input').every((record) => record['background'] === true)).toBe(true);
  });

  test('an unbound control refuses its tap and runs nothing', async ({ page }) => {
    const fixture = await openOrders(page);
    await fixture.tap('refund-order');
    await expect.poll(async () => refusals(await fixture.records()).length).toBe(1);
    expect(refusals(await fixture.records())[0]?.['outcome']).toBe('unbound');
    await fixture.stillInvocations(0);
    expect(await fixture.send('fire-current', { label: 'refund-order@/' })).toEqual({ outcome: 'unbound' });
  });

  test('a protocol action on an unrelated upstream Button still reaches onAction, once, without SAGA', async ({ page }) => {
    const fixture = await openOrders(page);
    await fixture.tapLabelled('Help');
    await expect.poll(async () => (await fixture.recordsOf('protocol-action')).length).toBe(1);
    await fixture.stillInvocations(0);
    expect((await fixture.recordsOf('protocol-action'))[0]?.['name']).toBe('open_help');
  });

  test('a second bind on a live binding throws and leaves the first in place', async ({ page }) => {
    const fixture = await openOrders(page);
    const result = await fixture.send<{ threw: boolean; message: string }>('bind-again', { label: 'submit-order@/', definition: 'cancel-order' });
    expect(result.threw).toBe(true);
    expect(result.message).toContain("'activate'");
    expect(result.message).toContain('already has a live binding');

    await fixture.tap('submit-order');
    const invocations = await fixture.untilInvocations(1);
    expect(invocations[0]?.['definition']).toBe('submit-order');
  });

  test('dispose then rebind: taps refuse while unbound, then run the new definition on the same instance', async ({ page }) => {
    const fixture = await openOrders(page);
    const before = await fixture.state();

    expect(await fixture.send('dispose', { label: 'submit-order@/' })).toEqual({ phase: 'disposed' });
    await fixture.tap('submit-order');
    await expect.poll(async () => refusals(await fixture.records()).length).toBe(1);
    expect(refusals(await fixture.records())[0]?.['outcome']).toBe('unbound');
    await fixture.stillInvocations(0);

    await fixture.send('rebind', { label: 'submit-order@/', definition: 'cancel-order' });
    await fixture.tap('submit-order');
    const invocations = await fixture.untilInvocations(1);
    expect(invocations[0]?.['definition']).toBe('cancel-order');

    // No remount: the same four logical instances are still live.
    const after = await fixture.state();
    expect(after.instances.filter((instance) => instance.live).map((instance) => instance.label)).toEqual(
      before.instances.filter((instance) => instance.live).map((instance) => instance.label),
    );
  });

  // OPEN SEAM FINDING. The design requires a tap closure captured before a dispose to be refused as
  // stale once a second binding is attached, by comparing direct binding references. ACT1's
  // `OpenInstance` never exposes the attached binding to the adapter, so the adapter cannot capture
  // it in a token or tell that one was replaced. The closure runs the replacement definition. This
  // test pins what the seam does today so a repair of the seam turns it red on purpose.
  test('an old queued tap after dispose and rebind reaches the replacement binding (open seam finding)', async ({ page }) => {
    const fixture = await openOrders(page);
    await fixture.send('capture-tap', { label: 'submit-order@/', name: 'before-replacement' });

    await fixture.send('dispose', { label: 'submit-order@/' });
    // During the unbound interval the same closure is refused.
    expect(await fixture.send('fire-captured', { name: 'before-replacement' })).toEqual({ outcome: 'unbound' });
    await fixture.send('rebind', { label: 'submit-order@/', definition: 'cancel-order' });

    expect(await fixture.send('fire-captured', { name: 'before-replacement' })).toEqual({ outcome: 'delivered' });
    const invocations = await fixture.untilInvocations(1);
    expect(invocations[0]?.['definition']).toBe('cancel-order');
  });

  test('setup that binds and then throws leaves the instance unbound and does not disturb others', async ({ page }) => {
    const fixture = await openOrders(page);
    const state = await fixture.state();

    expect(state.setupErrors).toEqual(['setup failed after binding']);
    const flaky = state.instances.find((instance) => instance.label === 'flaky@/');
    expect(flaky).toMatchObject({ live: true, bound: true, bindingPhase: 'disposed' });
    expect((await fixture.recordsOf('binding-state')).filter((record) => record['label'] === 'flaky@/').map((record) => record['phase'])).toEqual(['disposed']);

    await fixture.tap('flaky');
    expect(await fixture.send('fire-current', { label: 'flaky@/' })).toEqual({ outcome: 'unbound' });
    await fixture.stillInvocations(0);

    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);
  });

  test('a protocol action on a bound control is rejected before prop resolution; unrelated function calls are preserved', async ({ page }) => {
    const fixture = await openOrders(page);

    const rejected = await fixture.push(
      updateComponents(ORDERS, [
        { id: 'submit-order', component: 'ActionButton', child: 'submit-order-label', orderId: { path: '/order/id' }, action: { functionCall: { call: 'sagaProbe', args: { value: 'bound-control-action' } } } },
      ]),
    );
    expect(rejected.rejected).toEqual([{ surfaceId: ORDERS, componentId: 'submit-order', reason: 'action-on-bound-control' }]);

    // The same call on an upstream Button's action runs during resolution, before any tap: that is
    // the hazard the buffer check exists for, and the check does not try to remove it elsewhere.
    await fixture.push(
      updateComponents(ORDERS, [
        { id: 'help', component: 'Button', child: 'help-label', action: { functionCall: { call: 'sagaProbe', args: { value: 'upstream-button-action' } } } },
        { id: 'plain', component: 'Text', text: { call: 'sagaProbe', args: { value: 'unrelated-property' } } },
      ]),
    );
    await expect
      .poll(async () => (await fixture.recordsOf('function-call')).map((record) => record['value']))
      .toEqual(expect.arrayContaining(['upstream-button-action']));
    const values = (await fixture.recordsOf('function-call')).map((record) => record['value']);
    expect(values).not.toContain('bound-control-action');

    // The control kept its original message: still bound, still one definition per tap.
    await fixture.tap('submit-order');
    const invocations = await fixture.untilInvocations(1);
    expect(invocations[0]?.['definition']).toBe('submit-order');
  });

  test('an activation failure is reported to the adapter, returns the binding to idle, and does not stop later taps', async ({ page }) => {
    const fixture = await openOrders(page);
    await fixture.send('dispose', { label: 'submit-order@/' });
    await fixture.send('rebind', { label: 'submit-order@/', definition: 'failing' });

    await fixture.tap('submit-order');
    await expect.poll(async () => (await fixture.recordsOf('activation-error')).length).toBe(1);
    expect((await fixture.recordsOf('activation-error'))[0]?.['message']).toBe('handler failed on purpose');
    expect((await fixture.state()).instances.find((instance) => instance.label === 'submit-order@/')?.bindingPhase).toBe('idle');

    await fixture.tap('submit-order');
    await expect.poll(async () => (await fixture.recordsOf('activation-error')).length).toBe(2);
  });
});
