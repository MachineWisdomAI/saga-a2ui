import { expect, test } from '@playwright/test';
import { sagaSend } from './ingress.js';

// Two application-owned catalogs (the panel's and the answer card's) mounted in one page, one
// custom-element registry. Each has its own session; neither may change the other.

const answerData = (question: string, answer: string) => [
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: 'answer',
      value: { state: 'answer', status: 'Answer', question, answer },
    },
  },
];

test.beforeEach(async ({ page }) => {
  await page.goto('/catalog-isolation/index.html');
  await expect(page.getByTestId('panel-title')).toHaveText('Sample title');
  await expect(page.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');
});

test('each catalog renders only its own data', async ({ page }) => {
  await sagaSend(page, [
    { version: 'v0.9', updateDataModel: { surfaceId: 'fixture', path: '/title', value: 'Panel changed' } },
  ]);
  await expect(page.getByTestId('panel-title')).toHaveText('Panel changed');
  await expect(page.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');

  const result = await page.evaluate((input) => window.answerApp?.()?.ingest(input), answerData('Why?', 'Because.'));
  expect(result).toEqual({ ok: true });
  await expect(page.getByTestId('answer-text')).toHaveText('Because.');
  await expect(page.getByTestId('panel-title')).toHaveText('Panel changed');
});

test('a component from one catalog is unknown to the other', async ({ page }) => {
  // The answer session does not know the panel's component, and the panel session does not know the card.
  const answerResult = await page.evaluate(
    () =>
      window.answerApp?.()?.ingest([
        { version: 'v0.9', updateComponents: { surfaceId: 'answer', components: [{ id: 'extra', component: 'SagaPanel', title: 'x' }] } },
      ]),
  );
  expect(answerResult).toMatchObject({ ok: false, failure: { kind: 'rejected' } });
  const panelResult = await sagaSend(page, [
    { version: 'v0.9', updateComponents: { surfaceId: 'fixture', components: [{ id: 'extra', component: 'AnswerCard' }] } },
  ]);
  expect(panelResult).toMatchObject({ ok: false, failure: { kind: 'rejected' } });
});

test('a rejection clears only the affected instance', async ({ page }) => {
  await sagaSend(page, [{ version: 'v0.9', notAMessage: {} }]);
  await expect(page.getByTestId('failure')).toHaveCount(1);
  await expect(page.getByTestId('panel')).toHaveCount(0);
  await expect(page.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');
});

test('disposing one instance leaves the other, and a re-added instance starts fresh', async ({ page }) => {
  await page.evaluate((input) => window.answerApp?.()?.ingest(input), answerData('Why?', 'Because.'));
  await expect(page.getByTestId('answer-text')).toHaveText('Because.');

  const app = await page.locator('answer-app').elementHandle();
  if (!app) throw new Error('answer-app is not mounted');
  await app.evaluate((el) => el.remove());
  await expect(page.getByTestId('answer-root')).toHaveCount(0);
  await expect(page.getByTestId('panel-title')).toHaveText('Sample title');
  // A retired element ignores late input.
  const late = await app.evaluate((el, input) => (el as unknown as { ingest(i: unknown): unknown }).ingest(input), answerData('Late?', 'Late.'));
  expect(late).toMatchObject({ ok: false });

  await page.evaluate((el) => document.body.append(el), app);
  await expect(page.getByTestId('answer-root')).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('answer-text')).toBeHidden();
  await expect(page.locator('a2ui-surface')).toHaveCount(2);
});

test('the same tag and constructor is harmless; a different constructor fails and keeps the first definition', async ({ page }) => {
  await page.evaluate(() => window.repeatSetup?.());
  expect(await page.evaluate(() => window.defineConflicting?.('saga-panel'))).toBe('conflict');
  expect(await page.evaluate(() => window.defineConflicting?.('answer-card'))).toBe('conflict');
  expect(await page.evaluate(() => window.defineConflicting?.('unrelated-tag'))).toBe('defined');

  // The first definitions still render: the mounted panel is unchanged and still upgraded.
  await expect(page.getByTestId('panel-title')).toHaveText('Sample title');
  expect(await page.evaluate(() => window.firstDefinitionsKept?.())).toBe(true);
});
