import { expect, test } from '@playwright/test';
import { Fixture } from './fixture.js';
import { createSurface, orderControl, updateComponents, updateData } from './messages.js';

// The opted-in control's `checks` and `isValid` gate, on the real ReactLynx renderer under the Lynx
// Web runtime. The control evaluates `checks` with GenUI's exported `useChecks`, the hook the
// published Button uses, so a failing rule leaves no tap handler bound and shows its message.

const CHECKS = 'checks';
const LABELS = ['cancel-order@/', 'submit-order@/'] as const;
const APPROVAL = 'Approval required';

const failing = (message: string, condition: unknown = false) => ({ checks: [{ condition, message }] });

async function openChecks(page: import('@playwright/test').Page, submit: Record<string, unknown>, cancel: Record<string, unknown> = {}): Promise<Fixture> {
  const fixture = await Fixture.open(page);
  await fixture.push(
    createSurface(CHECKS),
    updateComponents(CHECKS, [
      { id: 'root', component: 'Column', children: ['submit-order', 'cancel-order'] },
      ...orderControl('submit-order', 'Submit', submit),
      ...orderControl('cancel-order', 'Cancel order', cancel),
    ]),
    updateData(CHECKS, '/', { order: { id: 'order-1' }, approved: false }),
  );
  await fixture.untilLive(...LABELS);
  return fixture;
}

const message = (page: import('@playwright/test').Page, text: string) => page.getByText(text, { exact: true });

test.describe('checks and isValid gate the tap handler', () => {
  test('a failing check binds no handler: the message shows and a tap runs nothing', async ({ page }) => {
    const fixture = await openChecks(page, failing(APPROVAL));
    await expect(message(page, APPROVAL)).toHaveCount(1);

    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);

    // The sibling control has no checks and is untouched.
    await fixture.tap('cancel-order');
    const invocations = await fixture.untilInvocations(1);
    expect(invocations[0]?.['definition']).toBe('cancel-order');
  });

  test('a passing check shows no message and the tap is delivered', async ({ page }) => {
    const fixture = await openChecks(page, failing('Never shown', true));
    await expect(message(page, 'Never shown')).toHaveCount(0);

    await fixture.tap('submit-order');
    const invocations = await fixture.untilInvocations(1);

    expect(invocations[0]?.['definition']).toBe('submit-order');
  });

  test('the first failing message shows when several rules fail', async ({ page }) => {
    const fixture = await openChecks(page, { checks: [{ condition: true, message: 'Passing' }, { condition: false, message: 'First failure' }, { condition: false, message: 'Second failure' }] });

    await expect(message(page, 'First failure')).toHaveCount(1);
    await expect(message(page, 'Second failure')).toHaveCount(0);
    await expect(message(page, 'Passing')).toHaveCount(0);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);
  });

  // The rule list is reactive in the way GenUI 0.7.0 makes it reactive here: `useChecks` re-evaluates
  // when the component's `checks` change. An agent update replaces the rule, and the control
  // follows it in both directions without a remount or a rebind.
  test('a replaced rule list is followed: enabled when it passes, disabled again when it fails', async ({ page }) => {
    const fixture = await openChecks(page, failing(APPROVAL));
    await expect(message(page, APPROVAL)).toHaveCount(1);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);

    const replaceRule = (condition: boolean) =>
      fixture.push(updateComponents(CHECKS, [{ id: 'submit-order', component: 'ActionButton', child: 'submit-order-label', orderId: { path: '/order/id' }, ...failing(APPROVAL, condition) }]));

    await replaceRule(true);
    await expect(message(page, APPROVAL)).toHaveCount(0);
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);

    await replaceRule(false);
    await expect(message(page, APPROVAL)).toHaveCount(1);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(1);

    await replaceRule(true);
    await expect(message(page, APPROVAL)).toHaveCount(0);
    await fixture.tap('submit-order');
    await fixture.untilInvocations(2);
    // One logical instance throughout.
    expect(await fixture.instance('submit-order@/')).toMatchObject({ live: true, bound: true });
    expect((await fixture.recordsOf('probe')).filter((record) => record['label'] === 'submit-order@/' && (record['type'] === 'opened' || record['type'] === 'closed')).map((record) => record['type'])).toEqual(['opened']);
  });

  // Observed limit of the pinned GenUI, shared with the published Button and not a choice of this
  // adapter: the processor resolves a data-bound `condition` to a string before the hook sees it,
  // and an unrecognized condition counts as passing. The control implements no interpreter of its
  // own, so it behaves as the Button does. Function-call conditions resolve to nothing, the same way.
  test('a data-bound condition is not enforced at GenUI 0.7.0, for the control and for the published Button alike', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(
      createSurface(CHECKS),
      updateComponents(CHECKS, [
        { id: 'root', component: 'Column', children: ['submit-order', 'upstream'] },
        ...orderControl('submit-order', 'Submit', failing(APPROVAL, { path: '/approved' })),
        { id: 'upstream', component: 'Button', child: 'upstream-label', action: { event: { name: 'open_help' } }, ...failing('Upstream approval', { path: '/approved' }) },
        { id: 'upstream-label', component: 'Text', text: 'Upstream' },
      ]),
      updateData(CHECKS, '/', { order: { id: 'order-1' }, approved: false }),
    );
    await fixture.untilLive('submit-order@/');
    await page.waitForTimeout(500);

    await expect(message(page, APPROVAL)).toHaveCount(0);
    await expect(message(page, 'Upstream approval')).toHaveCount(0);
  });

  test('isValid false still disables a control whose checks pass', async ({ page }) => {
    const fixture = await openChecks(page, { isValid: false, ...failing('Never shown', true) });

    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);
    await expect(message(page, 'Never shown')).toHaveCount(0);
  });

  test('a failing check does not unbind the control: recovery delivers to the same binding', async ({ page }) => {
    const fixture = await openChecks(page, failing(APPROVAL, { path: '/approved' }));
    const before = await fixture.instance('submit-order@/');
    expect(before).toMatchObject({ live: true, bound: true, bindingPhase: 'idle' });

    await fixture.push(updateData(CHECKS, '/approved', true));
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);

    expect(await fixture.instance('submit-order@/')).toMatchObject({ live: true, bound: true, bindingPhase: 'idle' });
  });
});
