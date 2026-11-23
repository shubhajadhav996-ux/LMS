import { test, expect } from '@playwright/test';
import { openAdmin, rows, modalForm, filterByText, rowAction, confirmDialog, uniqueName, waitApi } from './admin-helpers';

test.describe('Admin: Courses', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'courses');
    await expect(page.getByRole('heading', { name: 'Course Management' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('list shows columns and row actions', async ({ page }) => {
    for (const h of ['Course Name', 'Duration', 'Assigned Trainers', 'Students', 'Batches', 'Status', 'Actions'])
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    const row = rows(page).first();
    for (const a of ['View Course', 'Edit Course', 'Delete Course']) await expect(rowAction(row, a)).toBeVisible();
  });

  test('Add course: empty form shows required errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Add course' }).click();
    const f = modalForm(page);
    await f.getByRole('button', { name: 'Create Course' }).click();
    await expect(f).toBeVisible();
    await expect(f.getByText(/course name is required/i)).toBeVisible();
    await expect(f.getByText(/description is required/i)).toBeVisible();
    await expect(f.getByText('Please assign at least one trainer')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
    await expect(f).toBeHidden();
  });

  test('create, edit and delete a "QA Test" course', async ({ page }) => {
    const name = uniqueName('Course');
    // Create
    await page.getByRole('button', { name: 'Add course' }).click();
    let f = modalForm(page);
    await f.locator('input[name=courseName]').fill(name);
    await f.getByPlaceholder('eg. 5').fill('2');
    await f.locator('select').last().selectOption({ label: 'Months' });
    await f.getByText('Select trainers...').click();
    await f.getByPlaceholder('Search trainers...').fill('suryawanshi');
    await f.locator('label, div').filter({ hasText: /^shubhangi suryawanshi \(@/ }).locator('input[type=checkbox]').first().check();
    await f.locator('input[name=courseName]').click(); // close the trainer list
    await f.locator('textarea[name=description]').fill('QA Test course created by the Playwright suite. Safe to delete.');
    const created = waitApi(page, 'POST', /\/courses$/);
    await f.getByRole('button', { name: 'Create Course' }).click();
    expect((await created).status()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await filterByText(page, 'Filter by course name', name);
    let row = rows(page).filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('2 months');

    // Edit
    await rowAction(row, 'Edit Course').click();
    f = modalForm(page);
    await expect(f.locator('input[name=courseName]')).toHaveValue(name);
    await f.locator('input[name=courseName]').fill(`${name} edited`);
    await f.getByPlaceholder('eg. 5').fill('3');
    const updated = page.waitForResponse((r) => ['PATCH', 'PUT'].includes(r.request().method()) && /\/courses\/[a-f0-9]+$/.test(r.url()));
    await f.getByRole('button', { name: /Update|Save/ }).click();
    expect((await updated).status()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await filterByText(page, 'Filter by course name', `${name} edited`);
    row = rows(page).filter({ hasText: `${name} edited` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('3 months');

    // Delete
    await rowAction(row, 'Delete Course').click();
    const deleted = waitApi(page, 'DELETE', /\/courses\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(rows(page).filter({ hasText: name })).toHaveCount(0);
  });
});
