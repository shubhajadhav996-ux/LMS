import { test, expect } from './fixtures';
import { openSection, applyHeaderFilter, tableRows, COURSES } from './helpers';

test.describe('My Courses', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trainer/dashboard');
    await openSection(page, 'My Courses');
    await expect(page.getByRole('heading', { name: 'My Courses' })).toBeVisible();
  });

  test('shows only the courses assigned to the trainer', async ({ page }) => {
    const rows = tableRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: COURSES.testingProfile })).toHaveCount(1);
    await expect(rows.filter({ hasText: COURSES.trainerCourse })).toHaveCount(1);
    await expect(page.getByText(/Showing 1 to 2 of 2 Courses/)).toBeVisible();
  });

  test('trainer cannot edit or delete a course (admin only)', async ({ page }) => {
    const row = tableRows(page).first();
    await expect(row.locator('[title="Only an admin can edit a course"]')).toBeVisible();
    await expect(row.locator('[title="Only an admin can delete a course"]')).toBeVisible();
  });

  test('filter by course name, no-match message, and Clear All Filters', async ({ page }) => {
    await applyHeaderFilter(page, 'Filter by course name', (p) => p.getByPlaceholder('Search course name').fill('Testing'));
    await expect(tableRows(page)).toHaveCount(1);
    await expect(tableRows(page).first()).toContainText(COURSES.testingProfile);

    await applyHeaderFilter(page, 'Filter by course name', async (p) => {
      await p.getByPlaceholder('Search course name').fill('zzzQA');
    });
    await expect(page.getByText(/No courses match these filters|No Courses Found/i)).toBeVisible();

    await page.getByRole('button', { name: 'Clear All Filters' }).click();
    await expect(tableRows(page)).toHaveCount(2);
  });

  test('filter by assigned trainer', async ({ page }) => {
    await applyHeaderFilter(page, 'Filter by assigned trainers', (p) =>
      p.locator('label', { hasText: /^shubhangi jadhav$/ }).locator('input[type=checkbox]').check(),
    );
    // Only "This For Trainer Course And Batches" is co-assigned to the other trainer.
    await expect(tableRows(page)).toHaveCount(1);
    await expect(tableRows(page).first()).toContainText(COURSES.trainerCourse);
    await page.getByRole('button', { name: 'Clear All Filters' }).click();
    await expect(tableRows(page)).toHaveCount(2);
  });

  test('filter by status', async ({ page }) => {
    await applyHeaderFilter(page, 'Filter by status', (p) => p.locator('select').selectOption('active'));
    await expect(tableRows(page)).toHaveCount(2);
    await applyHeaderFilter(page, 'Filter by status', (p) => p.locator('select').selectOption('inactive'));
    await expect(page.getByText(/No courses match these filters|No Courses Found/i)).toBeVisible();
    await applyHeaderFilter(page, 'Filter by status', (p) => p.locator('select').selectOption('upcoming'));
    await expect(page.getByText(/No courses match these filters|No Courses Found/i)).toBeVisible();
    await page.getByRole('button', { name: 'Clear All Filters' }).click();
    await expect(tableRows(page)).toHaveCount(2);
  });

  test('search box finds a course', async ({ page }) => {
    await page.getByPlaceholder('Search courses or trainers').fill('Testing');
    await expect(tableRows(page)).toHaveCount(1);
  });

  test('course detail page opens with batches and course content tabs', async ({ page }) => {
    await tableRows(page).filter({ hasText: COURSES.testingProfile }).getByRole('link', { name: 'View course' }).click();
    await expect(page).toHaveURL(/\/trainer\/courses\/[a-f0-9]+/);
    await expect(page.getByRole('heading', { name: /Testing Profile/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Batches \(\d+\)/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Course content' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add batch' })).toBeVisible();
  });

  test('@known-bug SCRUM-163 student count is consistent between My Courses and the course page', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-163: My Courses shows 0 students while the course batches list students' });
    const row = tableRows(page).filter({ hasText: COURSES.testingProfile });
    const listCount = Number((await row.locator('td').nth(3).innerText()).trim());
    await row.getByRole('link', { name: 'View course' }).click();
    const card = page.getByText('Total students', { exact: true }).locator('xpath=preceding-sibling::*[1]');
    await expect(card).toBeVisible();
    const cardText = (await card.innerText()).trim();
    const batchStudents = await page
      .locator('main tbody tr')
      .evaluateAll((rows) => rows.map((r) => Number((r.querySelectorAll('td')[4]?.textContent || '0').trim()) || 0));
    const sum = batchStudents.reduce((a, b) => a + b, 0);
    test.info().annotations.push({
      type: 'observed',
      description: `My Courses=${listCount}, Total students card=${cardText}, sum of Students column in batches=${sum}`,
    });
    expect(cardText, 'Total students card should show a number').toMatch(/^\d+$/);
    expect(Number(cardText), 'card should equal My Courses count').toBe(listCount);
    expect(sum, 'students listed in batches should equal the course total').toBe(Number(cardText));
  });
});
