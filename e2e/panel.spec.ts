import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// One story, in order (SPEC § 12): first-run setup, the Journal, a CVE opened from the
// keyboard, a custom source, language and theme switches, and an accessibility audit of every
// page. The demo data is fictional (SPEC § 15) and the network is faked (e2e/serve-demo.mjs).
test.describe.configure({ mode: 'serial' });

const PASSPHRASE = 'e2e passphrase for tests only';
const STATE = 'test-results/.session.json';
const PAGES = ['/', '/brief', '/threats', '/breaches', '/releases', '/settings'] as const;

/** Collects CSP / Trusted Types violations from the very first script of each document. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const list: string[] = [];
    Object.defineProperty(window, '__violations', { value: list });
    document.addEventListener('securitypolicyviolation', (event) => {
      list.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? []);
}

async function audit(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  const blocking = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} (${n.failureSummary ?? ''})`).join(', ')}`,
    );
  expect(blocking, `axe on ${page.url()}`).toEqual([]);
}

test.use({ reducedMotion: 'reduce' });

test('first run: setup creates the account and opens the Journal', async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Setup token').fill('e2e-setup-token');
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByLabel('Confirm passphrase').fill(PASSPHRASE);
  await page.getByLabel('Your first name (optional)').fill('Ada');
  await page.getByRole('button', { name: 'Create my Panel' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The Daily Brief' })).toBeVisible();
  expect(await violations()).toEqual([]);
});

test('the login page unlocks Panel', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The Daily Brief' })).toBeVisible();
  // Logging in is rate limited (SPEC § 9.2): the following tests reuse this session.
  await page.context().storageState({ path: STATE });
});

test.describe('signed in', () => {
  test.use({ storageState: STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'The Daily Brief' })).toBeVisible();
  });

  test('Journal filters by category', async ({ page }) => {
    await page.getByRole('button', { name: 'Cyber', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cyber', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a CVE opens in the drawer and is driven from the keyboard', async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto('/threats');
    const first = page.locator('[data-cve]').first();
    await first.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
    await expect(page).toHaveURL(/\/threats\/CVE-\d{4}-\d+/);
    const firstUrl = page.url();
    await page.keyboard.press('j');
    await expect(page).not.toHaveURL(firstUrl);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/threats(?:\?|$)/);
    expect(await violations()).toEqual([]);
  });

  test('a custom source is validated before it can be added', async ({ page }) => {
    await page.goto('/settings/sources');
    const add = page.getByRole('button', { name: 'Add to my sources' });
    await expect(add).toBeDisabled();
    await page.getByLabel('Feed URL').fill('https://news.example.org/feed');
    await page.getByRole('button', { name: 'Test feed' }).click();
    await expect(page.getByText('A neutral sample headline')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Example feed');
    await expect(add).toBeEnabled();
    await add.click();
    await expect(page.getByText('Example feed').first()).toBeVisible();

    // Private addresses are refused by the (faked) safeFetch and nothing can be added.
    await page.getByLabel('Feed URL').fill('https://192.168.1.10/rss');
    await page.getByRole('button', { name: 'Test feed' }).click();
    await expect(add).toBeDisabled();
  });

  test('language and theme switch without a reload', async ({ page }) => {
    await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'FR' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('link', { name: 'Menaces' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Passer au thème sombre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await audit(page);
    await page.getByRole('button', { name: 'Passer au thème clair' }).click();
    await page.getByRole('group', { name: 'Langue' }).getByRole('button', { name: 'EN' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  for (const path of PAGES) {
    test(`axe finds no serious issue on ${path}`, async ({ page }) => {
      const violations = await watchViolations(page);
      await page.goto(path);
      await expect(page.locator('#page-title')).toBeVisible();
      await audit(page);
      expect(await violations()).toEqual([]);
    });
  }
});
