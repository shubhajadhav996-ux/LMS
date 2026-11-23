import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openAdmin, rows, modalForm, filterByText, rowAction, confirmDialog, uniqueName, waitApi, isoDate, dateOffset } from './admin-helpers';

const COURSE = /QA Test Notif Course 2311/i;

function randomSlot() {
  const startDays = 90 + Math.floor(Math.random() * 250);
  const hour = 6 + Math.floor(Math.random() * 14);
  const hh = (h: number) => String(h).padStart(2, '0') + ':00';
  return { start: isoDate(dateOffset(startDays)), end: isoDate(dateOffset(startDays + 3)), startTime: hh(hour), endTime: hh(hour + 1) };
}

async function findBatch(page: Page, name: string) {
  await filterByText(page, 'Filter by batch name', name);
  return rows(page).filter({ hasText: name });
}

test.describe('Admin: Batches', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'batches');
    await expect(page.getByRole('heading', { name: 'Batches Management' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('Create Batch: empty form shows required errors', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    const f = modalForm(page);
    await f.getByRole('button', { name: 'Create Batch' }).click();
    for (const msg of ['Batch name is required', 'Please select a course', 'Start date is required', 'End date is required'])
      await expect(f.getByText(msg)).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('end date before start date is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    const f = modalForm(page);
    await f.locator('input[name=batchName]').fill(uniqueName('Batch bad dates'));
    await f.locator('input[name=startDate]').fill(isoDate(dateOffset(100)));
    await f.locator('input[name=endDate]').fill(isoDate(dateOffset(95)));
    await f.getByRole('button', { name: 'Create Batch' }).click();
    await expect(f.getByText(/end date.*(after|before|later)/i).first()).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('create, edit, cancel and delete a "QA Test" batch', async ({ page }) => {
    const name = uniqueName('Admin Batch');
    const slot = randomSlot();
    await page.getByRole('button', { name: 'Create Batch' }).first().click();
    let f = modalForm(page);
    await f.locator('input[name=batchName]').fill(name);
    await f.getByRole('button', { name: /Select Course/ }).click();
    await f.getByRole('button', { name: COURSE }).first().click();
    await f.locator('input[name=startDate]').fill(slot.start);
    await f.locator('input[name=endDate]').fill(slot.end);
    await f.locator('input[name=studentCapacity]').fill('15');
    await f.locator('select[name=mode]').selectOption('online');
    await f.getByPlaceholder('Enter Google Meet link').fill('https://meet.google.com/qat-estb-atc');
    await f.locator('select[name=scheduleType]').selectOption('daily');
    await f.locator('input[name=startTime]').fill(slot.startTime);
    await f.locator('input[name=endTime]').fill(slot.endTime);
    const created = waitApi(page, 'POST', /\/batches$/);
    await f.getByRole('button', { name: 'Create Batch' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBe(201);
    await expect(f).toBeHidden({ timeout: 30_000 });

    let row = await findBatch(page, name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Upcoming/);
    await expect(row).toContainText(/Online/i);

    // Edit capacity and mode
    await rowAction(row, 'Edit Batch').click();
    f = modalForm(page);
    await expect(f.locator('input[name=batchName]')).toHaveValue(name);
    await f.locator('input[name=studentCapacity]').fill('25');
    await f.locator('select[name=mode]').selectOption('offline');
    const updated = page.waitForResponse((r) => ['PATCH', 'PUT'].includes(r.request().method()) && /\/batches\/[a-f0-9]+$/.test(r.url()));
    await f.getByRole('button', { name: 'Update Batch' }).click();
    const up = await updated;
    expect(up.status(), await up.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });
    row = rows(page).filter({ hasText: name });
    await expect(row).toContainText(/Offline/i);

    // Cancel the batch (a reason is required), then delete it
    await rowAction(row, 'Cancel Batch').click();
    const dlg = page.locator('[role=dialog], form, div.fixed').filter({ has: page.locator('textarea') }).last();
    await dlg.locator('textarea').fill('QA Test cleanup');
    const cancelled = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/batches\/[a-f0-9]+\/status$/.test(r.url()));
    await dlg.getByRole('button', { name: /Cancel Batch|Confirm|Yes/ }).last().click();
    expect((await cancelled).status()).toBeLessThan(300);
    await expect(row).toContainText(/Cancelled/i);

    await rowAction(row, 'Delete Batch').click();
    const deleted = waitApi(page, 'DELETE', /\/batches\/[a-f0-9]+$/);
    await confirmDialog(page);
    expect((await deleted).status()).toBeLessThan(300);
    await expect(rows(page).filter({ hasText: name })).toHaveCount(0);
  });
});
