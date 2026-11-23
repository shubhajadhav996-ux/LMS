import { test, expect } from '@playwright/test';
import { openAdmin, rows, modalForm, filterByText, rowAction, confirmDialog, uniqueName, waitApi, pickCourse, anyWrite } from './admin-helpers';

test.describe('Admin: Course Materials', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'course-materials');
    await expect(page.getByRole('heading', { name: 'Course Materials Library' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
  });

  test('list shows columns and row actions', async ({ page }) => {
    for (const h of ['Content', 'Type', 'Course / Module', 'Status', 'Access', 'Uploaded By', 'Actions'])
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    for (const a of ['View Material', 'Edit Material', 'Delete Material']) await expect(rowAction(rows(page).first(), a)).toBeVisible();
  });

  test('Add Material: empty form shows required errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Material' }).click();
    const f = modalForm(page);
    await f.getByRole('button', { name: 'Add Material' }).click();
    await expect(f).toBeVisible();
    await expect(f.getByText('Title is required.', { exact: true })).toBeVisible();
    await expect(f.getByText('Module title is required.')).toBeVisible();
    await expect(f.getByText(/select a course|course is required/i)).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('create, edit and delete a "QA Test" link material', async ({ page }) => {
    const title = uniqueName('Link').slice(0, 50);
    await page.getByRole('button', { name: 'Add Material' }).click();
    let f = modalForm(page);
    await f.getByPlaceholder('e.g. Introduction to React Hooks').fill(title);
    await pickCourse(f);
    await f.getByRole('button', { name: 'Add Link' }).click();
    await f.getByPlaceholder('https://example.com/resource').fill('https://example.com/qa-test');
    await f.getByPlaceholder('Module 1 - Frontend Basics').fill('QA Test Module');
    await f.locator('select').last().selectOption('draft');
    const created = waitApi(page, 'POST', /\/course-content\/resources|\/materials/);
    await f.getByRole('button', { name: 'Add Material' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await filterByText(page, 'Filter by content title', title);
    let row = rows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Link/);
    await expect(row).toContainText(/Draft/i);

    await rowAction(row, 'Edit Material').click();
    f = modalForm(page);
    await expect(f.getByPlaceholder('e.g. Introduction to React Hooks')).toHaveValue(title);
    await f.getByPlaceholder('e.g. Introduction to React Hooks').fill(`${title.slice(0, 43)} edited`);
    await f.locator('select').last().selectOption('published');
    const updated = anyWrite(page, /\/course-content\/resources\/|\/materials\//);
    await f.getByRole('button', { name: /Update|Save/ }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await filterByText(page, 'Filter by content title', `${title.slice(0, 43)} edited`);
    row = rows(page).filter({ hasText: 'edited' }).filter({ hasText: title.slice(0, 30) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Published/i);

    await rowAction(row, 'Delete Material').click();
    const deleted = waitApi(page, 'DELETE', /\/course-content\/resources\/|\/materials\//);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });
});
