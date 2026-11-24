import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import { openAdmin, rows, rowAction, confirmDialog, waitApi, anyWrite, letterStamp } from './admin-helpers';

/**
 * Subscription Plans in depth: the Features tab (create, edit, deactivate, activate, validation)
 * and the plan editor (features on a plan, LMS upgrades, batch extra charges, placement add-on,
 * variant prices, publish, duplicate, one plan per live-training length).
 * Everything is on "QA Test Notif Course 2311" (no students) and named "QA Test ...".
 * Features can't be deleted (only deactivated), so the QA feature is left Inactive at the end.
 */

const editor = (page: Page) => page.getByRole('form', { name: 'Plan editor' });
const dialog = (page: Page) => page.locator('[role=dialog]').last();

async function openFeatures(page: Page) {
  await openAdmin(page, 'subscription-plans');
  await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Features' }).click();
  await expect(page.getByRole('button', { name: 'New feature' })).toBeVisible();
}

async function newFeature(page: Page, name: string, description = '') {
  await page.getByRole('button', { name: 'New feature' }).click();
  const d = dialog(page);
  await d.getByLabel('Name*').fill(name);
  if (description) await d.getByLabel('Description (optional)').fill(description);
  return d;
}

async function startPlan(page: Page, name: string, duration = '1 month') {
  await page.getByRole('button', { name: 'New plan' }).click();
  const f = editor(page);
  await f.getByRole('button', { name: 'Course*' }).click();
  const search = page.getByPlaceholder(/search/i).last();
  if (await search.isVisible().catch(() => false)) await search.fill('QA Test Notif');
  await page.getByText(/QA Test Notif Course 2311/).last().click();
  await f.getByLabel('Plan name*').fill(name);
  await f.getByLabel('Live training*').selectOption({ label: duration });
  return f;
}

const featureBox = (f: Locator, name: string) => f.getByRole('group').filter({ hasText: '6. Included features' }).getByRole('checkbox', { name: new RegExp(`^${name}`) });

