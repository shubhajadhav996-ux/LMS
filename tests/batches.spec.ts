import { test, expect } from './fixtures';
import { openSection, tableRows, uniqueName, env, dateOffset, isoDate, toast } from './helpers';
import type { Page } from '@playwright/test';

/**
 * The backend rejects a batch that overlaps another session of the same trainer,
 * so every run picks a random 3-day window 3 to 11 months ahead (start must be within a year) and a random hour.
 */
function randomSlot() {
  const startDays = 90 + Math.floor(Math.random() * 250); // start must be within 1 year
  const hour = 6 + Math.floor(Math.random() * 14);
  const hh = (h: number) => String(h).padStart(2, '0') + ':00';
  return {
    start: isoDate(dateOffset(startDays)),
    end: isoDate(dateOffset(startDays + 3)),
    startTime: hh(hour),
    endTime: hh(hour + 1),
  };
}

const createBatchModal = (page: Page) =>
  page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Create Batch' }) })
    .filter({ has: page.getByRole('button', { name: 'Cancel' }) })
    .last();

test.describe('Batches', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trainer/dashboard');
    await openSection(page, 'Batches');
    await expect(page.getByRole('heading', { name: 'Batches', exact: true })).toBeVisible();
  });

  test('batch list loads', async ({ page }) => {
    await expect(tableRows(page).first()).toBeVisible();
    await expect(page.getByText(/Showing \d+ to \d+ of \d+ Batches/)).toBeVisible();
  });

  test('Create Batch: empty form shows required-field errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    const modal = createBatchModal(page);
    await modal.getByRole('button', { name: 'Create Batch' }).click();
    for (const msg of [
      'Batch name is required',
      'Please select a course',
      'Start date is required',
      'End date is required',
      'Enter a valid student capacity',
      'Please select a schedule type',
    ]) {
      await expect(modal.getByText(msg)).toBeVisible();
    }
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();
  });

  test('Create Batch: course list offers only the trainer\'s courses', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    const modal = createBatchModal(page);
    await modal.getByRole('button', { name: /Select Course/ }).click();
    const options = modal.getByRole('button', { name: /\(\d+ months?\)/ });
    await expect(options).toHaveCount(2);
    await modal.getByRole('button', { name: 'Cancel' }).click();
  });

  test('create a "QA Test" batch on Testing Profile', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    const name = uniqueName('Batch');
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    const modal = createBatchModal(page);
    await modal.locator('input[name=batchName]').fill(name);
    await modal.getByRole('button', { name: /Select Course/ }).click();
    await modal.getByRole('button', { name: /Testing profile/i }).click();
    const slot = randomSlot();
    await modal.locator('input[name=startDate]').fill(slot.start);
    await modal.locator('input[name=endDate]').fill(slot.end);
    await modal.locator('input[name=studentCapacity]').fill('20');
    await modal.locator('select[name=mode]').selectOption('offline');
    await modal.locator('select[name=scheduleType]').selectOption('daily');
    await modal.locator('input[name=startTime]').fill(slot.startTime);
    await modal.locator('input[name=endTime]').fill(slot.endTime);

    const started = Date.now();
    const created = page.waitForResponse(
      (r) => /\/api\/v1\/batches$/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 60_000 },
    );
    await modal.getByRole('button', { name: 'Create Batch' }).click();
    const res = await created;
    const seconds = (Date.now() - started) / 1000;
    test.info().annotations.push({ type: 'timing', description: `POST /batches answered ${res.status()} in ${seconds.toFixed(1)} s` });
    expect(res.status(), await res.text()).toBe(201);
    await expect(modal).toBeHidden({ timeout: 30_000 });

    await page.getByPlaceholder(/Search batches/).fill(name);
    await expect(tableRows(page).filter({ hasText: name })).toHaveCount(1);
    await expect(tableRows(page).filter({ hasText: name })).toContainText(/Upcoming/);
  });

  test('@known-bug SCRUM-164 Create Batch saves within 3 seconds', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-164: Create Batch took ~11 s with only a spinner' });
    const name = uniqueName('Batch Speed');
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    const modal = createBatchModal(page);
    await modal.locator('input[name=batchName]').fill(name);
    await modal.getByRole('button', { name: /Select Course/ }).click();
    await modal.getByRole('button', { name: /Testing profile/i }).click();
    const slot = randomSlot();
    await modal.locator('input[name=startDate]').fill(slot.start);
    await modal.locator('input[name=endDate]').fill(slot.end);
    await modal.locator('input[name=studentCapacity]').fill('20');
    await modal.locator('select[name=scheduleType]').selectOption('daily');
    await modal.locator('input[name=startTime]').fill(slot.startTime);
    await modal.locator('input[name=endTime]').fill(slot.endTime);
    const started = Date.now();
    await modal.getByRole('button', { name: 'Create Batch' }).click();
    await expect(modal).toBeHidden({ timeout: 60_000 });
    const seconds = (Date.now() - started) / 1000;
    test.info().annotations.push({ type: 'timing', description: `modal closed after ${seconds.toFixed(1)} s` });
    expect(seconds, 'Create Batch should finish within 3 s').toBeLessThanOrEqual(3);
  });
});
