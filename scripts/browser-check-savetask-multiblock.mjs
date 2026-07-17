// Browser regression for PKG-20260712b-savetask-core: SAVE_TASK must reconcile
// per-(person,date) allocation-grid cells by DELTA, never drop-and-recreate, so
// existing multi-block calendar days survive an unchanged TaskModal save and
// grid edits touch only the blocks their new total implies.
//
// Drives a REAL browser (Chromium or WebKit) against the dev server on :5173,
// seeds the sample data, then injects a second same-task/same-person/same-day
// WorkloadEntry via localStorage (a deterministic multi-block repro — no drag
// simulation needed). Verifies:
//   b/c. the allocation-grid cell sums both blocks and shows the ×N
//        multi-block badge.
//   d.   an UNCHANGED save leaves both WorkloadEntry rows byte-identical
//        (id, plannedHours, startMinutes, sortIndex) — the actual regression.
//   e.   +1h on the cell grows ONLY the later-starting (last) block by 1h;
//        the earlier block is untouched.
//   f.   setting the cell to 0 deletes both of that pair's blocks and leaves
//        every OTHER workload row of the task unchanged.
//   g.   sanity screenshot of the calendar week showing the two blocks
//        (taken right after step d, before e/f mutate them away).
//
// Usage:  node scripts/browser-check-savetask-multiblock.mjs [chromium|webkit]
// Exits non-zero if any check fails. Dev server must already be on :5173.
//
// Screenshots: reviews/screenshots-20260712-savetask/<engine>-*.png

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const KEY = 'n2hub.data.v1';
const SHOTS = 'reviews/screenshots-20260712-savetask';
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
const ok = (cond, label) => {
  notes.push(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures.push(label);
};

async function newPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
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

// Injects a duplicate WorkloadEntry right after the FIRST dated (non-bin) row
// found in the sample data — deterministic, no drag simulation required.
// Returns both rows plus the grid coordinates (dayIndex/colIndex) needed to
// locate the AllocationGrid cell.
async function seedMultiBlock(page) {
  return page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    const original = data.workload.find((w) => w.date !== '' && w.plannedHours > 0);
    if (!original) return { ok: false, reason: 'no dated workload entry in sample data' };
    const dupHours = 1;
    const rawStart = original.startMinutes + original.plannedHours * 60;
    const snapped = Math.round(rawStart / 15) * 15;
    const startMinutes = Math.min(snapped, 1440 - dupHours * 60);
    const dup = {
      id: `multiblock-test-dup-${Date.now()}`,
      taskId: original.taskId,
      personId: original.personId,
      date: original.date,
      plannedHours: dupHours,
      startMinutes,
      sortIndex: original.sortIndex + 1,
    };
    data.workload.push(dup);
    localStorage.setItem(key, JSON.stringify(data));
    const task = data.tasks.find((t) => t.id === original.taskId);
    const assignedIds = new Set(
      data.assignments.filter((a) => a.taskId === task.id).map((a) => a.personId),
    );
    const colIndex = data.people
      .filter((p) => assignedIds.has(p.id))
      .findIndex((p) => p.id === original.personId);
    return {
      ok: true,
      taskId: original.taskId,
      personId: original.personId,
      date: original.date,
      original,
      dup,
      taskStartDate: task.startDate,
      colIndex,
    };
  }, KEY);
}

