import { expect, test } from '@playwright/test';
import { Fixture } from './fixture.js';
import { createSurface, NOTES, ORDERS, ordersLayout, orderControl, updateComponents, updateData } from './messages.js';

// The opted-in control's `checks` and `isValid` gate, on the real ReactLynx renderer under the Lynx
// Web runtime. The control evaluates `checks` with GenUI's exported `useChecks`, the hook the
// published Button uses, so a failing rule leaves no tap handler bound and shows its message. It
// hands the hook the component's stored rules (`surface.components`), not the props GenUI has
// already resolved, so a data-bound or function-call condition reaches the evaluator as written
// and re-evaluates when the data model changes.

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

  // GenUI 0.7.0 resolves a `{ path }` or function-call condition to a plain value before a
  // component's props reach it, and `useChecks` treats a condition it does not recognise as
  // passing. The published Button hands `useChecks` those resolved props, so it does not enforce
  // such a rule (pinned below as evidence, not as this control's contract). The opted-in control
  // hands `useChecks` the stored rule, so the same rule is enforced and follows the data model.
  test('a model-bound condition: the control enforces it and follows the model; the published Button does not', async ({ page }) => {
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
    await expect(message(page, APPROVAL)).toHaveCount(1);
    // Evidence of the upstream limit at the pinned version: its Button shows no failure.
    await expect(message(page, 'Upstream approval')).toHaveCount(0);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);
  });

  test('a false model-bound condition blocks the tap and shows its message; the model then changes it both ways on one binding', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(
      ...ordersLayout,
      updateComponents(ORDERS, [
        { id: 'submit-order', component: 'ActionButton', child: 'checked-label', orderId: { path: '/order/id' }, checks: [{ condition: { path: '/approved' }, message: APPROVAL }] },
        { id: 'checked-label', component: 'Text', text: 'Checked submit' },
      ]),
      updateData(ORDERS, '/approved', false),
    );
    await fixture.untilLive('cancel-order@/', 'flaky@/', 'refund-order@/', 'submit-order@/');
    await expect(page.getByText('Checked submit', { exact: true })).toBeVisible();
    await expect(message(page, APPROVAL)).toHaveCount(1);

    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);

    await fixture.push(updateData(ORDERS, '/approved', true));
    await expect(message(page, APPROVAL)).toHaveCount(0);
    await fixture.tap('submit-order');
    const first = await fixture.untilInvocations(1);
    expect(first[0]?.['definition']).toBe('submit-order');

    await fixture.push(updateData(ORDERS, '/approved', false));
    await expect(message(page, APPROVAL)).toHaveCount(1);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(1);

    await fixture.push(updateData(ORDERS, '/approved', true));
    await expect(message(page, APPROVAL)).toHaveCount(0);
    await fixture.tap('submit-order');
    await fixture.untilInvocations(2);

    // The model changed the gate; it never rebound the control.
    expect(await fixture.instance('submit-order@/')).toMatchObject({ live: true, bound: true, bindingPhase: 'idle' });
    expect((await fixture.recordsOf('probe')).filter((record) => record['label'] === 'submit-order@/' && (record['type'] === 'opened' || record['type'] === 'closed')).map((record) => record['type'])).toEqual(['opened']);
  });

  test('a relative condition in a template row reads that row: only the approved row delivers, and a row follows its own value', async ({ page }) => {
    const fixture = await Fixture.open(page);
    await fixture.push(
      createSurface(NOTES),
      updateComponents(NOTES, [
        { id: 'root', component: 'Column', children: { componentId: 'row-archive', path: '/notes' } },
        { id: 'row-archive', component: 'ActionButton', child: 'row-label', noteId: { path: 'id' }, checks: [{ condition: { path: 'approved' }, message: 'Row not approved' }] },
        { id: 'row-label', component: 'Text', text: { path: 'title' } },
      ]),
      updateData(NOTES, '/', {
        notes: [
          { id: 'n1', title: 'One', approved: false },
          { id: 'n2', title: 'Two', approved: true },
        ],
      }),
    );
    await fixture.untilLive('row-archive@/notes/0', 'row-archive@/notes/1');
    await expect(message(page, 'Row not approved')).toHaveCount(1);

    await fixture.tap('row-archive:0');
    await fixture.stillInvocations(0);
    await fixture.tap('row-archive:1');
    await fixture.untilInvocations(1);

    await fixture.push(updateData(NOTES, '/notes/0/approved', true));
    await expect(message(page, 'Row not approved')).toHaveCount(0);
    await fixture.tap('row-archive:0');
    await fixture.untilInvocations(2);

    await fixture.push(updateData(NOTES, '/notes/1/approved', false));
    await expect(message(page, 'Row not approved')).toHaveCount(1);
    await fixture.tap('row-archive:1');
    await fixture.stillInvocations(2);
  });

  test('a changed rule source is followed: replacing the condition path re-evaluates against the new value', async ({ page }) => {
    const fixture = await openChecks(page, failing(APPROVAL, { path: '/approved' }));
    await fixture.push(updateData(CHECKS, '/', { order: { id: 'order-1' }, approved: false, reviewed: true }));
    await expect(message(page, APPROVAL)).toHaveCount(1);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);

    const source = (path: string) =>
      fixture.push(updateComponents(CHECKS, [{ id: 'submit-order', component: 'ActionButton', child: 'submit-order-label', orderId: { path: '/order/id' }, ...failing(APPROVAL, { path }) }]));

    await source('/reviewed');
    await expect(message(page, APPROVAL)).toHaveCount(0);
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);

    await source('/approved');
    await expect(message(page, APPROVAL)).toHaveCount(1);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(1);
    expect(await fixture.instance('submit-order@/')).toMatchObject({ live: true, bound: true });
  });

  test('a function-call condition runs through the same evaluator and follows the model', async ({ page }) => {
    const rule = { call: 'equals', args: { a: { path: '/approved' }, b: true }, returnType: 'boolean' };
    const fixture = await openChecks(page, failing(APPROVAL, rule));
    await expect(message(page, APPROVAL)).toHaveCount(1);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);

    await fixture.push(updateData(CHECKS, '/approved', true));
    await expect(message(page, APPROVAL)).toHaveCount(0);
    await fixture.tap('submit-order');
    await fixture.untilInvocations(1);

    await fixture.push(updateData(CHECKS, '/approved', false));
    await expect(message(page, APPROVAL)).toHaveCount(1);
    await fixture.tap('submit-order');
    await fixture.stillInvocations(1);
    expect(await fixture.instance('submit-order@/')).toMatchObject({ live: true, bound: true, bindingPhase: 'idle' });
  });

  test('isValid false still disables a control whose checks pass', async ({ page }) => {
    const fixture = await openChecks(page, { isValid: false, ...failing('Never shown', true) });

    await fixture.tap('submit-order');
    await fixture.stillInvocations(0);
    await expect(message(page, 'Never shown')).toHaveCount(0);
  });
});

