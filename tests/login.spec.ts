import { test, expect } from '@playwright/test';
import { env } from './helpers';

// These tests start logged out and do NOT use the profile-gate bypass.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Trainer login (/atlogin)', () => {
  test('trainer can log in with valid credentials', async ({ page }) => {
    await page.goto('/atlogin');
    await expect(page.getByText('Admin & Trainer access only')).toBeVisible();
    await page.getByPlaceholder('Email').fill(env.email);
    await page.getByPlaceholder('Password').fill(env.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page).toHaveURL(/\/trainer\//);
    await expect(page.getByText('Trainer Portal')).toBeVisible();
    await expect(page.getByText(/Login successful/i)).toBeVisible();
  });

  test('wrong password is refused with a clear message', async ({ page }) => {
    await page.goto('/atlogin');
    await page.getByPlaceholder('Email').fill(env.email);
    await page.getByPlaceholder('Password').fill('Wrong-Password-123');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page.locator('.Toastify__toast').first()).toContainText(/invalid|incorrect|wrong/i);
    await expect(page).toHaveURL(/atlogin/);
  });

  test('trainer with an incomplete profile is sent to the Profile page', async ({ page }) => {
    // New behaviour seen on 02 Nov 2026: every trainer page redirects to /trainer/profile
    // until the trainer profile is 100% complete. This test documents it.
    const meResponse = page.waitForResponse((r) => /\/users\/atlogin$/.test(r.url()));
    await page.goto('/atlogin');
    await page.getByPlaceholder('Email').fill(env.email);
    await page.getByPlaceholder('Password').fill(env.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    const body = await (await meResponse).json();
    const complete = body?.data?.user?.trainerProfileComplete;
    test.info().annotations.push({ type: 'trainerProfileComplete', description: String(complete) });
    test.skip(complete === true, 'Profile is complete, so there is no gate to check.');
    await expect(page).toHaveURL(/\/trainer\//);
    await page.locator('a[href="/trainer/courses"]').first().click();
    await expect(page).toHaveURL(/\/trainer\/profile/);
  });
});

test.describe('Student login page (/)', () => {
  test('@known-bug SCRUM-162 unknown user sees "Invalid email or password"', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-162: shows "Refresh token is required" instead' });
    await page.goto('/');
    await page.getByPlaceholder(/email/i).first().fill('qa.nonexistent.user@example.com');
    await page.getByPlaceholder(/password/i).first().fill('Whatever-123');
    await page.getByRole('button', { name: /^login$/i }).click();
    const firstToast = page.locator('.Toastify__toast').first();
    await expect(firstToast).toBeVisible();
    await expect(firstToast).toContainText(/invalid email or password/i);
    await expect(page.locator('.Toastify__toast', { hasText: /refresh token is required/i })).toHaveCount(0);
  });
});
