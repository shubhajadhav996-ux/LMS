import { test, expect } from './fixtures';
import type { Browser, Page } from '@playwright/test';
import { env, uniqueName } from './helpers';

/**
 * Notifications per module: the trainer (sender) does each create / edit / delete in one browser
 * context, and the admin (receiver) checks their server inbox in a second context.
 *
 * Trainer actions are made with the same API calls the portal makes (the trainer pages are behind the
 * profile-completion gate, and this keeps the checks fast and independent of page layout). The admin
 * side is read through /api/v1/notifications, which is what the admin bell shows.
 *
 * Needs ADMIN_EMAIL / ADMIN_PASSWORD and RUN_CREATE_TESTS=true. Everything is named "QA Test ..." and
 * created in NOTIFY_TRAINER_COURSE, a course the test trainer is assigned to. Temporary records are
 * deleted again; one cancelled batch and one task per run are left behind.
 */

const admin = { email: process.env.ADMIN_EMAIL || '', password: process.env.ADMIN_PASSWORD || '' };
const TRAINER_COURSE = new RegExp(process.env.NOTIFY_TRAINER_COURSE || 'QA Test Notif Course', 'i');
const ARRIVAL_TIMEOUT = 60_000;

type ApiResult = { status: number; json: any; text: string };
type AdminNotification = { title: string; message: string; actionType: string; category: string; createdAt: string; metadata?: any };

/** Call the backend as whoever is signed in on this page (the portal keeps a bearer token in localStorage). */
async function api(page: Page, method: string, path: string, body?: unknown): Promise<ApiResult> {
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

const ok = (r: ApiResult, what: string) => expect(r.status, `${what}: ${r.text}`).toBeLessThan(300);
const list = (r: ApiResult, ...keys: string[]): any[] => {
  const d = r.json?.data;
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d?.[k])) return d[k];
  return [];
};

async function loginAdmin(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/atlogin');
  await page.getByPlaceholder('Email').fill(admin.email);
  await page.getByPlaceholder('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\//, { timeout: 45_000 });
  return { context, page };
}

/** Wait until the admin inbox has a notification of this type mentioning `text`, created after `since`. */
async function waitForAdminNotification(adminPage: Page, actionType: string, text: string, since: string): Promise<AdminNotification> {
  let found: AdminNotification | undefined;
  await expect
    .poll(
      async () => {
        const r = await api(adminPage, 'GET', '/notifications?page=1&limit=50');
        const items: AdminNotification[] = r.json?.data?.notifications || [];
        found = items.find((n) => n.actionType === actionType && n.createdAt >= since && `${n.title} ${n.message}`.includes(text));
        return !!found;
      },
      { timeout: ARRIVAL_TIMEOUT, intervals: [2_000, 5_000], message: `admin should get ${actionType} for "${text}"` },
    )
    .toBe(true);
  return found!;
}

/** Same as waitForAdminNotification but returns undefined instead of failing (for "should notify" bug checks). */
async function findAdminNotification(adminPage: Page, actionType: string | RegExp, text: string, since: string, waitMs = 20_000) {
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const r = await api(adminPage, 'GET', '/notifications?page=1&limit=50');
    const items: AdminNotification[] = r.json?.data?.notifications || [];
    const n = items.find(
      (n) => (typeof actionType === 'string' ? n.actionType === actionType : actionType.test(n.actionType)) && n.createdAt >= since && `${n.title} ${n.message}`.includes(text),
    );
    if (n) return n;
    await adminPage.waitForTimeout(3_000);
  }
  return undefined;
}

const expectReadable = (n: AdminNotification) => {
  expect(`${n.title} ${n.message}`, 'notification text should not contain undefined / null').not.toMatch(/\bundefined\b|\bnull\b/);
};

