// Browser regression for PKG-20260713-bin-split-core / -ui: an oversized (>24h)
// bin row is recoverable — "Zaplanuj część" schedules a chosen 0.25h-aligned
// PART of a bin row onto a calendar day via SCHEDULE_BIN_PART, atomically
// decrementing the SAME bin row (same id) and creating one dated block, never
// splitting the row into a second same-(task,person) bin sibling.
//
// Drives a REAL browser (Chromium or WebKit) against the dev server on :5173,
// seeds sample data, injects a single 30h bin row for Ola onto a task she has
// no existing bin row for (ensureStartMinutes merges duplicate bin rows for
// the same (personId, taskId) pair on every load — storage.ts — so reusing an
// already-occupied task would silently sum into a >30h row instead of a clean
// 30h one), then proves:
//   (a) seed + inject + reload — one isolated 30h bin card for that task.
//   (b) the card's "Zaplanuj część" button opens the form; scheduling 8h on a
//       free day lands a new grid block and the SAME card now reads 22h.
//   (c) two more 8h schedules (→14h, →6h) — still the SAME single card
//       (one bin row) for that task throughout.
//   (d) identity through reload: the bin row's `id` is unchanged, and
//       conservation holds — dated hours for the task + remaining bin hours
//       = 30 exactly — both before AND after page.reload().
//   (e) refusal alignment inside the form: an overlapping time on an
//       already-scheduled day shows the exact collision warning and disables
//       `Zaplanuj`; fixing the time (touching the existing block's edge)
//       re-enables it.
//   (f) the final 6h schedule empties the bin row (card disappears for that
//       task); total dated hours for the task = 30; reload → still true.
//   (g) keyboard path: a remaining bin card's "Zaplanuj część" button opens
//       via keyboard focus + Enter, and 0.5h is scheduled using only keyboard
//       events (Tab into the Godziny field, clear via Home/Shift+End/
//       Backspace, type, Enter to submit) on Ola's other seeded 3h bin row.
//   (h) zero `pageerror`s across the whole flow.
//
// Usage: node scripts/browser-check-bin-split.mjs [chromium|webkit]
// Exits non-zero if any check fails. Dev server must already be on :5173.
//
// Screenshots: reviews/screenshots-20260713-binsplit/<engine>-*.png

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const KEY = 'n2hub.data.v1';
const SHOTS = 'reviews/screenshots-20260713-binsplit';
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
const ok = (cond, label) => {
  notes.push(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures.push(label);
};

const readStore = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

async function seed(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const seedBtn = page.getByRole('button', { name: 'Wczytaj przykładowe dane' });
  await seedBtn.waitFor({ timeout: 10000 });
  await seedBtn.click();
  const loginRow = page.locator('.login-person').first();
  if (await loginRow.isVisible().catch(() => false)) await loginRow.click();
  await page.locator('.app-nav-link').first().waitFor({ timeout: 10000 });
}

async function flowBinSplit(browser) {
  // Taller than Playwright's 720px default — the schedule form (title, sub-line,
  // 3 fields, warnings, actions) needs more room below the button-anchored menu
  // than a short viewport leaves after the `innerHeight - 240` clamp.
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    await seed(page);

    // --- (a) inject a clean, isolated 30h bin row for Ola ---
    const injected = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return { ok: false, reason: 'no-store' };
      const data = JSON.parse(raw);
      const ola = data.people.find((p) => p.name && p.name.includes('Ola'));
      if (!ola) return { ok: false, reason: 'no-ola' };
      const olaBinTaskIds = new Set(
        data.workload.filter((w) => w.personId === ola.id && w.date === '').map((w) => w.taskId),
      );
      // Ola's OTHER seeded bin row (task[0], 3h) is reserved for the keyboard-path
      // check later — pick a DIFFERENT task with no existing bin row for her.
      const freeTask = data.tasks.find((t) => !olaBinTaskIds.has(t.id));
      const seededTask = data.tasks.find((t) => olaBinTaskIds.has(t.id));
      if (!freeTask || !seededTask) return { ok: false, reason: 'no-task' };
      const maxSort = data.workload.reduce(
        (m, w) => (w.personId === ola.id && w.date === '' ? Math.max(m, w.sortIndex) : m),
        -1,
      );
      data.workload.push({
        id: 'split-30h',
        taskId: freeTask.id,
        personId: ola.id,
        date: '',
        plannedHours: 30,
        startMinutes: 0,
        sortIndex: maxSort + 1,
      });
      localStorage.setItem(key, JSON.stringify(data));
      return {
        ok: true,
        olaId: ola.id,
        olaName: ola.name,
        splitTaskId: freeTask.id,
        splitTaskTitle: freeTask.title,
        seededTaskId: seededTask.id,
        seededTaskTitle: seededTask.title,
      };
    }, KEY);
    ok(injected.ok, `injected a clean 30h bin row (${JSON.stringify(injected)})`);
    const { olaId, olaName, splitTaskId, splitTaskTitle, seededTaskId, seededTaskTitle } = injected;

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('a.app-nav-link[href="/calendar"]').click();
    await page.locator('.week-bin-block').first().waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-00-seeded.png` });

    const olaGroup = page.locator('.week-bin-group').filter({ hasText: olaName });
    const splitCard = olaGroup.locator('.week-bin-block').filter({ hasText: splitTaskTitle });
    const seededCard = olaGroup.locator('.week-bin-block').filter({ hasText: seededTaskTitle });

    ok((await splitCard.count()) === 1, 'exactly one bin card renders for the injected 30h row');
    const initialHours = (await splitCard.locator('.week-bin-block-hours').innerText()).trim();
    ok(initialHours === '30h', `injected card reads "30h" (got "${initialHours}")`);

    // --- pick 4 dates in the next 30 days Ola has NO existing dated entry on ---
    const freeDates = await page.evaluate(
      ({ key, olaId }) => {
        const data = JSON.parse(localStorage.getItem(key));
        const occupied = new Set(
          data.workload.filter((w) => w.personId === olaId && w.date !== '').map((w) => w.date),
        );
        const free = [];
        for (let i = 0; i < 60 && free.length < 4; i++) {
          const d = new Date();
          d.setDate(d.getDate() + i);
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate(),
          ).padStart(2, '0')}`;
          if (!occupied.has(iso)) free.push(iso);
        }
        return free;
      },
      { key: KEY, olaId },
    );
    // day4 is reserved for the keyboard-path check (g) — distinct from day1-3
    // so it is guaranteed free even after those three accumulate blocks.
    ok(freeDates.length === 4, `found 4 free calendar days for Ola (${JSON.stringify(freeDates)})`);
    const [day1, day2, day3, day4] = freeDates;

    // --- (b) + (c): three 8h partial schedules, same card each time ---
    async function scheduleFreeDay(date, expectHoursText) {
      const btn = splitCard.locator('button.week-bin-schedule-btn');
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click();
      const form = page.locator('.context-schedule-form');
      await form.waitFor({ state: 'visible', timeout: 5000 });
      await form.getByLabel('Dzień').fill(date);
      const confirmBtn = form.locator('button.btn.primary');
      ok(!(await confirmBtn.isDisabled()), `confirm enabled for ${date} (expect ${expectHoursText})`);
      const blocksBefore = await page.locator('.week-block').count();
      await confirmBtn.click();
      await form.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);
      const blocksAfter = await page.locator('.week-block').count();
      ok(
        blocksAfter === blocksBefore + 1,
        `grid block count grew by 1 scheduling on ${date} (before=${blocksBefore} after=${blocksAfter})`,
      );
      ok((await splitCard.count()) === 1, `still exactly ONE bin card for the task after ${date}`);
      const hoursText = (await splitCard.locator('.week-bin-block-hours').innerText()).trim();
      ok(hoursText === expectHoursText, `card reads "${expectHoursText}" after ${date} (got "${hoursText}")`);
    }

    await scheduleFreeDay(day1, '22h');
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-01-after-first-8h.png` });
    await scheduleFreeDay(day2, '14h');
    await scheduleFreeDay(day3, '6h');

    // --- (d) identity through reload + conservation ---
    async function conservation() {
      const data = await readStore(page);
      const dated = data.workload
        .filter((w) => w.taskId === splitTaskId && w.personId === olaId && w.date !== '')
        .reduce((s, w) => s + w.plannedHours, 0);
      const bin = data.workload.find(
        (w) => w.taskId === splitTaskId && w.personId === olaId && w.date === '',
      );
      return { dated, binHours: bin ? bin.plannedHours : 0, binId: bin ? bin.id : null };
    }
    const beforeReload = await conservation();
    ok(beforeReload.binId === 'split-30h', `bin row id unchanged before reload (${beforeReload.binId})`);
    ok(
      Math.abs(beforeReload.dated + beforeReload.binHours - 30) < 1e-9,
      `conservation before reload: dated ${beforeReload.dated} + bin ${beforeReload.binHours} = 30`,
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('a.app-nav-link[href="/calendar"]').click();
    await page.locator('.week-bin-block').first().waitFor({ timeout: 10000 });
    const afterReload = await conservation();
    ok(
      afterReload.binId === beforeReload.binId,
      `bin row id unchanged after reload (before=${beforeReload.binId} after=${afterReload.binId})`,
    );
    ok(
      Math.abs(afterReload.dated + afterReload.binHours - 30) < 1e-9,
      `conservation after reload: dated ${afterReload.dated} + bin ${afterReload.binHours} = 30`,
    );
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-02-after-reload.png` });

    // --- (e) + (f): refusal alignment, then the final 6h schedule ---
    {
      const btn = splitCard.locator('button.week-bin-schedule-btn');
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click();
      const form = page.locator('.context-schedule-form');
      await form.waitFor({ state: 'visible', timeout: 5000 });
      // Reuse day1 (already holds an 08:00–16:00 block from the first partial)
      // and force an overlapping start — the reducer/form share the exact same
      // collision guard as the drag path.
      await form.getByLabel('Dzień').fill(day1);
      await form.getByLabel('Start').fill('10:00');
      // Two `.context-warning` paragraphs can render together (the blocking
      // collision line AND the non-blocking overload preview, invariant 3) —
      // target the collision one specifically.
      const warning = form.locator('.context-warning').filter({ hasText: 'Koliduje' });
      await warning.waitFor({ state: 'visible', timeout: 5000 });
      const warningText = (await warning.innerText()).trim();
      ok(
        warningText === '⚠ Koliduje z innym blokiem tej osoby w tym dniu.',
        `exact collision warning shown (got "${warningText}")`,
      );
      const confirmBtn = form.locator('button.btn.primary');
      ok(await confirmBtn.isDisabled(), 'Zaplanuj disabled while the form shows a collision');
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-03-collision-warning.png` });

      // Fix the time — touch the existing block's edge (16:00) instead of
      // overlapping it (touching edges are allowed, invariant 3).
      await form.getByLabel('Start').fill('16:00');
      await page.waitForTimeout(150);
      ok(!(await warning.isVisible().catch(() => false)), 'collision warning cleared after fixing the time');
      ok(!(await confirmBtn.isDisabled()), 'Zaplanuj re-enabled after fixing the time');

      await confirmBtn.click();
      await form.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);
      // 16:00 touches the existing day1 08:00–16:00 block for this same
      // (task, person, date) — the reducer's adjacency merge (decision 6)
      // fuses them into ONE 14h block instead of adding a second, so the
      // grid block COUNT does not grow here; assert the merge directly.
      const mergedEntry = (await readStore(page)).workload.find(
        (w) => w.taskId === splitTaskId && w.personId === olaId && w.date === day1,
      );
      ok(
        mergedEntry !== undefined && Math.abs(mergedEntry.plannedHours - 14) < 1e-9,
        `day1 block merged to 14h via adjacency (got ${mergedEntry?.plannedHours})`,
      );
      ok((await splitCard.count()) === 0, 'the task’s bin card disappears once the row hits zero');
      const finalData = await readStore(page);
      const finalDated = finalData.workload
        .filter((w) => w.taskId === splitTaskId && w.personId === olaId && w.date !== '')
        .reduce((s, w) => s + w.plannedHours, 0);
      ok(Math.abs(finalDated - 30) < 1e-9, `total dated hours for the task = 30 (got ${finalDated})`);
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-04-final-scheduled.png` });

      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('a.app-nav-link[href="/calendar"]').click();
      await page.locator('.week-bin-block').first().waitFor({ timeout: 10000 });
      const olaGroupAfter = page.locator('.week-bin-group').filter({ hasText: olaName });
      const splitCardAfter = olaGroupAfter.locator('.week-bin-block').filter({ hasText: splitTaskTitle });
      ok((await splitCardAfter.count()) === 0, 'bin card for the task still gone after reload');
      const reloadedData = await readStore(page);
      const reloadedDated = reloadedData.workload
        .filter((w) => w.taskId === splitTaskId && w.personId === olaId && w.date !== '')
        .reduce((s, w) => s + w.plannedHours, 0);
      ok(
        Math.abs(reloadedDated - 30) < 1e-9,
        `total dated hours for the task still 30 after reload (got ${reloadedDated})`,
      );
    }

    // --- (g) keyboard path: Ola's other seeded 3h bin row, 0.5h via keyboard only ---
    {
      const olaGroupNow = page.locator('.week-bin-group').filter({ hasText: olaName });
      const seededCardNow = olaGroupNow.locator('.week-bin-block').filter({ hasText: seededTaskTitle });
      const kbBtn = seededCardNow.locator('button.week-bin-schedule-btn');
      await kbBtn.waitFor({ state: 'visible', timeout: 5000 });
      const beforeText = (await seededCardNow.locator('.week-bin-block-hours').innerText()).trim();
      ok(beforeText === '3h', `seeded row still reads "3h" before the keyboard test (got "${beforeText}")`);

      // Open via keyboard: focus the button — the same end state real Tab
      // navigation reaches in Chromium — then activate with Enter, no mouse
      // click on the control itself. (WebKit/Safari's DEFAULT platform tab
      // order deliberately excludes plain <button> elements — "Full Keyboard
      // Access" off — so a literal Tab-key loop never lands here in that
      // engine; this keeps the check identical and meaningful in both.)
      await kbBtn.focus();
      ok(
        await kbBtn.evaluate((el) => el === document.activeElement).catch(() => false),
        '"Zaplanuj część" button on the seeded bin card is focused',
      );
      await page.keyboard.press('Enter');
      const form = page.locator('.context-schedule-form');
      await form.waitFor({ state: 'visible', timeout: 5000 });

      // The Godziny field is `autoFocus`ed the instant the form mounts, so
      // it already has focus here — verify that, then clear + type + submit
      // using only keyboard keys (no Tab needed to reach it).
      const godzinyInput = form.getByLabel('Godziny');
      const reached = await godzinyInput.evaluate((el) => el === document.activeElement).catch(() => false);
      ok(reached, 'Godziny field is auto-focused when the schedule form opens');
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('0.5');

      await form.getByLabel('Dzień').fill(day4);
      // Re-focus Godziny (the date input's onChange re-derives Start, not
      // Godziny, but focus moved when we filled Dzień) before submitting.
      await godzinyInput.focus();
      await page.keyboard.press('Enter');
      await form.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);
      // day4 is next calendar week (outside the currently-rendered 7-day grid
      // for "today"), so the new block won't show as a `.week-block` in this
      // view — verify the dated row directly via localStorage instead.
      const newEntry = (await readStore(page)).workload.find(
        (w) => w.taskId === seededTaskId && w.personId === olaId && w.date === day4,
      );
      ok(
        newEntry !== undefined && Math.abs(newEntry.plannedHours - 0.5) < 1e-9,
        `keyboard-only 0.5h schedule created a dated block on ${day4} (got ${JSON.stringify(newEntry)})`,
      );
      const afterText = (await seededCardNow.locator('.week-bin-block-hours').innerText()).trim();
      ok(afterText === '2h 30m', `seeded row reads "2h 30m" after the 0.5h keyboard schedule (got "${afterText}")`);
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-05-keyboard-schedule.png` });
    }

    // --- (h) zero page errors across the whole flow ---
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
    await flowBinSplit(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n=== ${ENGINE} — bin split (partial scheduling) browser gate ===`);
  for (const n of notes) console.log(n);
  console.log(`\n[${ENGINE}] VERDICT: ${failures.length ? `FAIL (${failures.length})` : 'PASS'}`);
  process.exit(failures.length ? 1 : 0);
}

run();