async function flowMultiBlockSave(browser) {
  const { context, page, pageErrors } = await newPage(browser);
  try {
    await seed(page);
    const seedInfo = await seedMultiBlock(page);
    if (!seedInfo.ok) {
      ok(false, `seed: ${seedInfo.reason}`);
      return;
    }
    const dayIndex = Math.round(
      (new Date(seedInfo.date) - new Date(seedInfo.taskStartDate)) / 86400000,
    );
    const totalAfterDup = seedInfo.original.plannedHours + seedInfo.dup.plannedHours;
    await page.reload({ waitUntil: 'networkidle' });

    const modal = page.locator('.task-modal-card[role="dialog"]');
    const openModal = async () => {
      await page.goto(`${BASE}/tasks?task=${seedInfo.taskId}`, { waitUntil: 'networkidle' });
      await modal.waitFor({ timeout: 10000 });
    };
    const cell = () =>
      modal
        .locator('.alloc-grid tbody tr')
        .nth(dayIndex)
        .locator('td.alloc-cell')
        .nth(seedInfo.colIndex);

    // --- (c) grid cell sums both blocks, ×N badge visible ---
    await openModal();
    const valueC = await cell().locator('input.alloc-input').inputValue();
    ok(
      Number(valueC) === totalAfterDup,
      `c: grid cell shows the summed total (expected ${totalAfterDup}, got "${valueC}")`,
    );
    const badgeVisible = await cell()
      .locator('.alloc-multi')
      .isVisible()
      .catch(() => false);
    ok(badgeVisible, 'c: ×N multi-block badge is visible on the cell');
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-c-multiblock-cell.png` });

    // --- (d) unchanged save leaves both rows byte-identical (id included) ---
    await page.getByRole('button', { name: 'Zapisz i zamknij' }).click();
    await page.waitForTimeout(300);
    let store = await readStore(page);
    let pairRows = store.workload.filter(
      (w) =>
        w.taskId === seedInfo.taskId &&
        w.personId === seedInfo.personId &&
        w.date === seedInfo.date,
    );
    const sameRow = (before, afterRows) => {
      const found = afterRows.find((r) => r.id === before.id);
      return (
        found !== undefined &&
        found.plannedHours === before.plannedHours &&
        found.startMinutes === before.startMinutes &&
        found.sortIndex === before.sortIndex
      );
    };
    ok(
      pairRows.length === 2 &&
        sameRow(seedInfo.original, pairRows) &&
        sameRow(seedInfo.dup, pairRows),
      `d: unchanged save keeps both rows byte-identical incl. ids (got ${JSON.stringify(pairRows)})`,
    );

    // --- (g) sanity screenshot: calendar week shows the two blocks ---
    // Taken right after (d), before (e)/(f) mutate the pair away. Direct
    // navigation (not a sidebar click) since the modal scrim covers the nav.
    await page.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
    await page.locator('.week-days-grid').first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-g-calendar-week.png` });

    // --- (e) +1h on the cell grows ONLY the later-starting (last) block ---
    await openModal();
    const target = totalAfterDup + 1;
    await cell().locator('input.alloc-input').fill(String(target));
    await page.getByRole('button', { name: 'Zapisz i zamknij' }).click();
    await page.waitForTimeout(300);
    store = await readStore(page);
    pairRows = store.workload.filter(
      (w) =>
        w.taskId === seedInfo.taskId &&
        w.personId === seedInfo.personId &&
        w.date === seedInfo.date,
    );
    const sorted = pairRows.slice().sort((a, b) => a.startMinutes - b.startMinutes);
    const earlier = sorted[0];
    const later = sorted[sorted.length - 1];
    ok(
      pairRows.length === 2 &&
        !!earlier &&
        earlier.id === seedInfo.original.id &&
        earlier.plannedHours === seedInfo.original.plannedHours &&
        earlier.startMinutes === seedInfo.original.startMinutes,
      `e: earlier block unchanged (got ${JSON.stringify(earlier)})`,
    );
    ok(
      !!later &&
        later.id === seedInfo.dup.id &&
        later.plannedHours === seedInfo.dup.plannedHours + 1,
      `e: later block grew by exactly 1h (got ${JSON.stringify(later)})`,
    );
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-e-grown-cell.png` });

    // --- (f) cell = 0 deletes both blocks; every other task row untouched ---
    const otherRowsBefore = store.workload.filter(
      (w) =>
        w.taskId === seedInfo.taskId &&
        !(w.personId === seedInfo.personId && w.date === seedInfo.date),
    );
    await openModal();
    await cell().locator('input.alloc-input').fill('');
    await page.getByRole('button', { name: 'Zapisz i zamknij' }).click();
    await page.waitForTimeout(300);
    store = await readStore(page);
    pairRows = store.workload.filter(
      (w) =>
        w.taskId === seedInfo.taskId &&
        w.personId === seedInfo.personId &&
        w.date === seedInfo.date,
    );
    ok(
      pairRows.length === 0,
      `f: both blocks of the zeroed pair are deleted (got ${pairRows.length} remaining)`,
    );
    // Nowa semantyka (godziny sprzedane per osoba): suma osoby jest stała, więc
    // wyzerowanie komórki siatki PRZENOSI te godziny do zasobnika osoby zamiast
    // je kasować. Pozostałe wiersze datowane muszą przetrwać bajt-w-bajt, a
    // wiersz zasobnika osoby ma urosnąć dokładnie o wyzerowane godziny.
    const zeroedHours = seedInfo.original.plannedHours + seedInfo.dup.plannedHours + 1; // +1h z flow (e)
    const otherRowsAfter = store.workload.filter(
      (w) =>
        w.taskId === seedInfo.taskId &&
        !(w.personId === seedInfo.personId && w.date === seedInfo.date),
    );
    const isBinRow = (w) => w.personId === seedInfo.personId && w.date === '';
    const datedBefore = otherRowsBefore.filter((w) => !isBinRow(w));
    const datedAfter = otherRowsAfter.filter((w) => !isBinRow(w));
    const binBefore = otherRowsBefore.filter(isBinRow).reduce((s, w) => s + w.plannedHours, 0);
    const binAfter = otherRowsAfter.filter(isBinRow).reduce((s, w) => s + w.plannedHours, 0);
    ok(
      datedAfter.length === datedBefore.length &&
        datedBefore.every((b) =>
          datedAfter.some(
            (a) =>
              a.id === b.id &&
              a.plannedHours === b.plannedHours &&
              a.startMinutes === b.startMinutes &&
              a.sortIndex === b.sortIndex,
          ),
        ),
      'f: every other DATED workload row of the task is untouched',
    );
    ok(
      Math.abs(binAfter - binBefore - zeroedHours) < 1e-9,
      `f: zeroed hours moved to the person's bin (before ${binBefore}, after ${binAfter}, zeroed ${zeroedHours})`,
    );

    ok(pageErrors.length === 0, `no page errors across the flow (${pageErrors.join('; ')})`);
  } catch (e) {
    ok(false, `harness error — ${e.message}`);
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-harness-error.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await LAUNCHER.launch({ headless: true });
  try {
    await flowMultiBlockSave(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n=== ${ENGINE} — savetask multi-block browser gate ===`);
  for (const n of notes) console.log(n);
  console.log(`\n[${ENGINE}] VERDICT: ${failures.length ? `FAIL (${failures.length})` : 'PASS'}`);
  process.exit(failures.length ? 1 : 0);
}

run();
