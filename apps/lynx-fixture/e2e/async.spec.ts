import { expect, test, type Page } from '@playwright/test';
import { Fixture } from './fixture.js';
import { ASYNC, asyncLayout, updateData } from './messages.js';

// ACT4 on the real renderer: an asynchronous local action on ReactLynx 0.128.0 over GenUI 0.7.0 on
// the Lynx Web runtime. The shared runtime's admission and currentness are checked against this
// renderer's own observation seam, the item watch its slot keeps over the property that names the
// business item. A pending prerequisite and the row work wait for the test, so the test chooses the
// order in which things settle. This is common-seam qualification on Lynx Web in Chromium: not
// native Lynx, not full parity, and not an actual host.

const ROW = (index: number) => `row-stage@/notes/${index}`;
const NOTES = [
  { id: 'n1', title: 'One' },
  { id: 'n2', title: 'Two' },
];

async function open(page: Page): Promise<Fixture> {
  const fixture = await Fixture.open(page);
  await fixture.push(...asyncLayout(NOTES));
  await fixture.untilLive('review-order@/', ROW(0), ROW(1));
  return fixture;
}

const pending = (fixture: Fixture) =>
  fixture.send<{ count: number; rows: string[] }>('pending-sessions');
const phaseOf = async (fixture: Fixture, label: string) =>
  (await fixture.instance(label)).bindingPhase;
const hooks = async (fixture: Fixture) =>
  (await fixture.recordsOf('hook')).map(
    ({ hook, definition, item, cause, stage, kind }) => ({
      hook,
      definition,
      item,
      cause,
      stage,
      kind,
    }),
  );

test.describe('a pending prerequisite', () => {
  test('holds the handler until the session answers; the handler then runs once, with the provided value', async ({
    page,
  }) => {
    const fixture = await open(page);

    await fixture.tap('review-order');
    await expect.poll(async () => (await pending(fixture)).count).toBe(1);
    expect(await phaseOf(fixture, 'review-order@/')).toBe('running');
    await fixture.stillInvocations(0);
    // A second tap while the session is pending is the `ignore` busy policy: no second request.
    await fixture.tap('review-order');
    expect((await pending(fixture)).count).toBe(1);

    await fixture.send('answer-session', { answer: 'signed-in' });

    expect((await fixture.untilInvocations(1))[0]).toMatchObject({
      definition: 'review-order',
      item: 'order-1',
    });
    await expect
      .poll(async () => (await fixture.state()).presentation['order-1'])
      .toBe('reviewed by u-1');
    await expect.poll(() => phaseOf(fixture, 'review-order@/')).toBe('idle');
  });

  test('a refusal never runs the handler and the failure hook sees a refusal', async ({
    page,
  }) => {
    const fixture = await open(page);

    await fixture.tap('review-order');
    await expect.poll(async () => (await pending(fixture)).count).toBe(1);
    await fixture.send('answer-session', { answer: 'signed-out' });

    await expect
      .poll(async () =>
        (await hooks(fixture)).filter((hook) => hook.hook === 'failure'),
      )
      .toEqual([expect.objectContaining({ hook: 'failure', kind: 'refused' })]);
    await fixture.stillInvocations(0);
    await expect.poll(() => phaseOf(fixture, 'review-order@/')).toBe('idle');
  });

  test('disposal before the continuation cancels it: the late answer starts nothing and the binding stays disposed', async ({
    page,
  }) => {
    const fixture = await open(page);

    await fixture.tap('review-order');
    await expect.poll(async () => (await pending(fixture)).count).toBe(1);
    await fixture.send('dispose', { label: 'review-order@/' });
    await fixture.send('answer-session', { answer: 'signed-in' });

    await expect
      .poll(async () =>
        (await hooks(fixture)).filter(
          (hook) => hook.definition === 'review-order',
        ),
      )
      .toEqual([
        expect.objectContaining({
          hook: 'canceled',
          cause: 'disposed',
          stage: 'prerequisites',
        }),
      ]);
    await fixture.stillInvocations(0);
    expect(await phaseOf(fixture, 'review-order@/')).toBe('disposed');
  });

  test('unmounting the session before the continuation disposes the binding; a late answer starts nothing', async ({
    page,
  }) => {
    const fixture = await open(page);

    await fixture.tap('review-order');
    await expect.poll(async () => (await pending(fixture)).count).toBe(1);
    await fixture.send('reset');
    await fixture.send('answer-session', { answer: 'signed-in' });

    await expect
      .poll(async () =>
        (await hooks(fixture)).filter(
          (hook) => hook.definition === 'review-order',
        ),
      )
      .toEqual([
        expect.objectContaining({
          hook: 'canceled',
          cause: 'disposed',
          stage: 'prerequisites',
        }),
      ]);
    await fixture.stillInvocations(0);
  });
});