test.describe('Notifications per module: trainer action -> admin inbox', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!admin.email || !admin.password, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
  test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');

  let adminCtx: Awaited<ReturnType<typeof loginAdmin>>;
  let courseId = '';
  let trainerId = '';
  let batchId = '';
  let batchName = '';

  test.beforeAll(async ({ browser }) => {
    adminCtx = await loginAdmin(browser);
  });
  test.afterAll(async () => {
    await adminCtx?.context.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/trainer/dashboard');
    if (!courseId) {
      const me = await api(page, 'GET', '/users/me');
      trainerId = me.json?.data?._id;
      const courses = list(await api(page, 'GET', '/courses?page=1&limit=100'), 'courses', 'items');
      courseId = courses.find((c) => TRAINER_COURSE.test(c.courseName))?._id;
      expect(courseId, `trainer must be assigned to a course matching ${TRAINER_COURSE}`).toBeTruthy();
    }
  });

  test('announcement: create, edit, delete', async ({ page }) => {
    const since = new Date().toISOString();
    const title = uniqueName('Notify Ann');
    ok(
      await api(page, 'POST', '/announcements', {
        title,
        message: 'QA Test: notification check. Please ignore.',
        priority: 'normal',
        audience: { type: 'course-trainers', courseIds: [courseId] },
        status: 'published',
      }),
      'create announcement',
    );
    const id = list(await api(page, 'GET', '/announcements?page=1&limit=10'), 'items').find((a) => a.title === title)?._id;
    expect(id).toBeTruthy();
    expectReadable(await waitForAdminNotification(adminCtx.page, 'ANNOUNCEMENT_CREATED', title, since));

    ok(await api(page, 'PATCH', `/announcements/${id}`, { title: `${title} edited` }), 'edit announcement');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'ANNOUNCEMENT_UPDATED', `${title} edited`, since));

    ok(await api(page, 'DELETE', `/announcements/${id}`), 'delete announcement');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'ANNOUNCEMENT_DELETED', `${title} edited`, since));
  });

  test('batch: create', async ({ page }) => {
    const since = new Date().toISOString();
    batchName = uniqueName('Notify Batch');
    const r = await api(page, 'POST', '/batches', {
      batchName,
      course: courseId,
      mode: 'offline',
      startDate: '2027-01-04',
      endDate: '2027-01-29',
      studentCapacity: 10,
      instructors: [trainerId],
      scheduleSlots: [{ dayOfWeek: 'saturday', startTime: '01:00', endTime: '02:00' }],
    });
    ok(r, 'create batch');
    batchId = r.json?.data?.batch?._id || r.json?.data?._id;
    expect(batchId).toBeTruthy();
    const n = await waitForAdminNotification(adminCtx.page, 'BATCH_CREATED', batchName, since);
    expectReadable(n);
  });

  test('session: create, edit, delete', async ({ page }) => {
    test.skip(!batchId, 'needs the batch from the previous test');
    const since = new Date().toISOString();
    const topic = uniqueName('Notify Session');
    ok(
      await api(page, 'POST', `/batches/${batchId}/schedule`, { sessionDate: '2027-01-10', startTime: '03:00', endTime: '04:00', topicCovered: topic, title: topic }),
      'create session',
    );
    const sessions = list(await api(page, 'GET', `/batches/${batchId}/schedule`), 'sessions', 'items');
    const sid = sessions.find((s) => s.topicCovered === topic)?._id;
    expect(sid).toBeTruthy();
    expectReadable(await waitForAdminNotification(adminCtx.page, 'SESSION_CREATED', topic, since));

    ok(await api(page, 'PATCH', `/batches/${batchId}/schedule/${sid}`, { startTime: '03:30', endTime: '04:30' }), 'edit session');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'SESSION_UPDATED', topic, since));

    ok(await api(page, 'DELETE', `/batches/${batchId}/schedule/${sid}`), 'delete session');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'SESSION_DELETED', topic, since));
  });

  test('@known-bug session edit notification names the batch', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SESSION_UPDATED says in batch "batch" (or a raw batch ID) instead of the batch name' });
    test.skip(!batchId, 'needs the batch from the previous tests');
    const since = new Date().toISOString();
    const topic = uniqueName('Notify Session Name');
    ok(await api(page, 'POST', `/batches/${batchId}/schedule`, { sessionDate: '2027-01-11', startTime: '05:00', endTime: '06:00', topicCovered: topic, title: topic }), 'create session');
    const sid = list(await api(page, 'GET', `/batches/${batchId}/schedule`), 'sessions', 'items').find((s) => s.topicCovered === topic)?._id;
    ok(await api(page, 'PATCH', `/batches/${batchId}/schedule/${sid}`, { startTime: '05:30', endTime: '06:30' }), 'edit session');
    const n = await waitForAdminNotification(adminCtx.page, 'SESSION_UPDATED', topic, since);
    await api(page, 'DELETE', `/batches/${batchId}/schedule/${sid}`);
    expect(n.message).toContain(batchName);
  });

  test('@known-bug batch edit notification names the batch', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'BATCH_UPDATED says batch "undefined"' });
    test.skip(!batchId, 'needs the batch from the previous tests');
    const since = new Date().toISOString();
    ok(await api(page, 'PATCH', `/batches/${batchId}`, { studentCapacity: 12 }), 'edit batch');
    const n = await waitForAdminNotification(adminCtx.page, 'BATCH_UPDATED', '', since);
    expectReadable(n);
    expect(n.message).toContain(batchName);
  });

  test('@known-bug batch cancel notification names the batch', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'BATCH_STATUS_CHANGED says cancelled batch "undefined"' });
    test.skip(!batchId, 'needs the batch from the previous tests');
    const since = new Date().toISOString();
    ok(await api(page, 'PATCH', `/batches/${batchId}/status`, { status: 'cancelled', cancellationReason: 'QA Test notification check' }), 'cancel batch');
    const n = await waitForAdminNotification(adminCtx.page, 'BATCH_STATUS_CHANGED', 'QA Test notification check', since);
    expectReadable(n);
    expect(n.message).toContain(batchName);
  });

  test('course content: assignment create, edit, delete', async ({ page }) => {
    const since = new Date().toISOString();
    const title = uniqueName('Notify Assignment');
    const r = await api(page, 'POST', '/course-content/assignments', {
      course: courseId,
      courseId,
      title,
      description: 'QA Test: notification check. Please ignore.',
      maxScore: 10,
      dueDurationDays: 7,
      difficulty: 'easy',
      type: 'individual',
    });
    ok(r, 'create assignment');
    const id = r.json?.data?._id;
    expectReadable(await waitForAdminNotification(adminCtx.page, 'ASSIGNMENT_CREATED', title, since));
    ok(await api(page, 'PATCH', `/course-content/assignments/${id}`, { title: `${title} edited` }), 'edit assignment');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'ASSIGNMENT_UPDATED', `${title} edited`, since));
    ok(await api(page, 'DELETE', `/course-content/assignments/${id}`), 'delete assignment');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'ASSIGNMENT_DELETED', `${title} edited`, since));
  });

  test('course content: lesson plan create, edit, delete', async ({ page }) => {
    const since = new Date().toISOString();
    const topic = uniqueName('Notify Lesson');
    const r = await api(page, 'POST', '/course-content/lesson-plan', {
      course: courseId,
      courseId,
      order: 1,
      period: '1',
      topic,
      activities: 'QA Test',
      learningOutcome: 'QA Test',
    });
    ok(r, 'create lesson plan section');
    const id = r.json?.data?._id;
    expectReadable(await waitForAdminNotification(adminCtx.page, 'LESSON_PLAN_CREATED', topic, since));
    ok(await api(page, 'PATCH', `/course-content/lesson-plan/${id}`, { topic: `${topic} edited` }), 'edit lesson plan section');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'LESSON_PLAN_UPDATED', `${topic} edited`, since));
    ok(await api(page, 'DELETE', `/course-content/lesson-plan/${id}`), 'delete lesson plan section');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'LESSON_PLAN_DELETED', `${topic} edited`, since));
  });

  test('course content: resource (link) create, edit, delete', async ({ page }) => {
    const since = new Date().toISOString();
    const title = uniqueName('Notify Resource');
    const r = await api(page, 'POST', '/course-content/resources', {
      course: courseId,
      courseId,
      title,
      moduleTitle: 'QA Test',
      type: 'link',
      linkUrl: 'https://example.com/qa-test',
      status: 'draft',
    });
    ok(r, 'create resource');
    const id = r.json?.data?._id;
    expectReadable(await waitForAdminNotification(adminCtx.page, 'RESOURCE_CREATED', title, since));
    ok(
      await api(page, 'PATCH', `/course-content/resources/${id}`, { title: `${title} edited`, moduleTitle: 'QA Test', linkUrl: 'https://example.com/qa-test', status: 'draft' }),
      'edit resource',
    );
    expectReadable(await waitForAdminNotification(adminCtx.page, 'RESOURCE_UPDATED', `${title} edited`, since));
    ok(await api(page, 'DELETE', `/course-content/resources/${id}`), 'delete resource');
    expectReadable(await waitForAdminNotification(adminCtx.page, 'RESOURCE_DELETED', `${title} edited`, since));
  });

  test('@known-bug task: creating a task notifies the admin', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'Every other trainer create/edit/delete notifies admins; task creation does not' });
    const since = new Date().toISOString();
    const title = uniqueName('Notify Task').slice(0, 50);
    ok(
      await api(page, 'POST', '/tasks', {
        title,
        description: 'QA Test: notification check.',
        course: courseId,
        assignmentScope: 'course',
        dueDate: new Date(Date.now() + 7 * 864e5).toISOString(),
        priority: 'low',
        taskType: 'student',
      }),
      'create task',
    );
    const n = await findAdminNotification(adminCtx.page, /TASK/i, title, since);
    expect(n, 'admin should get a TASK_* notification').toBeTruthy();
  });

  test('profile-update request reaches the admin', async ({ page }) => {
    const since = new Date().toISOString();
    const title = uniqueName('Notify Request');
    ok(
      await api(page, 'POST', '/notifications/request', {
        title,
        message: `${title}: automated check, please ignore.`,
        actionType: 'profile-update',
        category: 'profile',
      }),
      'send request',
    );
    const n = await waitForAdminNotification(adminCtx.page, 'profile-update', title, since);
    expect(n.category).toBe('profile');
  });
});

