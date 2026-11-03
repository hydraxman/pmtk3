import { test, expect } from '@playwright/test';
import type { PublicCatalog, PublicDetail } from '../../pages/types';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.querySelectorAll('img').forEach(image => { image.loading = 'eager'; }));
  await expect.poll(() => page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
  await page.screenshot({ path: `test-results/pages-${name}.png`, fullPage: true });
}

test('static project-site paths, chapter guide, search, gallery and image provenance work', async ({ page }) => {
  const errors: string[] = [], failed: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /把抽象的概率/ })).toBeVisible();
  await expect(page.locator('#chapters a')).toHaveCount(25);
  await expect(page.locator('.demo-card')).toHaveCount(24);
  const catalog = await (await page.request.get('./catalog.json')).json() as PublicCatalog;
  expect(catalog.stats.runnable).toBe(563);
  expect(catalog.stats.reproductions).toBe(52);
  expect(catalog.stats.mapped).toBe(220);
  await screenshot(page, 'home');
  await page.locator('.skip').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.locator('#pagination')).toContainText('第 2 /');
  await page.locator('#mode').selectOption('helper');
  await expect(page.locator('.demo-card')).toHaveCount(7);
  await page.locator('#mode').selectOption('reproduction');
  await expect(page.locator('#result-count')).toHaveText('52 个案例');
  await page.locator('#chapters a[href="#/chapter/6"]').click();
  await page.getByRole('searchbox').fill('linregPolyVsRegDemo');
  await expect(page.locator('.demo-card')).toHaveCount(1);
  await page.locator('#chapters a[href="#/chapter/12"]').click();
  await expect(page.getByRole('heading', { name: '潜在线性模型。', exact: true })).toBeVisible();
  await expect(page.getByRole('math')).toContainText('Uᵣ');
  await expect(page.locator('.demo-card')).toHaveCount(14);
  await page.getByRole('searchbox', { name: '搜索实验' }).fill('svdImageDemo');
  await expect(page.locator('.demo-card')).toHaveCount(1);
  await page.locator('.card-image').click();
  await expect(page.locator('.repro-notes')).toContainText('独立 TypeScript');
  await expect(page.locator('.figure-grid img').first()).toBeVisible();
  await expect.poll(() => page.locator('.figure-grid img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await screenshot(page, 'reproduction');
  await page.reload();
  await expect(page.locator('.detail-hero code')).toHaveText('svdImageDemo');
  await page.goto('./#/demo/pcaDemo2d');
  await expect(page.locator('.detail-hero .badge')).toHaveText('原版 · Octave');
  await expect(page.locator('.provenance')).toContainText('实际 Octave 输出');
  await expect(page.locator('.figure-grid img').first()).toBeVisible();
  const nonvisual = catalog.entries.find(entry => entry.kind === 'original' && entry.imageCount === 0)!;
  await page.goto(`./#/demo/${encodeURIComponent(nonvisual.id)}`);
  await expect(page.getByRole('heading', { name: '这个案例没有生成图形' })).toBeVisible();
  await expect(page.locator('.figure-grid img')).toHaveCount(0);
  await page.goto('./#/chapter/unmapped');
  await expect(page.getByRole('heading', { name: /不强行归类/ })).toBeVisible();
  await page.getByRole('searchbox').fill('does-not-exist-xyz');
  await expect(page.getByRole('heading', { name: '暂时没有匹配的实验' })).toBeVisible();
  expect(errors).toEqual([]); expect(failed).toEqual([]);
});
test('all public metadata and current images exist, and exported data contains no local runtime paths', async ({ request }) => {
  test.setTimeout(300_000);
  const catalog = await (await request.get('./catalog.json')).json() as PublicCatalog;
  const allImages = new Set<string>();
  for (let i = 0; i < catalog.entries.length; i += 24) {
    await Promise.all(catalog.entries.slice(i, i + 24).map(async entry => {
      const response = await request.get(`./${entry.detail}`);
      expect(response.ok(), entry.id).toBe(true);
      const text = await response.text();
      expect(text).not.toMatch(/[A-Z]:\\\\Users\\\\|C:\/Users\/|api\/artifacts|runner_pid|\.demo-runtime/);
      const detail = JSON.parse(text) as PublicDetail;
      expect(detail.id).toBe(entry.id);
      expect(detail.images.length).toBe(entry.imageCount);
      detail.images.forEach(image => allImages.add(image.url));
      if (entry.kind === 'reproduction') expect(detail.reproduction?.checks.every(check => check.passed)).toBe(true);
    }));
  }
  const urls = [...allImages];
  expect(urls.length).toBe(catalog.stats.uniqueImages);
  if (!process.env.PAGES_TEST_URL) {
    for (const url of urls) {
      const bytes = await readFile(path.join('dist', 'pages', url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(path.basename(url).split('.')[0]);
      if (url.endsWith('.png')) expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      else expect(bytes.toString()).toContain('not an original MATLAB execution');
    }
  }
  for (let i = 0; i < urls.length; i += 32) await Promise.all(urls.slice(i, i + 32).map(async url => {
    const response = await request.head(`./${url}`);
    expect(response.ok(), url).toBe(true);
    expect(response.headers()['content-type']).toMatch(/image\/(png|svg\+xml)/);
  }));
});
test('mobile chapter navigation, reading and honest about page remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /把抽象的概率/ })).toBeVisible();
  await page.getByRole('button', { name: /章节目录/ }).click();
  await page.locator('#chapters a[href="#/chapter/17"]').click();
  await expect(page.getByRole('heading', { name: '马尔可夫模型与 HMM。', exact: true })).toBeVisible();
  await expect(page.getByRole('math')).toContainText('αₜ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, 'mobile');
  await page.goto('./#/about');
  await expect(page.getByRole('heading', { name: '数学说明是什么？' })).toBeVisible();
  await expect(page.locator('main')).toContainText('不复制或翻译书中段落');
  await expect(page.locator('main')).toContainText('9、20、22');
});
