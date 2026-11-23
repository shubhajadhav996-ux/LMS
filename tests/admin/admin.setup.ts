import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ADMIN_AUTH_FILE } from '../../playwright.config';

setup('log in as admin and save session', async ({ page, context }) => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  setup.skip(!email || !password, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  await page.goto('/atlogin');
  await page.getByPlaceholder('Email').fill(email!);
  await page.getByPlaceholder('Password').fill(password!);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\//, { timeout: 45_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  fs.mkdirSync(path.dirname(ADMIN_AUTH_FILE), { recursive: true });
  await context.storageState({ path: ADMIN_AUTH_FILE });
});
