import { BrowserContext, Page, expect } from '@playwright/test';

export const env = {
  baseUrl: process.env.BASE_URL || 'https://lms-website-lyart.vercel.app',
  apiUrl: process.env.API_URL || 'https://lms-backend-gamma-six.vercel.app/api/v1',
  email: required('TRAINER_EMAIL'),
  password: required('TRAINER_PASSWORD'),
  bypassProfileGate: (process.env.BYPASS_PROFILE_GATE ?? 'true').toLowerCase() === 'true',
  runCreateTests: (process.env.RUN_CREATE_TESTS ?? 'true').toLowerCase() === 'true',
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

/** Every record the suite creates starts with this, so it is easy to find and clean up. */
export const QA_PREFIX = 'QA Test';
export const uniqueName = (what: string) => {
  const d = new Date();
  const stamp = `${d.getDate().toString().padStart(2, '0')}${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getHours()
    .toString()
    .padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}`;
  return `${QA_PREFIX} ${what} ${stamp}`;
};

/** Courses assigned to the test trainer (see earlier reports). */
export const COURSES = {
  testingProfile: /testing\s+profile/i,
  trainerCourse: /this for trainer course and batches/i,
};

/**
 * The portal redirects trainers to /trainer/profile until trainerProfileComplete is true.
 * When BYPASS_PROFILE_GATE=true we rewrite only the browser's copy of the profile flags,
 * so the account itself is never changed.
 */
export async function applyProfileGateBypass(context: BrowserContext) {
  if (!env.bypassProfileGate) return;
  await context.route(/\/api\/v1\/(users\/me|users\/atlogin|trainers\/me)(\?.*)?$/, async (route) => {
    let response;
    try {
      response = await route.fetch();
    } catch {
      return; // page or test already closed
    }
    let body = await response.text().catch(() => '');
    body = body
      .replace(/"trainerProfileComplete":false/g, '"trainerProfileComplete":true')
      .replace(/"profileComplete":false/g, '"profileComplete":true')
      .replace(/"(trainerProfileCompletionPercentage|profileCompletionPercentage)":\d+/g, '"$1":100');
    await route.fulfill({ response, body }).catch(() => {});
  });
}

export type Section =
  | 'Dashboard'
  | 'My Courses'
  | 'Batches'
  | 'Announcements'
  | 'Course Material'
  | 'Task Management';

const sectionPaths: Record<Section, string> = {
  Dashboard: '/trainer/dashboard',
  'My Courses': '/trainer/courses',
  Batches: '/trainer/batches',
  Announcements: '/trainer/announcements',
  'Course Material': '/trainer/resources',
  'Task Management': '/trainer/task-management',
};

/** Open a trainer portal section through the sidebar, the way a user does. */
export async function openSection(page: Page, section: Section) {
  if (!page.url().includes('/trainer/')) {
    await page.goto('/trainer/dashboard');
  }
  await page.locator(`aside a[href="${sectionPaths[section]}"], nav a[href="${sectionPaths[section]}"], a[href="${sectionPaths[section]}"]`).first().click();
  await expect(page, `Expected to stay on ${section}. If you land on /trainer/profile, the profile-completion gate is active.`).toHaveURL(
    new RegExp(sectionPaths[section].replace(/\//g, '\\/') + '(\\?.*)?$'),
  );
  await page.waitForLoadState('networkidle').catch(() => {});
}

/** The floating filter panel that opens from a column header's filter icon. */
export const filterPanel = (page: Page) => page.locator('div[style*="z-index: 9999"]').last();

export async function applyHeaderFilter(page: Page, headerFilterTitle: string, fill: (panel: ReturnType<typeof filterPanel>) => Promise<unknown>) {
  await page.locator(`button[aria-label="${headerFilterTitle}"], button[title="${headerFilterTitle}"]`).first().click();
  const panel = filterPanel(page);
  await expect(panel).toBeVisible();
  await fill(panel);
  await panel.getByRole('button', { name: 'Filter', exact: true }).click();
}

export const tableRows = (page: Page) => page.locator('main tbody tr');

export function dateOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isoDateTimeLocal = (d: Date, hh = 10, mm = 0) =>
  `${isoDate(d)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

export const toast = (page: Page) => page.locator('.Toastify__toast');
