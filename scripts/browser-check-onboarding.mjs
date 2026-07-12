// Browser smoke check for first-login onboarding and manual replay.
// Usage: node scripts/browser-check-onboarding.mjs [chromium|webkit]
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

async function run() {
  const browser = await LAUNCHER.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Wczytaj przykładowe dane' }).click();
    const currentUserId = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('n2hub.data.v1'));
      return data.currentUserId;
    });

    // Reproduce a real first login: the login page writes the session marker.
    await page.evaluate((id) => {
      localStorage.removeItem('n2hub.ui.v1');
      sessionStorage.setItem('n2hub.onboarding.login.v1', id);
    }, currentUserId);
    await page.reload({ waitUntil: 'networkidle' });

    const intro = page.locator('.onboarding-intro');
    await intro.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    check(await intro.isVisible().catch(() => false), 'first login opens the intro');
    check((await intro.textContent())?.includes('Zaplanuj pracę bez zgadywania.') ?? false, 'intro has Polish product copy');

    await intro.getByRole('button', { name: 'Pomiń' }).click();
    await intro.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await page.reload({ waitUntil: 'networkidle' });
    check(!(await intro.isVisible().catch(() => false)), 'skip is persisted and does not reopen automatically');

    await page.locator('.sidebar-help').click();
    const center = page.locator('.tutorial-center');
    await center.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    check(await center.isVisible().catch(() => false), 'help centre reopens tutorials on demand');
    check((await center.textContent())?.includes('Kalendarz i Zasobnik') ?? false, 'role-appropriate modules are listed');

    await center.getByRole('button', { name: 'Uruchom' }).first().click();
    const coachmark = page.locator('.onboarding-coachmark');
    await coachmark.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    check(await coachmark.isVisible().catch(() => false), 'a selected module opens a coachmark');
    check((await coachmark.getAttribute('aria-modal')) === 'true', 'coachmark is announced as a modal dialog');
    await page.keyboard.press('Escape');
    await coachmark.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    check(!(await coachmark.isVisible().catch(() => false)), 'Escape closes a running tutorial');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(overflow, 'onboarding adds no horizontal viewport overflow');
  } catch (error) {
    failures.push(`harness error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n[${ENGINE}] ONBOARDING CHECK FAILED\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`\n[${ENGINE}] ONBOARDING CHECK PASS`);
}

void run();
