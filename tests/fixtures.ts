import { test as base, expect } from '@playwright/test';
import { applyProfileGateBypass } from './helpers';

/** Same as Playwright's test, but every browser context gets the profile-gate bypass (if enabled). */
export const test = base.extend({
  context: async ({ context }, use) => {
    await applyProfileGateBypass(context);
    await use(context);
  },
});

export { expect };
