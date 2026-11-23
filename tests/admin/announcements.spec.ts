import { test, expect } from '@playwright/test';
import { openAdmin, rows, modalForm, filterByText, rowAction, confirmDialog, uniqueName, waitApi, pickCourse, anyWrite, isoDateTimeLocal, dateOffset } from './admin-helpers';

async function fillAnnouncement(page: import('@playwright/test').Page, title: string) {
  const f = modalForm(page);
  await f.locator('input[name=title]').fill(title);
  await f.locator('textarea[name=description]').fill(`${title}: automated QA check, please ignore.`);
  await f.locator('select').first().selectOption('course');
  await f.locator('select[name=audienceTarget]').selectOption('trainers');
  await pickCourse(f);
  await f.locator('select[name=priority]').selectOption('normal');
  return f;
}

test.describe('Admin: Announcements', () => {
  // At 1440 px the Delete button is pushed past the right edge (see the layout test below), so CRUD runs at 1600 px.
  test.use({ viewport: { width: 1600, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'announcements');
    await expect(page.getByRole('heading', { name: 'Announcement Management' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
  });

  test('Add announcement: empty form shows required errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Add announcement' }).click();
    const f = modalForm(page);
    await f.getByRole('button', { name: 'Publish' }).click();
    await expect(f.getByText('Announcement title is required')).toBeVisible();
    await expect(f.getByText('Message / description is required')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a schedule time in the past is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Add announcement' }).click();
    const f = await fillAnnouncement(page, uniqueName('Past schedule'));
    await f.locator('input[name=scheduledFor]').fill(isoDateTimeLocal(dateOffset(-2)));
    await f.getByRole('button', { name: 'Publish' }).click();
    await expect(f).toBeVisible();
    await expect(page.getByText(/past|future/i).first()).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('save a draft, edit it, then delete it', async ({ page }) => {
    const title = uniqueName('Admin Draft');
    await page.getByRole('button', { name: 'Add announcement' }).click();
    let f = await fillAnnouncement(page, title);
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
    await f.locator('select[name=priority]').selectOption('important');
    const updated = anyWrite(page, /\/announcements\/[a-f0-9]+$/);
    await f.getByRole('button', { name: /Save as Draft|Update|Save/ }).first().click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await filterByText(page, 'Filter by title or message', `${title} edited`);
    row = rows(page).filter({ hasText: `${title} edited` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Important/i);

    await rowAction(row, 'Delete Announcement').click();
    const deleted = waitApi(page, 'DELETE', /\/announcements\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });

  test('publish to trainers of a course, then delete it', async ({ page }) => {
    const title = uniqueName('Admin Published');
    await page.getByRole('button', { name: 'Add announcement' }).click();
    const f = await fillAnnouncement(page, title);
    const created = waitApi(page, 'POST', /\/announcements$/);
    await f.getByRole('button', { name: 'Publish' }).click();
    expect((await created).status()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    await filterByText(page, 'Filter by title or message', title);
    const row = rows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Published/i);
    await expect(row).toContainText(/Course — Trainers/i);
    await expect(rowAction(row, 'Published announcements cannot be edited')).toBeDisabled();

    await rowAction(row, 'Delete Announcement').click();
    const deleted = waitApi(page, 'DELETE', /\/announcements\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(row).toHaveCount(0);
  });

  test.describe('layout at 1440 px', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('row action buttons fit inside the window', async ({ page }) => {
      const lastBtn = rows(page).first().locator('td').last().locator('button').last();
      await expect(lastBtn).toBeVisible();
      const box = await lastBtn.boundingBox();
      test.info().annotations.push({ type: 'observed', description: `last action button right edge ${Math.round(box!.x + box!.width)} px, window 1440 px` });
      expect(box!.x + box!.width, 'Delete button should be inside the window').toBeLessThanOrEqual(1440);
    });
  });
});
