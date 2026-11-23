import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAdmin, rows, rowAction, confirmDialog, waitApi, anyWrite, letterStamp } from './admin-helpers';

const editor = (page: Page) => page.getByRole('form', { name: 'Plan editor' });

async function chooseCourse(page: Page) {
  const f = editor(page);
  await f.getByRole('button', { name: 'Course*' }).click();
  const search = page.getByPlaceholder(/search/i).last();
  if (await search.isVisible().catch(() => false)) await search.fill('QA Test Notif');
  await page.getByText(/QA Test Notif Course 2311/).last().click();
}

test.describe('Admin: Subscription Plans', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'subscription-plans');
    await expect(page.getByRole('heading', { name: 'Subscription Plans' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
  });

  test('list shows columns and row actions', async ({ page }) => {
    for (const h of ['Plan', 'Course', 'Code', 'Online', 'Offline', 'Status', 'Actions'])
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    for (const a of ['Edit Plan', 'Duplicate Plan', 'Delete Plan']) await expect(rowAction(rows(page).first(), a)).toBeVisible();
  });

  test('New plan: empty form cannot be saved', async ({ page }) => {
    await page.getByRole('button', { name: 'New plan' }).click();
    const f = editor(page);
    await f.getByRole('button', { name: 'Save draft' }).click();
    await expect(f).toBeVisible();
    await expect(f.getByText(/required|select a course|enter a/i).first()).toBeVisible();
    await f.getByRole('button', { name: 'Close' }).click();
  });

  test('create a draft plan, edit it, then delete it', async ({ page }) => {
    const name = `QA Test Plan ${letterStamp()}`;
    await page.getByRole('button', { name: 'New plan' }).click();
    let f = editor(page);
    await chooseCourse(page);
    await f.getByPlaceholder('e.g. Full Stack, Starter, Pro').fill(name);
    await f.getByLabel('Live training*').selectOption({ label: '1 month' });
    await f.getByPlaceholder('e.g. 5000').fill('1234');
    await f.getByLabel('Online (live on video)').check();
    const created = waitApi(page, 'POST', /plans/);
    await f.getByRole('button', { name: 'Save draft' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await page.getByPlaceholder(/Search/).last().fill(name);
    let row = rows(page).filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Draft/i);
    await expect(row).toContainText('1,234');

    await rowAction(row, 'Edit Plan').click();
    f = editor(page);
    await expect(f.getByPlaceholder('e.g. Full Stack, Starter, Pro')).toHaveValue(name);
    await f.getByPlaceholder('e.g. 5000').fill('2345');
    const updated = anyWrite(page, /plans\/[a-f0-9]+$/);
    await f.getByRole('button', { name: 'Save draft' }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText('2,345');

    await rowAction(row, 'Delete Plan').click();
    const deleted = waitApi(page, 'DELETE', /plans\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });
});
