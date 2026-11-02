import { test, expect } from './fixtures';
import * as path from 'path';
import { openSection, tableRows, uniqueName, env, applyHeaderFilter, dateOffset, isoDateTimeLocal, toast } from './helpers';
import type { Page } from '@playwright/test';

const TXT = path.join(__dirname, '..', 'test-data', 'qa-test-unsupported.txt');
const form = (page: Page) => page.locator('form').filter({ has: page.locator('input[name=title]') }).last();

async function pickCourse(page: Page, course: RegExp) {
  const f = form(page);
  await f.getByText('Select course...').click();
  await f.locator('div', { has: page.locator('input[type=radio]') }).filter({ hasText: course }).last().click();
}

test.describe('Announcements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trainer/dashboard');
    await openSection(page, 'Announcements');
    await expect(page.getByRole('heading', { name: 'Announcements', exact: true })).toBeVisible();
    await expect(tableRows(page).first()).toBeVisible();
  });

  test('list shows title, audience, priority, status, posted by and date', async ({ page }) => {
    for (const h of ['Title', 'Audience', 'Priority', 'Status', 'Posted By', 'Date', 'Actions']) {
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    }
  });

  test('form validation: empty form shows required errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Announcement' }).first().click();
    const f = form(page);
    await f.getByRole('button', { name: 'Publish' }).click();
    await expect(f.getByText('Announcement title is required')).toBeVisible();
    await expect(f.getByText('Message / description is required')).toBeVisible();
    await expect(f.getByText('Please select a course')).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('form validation: whitespace-only title is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Announcement' }).first().click();
    const f = form(page);
    await f.locator('input[name=title]').fill('   ');
    await f.locator('textarea[name=description]').fill('   ');
    await f.getByRole('button', { name: 'Publish' }).click();
    await expect(f.getByText(/title is required/i)).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('form validation: title limited to 150 and message to 1000 characters', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Announcement' }).first().click();
    const f = form(page);
    await f.locator('input[name=title]').fill('A'.repeat(160));
    await f.locator('textarea[name=description]').fill('B'.repeat(1010));
    expect((await f.locator('input[name=title]').inputValue()).length).toBeLessThanOrEqual(150);
    expect((await f.locator('textarea[name=description]').inputValue()).length).toBeLessThanOrEqual(1000);
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a scheduled date in the past is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Announcement' }).first().click();
    const f = form(page);
    await f.locator('input[name=title]').fill(uniqueName('Past schedule (should not save)'));
    await f.locator('textarea[name=description]').fill('QA Test: should be rejected');
    await pickCourse(page, /testing\s+profile/i);
    await f.locator('input[name=scheduledFor]').fill(isoDateTimeLocal(dateOffset(-2)));
    await f.getByRole('button', { name: 'Publish' }).click();
    await expect(f).toBeVisible();
    await expect(page.getByText(/past|future/i).first()).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a .txt attachment is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Announcement' }).first().click();
    const f = form(page);
    await f.locator('input[type=file]').setInputFiles(TXT);
    await expect(page.getByText(/not allowed|unsupported|invalid file|only pdf/i).first()).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('publish a "QA Test" announcement to the trainers of Testing Profile', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    const title = uniqueName('Announcement');
    await page.getByRole('button', { name: 'Create Announcement' }).first().click();
    const f = form(page);
    await f.locator('input[name=title]').fill(title);
    await f.locator('textarea[name=description]').fill(`${title}: automated QA check, please ignore.`);
    await f.locator('select[name=audienceTarget]').selectOption('trainers');
    await pickCourse(page, /testing\s+profile/i);
    await f.locator('select[name=priority]').selectOption('normal');
    await f.getByRole('button', { name: 'Publish' }).click();
    await expect(f).toBeHidden({ timeout: 30_000 });

    const row = tableRows(page).filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Course — Trainers/i);
    await expect(row).toContainText(/published/i);
  });

  test('filter by title finds QA Test announcements', async ({ page }) => {
    await applyHeaderFilter(page, 'Filter by title or message', (p) => p.locator('input').first().fill('QA Test'));
    const rows = tableRows(page);
    await expect(rows.first()).toContainText('QA Test');
    const texts = await rows.allInnerTexts();
    for (const t of texts) expect(t).toMatch(/QA Test/i);
  });

  test('@known-bug SCRUM-179 Edit and Delete are visible for my own announcements on first load', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-179: actions hidden until a filter is applied' });
    // Any announcement I posted that is on page 1 (newest first), without touching filters or page size.
    const mine = tableRows(page).filter({ hasText: /QA Test/ }).filter({ hasNot: page.locator('[title="Only your own announcements can be edited"]') }).first();
    await expect(mine).toBeVisible();
    await expect(mine.locator('[title="Edit Announcement"]')).toBeVisible();
    await expect(mine.locator('[title="Delete Announcement"]')).toBeVisible();
  });

  test('@known-bug SCRUM-180 Delete is not offered on announcements posted by others', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-180: Delete shown on admin announcements' });
    // Show up to 100 rows so announcements by others are not pushed to page 2.
    await page.locator('main select').filter({ has: page.locator('option[value="100"]') }).last().selectOption('100');
    const others = tableRows(page).filter({ has: page.locator('[title="Only your own announcements can be edited"]') });
    await expect(others.first()).toBeVisible();
    const n = await others.count();
    for (let i = 0; i < n; i++) {
      const del = others.nth(i).locator('[title="Delete Announcement"]');
      if ((await del.count()) > 0) await expect(del, `row ${i + 1}: Delete should be hidden or disabled`).toBeDisabled();
    }
  });

  test('@known-bug SCRUM-182 sorting by Date toggles the order', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-182: Date sort does not toggle' });
    const firstTitle = async () => (await tableRows(page).first().locator('td').first().innerText()).trim();
    await page.locator('main thead').getByRole('button', { name: 'Date', exact: true }).click();
    await page.waitForTimeout(800);
    const a = await firstTitle();
    await page.locator('main thead').getByRole('button', { name: 'Date', exact: true }).click();
    await page.waitForTimeout(800);
    const b = await firstTitle();
    expect(b, 'second click should reverse the order').not.toBe(a);
  });
});