test.describe('Notifications: admin inbox functions', () => {
  test.skip(!admin.email || !admin.password, 'Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');

  test('unread count on the bell matches the server', async ({ browser }) => {
    const a = await loginAdmin(browser);
    try {
      const r = await api(a.page, 'GET', '/notifications/unread-count');
      ok(r, 'unread-count');
      const n = r.json.data.unreadCount as number;
      await a.page.goto('/admin/notifications');
      const bell = a.page.locator('button[title="Notifications"]').first();
      await expect(bell).toHaveAttribute('aria-label', n > 0 ? `Notifications, ${n} unread` : 'Notifications');
    } finally {
      await a.context.close();
    }
  });

  test('each category filter only returns that category', async ({ browser }) => {
    const a = await loginAdmin(browser);
    try {
      for (const c of ['session', 'batch', 'course_content', 'announcement', 'profile']) {
        const r = await api(a.page, 'GET', `/notifications?page=1&limit=20&category=${c}`);
        ok(r, `category ${c}`);
        for (const n of r.json.data.notifications) expect(n.category, `filter ${c}`).toBe(c);
      }
    } finally {
      await a.context.close();
    }
  });

  test('@known-bug search returns results instead of a server error', async ({ browser }) => {
    test.info().annotations.push({ type: 'issue', description: 'GET /notifications?search=... returns 500; the page stays on "Loading notifications..."' });
    const a = await loginAdmin(browser);
    try {
      const r = await api(a.page, 'GET', '/notifications?page=1&limit=10&search=Trainer');
      expect(r.status, r.text).toBe(200);
    } finally {
      await a.context.close();
    }
  });

  test('@known-bug payment notifications have a category filter and a link', async ({ browser }) => {
    test.info().annotations.push({ type: 'issue', description: 'category "payment" is missing from the filter and has no destination' });
    const a = await loginAdmin(browser);
    try {
      await a.page.goto('/admin/notifications');
      const category = a.page.getByLabel('Notification inbox').locator('select').nth(1);
      await expect(category.locator('option[value="payment"]')).toHaveCount(1);
    } finally {
      await a.context.close();
    }
  });
});

