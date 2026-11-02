import { test, expect } from './fixtures';
import * as path from 'path';
import { openSection, tableRows, uniqueName, env, dateOffset, isoDateTimeLocal } from './helpers';
import type { Page } from '@playwright/test';

const TXT = path.join(__dirname, '..', 'test-data', 'qa-test-unsupported.txt');
const form = (page: Page) => page.locator('form').filter({ has: page.getByRole('button', { name: 'Create Task' }) }).last();

async function pickCourse(page: Page, course: RegExp) {
  const f = form(page);
  await f.getByText('Select course...').click();
  await f.locator('span.block.truncate').filter({ hasText: course }).first().click();
}

test.describe('Task Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trainer/dashboard');
    await openSection(page, 'Task Management');
    await expect(page.getByRole('heading', { name: 'Task Management' })).toBeVisible();
  });

  test('list and summary are shown', async ({ page }) => {
    for (const h of ['Task Title', 'Course', 'Batch', 'Students', 'Due Date', 'Priority', 'Status', 'Completions', 'Actions']) {
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    }
    await expect(page.getByText(/total tasks/i).first()).toBeVisible();
    await expect(page.getByText(/Showing \d+ to \d+ of \d+ Tasks/)).toBeVisible();
  });

  test('form validation: empty form', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = form(page);
    await f.getByRole('button', { name: 'Create Task' }).click();
    await expect(f.getByText('Title is required.')).toBeVisible();
    await expect(f.getByText('Please select a course.')).toBeVisible();
    await expect(f.getByText('Due date and time are required.')).toBeVisible();
    await expect(f.getByText('Please fix the highlighted fields.')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('form validation: title max 50, description max 500', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = form(page);
    await f.getByPlaceholder(/Build a responsive landing page/).fill('T'.repeat(60));
    await f.locator('textarea').fill('D'.repeat(520));
    expect((await f.getByPlaceholder(/Build a responsive landing page/).inputValue()).length).toBe(50);
    expect((await f.locator('textarea').inputValue()).length).toBe(500);
    await expect(f.getByText('50/50')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('form validation: due date in the past', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = form(page);
    await f.getByPlaceholder(/Build a responsive landing page/).fill(uniqueName('Past'));
    await pickCourse(page, /testing\s+profile/i);
    await f.locator('input[type=datetime-local]').fill(isoDateTimeLocal(dateOffset(-1)));
    await f.getByRole('button', { name: 'Create Task' }).click();
    await expect(f.getByText('Due date must be in the future.')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('specific batch(es) scope requires a batch', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = form(page);
    await pickCourse(page, /testing\s+profile/i);
    await f.locator('select').first().selectOption('batch');
    await expect(f.getByText('Only members of the selected batch(es) will get this task.')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('unsupported attachment (.txt) is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = form(page);
    await f.locator('input[type=file]').setInputFiles(TXT);
    await expect(page.getByText(/Unsupported file type/i)).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('create a "QA Test" task for the whole course', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    const title = uniqueName('Task');
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = form(page);
    await f.getByPlaceholder(/Build a responsive landing page/).fill(title);
    await f.locator('textarea').fill('QA Test: created by Playwright suite. Safe to ignore.');
    await pickCourse(page, /testing\s+profile/i);
    await f.locator('input[type=datetime-local]').fill(isoDateTimeLocal(dateOffset(7), 17, 0));
    await f.locator('select').nth(1).selectOption('low');
    await f.getByRole('button', { name: 'Create Task' }).click();
    await expect(f).toBeHidden({ timeout: 30_000 });

    const row = tableRows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/All batches/i);
    await expect(row).toContainText(/assigned/i);
  });

  test('@known-bug SCRUM-199 Edit and Delete are visible on first load', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-199: task row actions hidden until filters change' });
    const row = tableRows(page).filter({ hasText: 'QA Test' }).first();
    await expect(row.locator('[title="Edit Task"]')).toBeVisible();
    await expect(row.locator('[title="Delete Task"]')).toBeVisible();
  });

  test('@known-bug SCRUM-200 trainer can view task details', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-200: "Task details are available for admins only"' });
    await tableRows(page).filter({ hasText: 'QA Test' }).first().locator('[title="View Task"]').click();
    await expect(page.getByText(/available for admins only/i)).toHaveCount(0);
    await expect(page.getByText(/^due date$/i)).toBeVisible();
    await expect(page.getByText(/^students$/i).last()).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  });

  test('@known-bug SCRUM-201 cannot create a task for a course with no students', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false (this check may create a task if the bug is present)');
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-201: task saved with 0 recipients (0/0)' });
    // "Testing Profile" has no active students. Expected: a warning and no task created.
    const title = uniqueName('Zero recipients');
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = form(page);
    await f.getByPlaceholder(/Build a responsive landing page/).fill(title);
    await pickCourse(page, /testing\s+profile/i);
    await f.locator('input[type=datetime-local]').fill(isoDateTimeLocal(dateOffset(7), 18, 0));
    await f.getByRole('button', { name: 'Create Task' }).click();
    await page.waitForTimeout(4000);
    await expect(tableRows(page).filter({ hasText: title }), 'a task with no recipients should not be saved').toHaveCount(0);
  });
});