test.describe('same-position subject replacement', () => {
  test('the data change that puts another item at the position cancels the work at the change; the instance and binding stay', async ({
    page,
  }) => {
    const fixture = await open(page);

    await fixture.tap('row-stage:0');
    await fixture.tap('row-stage:1');
    await expect
      .poll(async () => (await pending(fixture)).rows.sort())
      .toEqual(['n1', 'n2']);
    const before = await fixture.instance(ROW(0));

    await fixture.push(updateData(ASYNC, '/notes/0/id', 'n9'));

    await expect
      .poll(async () =>
        (await hooks(fixture)).filter(
          (hook) => hook.definition === 'stage-note',
        ),
      )
      .toEqual([
        expect.objectContaining({
          hook: 'canceled',
          item: 'n1',
          cause: 'subject-changed',
          stage: 'running',
        }),
      ]);
    // Same instance (the position kept it), still bound, and idle again; the other row is untouched.
    const after = await fixture.instance(ROW(0));
    expect(after).toMatchObject({
      live: true,
      bound: true,
      bindingPhase: 'idle',
    });
    expect(after.epoch).toBe(before.epoch + 1);
    expect(await phaseOf(fixture, ROW(1))).toBe('running');

    // The old work finishing late presents nothing, and a fresh tap runs for the item now shown.
    await fixture.send('release-row', { noteId: 'n1' });
    await fixture.page.waitForTimeout(300);
    expect((await fixture.state()).presentation['n1']).toBe(
      'canceled: subject-changed',
    );
    await fixture.tap('row-stage:0');
    await expect
      .poll(async () => (await pending(fixture)).rows.sort())
      .toEqual(['n2', 'n9']);
    await fixture.send('release-row', { noteId: 'n9' });
    await expect
      .poll(async () => (await fixture.state()).presentation['n9'])
      .toBe('staged');
  });

  test('a change in one batch that returns to the first value is not seen; the invocation continues', async ({
    page,
  }) => {
    const fixture = await open(page);

    await fixture.tap('row-stage:0');
    await expect
      .poll(async () => (await pending(fixture)).rows)
      .toEqual(['n1']);
    await fixture.send('set-store', {
      label: ROW(0),
      updates: [
        { path: '/notes/0/id', value: 'n9' },
        { path: '/notes/0/id', value: 'n1' },
      ],
    });
    await fixture.page.waitForTimeout(300);

    expect(await phaseOf(fixture, ROW(0))).toBe('running');
    await fixture.send('release-row', { noteId: 'n1' });
    await expect
      .poll(async () => (await fixture.state()).presentation['n1'])
      .toBe('staged');
  });

  // An observed environment limit, recorded so that it cannot be mistaken for a guarantee: on GenUI
  // 0.7.0 over Lynx Web, shrinking the array that a template expands does not retire the row that
  // no longer has an item. The instance stays live and bound, and the runtime has nothing to observe.
  // Retirement of a removed row is therefore not claimed for this renderer; the keyed reset above,
  // disposal and a changed item at a kept position are.
  test('limit: a row whose item is removed from the array is not retired on this renderer, so its work is not canceled', async ({
    page,
  }) => {
    const fixture = await open(page);

    await fixture.tap('row-stage:1');
    await expect
      .poll(async () => (await pending(fixture)).rows)
      .toEqual(['n2']);
    await fixture.push(updateData(ASYNC, '/notes', [NOTES[0]]));
    await fixture.page.waitForTimeout(1_000);

    expect(await fixture.instance(ROW(1))).toMatchObject({
      live: true,
      bound: true,
      bindingPhase: 'running',
    });
    expect(
      (await hooks(fixture)).filter((hook) => hook.definition === 'stage-note'),
    ).toEqual([]);
  });
});
