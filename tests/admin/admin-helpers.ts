import { expect, Page, Locator } from '@playwright/test';
import { env } from '../helpers';

export { uniqueName, dateOffset, isoDate, isoDateTimeLocal, QA_PREFIX } from '../helpers';

export type AdminSection =
  | 'dashboard'
  | 'students'
  | 'courses'
  | 'trainers'
  | 'batches'
  | 'course-materials'
  | 'announcements'
  | 'task-management'
  | 'subscription-plans'
  | 'payments';

/** Open an admin section from the sidebar, the way a user does. */
export async function openAdmin(page: Page, section: AdminSection) {
  if (!page.url().includes('/admin/')) await page.goto('/admin/dashboard');
  await page.locator(`a[href="/admin/${section}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/${section}(\\?.*)?$`));
  await page.waitForLoadState('networkidle').catch(() => {});
}

export const rows = (page: Page) => page.locator('main tbody tr');

/** The open modal form (create / edit dialogs are a <form> on top of the page). */
export const modalForm = (page: Page) => page.locator('form').last();

/** Narrow the table with a column-header filter (text search panel). */
export async function filterByText(page: Page, filterTitle: string, text: string) {
  await page.locator(`button[aria-label="${filterTitle}"], button[title="${filterTitle}"]`).first().click();
  const panel = page.locator('div[style*="z-index: 9999"]').last();
  await expect(panel).toBeVisible();
  await panel.locator('input').first().fill(text);
  const apply = panel.getByRole('button', { name: /^(Filter|Apply)$/ });
  if (await apply.count()) await apply.first().click();
  else await page.keyboard.press('Enter');
  // Some panels stay open after applying; close them so they do not cover the table.
  if (await panel.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  if (await panel.isVisible().catch(() => false)) await page.locator('main h1').first().click();
  await page.waitForTimeout(500);
}

/** Click a row action by its title (Edit Course, Delete Course, ...). */
export const rowAction = (row: Locator, title: string) => row.locator(`[title="${title}"], [aria-label="${title}"]`).first();

/** Confirm a "Delete ...?" dialog. */
export async function confirmDialog(page: Page, button: RegExp = /^(Delete|Yes, delete|Confirm|Yes)/i) {
  const dlg = page.locator('[role=dialog], [role=alertdialog], div.fixed').filter({ has: page.getByRole('button', { name: button }) }).last();
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: button }).last().click();
}

export const toast = (page: Page) => page.locator('.Toastify__toast');

type ApiResult = { status: number; json: any; text: string };
/** Call the backend as the signed-in user (used for lookups and for cleanup only). */
export async function api(page: Page, method: string, path: string, body?: unknown): Promise<ApiResult> {
  return page.evaluate(
    async ({ base, method, path, body }) => {
      const r = await fetch(base + path, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('accessToken') || '') },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: r.status, json, text: text.slice(0, 500) };
    },
    { base: env.apiUrl, method, path, body },
  );
}

/** Wait for the API call a UI action makes, and return it. */
export const waitApi = (page: Page, method: string, url: RegExp, timeout = 60_000) =>
  page.waitForResponse((r) => r.request().method() === method && url.test(r.url()), { timeout });

/** A unique, letters-only tag (person names may not contain digits). */
export const letterStamp = () =>
  Date.now()
    .toString()
    .slice(-7)
    .split('')
    .map((d) => 'abcdefghij'[Number(d)])
    .join('');

/** The course every create test uses: assigned to the test trainer, has no students. */
export const QA_COURSE = /QA Test Notif Course 2311/i;

/** Pick a course in the "Select course..." picker of the open form. */
export async function pickCourse(form: Locator, course: RegExp = QA_COURSE) {
  await form.getByText('Select course...').first().click();
  const search = form.getByPlaceholder(/search/i);
  if (await search.count()) await search.first().fill('QA Test Notif').catch(() => {});
  await form.getByText(course).last().click();
}

export const anyWrite = (page: Page, url: RegExp) =>
  page.waitForResponse((r) => ['PATCH', 'PUT'].includes(r.request().method()) && url.test(r.url()), { timeout: 60_000 });
