import { test, expect } from '@playwright/test';
import { letterStamp, openAdmin, rows, modalForm, filterByText, rowAction, waitApi, api } from './admin-helpers';

test.describe('Admin: Trainers', () => {
  test.beforeEach(async ({ page }) => {
    await openAdmin(page, 'trainers');
    await expect(page.getByRole('heading', { name: 'Trainers Management' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('list shows columns and row actions', async ({ page }) => {
    for (const h of ['Trainer Name', 'Contact', 'Expertise', 'Assigned Courses', 'Batches', 'Status', 'Actions'])
      await expect(page.locator('main thead th', { hasText: h }).first()).toBeVisible();
    for (const a of ['View Trainer', 'Edit Trainer']) await expect(rowAction(rows(page).first(), a)).toBeVisible();
  });

  test('Add Trainer: empty form and bad phone are rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Trainer' }).click();
    const f = modalForm(page);
    await f.getByRole('button', { name: 'Add Trainer' }).click();
    await expect(f).toBeVisible();
    await expect(f.getByText(/name is required/i)).toBeVisible();
    await expect(f.getByText(/email.*required/i)).toBeVisible();
    await f.locator('input[name=contactNumber]').fill('12345');
    await f.getByRole('button', { name: 'Add Trainer' }).click();
    await expect(f.getByText(/10.digit|valid (contact|phone|mobile)/i).first()).toBeVisible();
    await f.getByRole('button', { name: 'Cancel' }).click();
  });

  test('create and edit a "QA Test" trainer (then remove it)', async ({ page }) => {
    const stamp = Date.now().toString().slice(-8);
    const name = `QA Test Trainer ${letterStamp()}`;
    const email = `qa.test.trainer.${stamp}@example.com`;
    const phone = `9${stamp}${Math.floor(Math.random() * 10)}`;
    await page.getByRole('button', { name: 'Add Trainer' }).click();
    let f = modalForm(page);
    await f.locator('input[name=fullName]').fill(name);
    await f.locator('input[name=contactNumber]').fill(phone);
    await f.locator('input[name=email]').fill(email);
    await f.locator('select[name=gender]').selectOption('female');
    await f.locator('input[name=dob]').fill('1990-01-01');
    await f.locator('input[name=city]').fill('Pune');
    const created = waitApi(page, 'POST', /\/(trainers|users)[^?]*$/);
    await f.getByRole('button', { name: 'Add Trainer' }).click();
    const cr = await created;
    expect(cr.status(), await cr.text()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await filterByText(page, 'Filter by trainer name', name);
    let row = rows(page).filter({ hasText: email });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/Pending/i);

    await rowAction(row, 'Edit Trainer').click();
    f = modalForm(page);
    await expect(f.locator('input[name=contactNumber]')).toHaveValue(phone);
    await f.locator('input[name=city]').fill('Mumbai');
    await f.locator('input[name=state]').fill('Maharashtra');
    const updated = page.waitForResponse((r) => ['PATCH', 'PUT'].includes(r.request().method()) && /\/(trainers|users)\//.test(r.url()));
    await f.getByRole('button', { name: 'Save Changes' }).click();
    expect((await updated).status()).toBeLessThan(300);
    await expect(f).toBeHidden({ timeout: 30_000 });

    await rowAction(rows(page).filter({ hasText: email }), 'View Trainer').click();
    await expect(page.getByText('Mumbai').first()).toBeVisible();
    await expect(page.getByText('Maharashtra').first()).toBeVisible();

    // The admin UI has no Delete for trainers. Remove the QA record through the API if the backend allows it.
    const id = cr.url() && (await cr.json().catch(() => null))?.data?.trainer?._id;
    if (id) {
      const del = await api(page, 'DELETE', `/trainers/${id}`);
      test.info().annotations.push({ type: 'cleanup', description: `DELETE /trainers/${id} -> ${del.status}` });
    }
  });
});
