import { test, expect } from './fixtures';
import * as path from 'path';
import { openSection, tableRows, uniqueName, env, COURSES } from './helpers';
import type { Page } from '@playwright/test';

const PDF = path.join(__dirname, '..', 'test-data', 'qa-test-document.pdf');

async function openCourseContent(page: Page) {
  await page.goto('/trainer/dashboard');
  await openSection(page, 'My Courses');
  await tableRows(page).filter({ hasText: COURSES.testingProfile }).getByRole('link', { name: 'View course' }).click();
  await page.getByRole('button', { name: 'Course content' }).click();
  await expect(page.getByRole('button', { name: 'Upload document' })).toBeVisible();
}

const uploadModal = (page: Page) => page.getByRole('dialog', { name: 'Upload Document' });

test.describe('Course content', () => {
  test.beforeEach(async ({ page }) => openCourseContent(page));

  test('content sections are listed', async ({ page }) => {
    for (const label of ['Videos', 'Documents', 'Online resources', 'Text content', 'Lessons', 'Assignments']) {
      await expect(page.locator('main a', { hasText: label }).first()).toBeVisible();
    }
  });

  test('upload form requires title, module and file', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload document' }).click();
    const modal = uploadModal(page);
    await modal.getByRole('button', { name: 'Upload Document', exact: true }).click();
    await expect(modal).toBeVisible(); // nothing submitted
    await expect(modal.getByText(/required|please/i).first()).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel' }).click();
  });

  test('file picker accepts only document types', async ({ page }) => {
    await page.getByRole('button', { name: 'Upload document' }).click();
    const accept = await uploadModal(page).locator('input[type=file]').getAttribute('accept');
    expect(accept).toContain('.pdf');
    expect(accept).not.toContain('.txt');
    await uploadModal(page).getByRole('button', { name: 'Cancel' }).click();
  });

  test('upload a "QA Test" PDF as Draft and see the Draft badge', async ({ page }) => {
    test.skip(!env.runCreateTests, 'RUN_CREATE_TESTS=false');
    const title = uniqueName('Document');
    await page.getByRole('button', { name: 'Upload document' }).click();
    const modal = uploadModal(page);
    await modal.getByPlaceholder('HTML5 Semantic Elements Cheatsheet').fill(title);
    await modal.getByPlaceholder('Module 1 - Frontend Basics').fill('QA Test Module');
    await modal.locator('textarea').fill('QA Test automated upload, safe to delete');
    await modal.locator('select').selectOption('draft');
    await modal.locator('input[type=file]').setInputFiles(PDF);
    await modal.getByRole('button', { name: 'Upload Document', exact: true }).click();
    await expect(modal).toBeHidden({ timeout: 60_000 });

    const card = page
      .locator('main div')
      .filter({ hasText: title })
      .filter({ has: page.locator('[title="Edit Details"]') })
      .last();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/draft/i);
  });

  test('@known-bug SCRUM-165 Course Material library shows draft documents as Draft', async ({ page }) => {
    test.info().annotations.push({ type: 'issue', description: 'SCRUM-165: draft material listed as "All Batches" with no Draft label' });
    await openSection(page, 'Course Material');
    const row = page.locator('main').locator('tr, [class*=card]').filter({ hasText: 'QA Test Document' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/Draft/);
  });
});
