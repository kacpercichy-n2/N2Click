// Focused browser check for role landing, the mobile drawer, and calendar
// pseudo-button keyboard activation.
// Usage: node scripts/browser-check-ui-keyboard.mjs [chromium|webkit]
// Requires the Vite dev server on http://localhost:5173.

import { chromium, webkit } from 'playwright';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const failures = [];

function check(condition, label) {
  if (condition) console.log(`PASS: ${label}`);
  else {
    console.error(`FAIL: ${label}`);
    failures.push(label);
  }
}

async function clearPendingIntro(page) {
  await page.evaluate(() => sessionStorage.removeItem('n2hub.onboarding.login.v1'));
}

async function run() {
  const browser = await LAUNCHER.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Wczytaj przykładowe dane' }).click();

    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await page.getByRole('button').filter({ hasText: 'PRACOWNIK' }).click();
    await page.waitForURL('**/my-work');
    check(new URL(page.url()).pathname === '/my-work', 'pracownik logs in to /my-work');
    await clearPendingIntro(page);

    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await page.getByRole('button').filter({ hasText: 'ADMINISTRATOR' }).first().click();
    await page.waitForURL('**/dashboard');
    check(new URL(page.url()).pathname === '/dashboard', 'non-worker logs in to /dashboard');
    await clearPendingIntro(page);

    await page.setViewportSize({ width: 375, height: 812 });
    const drawer = page.locator('#app-drawer');
    const main = page.locator('main.app-main');
    const hamburger = page.getByRole('button', { name: 'Otwórz menu' });
    check((await drawer.getAttribute('aria-hidden')) === 'true', 'closed mobile drawer is aria-hidden');
    check(await drawer.evaluate((element) => element.inert), 'closed mobile drawer is inert');

    await hamburger.focus();
    await page.keyboard.press('Tab');
    check(
      !(await page.evaluate(() => Boolean(document.activeElement?.closest('#app-drawer')))),
      'closed mobile drawer is skipped by sequential focus',
    );

    await hamburger.click();
    check((await drawer.getAttribute('aria-hidden')) === null, 'open mobile drawer is exposed to assistive technology');
    check(!(await drawer.evaluate((element) => element.inert)), 'open mobile drawer is not inert');
    check(await main.evaluate((element) => element.inert), 'open mobile drawer makes background content inert');
    await page.waitForFunction(() => Boolean(document.activeElement?.closest('#app-drawer'))).catch(() => {});
    check(
      await page.evaluate(() => Boolean(document.activeElement?.closest('#app-drawer'))),
      'opening the drawer moves focus into it',
    );

    await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('#app-drawer a[href], #app-drawer button:not([disabled]), #app-drawer input:not([disabled]), #app-drawer select:not([disabled]), #app-drawer textarea:not([disabled]), #app-drawer [tabindex]:not([tabindex="-1"])'));
      const visible = candidates.filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      visible.at(-1)?.focus();
    });
    await page.keyboard.press('Tab');
    check(
      await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('#app-drawer a[href], #app-drawer button:not([disabled]), #app-drawer input:not([disabled]), #app-drawer select:not([disabled]), #app-drawer textarea:not([disabled]), #app-drawer [tabindex]:not([tabindex="-1"])'));
        const visible = candidates.filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
        return document.activeElement === visible[0];
      }),
      'forward Tab wraps from the last drawer control to the first',
    );
    await page.keyboard.press('Shift+Tab');
    check(
      await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('#app-drawer a[href], #app-drawer button:not([disabled]), #app-drawer input:not([disabled]), #app-drawer select:not([disabled]), #app-drawer textarea:not([disabled]), #app-drawer [tabindex]:not([tabindex="-1"])'));
        const visible = candidates.filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
        return document.activeElement === visible.at(-1);
      }),
      'reverse Tab wraps from the first drawer control to the last',
    );

    await page.keyboard.press('Escape');
    check((await hamburger.getAttribute('aria-expanded')) === 'false', 'Escape closes the mobile drawer');
    check(await hamburger.evaluate((element) => element === document.activeElement), 'closing restores focus to the hamburger');
    check(await drawer.evaluate((element) => element.inert), 'closed drawer becomes inert again');
    check(!(await main.evaluate((element) => element.inert)), 'closing restores background interaction');

    await page.setViewportSize({ width: 1280, height: 800 });
    // matchMedia change delivery is asynchronous relative to setViewportSize;
    // wait for React to apply the desktop state before asserting it.
    await page.waitForFunction(() => {
      const element = document.querySelector('#app-drawer');
      return element !== null && !element.inert && !element.hasAttribute('aria-hidden');
    });
    check(!(await drawer.evaluate((element) => element.inert)), 'desktop sidebar remains operable');
    check((await drawer.getAttribute('aria-hidden')) === null, 'desktop sidebar is not aria-hidden');

    await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
    const timedBlock = page.locator('.week-block[role="button"]').first();
    await timedBlock.focus();
    await page.keyboard.press('Space');
    const taskModal = page.locator('.task-modal-card');
    await taskModal.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    check(await taskModal.isVisible().catch(() => false), 'Space activates a timed calendar block');
    await taskModal.getByRole('button', { name: 'Zamknij' }).click();
    await taskModal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

    const binCard = page.locator('.week-bin-block[role="button"]').first();
    if ((await binCard.count()) > 0) {
      await binCard.focus();
      await page.keyboard.press('Space');
      await taskModal.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      check(await taskModal.isVisible().catch(() => false), 'Space activates a calendar bin card');
    } else {
      check(false, 'sample data exposes a calendar bin card for keyboard coverage');
    }
  } catch (error) {
    failures.push(`harness error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n[${ENGINE}] UI KEYBOARD CHECK FAILED\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`\n[${ENGINE}] UI KEYBOARD CHECK PASS`);
}

void run();
