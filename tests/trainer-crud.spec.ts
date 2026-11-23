import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { rows, modalForm, filterByText, rowAction, confirmDialog, waitApi, pickCourse, anyWrite, QA_COURSE } from './admin/admin-helpers';
import { uniqueName, dateOffset, isoDate, isoDateTimeLocal } from './helpers';

/**
 * Trainer portal: create, edit and delete in every module the trainer can change.
 * Everything is created in the trainer's own test course "QA Test Notif Course 2311" (no students),
 * named "QA Test ...", and deleted again at the end of each test.
 */

async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')), { timeout: 45_000 });
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
}

function randomSlot() {
  const startDays = 90 + Math.floor(Math.random() * 250);
  const hour = 6 + Math.floor(Math.random() * 14);
  const hh = (h: number) => String(h).padStart(2, '0') + ':00';
  return { start: isoDate(dateOffset(startDays)), end: isoDate(dateOffset(startDays + 3)), startTime: hh(hour), endTime: hh(hour + 1) };
}

test.describe('Trainer: Batches', () => {
  test('create, edit and cancel a "QA Test" batch', async ({ page }) => {
    await open(page, '/trainer/batches', 'Batches');
    const name = uniqueName('Trainer Batch');
    const slot = randomSlot();
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    let f = modalForm(page);
    await f.locator('input[name=batchName]').fill(name);
    await f.getByRole('button', { name: /Select Course/ }).click();
    await f.getByRole('button', { name: QA_COURSE }).first().click();
    await f.locator('input[name=startDate]').fill(slot.start);
    await f.locator('input[name=endDate]').fill(slot.end);
    await f.locator('input[name=studentCapacity]').fill('10');
    await f.locator('select[name=mode]').selectOption('offline');
    await f.locator('select[name=scheduleType]').selectOption('daily');
    await f.locator('input[name=startTime]').fill(slot.startTime);
    await f.locator('input[name=endTime]').fill(slot.endTime);
    const created = waitApi(page, 'POST', /\/batches$/);
    await f.getByRole('button', { name: 'Create Batch' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBe(201);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await filterByText(page, 'Filter by batch name', name);
    const row = rows(page).filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Upcoming/);

    await rowAction(row, 'Edit Batch').click();
    f = modalForm(page);
    await expect(f.locator('input[name=batchName]')).toHaveValue(name);
    await f.locator('input[name=studentCapacity]').fill('12');
    const updated = anyWrite(page, /\/batches\/[a-f0-9]+$/);
    await f.getByRole('button', { name: 'Update Batch' }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await rowAction(row, 'Cancel Batch').click();
    const dlg = page.locator('[role=dialog], form, div.fixed').filter({ has: page.locator('textarea') }).last();
    await dlg.locator('textarea').fill('QA Test cleanup');
    const cancelled = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/batches\/[a-f0-9]+\/status$/.test(r.url()));
    await dlg.getByRole('button', { name: /Cancel Batch|Confirm|Yes/ }).last().click();
    expect((await cancelled).status()).toBeLessThan(300);
    await expect(row).toContainText(/Cancelled/i);

    // Delete, if the trainer is allowed to
    const del = rowAction(row, 'Delete Batch');
    test.info().annotations.push({ type: 'observed', description: `trainer Delete Batch offered: ${(await del.count()) > 0}` });
    if ((await del.count()) > 0 && (await del.isEnabled())) {
      await del.click();
      const deleted = waitApi(page, 'DELETE', /\/batches\/[a-f0-9]+$/);
      await confirmDialog(page);
      expect((await deleted).status()).toBeLessThan(300);
      await expect(row).toHaveCount(0);
    }
  });
});

test.describe('Trainer: Announcements', () => {
  async function fill(page: Page, title: string) {
    const f = modalForm(page);
    await f.locator('input[name=title]').fill(title);
    await f.locator('textarea[name=description]').fill(`${title}: automated QA check, please ignore.`);
    await f.locator('select[name=audienceTarget]').selectOption('trainers');
    await pickCourse(f);
    return f;
  }

  test('save a draft, edit it, publish another, delete both', async ({ page }) => {
    await open(page, '/trainer/announcements', 'Announcement Management');
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
    const title = uniqueName('Trainer Draft');
    await page.getByRole('button', { name: 'Add announcement' }).click();
    let f = await fill(page, title);
    const created = waitApi(page, 'POST', /\/announcements$/);
    await f.getByRole('button', { name: 'Save as Draft' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await filterByText(page, 'Filter by title or message', title);
    let row = rows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Draft/i);

    await rowAction(row, 'Edit Announcement').click();
    f = modalForm(page);
    await expect(f.locator('input[name=title]')).toHaveValue(title);
    await f.locator('input[name=title]').fill(`${title} edited`);
    await f.locator('select[name=priority]').selectOption('urgent');
    const updated = anyWrite(page, /\/announcements\/[a-f0-9]+$/);
    await f.getByRole('button', { name: /Save as Draft|Update|Save/ }).first().click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await filterByText(page, 'Filter by title or message', `${title} edited`);
    row = rows(page).filter({ hasText: `${title} edited` });
    await expect(row).toContainText(/Urgent/i);

    await rowAction(row, 'Delete Announcement').click();
    const deleted = waitApi(page, 'DELETE', /\/announcements\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);

    // Publish one and delete it
    const pub = uniqueName('Trainer Published');
    await page.getByRole('button', { name: 'Add announcement' }).click();
    f = await fill(page, pub);
    const created2 = waitApi(page, 'POST', /\/announcements$/);
    await f.getByRole('button', { name: 'Publish' }).click();
    expect((await created2).status()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await filterByText(page, 'Filter by title or message', pub);
    row = rows(page).filter({ hasText: pub });
    await expect(row).toContainText(/Published/i);
    await rowAction(row, 'Delete Announcement').click();
    const deleted2 = waitApi(page, 'DELETE', /\/announcements\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted2).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });
});

test.describe('Trainer: Task Management', () => {
  test('a course with no students cannot get a task', async ({ page }) => {
    await open(page, '/trainer/task-management', 'Task Management');
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    const f = modalForm(page);
    await f.getByLabel('Title*').fill(uniqueName('No students'));
    await f.getByLabel('Description*').fill('QA Test: should not be saved.');
    await pickCourse(f); // QA Test Notif Course 2311 has no students
    await f.getByLabel('Due Date & Time*').fill(isoDateTimeLocal(dateOffset(7), 17, 0));
    await f.getByRole('button', { name: 'Create Task' }).click();
    await expect(f.getByText(/No students are enrolled in this course/)).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  // Uses "Testing Trainer Flow" (one test student), because a task needs at least one recipient.
  test('create, edit and delete a "QA Test" task', async ({ page }) => {
    await open(page, '/trainer/task-management', 'Task Management');
    const title = uniqueName('Trainer Task').slice(0, 50);
    await page.getByRole('button', { name: 'Create Task' }).first().click();
    let f = modalForm(page);
    await f.getByLabel('Title*').fill(title);
    await f.getByLabel('Description*').fill('QA Test: created by the Playwright suite. Safe to ignore.');
    await f.getByText('Select course...').first().click();
    await f.getByText(/^Testing Trainer Flow$/i).last().click();
    await f.getByLabel('Due Date & Time*').fill(isoDateTimeLocal(dateOffset(7), 17, 0));
    await f.getByLabel('Priority*').selectOption('low');
    const created = waitApi(page, 'POST', /\/tasks$/);
    await f.getByRole('button', { name: 'Create Task' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await page.getByRole('tab', { name: /Assigned by me/ }).or(page.getByRole('button', { name: /^Assigned by me/ })).first().click();
    await filterByText(page, 'Filter by title or description', title);
    const row = rows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Low/);

    await rowAction(row, 'Edit Task').click();
    f = modalForm(page);
    await expect(f.getByLabel('Title*')).toHaveValue(title);
    await f.getByLabel('Priority*').selectOption('urgent');
    const updated = anyWrite(page, /\/tasks\/[a-f0-9]+$/);
    await f.getByRole('button', { name: /Update|Save/ }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText(/Urgent/);

    await rowAction(row, 'Delete Task').click();
    const deleted = waitApi(page, 'DELETE', /\/tasks\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });
});

test.describe('Trainer: Course Material', () => {
  test('create, edit and delete a "QA Test" link', async ({ page }) => {
    await open(page, '/trainer/resources', 'Course Material');
    const title = uniqueName('Trainer Link').slice(0, 50);
    await page.getByRole('button', { name: 'Add Material' }).click();
    let f = modalForm(page);
    await f.getByPlaceholder('e.g. Introduction to React Hooks').fill(title);
    await pickCourse(f);
    await f.getByRole('button', { name: 'Add Link' }).click();
    await f.getByPlaceholder(/https:\/\//).fill('https://example.com/qa-test');
    await f.getByPlaceholder('Module 1 - Frontend Basics').fill('QA Test Module');
    const created = waitApi(page, 'POST', /\/course-content\/resources|\/materials/);
    await f.getByRole('button', { name: 'Add Material' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await filterByText(page, 'Filter by content title', title);
    let row = rows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Link/);

    await rowAction(row, 'Edit Material').click();
    f = modalForm(page);
    await expect(f.getByPlaceholder('e.g. Introduction to React Hooks')).toHaveValue(title);
    const edited = `${title.slice(0, 43)} edited`;
    await f.getByPlaceholder('e.g. Introduction to React Hooks').fill(edited);
    const updated = anyWrite(page, /\/course-content\/resources\/|\/materials\//);
    await f.getByRole('button', { name: /Update|Save/ }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await filterByText(page, 'Filter by content title', edited);
    row = rows(page).filter({ hasText: edited });
    await expect(row).toHaveCount(1);

    await rowAction(row, 'Delete Material').click();
    const deleted = waitApi(page, 'DELETE', /\/course-content\/resources\/|\/materials\//);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });
});

test.describe('Trainer: Assignments', () => {
  test('create, edit and delete a "QA Test" assignment', async ({ page }) => {
    await open(page, '/trainer/assignments', 'Assignments');
    const title = uniqueName('Assignment');
    await page.getByRole('button', { name: 'Create assignment' }).click();
    let f = modalForm(page);
    await f.getByPlaceholder('React Hooks Assignment').fill(title);
    await f.locator('select').first().selectOption({ label: 'QA Test Notif Course 2311' });
    await f.getByPlaceholder('e.g. 7').fill('5');
    await f.locator('select').filter({ has: page.locator('option', { hasText: 'Select Difficulty' }) }).selectOption({ label: 'Easy' });
    await f.locator('select').filter({ has: page.locator('option', { hasText: 'Select Type' }) }).selectOption({ label: 'Individual' });
    await f.locator('select').filter({ has: page.locator('option', { hasText: 'Archived' }) }).selectOption({ label: 'Draft' });
    await f.getByPlaceholder('100').fill('50');
    const created = waitApi(page, 'POST', /assignments$/);
    await f.getByRole('button', { name: 'Create Assignment' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await page.getByPlaceholder('Search assignments, courses or creators').fill(title);
    let row = rows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Easy/i);
    await expect(row).toContainText('50');

    await rowAction(row, 'Edit assignment').click();
    f = modalForm(page);
    await expect(f.getByPlaceholder('React Hooks Assignment')).toHaveValue(title);
    await f.getByPlaceholder('React Hooks Assignment').fill(`${title} edited`);
    await f.getByPlaceholder('100').fill('80');
    const updated = anyWrite(page, /assignments\/[a-f0-9]+$/);
    await f.getByRole('button', { name: /Update|Save/ }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await page.getByPlaceholder('Search assignments, courses or creators').fill(`${title} edited`);
    row = rows(page).filter({ hasText: `${title} edited` });
    await expect(row).toContainText('80');

    await rowAction(row, 'More actions').click();
    await page.getByRole('menuitem', { name: /Delete/ }).or(page.getByRole('button', { name: /^Delete/ })).first().click();
    const deleted = waitApi(page, 'DELETE', /assignments\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });
});
