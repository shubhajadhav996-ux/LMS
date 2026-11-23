import { test, expect } from '@playwright/test';
import { openAdmin, rows, rowAction } from './admin-helpers';

test.describe('Admin: Dashboard', () => {
  test('greeting, stat tiles and sections load', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening),/ })).toBeVisible();
    for (const tile of [/^Students \d/, /^Batches running \d/, /^Trainers \d/, /^Courses \d/, /^Active subscriptions \d/])
      await expect(page.getByRole('button', { name: tile }).first()).toBeVisible();
    for (const h of ['Needs your action', "Today's sessions", 'Ongoing batch health', 'Batches starting soon', 'Announcements going out'])
      await expect(page.getByRole('heading', { name: h })).toBeVisible();
  });

  test('stat tiles open their modules', async ({ page }) => {
    for (const [tile, url] of [
      [/^Students \d/, /\/admin\/students/],
      [/^Courses \d/, /\/admin\/courses/],
      [/^Trainers \d/, /\/admin\/trainers/],
      [/^Batches running \d/, /\/admin\/batches/],
    ] as const) {
      await page.goto('/admin/dashboard');
      await expect(page.getByRole('button', { name: tile }).first()).toBeVisible({ timeout: 60_000 });
      await page.getByRole('button', { name: tile }).first().click();
      await expect(page).toHaveURL(url);
    }
  });

  test('student count on the dashboard matches Students page', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page.getByRole('button', { name: /^Students \d/ }).first()).toBeVisible({ timeout: 60_000 });
    const tile = await page.getByRole('button', { name: /^Students \d/ }).first().innerText();
    const dash = Number(tile.replace(/\s+/g, ' ').match(/Students\s*(\d+)/)![1]);
    await openAdmin(page, 'students');
    await expect(rows(page).filter({ hasText: '@' }).first()).toBeVisible({ timeout: 60_000 });
    const all = await page.getByRole('button', { name: /^All\s*\d+/ }).first().innerText();
    expect(Number(all.replace(/\s+/g, ' ').match(/All\s*(\d+)/)![1])).toBe(dash);
  });

  test('@known-bug SCRUM-362 active trainer count on the dashboard matches Trainers page', async ({ page }) => {
    await page.goto('/admin/dashboard');
    const tile = (await page.getByRole('button', { name: /^Trainers \d/ }).first().innerText()).replace(/\s+/g, ' ');
    const dashActive = Number(tile.match(/(\d+) active/)![1]);
    await openAdmin(page, 'trainers');
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
    const chip = (await page.getByRole('button', { name: /^Active\s*\d+/ }).first().innerText()).replace(/\s+/g, ' ');
    const pageActive = Number(chip.match(/Active\s*(\d+)/)![1]);
    test.info().annotations.push({ type: 'observed', description: `dashboard "${tile}" vs Trainers page "${chip}"` });
    expect(pageActive, 'Trainers page Active count should equal the dashboard active count').toBe(dashActive);
  });
});

test.describe('Admin: Payments (read only: refunds are never clicked)', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'payments');
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
  });

  test('list shows payment columns', async ({ page }) => {
    for (const h of ['Payment # / Date', 'Student', 'Plan', 'Amount', 'Method', 'Status', 'Actions'])
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    await expect(rows(page).first()).toContainText(/PAY-\d{8}-\d+/);
    await expect(rows(page).first()).toContainText(/₹/);
  });

  test('receipt opens for a payment', async ({ page }) => {
    const row = rows(page).first();
    const id = (await row.innerText()).match(/PAY-\d{8}-\d+/)![0];
    const popup = page.waitForEvent('popup', { timeout: 10_000 }).catch(() => null);
    await rowAction(row, 'View receipt').click();
    const p = await popup;
    const target = p ?? page;
    await expect(target.getByText(id).first()).toBeVisible({ timeout: 30_000 });
  });

  test('refunded payments cannot be refunded again', async ({ page }) => {
    const refunded = rows(page).filter({ has: page.locator('[title="Cannot refund a refunded payment"]') });
    test.skip((await refunded.count()) === 0, 'no refunded payment on page 1');
    await expect(refunded.first().locator('[title="Cannot refund a refunded payment"]')).toBeDisabled();
    await expect(refunded.first()).toContainText(/Refunded/i);
  });
});
