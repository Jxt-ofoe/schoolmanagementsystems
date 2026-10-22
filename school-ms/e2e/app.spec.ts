import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(base)) throw new Error('E2E tests only run against the local stack');

// Accounts created by scripts/local-stack/seed-demo.mjs (random passwords, local only)
const lines = readFileSync('.local-stack/demo-credentials.txt', 'utf8').split('\n').filter((l) => l.includes('@'));
const acct = (re: RegExp) => { const l = lines.find((x) => re.test(x))!; const [email, password] = l.trim().split(/\s+/).slice(-2); return { email, password }; };
const admin = acct(/Platform Admin/), head = acct(/Abena Owusu/), teacher = acct(/Kwame Mensah/);

async function login(page: Page, who: { email: string; password: string }, path = '/') {
  await page.goto(path);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function noHorizontalOverflow(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw, 'page should not scroll sideways').toBeLessThanOrEqual(iw + 1);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png`, fullPage: false });

test('protected route redirects to login and returns afterwards', async ({ page }) => {
  await page.goto('/school/students');
  await expect(page).toHaveURL(/\/login\?next=%2Fschool%2Fstudents/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, '01-login');
  await page.getByLabel('Email').fill(head.email);
  await page.getByLabel('Password').fill(head.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/school\/students$/);
});

test('wrong password shows an error', async ({ page }) => {
  await login(page, { email: head.email, password: 'definitely-wrong-1' });
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('headmaster: dashboard, class cards, search, roster, profile', async ({ page }) => {
  await login(page, head);
  await expect(page).toHaveURL(/\/school$/);
  await expect(page.getByText('Active students').first()).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, '02-headmaster-dashboard');

  await page.goto('/school/students');
  await expect(page.locator('a.class-card')).toHaveCount(4);
  await expect(page.locator('a.class-card').filter({ hasText: 'JHS 1' }).first()).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, '03-students-classes');

  await page.getByLabel('Search students').fill('ADB/0013');
  await expect(page.getByText('ADB/0013').first()).toBeVisible();
  await expect(page).toHaveURL(/q=ADB/);
  await shot(page, '04-students-search');

  await page.getByLabel('Search students').fill('');
  await page.locator('a.class-card').filter({ hasText: 'JHS 2' }).click();
  await expect(page).toHaveURL(/\/school\/students\/class\//);
  await expect(page.getByText('ADB/0040').first()).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, '05-class-roster');

  await page.getByText('ADB/0040').first().click();
  await expect(page).toHaveURL(/\/school\/students\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Guardian').first()).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, '06-student-profile');

  await page.goto('/school/attendance');
  await expect(page.getByText('JHS 1 A').first()).toBeVisible();
  await shot(page, '07-attendance-overview');

  await page.goto('/school/billing');
  await expect(page.getByText('× ').first()).toBeVisible();
  await shot(page, '08-school-billing');
});

test('headmaster cannot open platform admin pages', async ({ page }) => {
  await login(page, head);
  await expect(page).toHaveURL(/\/school$/);
  await page.goto('/admin/billing');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('teacher: dashboard, attendance register, no headmaster pages', async ({ page }) => {
  await login(page, teacher);
  await expect(page).toHaveURL(/\/teach$/);
  await expect(page.getByText('JHS 1 A').first()).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, '09-teacher-dashboard');

  await page.getByRole('link', { name: /Take attendance|View register/ }).first().click();
  await expect(page).toHaveURL(/\/attendance\//);
  await expect(page.locator('.att-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark remaining present' }).click();
  await expect(page.locator('.att-btn.s-present[aria-pressed="true"]').first()).toBeVisible();
  await page.locator('.att-row').nth(2).getByRole('button', { name: 'Absent' }).click();
  await expect(page.locator('.att-row').nth(2).locator('.att-btn.s-absent')).toHaveAttribute('aria-pressed', 'true');
  await noHorizontalOverflow(page);
  await shot(page, '10-take-attendance');

  await page.goto('/school/billing');
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('super admin: schools and billing', async ({ page }) => {
  await login(page, admin);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('Platform overview')).toBeVisible();
  await shot(page, '11-admin-dashboard');
  await page.goto('/admin/schools');
  await expect(page.getByText('Accra Demo Basic School')).toBeVisible();
  await noHorizontalOverflow(page);
  await page.goto('/admin/billing');
  await expect(page.getByText('Accra Demo Basic School').first()).toBeVisible();
  await shot(page, '12-admin-billing');
});
