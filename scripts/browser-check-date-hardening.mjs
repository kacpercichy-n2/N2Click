// Browser gate for run 2026-07-12 (release-hardening-1: invalid-date crashes).
//
// Drives a REAL browser (Chromium or WebKit) against the dev server on :5173
// and verifies the four end-of-run flows from handoffs/RUN-STATE.md:
//   1. Original repro — clear BOTH project dates, save → Polish inline error,
//      NO blank screen, NO uncaught RangeError, nothing persisted.
//   2. TaskModal — empty / reversed period → Polish error, no "NaN" in the DOM.
//   3. Corrupt persisted payload (project ''-date, impossible task date, garbage
//      milestone date, off-calendar workload date) → app loads repaired, pages
//      render, no page errors.
//   4. Forced render throw (Date.prototype.getMonth poisoned behind a flag) →
//      Polish recovery screen with export/reload/reset; confirmed reset returns
//      the app to a clean, usable state.
//
// Usage:  node scripts/browser-check-date-hardening.mjs [chromium|webkit]
// Exits non-zero if any flow fails. Dev server must already be on :5173.
//
// Screenshots: reviews/screenshots-20260712-datehardening/<engine>-*.png

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const KEY = 'n2hub.data.v1';
const SHOTS = 'reviews/screenshots-20260712-datehardening';
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
const ok = (cond, label) => {
  notes.push(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures.push(label);
};

async function newPage(browser, { poisonDates = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  if (poisonDates) {
    // Installed on every navigation; throws ONLY once window.__forceCrash is
    // set, so seeding and normal navigation are unaffected. Any page that
    // formats a date (date-fns 'MMM' → getMonth) then throws during render.
    await page.addInitScript(() => {
      const orig = Date.prototype.getMonth;
      Date.prototype.getMonth = function (...args) {
        if (window.__forceCrash) throw new Error('TEST-FORCED render crash');
        return orig.apply(this, args);
      };
    });
  }
  return { context, page, pageErrors };
}

async function seed(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const seedBtn = page.getByRole('button', { name: 'Wczytaj przykładowe dane' });
  await seedBtn.waitFor({ timeout: 10000 });
  await seedBtn.click();
  // LOAD_SAMPLE signs in Kasia (admin); handle a login screen defensively.
  const loginRow = page.locator('.login-person').first();
  if (await loginRow.isVisible().catch(() => false)) await loginRow.click();
  await page.locator('.app-nav-link').first().waitFor({ timeout: 10000 });
}

const readStore = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

// ---- Flow 1: clear both project dates, save ----
async function flowEmptyProjectDates(browser) {
  const { context, page, pageErrors } = await newPage(browser);
  try {
    await seed(page);
    const before = await readStore(page);
    const proj = before.projects[0];
    await page.goto(`${BASE}/projects/${proj.id}`, { waitUntil: 'networkidle' });
    await page.locator('#pd-start').waitFor({ timeout: 10000 });
    await page.fill('#pd-start', '');
    await page.fill('#pd-end', '');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    const err = page.locator('.field-error');
    await err.first().waitFor({ timeout: 5000 }).catch(() => {});
    const errText = (await err.first().textContent().catch(() => '')) || '';
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow1-inline-error.png` });
    ok(errText.includes('Podaj datę startu'), `flow1: Polish inline error shown (got "${errText}")`);
    // App still alive: sidebar nav navigates.
    await page.locator('a.app-nav-link[href="/dashboard"]').click().catch(() => {});
    const alive = await page
      .locator('.app-nav-link')
      .first()
      .isVisible()
      .catch(() => false);
    ok(alive, 'flow1: app still usable after rejected save (no blank screen)');
    const after = await readStore(page);
    const stored = after.projects.find((p) => p.id === proj.id);
    ok(
      stored.startDate === proj.startDate && stored.endDate === proj.endDate,
      'flow1: nothing persisted — stored project dates unchanged',
    );
    const rangeErrs = pageErrors.filter((e) => /RangeError|Invalid time value/i.test(e));
    ok(rangeErrs.length === 0, `flow1: no uncaught RangeError (${rangeErrs.join('; ')})`);
  } catch (e) {
    ok(false, `flow1: harness error — ${e.message}`);
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow1-harness-error.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

// ---- Flow 2: TaskModal empty / reversed dates, no NaN ----
async function flowTaskModal(browser) {
  const { context, page, pageErrors } = await newPage(browser);
  try {
    await seed(page);
    const data = await readStore(page);
    const task = data.tasks[0];
    await page.goto(`${BASE}/tasks?task=${task.id}`, { waitUntil: 'networkidle' });
    const modal = page.locator('.task-modal-card[role="dialog"]');
    await modal.waitFor({ timeout: 10000 });
    // Empty start date → missing-start error, live.
    await page.fill('#t-start', '');
    let errText = (await modal.locator('.field-error').first().textContent().catch(() => '')) || '';
    ok(errText.includes('Podaj datę startu'), `flow2: empty start shows Polish error (got "${errText}")`);
    // Reversed period → reversed error.
    await page.fill('#t-start', '2026-07-20');
    await page.fill('#t-end', '2026-07-10');
    errText = (await modal.locator('.field-error').first().textContent().catch(() => '')) || '';
    ok(errText.includes('Data końca musi być'), `flow2: reversed period shows Polish error (got "${errText}")`);
    const modalText = (await modal.textContent()) || '';
    ok(!modalText.includes('NaN'), 'flow2: no "NaN" rendered in the task modal');
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow2-taskmodal-error.png` });
    ok(pageErrors.length === 0, `flow2: no page errors (${pageErrors.join('; ')})`);
  } catch (e) {
    ok(false, `flow2: harness error — ${e.message}`);
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow2-harness-error.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

// ---- Flow 3: corrupt persisted payload loads repaired ----
async function flowCorruptPayload(browser) {
  const { context, page, pageErrors } = await newPage(browser);
  try {
    await seed(page);
    const corrupted = await page.evaluate((key) => {
      const data = JSON.parse(localStorage.getItem(key));
      data.projects[0].startDate = '';
      data.projects[0].endDate = '';
      data.tasks[0].endDate = '2026-13-45';
      if (data.milestones[0]) data.milestones[0].date = 'not-a-date';
      const dated = data.workload.find((w) => w.date !== '');
      if (dated) dated.date = '2026-02-31';
      localStorage.setItem(key, JSON.stringify(data));
      return { projectId: data.projects[0].id, taskId: data.tasks[0].id };
    }, KEY);
    await page.reload({ waitUntil: 'networkidle' });
    const loaded = await page
      .locator('.app-nav-link')
      .first()
      .isVisible()
      .catch(() => false);
    ok(loaded, 'flow3: app loads with corrupt payload (data survived, no sample banner)');
    // Render the pages that consume the corrupted rows.
    await page.goto(`${BASE}/projects/${corrupted.projectId}`, { waitUntil: 'networkidle' });
    const projText = (await page.locator('main, body').first().textContent()) || '';
    ok(!projText.includes('NaN'), 'flow3: project detail renders without NaN');
    await page.goto(`${BASE}/tasks?task=${corrupted.taskId}`, { waitUntil: 'networkidle' });
    const modalVisible = await page
      .locator('.task-modal-card[role="dialog"]')
      .isVisible()
      .catch(() => false);
    ok(modalVisible, 'flow3: task modal opens on the repaired task');
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow3-repaired.png` });
    ok(pageErrors.length === 0, `flow3: no page errors across corrupt-data render (${pageErrors.join('; ')})`);
  } catch (e) {
    ok(false, `flow3: harness error — ${e.message}`);
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow3-harness-error.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

// ---- Flow 4: forced render throw → recovery screen → confirmed reset ----
async function flowErrorBoundary(browser) {
  const { context, page, pageErrors } = await newPage(browser, { poisonDates: true });
  try {
    await seed(page);
    await page.evaluate(() => {
      window.__forceCrash = true;
    });
    // Client-side navigate to a date-formatting page → render throws.
    await page.locator('a.app-nav-link[href="/projects"]').click();
    const crashCard = page.locator('.crash-card');
    await crashCard.waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow4-crash-screen.png` });
    const title = (await crashCard.locator('.crash-title').textContent()) || '';
    ok(title.includes('Coś poszło nie tak'), `flow4: Polish recovery screen shown (got "${title}")`);
    const exportVisible = await crashCard
      .getByRole('button', { name: 'Pobierz kopię danych (JSON)' })
      .isVisible()
      .catch(() => false);
    ok(exportVisible, 'flow4: export button offered (data still exportable)');
    // Export downloads the raw JSON.
    const download = await Promise.race([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      crashCard
        .getByRole('button', { name: 'Pobierz kopię danych (JSON)' })
        .click()
        .then(() => page.waitForEvent('download', { timeout: 5000 }))
        .catch(() => null),
    ]);
    ok(download !== null, 'flow4: export triggers a JSON download');
    // Confirmed reset → reload → clean app with sample banner (usable again).
    page.on('dialog', (d) => d.accept());
    await crashCard.getByRole('button', { name: 'Wyzeruj dane i zacznij od nowa' }).click();
    const seedBtn = page.getByRole('button', { name: 'Wczytaj przykładowe dane' });
    const recovered = await seedBtn
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    ok(recovered, 'flow4: confirmed reset reloads into a clean, usable app');
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow4-after-reset.png` });
    const unexpected = pageErrors.filter((e) => !/TEST-FORCED/.test(e));
    ok(unexpected.length === 0, `flow4: no page errors beyond the forced one (${unexpected.join('; ')})`);
  } catch (e) {
    ok(false, `flow4: harness error — ${e.message}`);
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-flow4-harness-error.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await LAUNCHER.launch({ headless: true });
  try {
    await flowEmptyProjectDates(browser);
    await flowTaskModal(browser);
    await flowCorruptPayload(browser);
    await flowErrorBoundary(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n=== ${ENGINE} — date-hardening browser gate ===`);
  for (const n of notes) console.log(n);
  console.log(`\n[${ENGINE}] VERDICT: ${failures.length ? `FAIL (${failures.length})` : 'PASS'}`);
  process.exit(failures.length ? 1 : 0);
}

run();