test.describe('Admin: Subscription Plans > Features', () => {
  test.beforeEach(async ({ page }) => openFeatures(page));

  test('feature name is required and limited to 50 characters', async ({ page }) => {
    const d = await newFeature(page, '');
    await d.getByRole('button', { name: 'Create feature' }).click();
    await expect(d.getByText('Feature name is required')).toBeVisible();
    await d.getByLabel('Name*').fill('   ');
    await d.getByRole('button', { name: 'Create feature' }).click();
    await expect(d.getByText('Feature name is required')).toBeVisible();
    await d.getByLabel('Name*').fill('N'.repeat(60));
    expect((await d.getByLabel('Name*').inputValue()).length).toBeLessThanOrEqual(50);
    await d.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a feature name that already exists is refused', async ({ page }) => {
    const existing = (await rows(page).first().locator('td').first().innerText()).trim();
    const d = await newFeature(page, existing.toUpperCase());
    const post = page.waitForResponse((r) => r.request().method() === 'POST' && /feature/i.test(r.url()), { timeout: 10_000 }).catch(() => null);
    await d.getByRole('button', { name: 'Create feature' }).click();
    const res = await post;
    test.info().annotations.push({ type: 'observed', description: `"${existing.toUpperCase()}" -> ${res ? res.status() : 'no request'}` });
    if (res && res.ok()) {
      // Remove the duplicate again (features can only be deactivated)
      await page.getByPlaceholder('Search features').fill(existing.toUpperCase());
      const dup = rows(page).filter({ hasText: existing.toUpperCase() }).filter({ hasText: 'Active' }).first();
      await dup.getByRole('button', { name: 'Deactivate' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
    }
    expect(res?.ok() ?? false, 'a duplicate feature name should be refused').toBe(false);
  });

  test('create, edit, deactivate and activate a "QA Test" feature', async ({ page }) => {
    const name = `QA Test Feature ${letterStamp()}`;
    let d = await newFeature(page, name, 'QA Test feature, safe to ignore');
    const created = waitApi(page, 'POST', /feature/i);
    await d.getByRole('button', { name: 'Create feature' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(d).toBeHidden({ timeout: 30_000 });

    await page.getByPlaceholder('Search features').fill(name);
    let row = rows(page).filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Active');

    await row.getByRole('button', { name: `Edit ${name}` }).click();
    d = dialog(page);
    await expect(d.getByLabel('Name*')).toHaveValue(name);
    await d.getByLabel('Description (optional)').fill('QA Test feature, edited');
    const updated = anyWrite(page, /feature/i);
    await d.getByRole('button', { name: /Save|Update/ }).click();
    expect((await updated).status()).toBeLessThan(300);
    await expect(d).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText('QA Test feature, edited');

    await row.getByRole('button', { name: 'Deactivate' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(row).toContainText('Inactive');
    await row.getByRole('button', { name: 'Activate' }).click();
    const confirm = page.getByRole('alertdialog');
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: 'Activate' }).click();
    await expect(row.locator('td').nth(2)).toHaveText('Active');
    // Leave it inactive: features cannot be deleted
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(row).toContainText('Inactive');
  });

  test('filter by status shows only that status', async ({ page }) => {
    await page.getByRole('button', { name: 'Filter by status' }).click();
    const panel = page.locator('div[style*="z-index: 9999"]').last();
    await panel.locator('select, input[type=radio], input[type=checkbox]').first().evaluate(() => {});
    const select = panel.locator('select');
    if (await select.count()) await select.first().selectOption({ label: 'Inactive' });
    else await panel.getByText('Inactive', { exact: true }).click();
    const apply = panel.getByRole('button', { name: /^(Filter|Apply)$/ });
    if (await apply.count()) await apply.click();
    await expect(rows(page).first()).toBeVisible();
    for (const t of await rows(page).locator('td:nth-child(3)').allInnerTexts()) expect(t.trim()).toBe('Inactive');
  });
});

test.describe('Admin: Subscription Plans > plan editor', () => {
  let cleanupPlan = '';
  let cleanupFeature = '';
  test.afterEach(async ({ page }) => {
    // Remove whatever a failed run left behind: plans named cleanupPlan..., and deactivate cleanupFeature.
    if (!cleanupPlan && !cleanupFeature) return;
    await page.goto('/admin/subscription-plans');
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
    if (cleanupPlan) {
      // Any "QA Test Plan" is suite data (also from an earlier failed run), so remove them all.
      await page.waitForTimeout(2000);
      await page.getByPlaceholder(/Search plans/).fill('QA Test Plan');
      await page.waitForTimeout(3000);
      for (let i = 0; i < 5 && (await rows(page).filter({ hasText: 'QA Test Plan' }).count()) > 0; i++) {
        await rowAction(rows(page).filter({ hasText: 'QA Test Plan' }).first(), 'Delete Plan').click();
        await confirmDialog(page);
        await page.waitForTimeout(2000);
      }
    }
    if (cleanupFeature) {
      await page.getByRole('tab', { name: 'Features' }).click();
      await page.getByPlaceholder('Search features').fill(cleanupFeature);
      const btn = rows(page).filter({ hasText: cleanupFeature }).getByRole('button', { name: 'Deactivate' });
      if (await btn.count()) {
        await btn.click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
      }
    }
    cleanupPlan = cleanupFeature = '';
  });

  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'subscription-plans');
    await expect(rows(page).first()).toBeVisible({ timeout: 60_000 });
  });

  test('variant prices follow base price, offline %, weekend charge and LMS upgrade', async ({ page }) => {
    const f = await startPlan(page, `QA Test Plan ${letterStamp()}`);
    await f.getByLabel('Base price (online)*').fill('10000');
    await f.getByLabel('Extra charge for offline batches, in percent').fill('20');
    await f.getByLabel('Extra charge for weekend batches, in rupees').fill('500');
    const buy = f.getByRole('region', { name: 'What students can buy' });
    await expect(buy).toContainText('4 sellable variants');
    for (const [code, price] of [['WKND', '10,500'], ['OFF', '12,000'], ['OFF-WKND', '12,500']]) {
      await expect(buy, `${code} should cost ₹${price}`).toContainText(new RegExp(`-1M-${code}₹${price}`));
    }
    // Paid LMS upgrade doubles the variants
    await f.getByRole('checkbox', { name: '6 months' }).check();
    await f.getByLabel('6 months upgrade price').fill('999');
    await expect(buy).toContainText('8 sellable variants');
    // Only online + weekday leaves one batch option
    await f.getByRole('checkbox', { name: 'Offline (in the classroom)' }).uncheck();
    await f.getByRole('checkbox', { name: 'Weekend batch (Sat and Sun)' }).uncheck();
    await expect(buy).toContainText('2 sellable variants');
    await f.getByRole('button', { name: 'Close' }).click();
  });

  test('invalid prices are refused', async ({ page }) => {
    const f = await startPlan(page, `QA Test Plan ${letterStamp()}`);
    await f.getByLabel('Base price (online)*').fill('5000');
    await f.getByLabel('Strike-through price').fill('4000'); // lower than the price
    const post = page.waitForResponse((r) => r.request().method() === 'POST' && /plans/.test(r.url()), { timeout: 10_000 }).catch(() => null);
    await f.getByRole('button', { name: 'Save draft' }).click();
    const res = await post;
    test.info().annotations.push({ type: 'observed', description: `strike-through 4000 < price 5000 -> ${res ? res.status() : 'blocked in form'}` });
    if (res?.ok()) {
      const id = (await res.json().catch(() => null))?.data?.plan?._id ?? (await res.json().catch(() => null))?.data?._id;
      test.info().annotations.push({ type: 'cleanup', description: `created plan ${id}` });
    }
    expect(res?.ok() ?? false, 'strike-through price lower than the price should be refused').toBe(false);
    if (await f.isVisible()) {
      await f.getByLabel('Strike-through price').fill('');
      await f.getByLabel('Base price (online)*').fill('-100');
      await f.getByRole('button', { name: 'Save draft' }).click();
      await expect(f).toBeVisible();
      await f.getByRole('button', { name: 'Close' }).click();
    }
  });

  test('inactive features cannot be added to a new plan', async ({ page }) => {
    await page.getByRole('button', { name: 'New plan' }).click();
    const group = editor(page).getByRole('group').filter({ hasText: '6. Included features' });
    await group.click();
    await expect(group.getByRole('checkbox').first()).toBeVisible();
    const inactive = group.getByRole('checkbox', { name: /\(inactive\)/i });
    test.skip((await inactive.count()) === 0, 'no inactive feature listed');
    for (let i = 0; i < (await inactive.count()); i++) await expect(inactive.nth(i), 'inactive feature should not be selectable').toBeDisabled();
  });

  test('publish a plan with features, check it, duplicate it, then delete both', async ({ page }) => {
    // A feature to put on the plan
    await page.getByRole('tab', { name: 'Features' }).click();
    const featureName = `QA Test Feature ${letterStamp()}`;
    cleanupFeature = featureName;
    const d = await newFeature(page, featureName);
    await d.getByRole('button', { name: 'Create feature' }).click();
    await expect(d).toBeHidden({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Course plans' }).click();

    const name = `QA Test Plan ${letterStamp()}`;
    cleanupPlan = name;
    const f = await startPlan(page, name, '2 months');
    await f.getByLabel('Base price (online)*').fill('8000');
    await f.getByLabel('Strike-through price').fill('9000');
    await f.getByLabel('Short description (optional)').fill('QA Test plan, safe to delete');
    await f.getByPlaceholder('e.g. Weekday or weekend batch').fill('QA Test highlight');
    await f.getByRole('button', { name: 'Add', exact: true }).click();
    await f.getByRole('checkbox', { name: 'Mark as Most popular' }).check();
    await f.getByLabel('Included with plan').selectOption({ label: '6 months' });
    await f.getByRole('checkbox', { name: 'Offline (in the classroom)' }).uncheck();
    await f.getByRole('radio', { name: /Paid add-on/ }).check();
    await f.getByLabel('Placement add-on price').fill('1500');
    await f.getByRole('group').filter({ hasText: '6. Included features' }).click();
    const fsearch = f.getByPlaceholder(/Search or create a feature/);
    if (await fsearch.isVisible().catch(() => false)) await fsearch.fill(featureName);
    await featureBox(f, featureName).check();
    await expect(f.getByText('Student preview').locator('..')).toContainText(name);

    const created = waitApi(page, 'POST', /plans/);
    await f.getByRole('button', { name: 'Publish plan' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await page.getByPlaceholder(/Search plans/).fill(name);
    const row = rows(page).filter({ hasText: name }).first();
    await expect(row).toContainText(/Active/);
    await expect(row).toContainText('8,000');
    await expect(row).toContainText(/Most popular/);
    await expect(row).toContainText(/6 months/);
    await expect(row).toContainText(/Add-on ₹1,500/);

    // Saved values come back in the editor
    await rowAction(row, 'Edit Plan').click();
    await expect(editor(page).getByLabel('Plan name*')).toHaveValue(name);
    await expect(editor(page).getByLabel('Strike-through price')).toHaveValue(/9,?000/);
    await expect(editor(page).getByRole('group').filter({ hasText: '6. Included features' })).toContainText('1 selected');
    await expect(editor(page).getByText('QA Test highlight').first()).toBeVisible();
    await editor(page).getByRole('button', { name: 'Close' }).click();

    // One plan per live-training length: the same course + 2 months again is refused
    const g = await startPlan(page, `${name} twin`, '2 months');
    await g.getByLabel('Base price (online)*').fill('7000');
    await expect(g.getByText(/This course already has a plan for 2 months/)).toBeVisible();
    const saveBtn = g.getByRole('button', { name: 'Save draft' });
    if (await saveBtn.isDisabled()) {
      test.info().annotations.push({ type: 'observed', description: 'second 2-month plan: Save draft / Publish disabled in the form' });
    } else {
      const twin = page.waitForResponse((r) => r.request().method() === 'POST' && /plans/.test(r.url()), { timeout: 10_000 }).catch(() => null);
      await saveBtn.click();
      const tw = await twin;
      test.info().annotations.push({ type: 'observed', description: `second 2-month plan -> ${tw ? tw.status() : 'blocked in form'}` });
      expect(tw?.ok() ?? false, 'a second plan with the same live-training length should be refused').toBe(false);
    }
    if (await g.isVisible()) {
      await g.getByRole('button', { name: 'Close' }).click();
      const discard = page.getByRole('button', { name: 'Discard' });
      if (await discard.isVisible().catch(() => false)) await discard.click();
      await expect(g).toBeHidden();
    }

    // Duplicate
    await rowAction(row, 'Duplicate Plan').click();
    const dup = editor(page);
    if (await dup.isVisible().catch(() => false)) {
      await dup.getByLabel('Live training*').selectOption({ label: '3 months' });
      const dupPost = waitApi(page, 'POST', /plans/);
      await dup.getByRole('button', { name: 'Save draft' }).click();
      expect((await dupPost).status()).toBeLessThan(300);
      await expect(dup).toBeHidden({ timeout: 30_000 });
    }
    await page.getByPlaceholder(/Search plans/).fill(name);
    await expect(rows(page).filter({ hasText: name })).toHaveCount(2);

    // Delete both
    for (let i = 0; i < 2; i++) {
      await rowAction(rows(page).filter({ hasText: name }).first(), 'Delete Plan').click();
      const del = waitApi(page, 'DELETE', /plans\/[a-f0-9]+$/);
      await confirmDialog(page);
      expect((await del).status()).toBeLessThan(300);
    }
    await expect(rows(page).filter({ hasText: name })).toHaveCount(0);

  });
});
