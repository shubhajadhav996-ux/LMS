# LMS trainer portal: Playwright tests

End-to-end tests (TypeScript + Playwright) for the trainer side of the LMS at
https://lms-website-lyart.vercel.app (trainers sign in at `/atlogin`).

They cover the flows tested manually in October 2026:

| File | What it checks |
|---|---|
| `tests/login.spec.ts` | Trainer login, wrong password, profile-completion redirect, student login error (SCRUM-162) |
| `tests/courses.spec.ts` | My Courses list, admin-only actions, filters (course name, trainer, status), search, course page, student counts (SCRUM-163), Students column vs enrolled (SCRUM-203) |
| `tests/batches.spec.ts` | Batch list, Create Batch validation, course list, create a batch, save time (SCRUM-164) |
| `tests/course-content.spec.ts` | Course content sections, upload validation, upload a Draft PDF, Draft label in Course Material (SCRUM-165) |
| `tests/announcements.spec.ts` | List, form validation, past schedule, .txt attachment, publish, title filter, Edit/Delete visibility (SCRUM-179, 180), Date sort (SCRUM-182) |
| `tests/tasks.spec.ts` | List, form validation, past due date, batch scope, .txt attachment, create task, task details (SCRUM-199), row actions (SCRUM-200), zero-recipient task (SCRUM-201), optional description (SCRUM-202) |

## Rules the suite follows

- **Credentials live only in `.env`**, which is git-ignored. `.env.example` shows the keys.
- **Everything it creates starts with `QA Test`** plus a time stamp (for example `QA Test Batch 0211-0547`).
- **It never deletes or edits existing data.** Set `RUN_CREATE_TESTS=false` to skip the tests that create records.
- Tests tagged **`@known-bug`** check the *correct* behaviour for a bug already filed in Jira. They fail while the bug is open and start passing once it is fixed. Run `npm run test:stable` to leave them out.

## Profile-completion gate (important)

Since early November 2026 the portal sends a trainer back to **Profile** on every page until their
profile is 100% complete. The test trainer's profile is incomplete, so with `BYPASS_PROFILE_GATE=true`
(the default) the tests make **only the browser's copy** of the profile flags say "complete". Nothing on
the account changes. Set it to `false` to test the real behaviour; page tests will then fail until the
profile is completed.

## Run it in VS Code

1. Install **Node.js 18 or newer** (https://nodejs.org) and **VS Code**.
2. Clone the repo and open the folder in VS Code (File > Open Folder).
3. Open a terminal in VS Code (Terminal > New Terminal) and run:
   ```bash
   npm install
   npx playwright install
   ```
   On Linux you may need `npx playwright install --with-deps`.
4. Create your `.env`:
   ```bash
   cp .env.example .env        # Windows PowerShell: copy .env.example .env
   ```
   Open `.env` and fill in `TRAINER_EMAIL` and `TRAINER_PASSWORD`.
5. Run all tests:
   ```bash
   npx playwright test
   ```
   Then open the HTML report with `npx playwright show-report`.

### With the Playwright extension (click-to-run)

1. In VS Code Extensions (Ctrl+Shift+X), install **Playwright Test for VSCode** (publisher: Microsoft).
2. Open the **Testing** view (the flask icon in the left bar). The tests appear grouped by file.
3. Click the play button next to any test or file. Tick **Show browser** to watch it run, or
   **Show trace viewer** to step through each action afterwards.
4. Make sure the `chromium` project is ticked in the Playwright panel; the `setup` project logs in first automatically.

### Useful commands

| Command | What it does |
|---|---|
| `npm test` | Run everything |
| `npm run test:stable` | Run everything except `@known-bug` checks |
| `npm run test:known-bugs` | Only the known-bug checks (to see which bugs are fixed) |
| `npm run test:headed` | Run with the browser visible |
| `npm run test:ui` | Playwright UI mode (pick, watch and rerun tests) |
| `npx playwright test tests/tasks.spec.ts` | One file |
| `npm run report` | Open the last HTML report |

## How it works

- `tests/auth.setup.ts` logs in once and saves the session to `playwright/.auth/trainer.json` (git-ignored).
- `tests/fixtures.ts` adds the profile-gate bypass to every test.
- `tests/helpers.ts` holds the `.env` settings, sidebar navigation, filter-panel helpers and `QA Test` naming.
- Tests run one at a time (`workers: 1`) because they share one live account.
- Failures keep a screenshot, video and trace in `test-results/`.

## Known-bug mapping

| Jira | Checked by |
|---|---|
| SCRUM-162 | Student login error message |
| SCRUM-163 | Course student count is a number and matches My Courses |
| SCRUM-164 | Create Batch saves within 3 seconds |
| SCRUM-165 | Draft label in Course Material |
| SCRUM-179 / 180 / 182 | Announcement actions on load, Delete on others' posts, Date sort |
| SCRUM-199 / 200 / 201 | Task details for trainers, task actions on load, zero-recipient task |
| SCRUM-202 | Task Description is optional |
| SCRUM-203 | Course page Students column shows enrolled count |
| SCRUM-205 | Profile-completion redirect (documented by `login.spec.ts`; the suite bypasses it) |