test.describe('Notifications: trainer bell bugs', () => {
  test('@known-bug trainer is not notified about their own announcement', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    test.info().annotations.push({ type: 'issue', description: '/dashboard/trainer announcements have no isMine, so own posts are not filtered out' });
    await page.goto('/trainer/dashboard');
    const courses = list(await api(page, 'GET', '/courses?page=1&limit=100'), 'courses', 'items');
    const courseId = courses.find((c) => TRAINER_COURSE.test(c.courseName))?._id;
    test.skip(!courseId, `trainer has no course matching ${TRAINER_COURSE}`);
    const title = uniqueName('Notify Own Ann');
    ok(
      await api(page, 'POST', '/announcements', {
        title,
        message: 'QA Test: own-announcement check. Please ignore.',
        priority: 'normal',
        audience: { type: 'course-trainers', courseIds: [courseId] },
        status: 'published',
      }),
      'create announcement',
    );
    const id = list(await api(page, 'GET', '/announcements?page=1&limit=10'), 'items').find((a) => a.title === title)?._id;
    try {
      await page.goto('/trainer/notifications');
      await expect(page.getByLabel('Notification inbox')).toBeVisible();
      await page.waitForTimeout(3_000);
      await expect(page.getByRole('list', { name: 'Notifications' }).getByText(title)).toHaveCount(0);
    } finally {
      if (id) await api(page, 'DELETE', `/announcements/${id}`);
    }
  });

  test('@known-bug read state survives logging in again', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'read/deleted state is only in localStorage and is wiped on logout' });
    await page.goto('/trainer/notifications');
    await expect(page.getByLabel('Notification inbox')).toBeVisible();
    await page.getByRole('button', { name: /mark all read/i }).click();
    await expect(page.locator('button[title="Notifications"]').first()).toHaveAttribute('aria-label', 'Notifications');
    // A fresh sign-in starts with empty localStorage, like logging out and in or another device.
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('trainer-notifications:')) localStorage.removeItem(k);
    });
    await page.reload();
    await page.waitForTimeout(3_000);
    await expect(page.locator('button[title="Notifications"]').first()).toHaveAttribute('aria-label', 'Notifications');
  });
});
