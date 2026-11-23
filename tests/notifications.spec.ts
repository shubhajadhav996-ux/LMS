import { test, expect } from './fixtures';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { env, uniqueName, dateOffset, isoDateTimeLocal, tableRows, openSection } from './helpers';

/**
 * Notifications, tested with two people at once: the trainer (sender) in one browser context and a
 * student (receiver) in a second, separate context.
 *
 * How the portal does notifications (read from the live site, November 2026):
 * - Admins get real server-side notifications from /api/v1/notifications.
 * - Trainers and students get a bell feed that the BROWSER builds from announcements, tasks,
 *   submissions and sessions. It refreshes every minute. "Read" and "deleted" are stored only in that
 *   browser's localStorage, not on the server.
 *
 * Needs in .env: STUDENT_EMAIL / STUDENT_PASSWORD (a student enrolled in NOTIFY_COURSE, a course the
 * trainer teaches). Optional: ADMIN_EMAIL / ADMIN_PASSWORD for the admin inbox test.
 * Everything created is named "QA Test ...". Nothing is deleted.
 */

const student = { email: process.env.STUDENT_EMAIL || '', password: process.env.STUDENT_PASSWORD || '' };
const admin = { email: process.env.ADMIN_EMAIL || '', password: process.env.ADMIN_PASSWORD || '' };
/** A course the trainer teaches that the test student is enrolled in. */
const COURSE = new RegExp(process.env.NOTIFY_COURSE || 'this for trainer course and batches', 'i');
/** The feed refreshes every 60 s; reloading is faster, but allow time for the backend. */
const ARRIVAL_TIMEOUT = 120_000;

const bell = (page: Page) => page.locator('header button[title="Notifications"], button[title="Notifications"]').first();

async function unreadCount(page: Page): Promise<number> {
  const label = (await bell(page).getAttribute('aria-label')) || '';
  const m = label.match(/(\d+) unread/);
  return m ? Number(m[1]) : 0;
}

