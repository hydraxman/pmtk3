import { test, expect } from '@playwright/test';
import { reproductionIds } from '../../shared/reproductions/manifest';
import type { ReproductionRun } from '../../shared/reproductions/index';

test('all 52 independent visual reproductions compute and render without changing original status', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const before = await (await page.request.get('/api/state')).json();
  await page.goto('/');
  await page.getByRole('button', { name: /Visual reproductions/ }).click();
  await expect(page.getByRole('heading', { name: 'Every case, a runnable experiment.' })).toBeVisible();
  for (const id of reproductionIds) {
    await page.getByLabel('Choose visual reproduction').selectOption(id);
    const responsePromise = page.waitForResponse(response => response.url().includes(`/api/reproductions/${id}?`));
    await page.getByRole('button', { name: 'Run visual reproduction', exact: true }).click();
    const response = await responsePromise;
    expect(response.status(), id).toBe(200);
    const run = await response.json() as ReproductionRun;
    expect(run.originalExecuted).toBe(false);
    expect(run.result.checks.every(check => check.passed), id).toBe(true);
    await expect(page.locator('.reproduction-result')).toBeVisible();
    await expect(page.locator('.reproduction-figure')).toHaveCount(run.result.plots.length);
    await expect(page.locator('.reproduction-figure .main-svg').first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({ path: `test-results/reproductions/${id}.png`, fullPage: true });
  }
  const after = await (await page.request.get('/api/state')).json();
  const statuses = (state: { entries: { id: string; result: { status: string } }[] }) =>
    Object.fromEntries(state.entries.map(entry => [entry.id, entry.result.status]));
  expect(statuses(after)).toEqual(statuses(before));
  expect(errors).toEqual([]);
});
