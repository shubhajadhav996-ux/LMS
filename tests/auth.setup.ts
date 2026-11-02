import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { AUTH_FILE } from '../playwright.config';
import { env } from './helpers';

setup('log in as trainer and save session', async ({ page, context }) => {
  await page.goto('/atlogin');
  await page.getByPlaceholder('Email').fill(env.email);
  await page.getByPlaceholder('Password').fill(env.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/trainer\//, { timeout: 45_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });
});