async function loginStudent(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByPlaceholder(/email/i).first().fill(student.email);
  await page.getByPlaceholder(/password/i).first().fill(student.password);
  await page.getByRole('button', { name: /^login$/i }).click();
  await expect(page).toHaveURL(/\/student\//, { timeout: 45_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return { context, page };
}

async function loginAdmin(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/atlogin');
  await page.getByPlaceholder('Email').fill(admin.email);
  await page.getByPlaceholder('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\//, { timeout: 45_000 });
  return { context, page };
}

/** Reload the student's notifications page until an item with this text shows up. */
async function waitForStudentNotification(page: Page, text: string) {
  await expect(async () => {
    await page.goto('/student/notifications');
    await expect(page.getByRole('list', { name: 'Notifications' }).getByText(text).first()).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: ARRIVAL_TIMEOUT, intervals: [5_000, 10_000, 15_000] });
}

async function publishAnnouncementToStudents(page: Page, title: string) {
  await page.goto('/trainer/dashboard');
  await openSection(page, 'Announcements');
  await page.getByRole('button', { name: 'Create Announcement' }).first().click();
  const f = page.locator('form').filter({ has: page.locator('input[name=title]') }).last();
  await f.locator('input[name=title]').fill(title);
  await f.locator('textarea[name=description]').fill(`${title}: automated notification check, please ignore.`);
  await f.locator('select[name=audienceTarget]').selectOption('students');
  await f.getByText('Select course...').click();
  await f.locator('div', { has: page.locator('input[type=radio]') }).filter({ hasText: COURSE }).last().click();
  await f.locator('select[name=priority]').selectOption('normal');
  await f.getByRole('button', { name: 'Publish' }).click();
  await expect(f).toBeHidden({ timeout: 30_000 });
  await expect(tableRows(page).filter({ hasText: title })).toHaveCount(1);
}

async function createTaskForCourse(page: Page, title: string) {
  await page.goto('/trainer/dashboard');
  await openSection(page, 'Task Management');
  await page.getByRole('button', { name: 'Create Task' }).first().click();
  const f = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create Task' }) }).last();
  await f.getByPlaceholder(/Build a responsive landing page/).fill(title);
  await f.locator('textarea').fill('QA Test: notification check. Safe to ignore.');
  await f.getByText('Select course...').click();
  await f.locator('span.block.truncate').filter({ hasText: COURSE }).first().click();
  await f.locator('input[type=datetime-local]').fill(isoDateTimeLocal(dateOffset(7), 17, 0));
  await f.getByRole('button', { name: 'Create Task' }).click();
  await expect(f).toBeHidden({ timeout: 30_000 });
}

test.describe('Notifications: trainer bell', () => {
  test('bell is shown and opens the trainer notifications page', async ({ page }) => {
    await page.goto('/trainer/dashboard');
    await expect(bell(page)).toBeVisible();
    await bell(page).click();
    await expect(page).toHaveURL(/\/trainer\/notifications/);
    await expect(page.getByText('Your notifications')).toBeVisible();
    await expect(page.getByText(/Unable to load notifications/i)).toHaveCount(0);
  });

  test('filters (status, category, search) do not error', async ({ page }) => {
    await page.goto('/trainer/notifications');
    const inbox = page.getByLabel('Notification inbox');
    await expect(inbox).toBeVisible();
    await inbox.locator('select').first().selectOption('unread');
    await inbox.getByPlaceholder(/search/i).fill('zz-no-such-notification-zz');
    await expect(page.getByText('No matching notifications')).toBeVisible();
  });
});

test.describe('Notifications: trainer to student (two browsers)', () => {
  test.skip(!student.email || !student.password, 'Set STUDENT_EMAIL and STUDENT_PASSWORD in .env');

  test('student bell loads without error', async ({ browser }) => {
    const s = await loginStudent(browser);
    try {
      await expect(bell(s.page)).toBeVisible();
      await expect(bell(s.page)).not.toHaveAttribute('aria-label', /unavailable/);
      await bell(s.page).click();
      await expect(s.page.getByRole('dialog').getByText(/Loading notifications|You're all caught up|Notification/).first()).toBeVisible();
      await expect(s.page.getByText('Unable to load notifications')).toHaveCount(0);
    } finally {
      await s.context.close();
    }
  });

  test('announcement to students appears in the student bell and marks read', async ({ page, browser }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    const s = await loginStudent(browser);
    try {
      const before = await unreadCount(s.page);
      const title = uniqueName('Notify Announcement');
      await publishAnnouncementToStudents(page, title);

      await waitForStudentNotification(s.page, title);
      const item = s.page.getByRole('list', { name: 'Notifications' }).locator('li', { hasText: title }).first();
      await expect(item, 'new notification should be unread (blue dot)').toContainText(title);

      await s.page.goto('/student/dashboard');
      await expect.poll(() => unreadCount(s.page), { message: 'unread badge should go up' }).toBeGreaterThan(before);

      // Opening it from the bell marks it read and goes to Announcements.
      await bell(s.page).click();
      await s.page.getByRole('dialog').getByText(title).first().click();
      await expect(s.page).toHaveURL(/\/student\/announcements/);
      await s.page.goto('/student/notifications');
      await s.page.getByLabel('Notification inbox').locator('select').first().selectOption('unread');
      await expect(s.page.getByRole('list', { name: 'Notifications' }).getByText(title)).toHaveCount(0);
    } finally {
      await s.context.close();
    }
  });

  test('trainer does not get a notification for their own announcement', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    await page.goto('/trainer/notifications');
    await expect(page.getByLabel('Notification inbox')).toBeVisible();
    await page.getByLabel('Notification inbox').getByPlaceholder(/search/i).fill('QA Test Notify Announcement');
    await expect(page.getByRole('list', { name: 'Notifications' }).getByText(/QA Test Notify Announcement/)).toHaveCount(0);
  });

  test('new task for the course shows "New task assigned" to the student', async ({ page, browser }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    const s = await loginStudent(browser);
    try {
      const title = uniqueName('NTask').slice(0, 50);
      await createTaskForCourse(page, title);
      await waitForStudentNotification(s.page, title);
      const item = s.page.getByRole('list', { name: 'Notifications' }).locator('li', { hasText: title }).first();
      await expect(item).toContainText('New task assigned');
    } finally {
      await s.context.close();
    }
  });

  test('read state carries over to a new login of the same student', async ({ browser }) => {
    test.info().annotations.push({
      type: 'note',
      description: 'Read/deleted state is kept in localStorage only, so a new browser or device shows everything unread again.',
    });
    const a = await loginStudent(browser);
    let before = 0;
    try {
      await a.page.goto('/student/notifications');
      await a.page.getByRole('button', { name: /mark all as read/i }).click();
      await a.page.goto('/student/dashboard');
      await expect.poll(() => unreadCount(a.page)).toBe(0);
    } finally {
      await a.context.close();
    }
    const b = await loginStudent(browser);
    try {
      await b.page.waitForTimeout(3_000);
      before = await unreadCount(b.page);
      expect(before, 'a fresh login should not show already-read notifications as unread').toBe(0);
    } finally {
      await b.context.close();
    }
  });
});

test.describe('Notifications: admin to trainer (two browsers)', () => {
  test.skip(!admin.email || !admin.password, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');

  test('admin announcement to course trainers appears in the trainer bell', async ({ page, browser }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    await page.goto('/trainer/dashboard');
    const before = await unreadCount(page);

    const a = await loginAdmin(browser);
    const title = uniqueName('Notify Admin Announcement');
    try {
      await a.page.goto('/admin/announcements');
      await a.page.getByRole('button', { name: 'Create Announcement' }).first().click();
      const f = a.page.locator('form').filter({ has: a.page.locator('input[name=title]') }).last();
      await f.locator('input[name=title]').fill(title);
      await f.locator('textarea[name=description]').fill(`${title}: automated notification check, please ignore.`);
      // Only the trainers of "Testing Profile" (the test trainer's course), not every trainer.
      const scope = f.locator('select:has(option[value="course"])').first();
      if (await scope.count()) await scope.selectOption('course');
      await f.locator('select[name=audienceTarget]').selectOption('trainers');
      await f.getByText('Select course...').click();
      await f.locator('div', { has: a.page.locator('input[type=radio]') }).filter({ hasText: /testing\s+profile/i }).last().click();
      await f.locator('select[name=priority]').selectOption('normal');
      await f.getByRole('button', { name: 'Publish' }).click();
      await expect(f).toBeHidden({ timeout: 30_000 });
    } finally {
      await a.context.close();
    }

    // Receiver: the trainer, in the suite's own (separate) browser context.
    await expect(async () => {
      await page.goto('/trainer/notifications');
      await expect(page.getByRole('list', { name: 'Notifications' }).getByText(title).first()).toBeVisible({ timeout: 8_000 });
    }).toPass({ timeout: ARRIVAL_TIMEOUT, intervals: [5_000, 10_000, 15_000] });

    await page.goto('/trainer/dashboard');
    await expect.poll(() => unreadCount(page), { message: 'trainer unread badge should go up' }).toBeGreaterThan(before);

    // Opening it marks it read and goes to that announcement.
    await page.goto('/trainer/notifications');
    await page.getByRole('list', { name: 'Notifications' }).getByText(title).first().click();
    await expect(page).toHaveURL(/\/trainer\/announcements/);
  });
});

test.describe('Notifications: opening a notification', () => {
  test('@known-bug opening a trainer announcement notification shows that announcement', async ({ page }) => {
    test.info().annotations.push({
      type: 'issue',
      description: 'Bell links to /trainer/announcements?id=..., but the Announcements page only reads ?announcementId=..., so it lands on page 1 of the list.',
    });
    await page.goto('/trainer/notifications');
    await page.getByLabel('Notification inbox').locator('select').last().selectOption('100');
    const last = page.getByRole('list', { name: 'Notifications' }).locator('li').last();
    const title = (await last.locator('.font-bold').first().innerText()).trim();
    await last.locator('button').first().click();
    await expect(page).toHaveURL(/\/trainer\/announcements/);
    await expect(page.locator('main tbody tr', { hasText: title }).first(), 'the opened announcement should be shown').toBeInViewport();
  });
});

test.describe('Notifications: admin inbox (server-side)', () => {
  test.skip(!admin.email || !admin.password, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');

  test('a trainer profile-update request reaches the admin inbox', async ({ page, browser }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    const title = uniqueName('Notify Request');
    await page.goto('/trainer/dashboard');
    // Same call the trainer profile page makes after a name / date-of-birth change.
    const res = await page.evaluate(
      async ({ api, title }) => {
        const r = await fetch(`${api}/notifications/request`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, message: `${title}: automated check, please ignore.`, actionType: 'profile-update', category: 'profile' }),
        });
        return { status: r.status, body: (await r.text()).slice(0, 300) };
      },
      { api: env.apiUrl, title },
    );
    test.info().annotations.push({ type: 'observed', description: `POST /notifications/request -> ${res.status} ${res.body}` });
    expect(res.status, res.body).toBeLessThan(300);

    const a = await loginAdmin(browser);
    try {
      await expect(async () => {
        await a.page.goto('/admin/notifications');
        await expect(a.page.getByRole('list', { name: 'Notifications' }).getByText(title).first()).toBeVisible({ timeout: 8_000 });
      }).toPass({ timeout: ARRIVAL_TIMEOUT, intervals: [5_000, 10_000] });
    } finally {
      await a.context.close();
    }
  });
});
