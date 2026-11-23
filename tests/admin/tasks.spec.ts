import { test, expect } from '@playwright/test';
import { openAdmin, rows, modalForm, filterByText, rowAction, confirmDialog, uniqueName, waitApi, pickCourse, anyWrite, isoDateTimeLocal, dateOffset } from './admin-helpers';

test.describe('Admin: Task Management', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'task-management');
    await expect(page.getByRole('heading', { name: 'Task Management' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
  });

  test('Assign Task: empty form and past due date are rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Assign Task' }).first().click();
    const f = modalForm(page);
    await f.getByRole('button', { name: 'Assign Task' }).click();
    await expect(f.getByText('Title is required.')).toBeVisible();
    await expect(f.getByText('Please select a course.')).toBeVisible();
    await expect(f.getByText('Due date and time are required.')).toBeVisible();
    await f.getByLabel('Title*').fill(uniqueName('Past'));
    await f.getByLabel('Due Date & Time*').fill(isoDateTimeLocal(dateOffset(-1)));
    await f.getByRole('button', { name: 'Assign Task' }).click();
    await expect(f.getByText('Due date must be in the future.')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('create, edit and delete a "QA Test" task for trainers', async ({ page }) => {
    const title = uniqueName('Admin Task').slice(0, 50);
    await page.getByRole('button', { name: 'Assign Task' }).first().click();
    let f = modalForm(page);
    await f.getByLabel('Title*').fill(title);
    await f.getByLabel('Description(optional)').fill('QA Test: created by the Playwright suite. Safe to ignore.');
    await f.getByLabel('Audience*').selectOption('trainer');
    await pickCourse(f);
    await f.getByLabel('Due Date & Time*').fill(isoDateTimeLocal(dateOffset(7), 17, 0));
    await f.getByLabel('Priority*').selectOption('low');
    const created = waitApi(page, 'POST', /\/tasks$/);
    await f.getByRole('button', { name: 'Assign Task' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await page.getByRole('tab', { name: /^Trainers/ }).click();
    await filterByText(page, 'Filter by title or description', title);
    let row = rows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Low/);

    await rowAction(row, 'Edit Task').click();
    f = modalForm(page);
    await expect(f.getByLabel('Title*')).toHaveValue(title);
    await f.getByLabel('Priority*').selectOption('high');
    const updated = anyWrite(page, /\/tasks\/[a-f0-9]+$/);
    await f.getByRole('button', { name: /Update|Save/ }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText(/High/);

    // Task details page, then delete from there
    await rowAction(row, 'View Task').click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('QA Test Notif Course 2311').first()).toBeVisible();
    await expect(page.getByText('Total Assignees')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleted = waitApi(page, 'DELETE', /\/tasks\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(page).toHaveURL(/\/admin\/task-management(\?.*)?$/);
    await page.getByRole('tab', { name: /^Trainers/ }).click();
    await page.getByPlaceholder(/Search/).last().fill(title);
    await expect(row).toHaveCount(0);
  });
});
