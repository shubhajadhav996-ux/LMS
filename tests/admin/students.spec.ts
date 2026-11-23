import { test, expect } from '@playwright/test';
import { letterStamp, openAdmin, rows, modalForm, filterByText, rowAction, confirmDialog, uniqueName, waitApi, isoDate, dateOffset } from './admin-helpers';

test.describe('Admin: Students', () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'students');
    await expect(page.getByRole('heading', { name: 'Student Management' })).toBeVisible();
    // The whole student list is fetched before the table fills (about 20 s on the live site).
    await expect(rows(page).filter({ hasText: '@' }).first()).toBeVisible({ timeout: 60_000 });
  });

  test('list shows columns and row actions', async ({ page }) => {
    for (const h of ['Student', 'Phone', 'Course', 'Joining Date', 'Type', 'Status', 'Actions'])
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    for (const a of ['View Student', 'Edit Student', 'Delete Student']) await expect(rowAction(rows(page).first(), a)).toBeVisible();
  });

  test('Add Student: empty form and invalid email are rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Student' }).click();
    const f = modalForm(page);
    await f.getByRole('button', { name: 'Add Student' }).click();
    await expect(f).toBeVisible();
    await expect(f.getByText(/first name is required/i)).toBeVisible();
    await expect(f.getByText(/last name is required/i)).toBeVisible();
    await expect(f.getByText(/email is required/i)).toBeVisible();
    await f.locator('input[name=email]').fill('not-an-email');
    await f.getByRole('button', { name: 'Add Student' }).click();
    await expect(f.getByText(/valid email/i)).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
    await expect(f).toBeHidden();
  });

  test('create, edit and delete a "QA Test" student', async ({ page }) => {
    const stamp = Date.now().toString().slice(-8);
    const email = `qa.test.student.${stamp}@example.com`;
    const last = `Student ${letterStamp()}`;
    // Create
    await page.getByRole('button', { name: 'Add Student' }).click();
    let f = modalForm(page);
    await f.locator('input[name=firstName]').fill('QA Test');
    await f.locator('input[name=lastName]').fill(last);
    await f.locator('input[name=email]').fill(email);
    await f.locator('input[name=phone]').fill(`+91 9${stamp.slice(-9).padStart(9, '1')}`);
    await f.locator('input[name=joiningDate]').fill(isoDate(dateOffset(0)));
    await f.locator('select[name=type]').selectOption('free');
    const created = waitApi(page, 'POST', /\/(students|users)[^?]*$/);
    await f.getByRole('button', { name: 'Add Student' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    // The list reloads every student after a save, so the new row can take ~20 s to show up.
    const savedAt = Date.now();
    await page.getByPlaceholder(/Search by name, email/).fill(email);
    let row = rows(page).filter({ hasText: email });
    await expect(row).toHaveCount(1, { timeout: 60_000 });
    test.info().annotations.push({ type: 'timing', description: `new student visible after ${((Date.now() - savedAt) / 1000).toFixed(1)} s` });
    await expect(row).toContainText('QA Test');
    await expect(row).toContainText(/Free/i);
    await expect(row).toContainText(/Pending/i);

    // Edit
    await rowAction(row, 'Edit Student').click();
    f = modalForm(page);
    await expect(f.locator('input[name=email]')).toHaveValue(email);
    await f.locator('input[name=lastName]').fill(`${last} edited`);
    await f.locator('select[name=type]').selectOption('scholarship');
    const updated = page.waitForResponse((r) => ['PATCH', 'PUT'].includes(r.request().method()) && /\/(students|users)\//.test(r.url()));
    await f.getByRole('button', { name: 'Update Student' }).click();
    expect((await updated).status()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    row = rows(page).filter({ hasText: email });
    await expect(row).toContainText(`${last} edited`, { timeout: 60_000 });
    await expect(row).toContainText(/Scholarship/i);

    // Delete
    await rowAction(row, 'Delete Student').click();
    const deleted = waitApi(page, 'DELETE', /\/(students|users)\//);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(rows(page).filter({ hasText: email })).toHaveCount(0, { timeout: 60_000 });
  });
});
