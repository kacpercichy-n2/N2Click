// Browser regression for PKG-20260713b-placement-core / -ui: automatic
// calendar placement writers (INSERT_BLOCK ripple insert, REASSIGN_ENTRY,
// the "Zaplanuj część" schedule form) must never clamp a block back over
// occupied time, INSERT_BLOCK must respect the 92-day task-period cap, and
// every impossible automatic placement must surface a persistent Polish
// reason in the UI (not just a silent reducer rejection).
//
// Drives a REAL browser (Chromium or WebKit) against the dev server on :5173,
// seeds sample data, injects isolated fixture tasks/blocks via localStorage
// (three well-separated fixture dates — today+10/+20/+30 — so nothing
// collides with the seed's own this-week/last-week blocks), then proves:
//
//   (a) near-midnight ripple-insert refusal: a Marek block ending 23:00 on
//       DA — right-click → "Dodaj po" → 2h cannot fit the day → the exact
//       fit warning shows and `Wstaw` is disabled; reducing to 1h (which
//       fits exactly to 24:00) clears the warning, enables `Wstaw`, and the
//       insert lands — proven by a localStorage overlap scan for Marek/DA.
//   (b) 92-day cap refusal: a Marek block on DB — right-click → "Dodaj po"
//       → picking a task dated ~95 days out shows the exact cap warning and
//       disables `Wstaw`; switching back to the original (in-range) task
//       clears the warning and re-enables `Wstaw`.
//   (c) WorkloadPage reassign pre-validation: Ola has a 1h block on DC;
//       Kasia's DC is packed solid (24h) so her reassign option ends
//       " — brak miejsca" and `Przenieś` is disabled with the exact title;
//       Marek's DC is free, so his option has no suffix and reassigning to
//       him succeeds — proven by a localStorage scan (entry now under
//       Marek, no overlap).
//   (d) "Zaplanuj część" default-start collision avoidance: Ola's seeded
//       bin row for her redesign task, opened on a TODAY that has an
//       injected 08:00-11:00 + 15:00-24:00 occupancy pair (an 11:00-14:00
//       gap) — the form's default Start is the real gap (11:00), not the
//       append-based 21:00 that would collide with the evening block; no
//       collision warning shows initially, and submitting schedules
//       cleanly (proven via localStorage).
//   (e) zero `pageerror`s across the whole flow.
//
// Usage: node scripts/browser-check-placement.mjs [chromium|webkit]
// Exits non-zero if any check fails. Dev server must already be on :5173.
//
// Screenshots: reviews/screenshots-20260713b-placement/<engine>-*.png

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const KEY = 'n2hub.data.v1';
const SHOTS = 'reviews/screenshots-20260713b-placement';
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const notes = [];
const ok = (cond, label) => {
  notes.push(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failures.push(label);
};

const readStore = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

// ---- Script-local date/time math (scripts can't import the TS modules) ----

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
function addDays(iso, delta) {
  const [y, m, dd] = iso.split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
function mondayOf(iso) {
  const [y, m, dd] = iso.split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  const dow = d.getDay(); // 0 Sun..6 Sat
  const diff = (dow + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d;
}
function weeksBetween(fromIso, toIso) {
  const a = mondayOf(fromIso).getTime();
  const b = mondayOf(toIso).getTime();
  return Math.round((b - a) / (7 * 86400000));
}
/** Monday=0 .. Sunday=6, matching weekDays()'s Mon-first column order. */
function mondayIndex(iso) {
  const [y, m, dd] = iso.split('-').map(Number);
  const dow = new Date(y, m - 1, dd).getDay();
  return (dow + 6) % 7;
}
/** Strict overlap (touching edges allowed) — mirrors utils/time.ts rangesOverlap. */
function hasOverlap(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      const aEnd = a.startMinutes + a.plannedHours * 60;
      const bEnd = b.startMinutes + b.plannedHours * 60;
      if (a.startMinutes < bEnd && b.startMinutes < aEnd) return true;
    }
  }
  return false;
}

const DA = addDays(todayISO(), 10); // near-midnight ripple-insert fixture
const DB = addDays(todayISO(), 20); // 92-day cap fixture
const DC = addDays(todayISO(), 30); // reassign fixture
const TODAY = todayISO(); // "Zaplanuj część" default-start fixture

async function seed(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const seedBtn = page.getByRole('button', { name: 'Wczytaj przykładowe dane' });
  await seedBtn.waitFor({ timeout: 10000 });
  await seedBtn.click();
  const loginRow = page.locator('.login-person').first();
  if (await loginRow.isVisible().catch(() => false)) await loginRow.click();
  await page.locator('.app-nav-link').first().waitFor({ timeout: 10000 });
}

async function flowPlacement(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  try {
    await seed(page);

    // --- inject every fixture in one shot ---
    const fx = await page.evaluate(
      ({ key, DA, DB, DC, TODAY }) => {
        const raw = localStorage.getItem(key);
        if (!raw) return { ok: false, reason: 'no-store' };
        const data = JSON.parse(raw);
        const marek = data.people.find((p) => p.name && p.name.includes('Marek'));
        const ola = data.people.find((p) => p.name && p.name.includes('Ola'));
        const kasia = data.people.find((p) => p.name && p.name.includes('Kasia'));
        if (!marek || !ola || !kasia) return { ok: false, reason: 'no-people' };
        const project = data.projects[0];
        const status = data.statuses[0];
        if (!project || !status) return { ok: false, reason: 'no-project-or-status' };
        const now = new Date().toISOString();

        // Ola's existing seeded bin row (the ONLY one — 3h from the redesign task)
        // is reused as-is for the "Zaplanuj część" default-start check.
        const olaBinEntry = data.workload.find((w) => w.personId === ola.id && w.date === '');
        if (!olaBinEntry) return { ok: false, reason: 'no-ola-bin' };
        const olaBinTask = data.tasks.find((t) => t.id === olaBinEntry.taskId);

        const mk = (over) => ({
          id: over.id,
          projectId: project.id,
          statusId: status.id,
          title: over.title,
          description: '',
          startDate: over.startDate,
          endDate: over.endDate,
          estimatedHours: over.estimatedHours,
          priority: 'normal',
          workCategoryId: '',
          checklist: [],
          createdAt: now,
          updatedAt: now,
        });

        // (a) near-midnight ripple-insert fixture: Marek, one 08:00-23:00 (15h)
        // block on DA — generous estimate so the budget gate never masks the
        // fit/cap checks under test.
        const taskA = mk({
          id: 'fixture-insert-fit',
          title: 'Fixture — dopasowanie',
          startDate: DA,
          endDate: DA,
          estimatedHours: 40,
        });
        // (b) 92-day cap fixture: a short in-range ref task on DB (Marek, 2h
        // 08:00-10:00) plus a FAR task dated ~95 days past DB — widening the far
        // task's period to cover DB blows the 92-day cap.
        const taskC = mk({
          id: 'fixture-cap-ref',
          title: 'Fixture — limit dni (ref)',
          startDate: DB,
          endDate: DB,
          estimatedHours: 20,
        });
        // Real ~95-day-out dates are patched in by a second, tiny evaluate call
        // right after this one (DB/date math lives in the script, not the page).
        const taskD = mk({
          id: 'fixture-cap-far',
          title: 'Fixture — zadanie odległe',
          startDate: DB,
          endDate: DB,
          estimatedHours: 100,
        });
        // (c) reassign fixture: Ola, 1h block on DC.
        const taskE = mk({
          id: 'fixture-reassign-src',
          title: 'Fixture — przeniesienie',
          startDate: DC,
          endDate: DC,
          estimatedHours: 10,
        });

        data.tasks.push(taskA, taskC, taskD, taskE);
        data.assignments.push(
          { id: 'fixture-as-a', taskId: taskA.id, personId: marek.id },
          { id: 'fixture-as-c', taskId: taskC.id, personId: marek.id },
          { id: 'fixture-as-e', taskId: taskE.id, personId: ola.id },
        );

        // Kasia's existing assignment reused for the "packed day" reassign target
        // (any task she's already on works — the block just needs to render).
        const kasiaTaskId = data.assignments.find((a) => a.personId === kasia.id)?.taskId;
        if (!kasiaTaskId) return { ok: false, reason: 'no-kasia-task' };

        data.workload.push(
          { id: 'fixture-wl-a', taskId: taskA.id, personId: marek.id, date: DA, plannedHours: 15, startMinutes: 480, sortIndex: 0 },
          { id: 'fixture-wl-c', taskId: taskC.id, personId: marek.id, date: DB, plannedHours: 2, startMinutes: 480, sortIndex: 0 },
          { id: 'fixture-wl-e', taskId: taskE.id, personId: ola.id, date: DC, plannedHours: 1, startMinutes: 480, sortIndex: 0 },
          { id: 'fixture-wl-kasia-full', taskId: kasiaTaskId, personId: kasia.id, date: DC, plannedHours: 24, startMinutes: 0, sortIndex: 0 },
        );

        // (d) today occupancy for Ola: clear whatever the seed put on TODAY (if
        // today happens to land inside the seeded this-week Mon-Fri span) and
        // replace with a deterministic 08:00-11:00 + 15:00-24:00 pair, leaving an
        // 11:00-14:00 gap — big enough for her 3h bin remainder, but only findable
        // by scanning gaps (a naive append-after-last-block default would clamp
        // back to 21:00 and collide with the evening block).
        data.workload = data.workload.filter((w) => !(w.personId === ola.id && w.date === TODAY));
        data.workload.push(
          { id: 'fixture-wl-today-a', taskId: olaBinTask.id, personId: ola.id, date: TODAY, plannedHours: 3, startMinutes: 480, sortIndex: 0 },
          { id: 'fixture-wl-today-b', taskId: olaBinTask.id, personId: ola.id, date: TODAY, plannedHours: 9, startMinutes: 900, sortIndex: 1 },
        );

        localStorage.setItem(key, JSON.stringify(data));
        return {
          ok: true,
          marekId: marek.id,
          olaId: ola.id,
          kasiaId: kasia.id,
          taskATitle: taskA.title,
          taskCTitle: taskC.title,
          taskDId: taskD.id,
          taskCId: taskC.id,
          taskEId: taskE.id,
          olaBinEntryId: olaBinEntry.id,
          olaBinTaskId: olaBinTask.id,
          olaBinTaskTitle: olaBinTask.title,
        };
      },
      { key: KEY, DA, DB, DC, TODAY },
    );
    ok(fx.ok, `injected fixtures (${JSON.stringify(fx)})`);
    const {
      marekId,
      olaId,
      kasiaId,
      taskATitle,
      taskCTitle,
      taskDId,
      taskCId,
      olaBinTaskId,
      olaBinTaskTitle,
    } = fx;

    // The far task's real ~95-day-out dates couldn't be computed inside the
    // page.evaluate closure (DB is a script-local const, not a page global) —
    // patch them in a second, tiny evaluate call.
    const farStart = addDays(DB, 95);
    const farEnd = addDays(DB, 96);
    await page.evaluate(
      ({ key, taskDId, farStart, farEnd }) => {
        const data = JSON.parse(localStorage.getItem(key));
        const t = data.tasks.find((t) => t.id === taskDId);
        t.startDate = farStart;
        t.endDate = farEnd;
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: KEY, taskDId, farStart, farEnd },
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('a.app-nav-link[href="/calendar"]').click();
    await page.locator('.week-cal').waitFor({ timeout: 10000 });

    // ============================================================
    // (a) near-midnight ripple-insert refusal → reduce → success
    // ============================================================
    {
      const weeks = weeksBetween(TODAY, DA);
      for (let i = 0; i < weeks; i++) {
        await page.locator('button[aria-label="Następny"]').click();
      }
      const block = page.locator('.week-block').filter({ hasText: taskATitle });
      await block.waitFor({ state: 'visible', timeout: 10000 });
      await block.click({ button: 'right' });
      const menu = page.locator('.context-menu');
      await menu.waitFor({ state: 'visible', timeout: 5000 });
      await menu.locator('.context-menu-item', { hasText: 'Dodaj po' }).click();

      const form = page.locator('.context-insert-form:not(.context-schedule-form)');
      await form.waitFor({ state: 'visible', timeout: 5000 });
      await form.getByLabel('Godziny').fill('2');

      const fitWarning = form.locator('.context-warning').filter({ hasText: 'Wstawka nie mieści się' });
      await fitWarning.waitFor({ state: 'visible', timeout: 5000 });
      const fitWarningText = (await fitWarning.innerText()).trim();
      ok(
        fitWarningText === '⚠ Wstawka nie mieści się w dobie — bloki za nią musiałyby wyjść poza 24:00.',
        `exact near-midnight fit warning shown (got "${fitWarningText}")`,
      );
      const wstawBtn = form.locator('button.btn.primary');
      ok(await wstawBtn.isDisabled(), 'Wstaw disabled while the 2h insert cannot fit');
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-a1-fit-warning.png` });

      await form.getByLabel('Godziny').fill('1');
      await page.waitForTimeout(150);
      ok(!(await fitWarning.isVisible().catch(() => false)), 'fit warning clears once 1h fits exactly to 24:00');
      ok(!(await wstawBtn.isDisabled()), 'Wstaw re-enabled once 1h fits');

      await wstawBtn.click();
      await form.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);

      const afterA = await readStore(page);
      const marekDA = afterA.workload.filter((w) => w.personId === marekId && w.date === DA);
      ok(marekDA.length === 2, `Marek/DA now has 2 blocks (got ${marekDA.length})`);
      ok(!hasOverlap(marekDA), 'no same-person time overlap on Marek/DA after the insert');
      const totalDA = marekDA.reduce((s, w) => s + w.plannedHours, 0);
      ok(Math.abs(totalDA - 16) < 1e-9, `Marek/DA total hours = 16 (got ${totalDA})`);
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-a2-inserted.png` });
    }

    // ============================================================
    // (b) 92-day cap refusal → switch back → enabled
    // ============================================================
    {
      await page.locator('.btn.ghost', { hasText: 'Dzisiaj' }).click();
      const weeks = weeksBetween(TODAY, DB);
      for (let i = 0; i < weeks; i++) {
        await page.locator('button[aria-label="Następny"]').click();
      }
      const block = page.locator('.week-block').filter({ hasText: taskCTitle });
      await block.waitFor({ state: 'visible', timeout: 10000 });
      await block.click({ button: 'right' });
      const menu = page.locator('.context-menu');
      await menu.waitFor({ state: 'visible', timeout: 5000 });
      await menu.locator('.context-menu-item', { hasText: 'Dodaj po' }).click();

      const form = page.locator('.context-insert-form:not(.context-schedule-form)');
      await form.waitFor({ state: 'visible', timeout: 5000 });
      const wstawBtn = form.locator('button.btn.primary');
      const capWarning = form.locator('.context-warning').filter({ hasText: 'limit 92 dni' });

      await form.getByLabel('Zadanie').selectOption(taskDId);
      await capWarning.waitFor({ state: 'visible', timeout: 5000 });
      const capWarningText = (await capWarning.innerText()).trim();
      ok(
        capWarningText === '⚠ Termin zadania przekroczyłby limit 92 dni.',
        `exact 92-day cap warning shown (got "${capWarningText}")`,
      );
      ok(await wstawBtn.isDisabled(), 'Wstaw disabled while the far task would blow the 92-day cap');
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-b1-cap-warning.png` });

      await form.getByLabel('Zadanie').selectOption(taskCId);
      await page.waitForTimeout(150);
      ok(!(await capWarning.isVisible().catch(() => false)), 'cap warning clears switching back to the in-range task');
      ok(!(await wstawBtn.isDisabled()), 'Wstaw re-enabled switching back to the in-range task');
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-b2-switched-back.png` });

      await form.locator('button.btn.ghost', { hasText: 'Anuluj' }).click();
    }

    // ============================================================
    // (c) WorkloadPage reassign pre-validation — brak miejsca / fitting target
    // ============================================================
    {
      await page.locator('a.app-nav-link[href="/workload"]').click();
      await page.locator('.workload-table').waitFor({ timeout: 10000 });
      const weeks = weeksBetween(TODAY, DC);
      for (let i = 0; i < weeks; i++) {
        await page.locator('button[aria-label="Następny tydzień"]').click();
      }
      const dayIndex = mondayIndex(DC);
      const olaRow = page.locator('tr').filter({ hasText: 'Ola Nowak' }).first();
      await olaRow.waitFor({ timeout: 10000 });
      const cell = olaRow.locator('td.workload-cell').nth(dayIndex);
      await cell.click();

      const panel = page.locator('.wr-panel');
      await panel.waitFor({ state: 'visible', timeout: 5000 });
      const select = panel.locator('select[aria-label="Przypisz do osoby"]');
      const przenies = panel.locator('.wr-reassign button', { hasText: 'Przenieś' });

      const kasiaOption = select.locator(`option[value="${kasiaId}"]`);
      const kasiaOptText = (await kasiaOption.innerText()).trim();
      ok(kasiaOptText.endsWith(' — brak miejsca'), `Kasia's option ends " — brak miejsca" (got "${kasiaOptText}")`);
      await select.selectOption(kasiaId);
      ok(await przenies.isDisabled(), 'Przenieś disabled when the packed target is selected');
      const przeniesTitle = await przenies.getAttribute('title');
      ok(
        przeniesTitle === 'Brak wolnego przedziału czasu w tym dniu u wybranej osoby.',
        `Przenieś carries the exact no-fit title (got "${przeniesTitle}")`,
      );
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-c1-no-fit.png` });

      const marekOption = select.locator(`option[value="${marekId}"]`);
      const marekOptText = (await marekOption.innerText()).trim();
      ok(!marekOptText.endsWith(' — brak miejsca'), `Marek's option has no "brak miejsca" suffix (got "${marekOptText}")`);
      await select.selectOption(marekId);
      ok(!(await przenies.isDisabled()), 'Przenieś enabled once a fitting target is selected');
      await przenies.click();
      await page.waitForTimeout(250);

      const afterC = await readStore(page);
      const moved = afterC.workload.find((w) => w.id === 'fixture-wl-e');
      ok(moved !== undefined && moved.personId === marekId, `reassigned entry now belongs to Marek (got ${moved?.personId})`);
      ok(moved !== undefined && moved.date === DC, 'reassigned entry keeps its date');
      const marekDC = afterC.workload.filter((w) => w.personId === marekId && w.date === DC);
      ok(!hasOverlap(marekDC), 'no overlap on Marek/DC after the reassign');
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-c2-reassigned.png` });
    }

    // ============================================================
    // (d) "Zaplanuj część" default start avoids the injected mid-day gap
    // ============================================================
    {
      await page.locator('a.app-nav-link[href="/calendar"]').click();
      await page.locator('.week-cal').waitFor({ timeout: 10000 });

      const olaGroup = page.locator('.week-bin-group').filter({ hasText: 'Ola Nowak' });
      const binCard = olaGroup.locator('.week-bin-block').filter({ hasText: olaBinTaskTitle });
      await binCard.waitFor({ state: 'visible', timeout: 10000 });
      const scheduleBtn = binCard.locator('button.week-bin-schedule-btn');
      await scheduleBtn.click();

      const form = page.locator('.context-schedule-form');
      await form.waitFor({ state: 'visible', timeout: 5000 });
      const dzienVal = await form.getByLabel('Dzień').inputValue();
      ok(dzienVal === TODAY, `schedule form defaults Dzień to today (got "${dzienVal}")`);
      const startVal = await form.getByLabel('Start').inputValue();
      ok(startVal === '11:00', `default Start lands in the real 11:00 gap, not the 21:00 append-clamp (got "${startVal}")`);
      // Ola's injected day already totals 12h (3h+9h), over her 8h capacity, so
      // the NON-BLOCKING overload preview line is expected here (invariant 3 —
      // warns, never blocks); what must be absent is the BLOCKING collision
      // warning, since the 11:00 default is already a real free gap.
      const collisionWarning = form.locator('.context-warning').filter({ hasText: 'Koliduje' });
      ok((await collisionWarning.count()) === 0, 'no collision warning — the default 11:00 start is already a real free gap');
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-d1-default-start.png` });

      const zaplanujBtn = form.locator('button.btn.primary');
      ok(!(await zaplanujBtn.isDisabled()), 'Zaplanuj enabled with the collision-free default');
      await zaplanujBtn.click();
      await form.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(250);

      // The scheduled 11:00-14:00 part touches the existing 08:00-11:00 block's
      // edge for the SAME (task, person) pair, so the reducer's adjacency merge
      // (shared with SCHEDULE_BIN_PART generally) fuses it into that block rather
      // than creating a new entry: 'fixture-wl-today-a' survives, extended from
      // 3h to 6h, still starting at 08:00; the untouched 15:00-24:00 block is
      // unaffected.
      const afterD = await readStore(page);
      const mergedMorning = afterD.workload.find((w) => w.id === 'fixture-wl-today-a');
      ok(
        mergedMorning !== undefined &&
          mergedMorning.startMinutes === 480 &&
          Math.abs(mergedMorning.plannedHours - 6) < 1e-9,
        `the 3h part adjacency-merges into the existing 08:00 block, extending it to 6h (got ${JSON.stringify(mergedMorning)})`,
      );
      const eveningBlock = afterD.workload.find((w) => w.id === 'fixture-wl-today-b');
      ok(
        eveningBlock !== undefined &&
          eveningBlock.startMinutes === 900 &&
          Math.abs(eveningBlock.plannedHours - 9) < 1e-9,
        `the evening block is untouched by the merge (got ${JSON.stringify(eveningBlock)})`,
      );
      const olaToday = afterD.workload.filter((w) => w.personId === olaId && w.date === TODAY);
      const totalToday = olaToday.reduce((s, w) => s + w.plannedHours, 0);
      ok(Math.abs(totalToday - 15) < 1e-9, `Ola/today conserves all 15h (3+9+3) after scheduling (got ${totalToday})`);
      ok(!hasOverlap(olaToday), 'no overlap on Ola/today after scheduling the bin part');
      ok((await binCard.count()) === 0, 'the emptied bin card disappears');
      await page.screenshot({ path: `${SHOTS}/${ENGINE}-d2-scheduled.png` });
    }

    // --- (e) zero page errors across the whole flow ---
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
    await flowPlacement(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n=== ${ENGINE} — placement guards (fit/cap/reassign/default-start) browser gate ===`);
  for (const n of notes) console.log(n);
  console.log(`\n[${ENGINE}] VERDICT: ${failures.length ? `FAIL (${failures.length})` : 'PASS'}`);
  process.exit(failures.length ? 1 : 0);
}

run();
