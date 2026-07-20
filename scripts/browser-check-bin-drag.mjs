// Browser repro harness for the "bin → calendar drag freezes the site" report.
//
// Drives a REAL browser (Chromium or WebKit) against the running dev server,
// seeds the sample data, opens the calendar week view, and drags Ola's 3h bin
// card (Zasobnik) onto a free day-column slot. Then runs three freeze probes:
//   (a) main-thread heartbeat  — a setInterval stamp that must keep advancing;
//   (b) pointer-delivery liveness — after the drop, a grid block still opens the
//       TaskModal on click (i.e. the page still delivers pointer events);
//   (c) console/pageerror capture — any error/warning, esp. React's
//       "Maximum update depth exceeded".
//
// Usage: node scripts/browser-check-bin-drag.mjs [chromium|webkit]
//        [free|merge|window-fallback|collision|separator|invalid|oversized] [--narrow]
// Exits non-zero if any probe fails (freeze reproduced or drop broken).
//
// `oversized` injects a 30h bin row (via the PATHO localStorage pattern) for
// Ola's first task, then drags it at the `free` slot. It must NOT land (the
// reducer rejects >24h bin rows) — this is the regression for the
// `SCHEDULE_BIN_PART` / "Zaplanuj część" recovery path (PKG-20260713-bin-split).
//
// Screenshots: reviews/screenshots-20260709-codex/<engine>-{01,02,03,03-freeze}.png
// (Committed as the rerunnable regression artifact; dev server must be on :5173.)

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
// Scenario drives WHERE/HOW the bin card is dropped (see the stress matrix in
// PKG-20260709b). `window-fallback` deliberately delivers pointerup to the day
// column instead of the source card; it is the regression for a missing/lost
// element capture. `collision` must revert cleanly with no ghost left behind.
const SCENARIO = (process.argv[3] || 'free').toLowerCase();
const NARROW = process.argv.includes('--narrow');
const PATHO = process.argv.includes('--pathological');
// (col 0-6 Mon-Sun, startMinutes) target per scenario.
const TARGETS = {
  free: { col: 4, startMin: 660 }, // Fri 11:00 — Ola has nothing Friday
  merge: { col: 0, startMin: 840 }, // Mon 14:00 — touches Ola's 8:00-14:00 t1 block
  'window-fallback': { col: 4, startMin: 660 }, // synthetic source move + grid pointerup
  collision: { col: 0, startMin: 600 }, // Mon 10:00 — overlaps Ola's t1 block
  separator: { col: 1, startMin: 900 }, // exact Mon/Tue separator at a free 15:00 slot
  invalid: { col: 2, startMin: 0 }, // day header, outside the timed viewport
  oversized: { col: 4, startMin: 660 }, // Fri 11:00 — same free slot as `free`, but the row is >24h
};
const TARGET = TARGETS[SCENARIO] || TARGETS.free;
const EXPECT_LAND =
  SCENARIO !== 'collision' && SCENARIO !== 'invalid' && SCENARIO !== 'oversized';
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const SHOTS = 'reviews/screenshots-20260709-codex';
mkdirSync(SHOTS, { recursive: true });

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${ENGINE}-${name}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** page.evaluate with a hard wall-clock timeout — a spinning main thread never resolves. */
async function evalWithTimeout(page, expr, ms) {
  return Promise.race([
    page.evaluate(expr).then((v) => ({ ok: true, v })),
    sleep(ms).then(() => ({ ok: false, v: null })),
  ]);
}

async function run() {
  const consoleErrors = [];
  const pageErrors = [];
  const maxDepth = [];

  const browser = await LAUNCHER.launch({ headless: true });
  const context = await browser.newContext(
    NARROW ? { viewport: { width: 1100, height: 780 } } : undefined,
  );
  const page = await context.newPage();

  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') {
      const text = m.text();
      consoleErrors.push(`[${t}] ${text}`);
      if (/maximum update depth/i.test(text)) maxDepth.push(text);
    }
  });
  page.on('pageerror', (e) => {
    pageErrors.push(String(e));
    if (/maximum update depth/i.test(String(e))) maxDepth.push(String(e));
  });

  const result = {
    engine: ENGINE,
    scenario: SCENARIO + (NARROW ? '+narrow' : '') + (PATHO ? '+pathological' : ''),
    seeded: false,
    droppedLanded: false,
    dropOutcomeCorrect: false,
    binRowGone: false,
    ghostGone: false,
    heartbeatAlive: null,
    evalResponsive: null,
    modalOpensAfterDrop: null,
    maxUpdateDepth: false,
    oversizedCardStillShows30h: null, // set only for scenario=oversized
    oversizedHintContainsSchedule: null, // set only for scenario=oversized
    consoleErrors: [],
    pageErrors: [],
    notes: [],
  };

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Fresh context → empty localStorage → sample banner. Seed.
    const seedBtn = page.getByRole('button', { name: 'Wczytaj przykładowe dane' });
    await seedBtn.waitFor({ timeout: 10000 });
    await seedBtn.click();
    result.seeded = true;

    // LOAD_SAMPLE sets currentUserId=Kasia, so no login screen. But handle it
    // defensively (one-click passwordless Kasia row) in case that changes.
    const loginRow = page.locator('.login-person').first();
    if (await loginRow.isVisible().catch(() => false)) {
      await loginRow.click();
      result.notes.push('login screen appeared — clicked first person');
    }

    // Optional H3 probe: inject a pathological bin row (NaN/huge/off-grid) into
    // persisted storage, then reload so the v5 loader processes it. Reveals what
    // actually reaches the reducer / packDayBlocks.
    if (PATHO) {
      const injected = await page.evaluate(() => {
        const KEY = 'n2hub.data.v1';
        const raw = localStorage.getItem(KEY);
        if (!raw) return 'no-store';
        const data = JSON.parse(raw);
        const ola = data.people.find((p) => p.name && p.name.includes('Ola'));
        const task = data.tasks[0];
        if (!ola || !task) return 'no-person-or-task';
        data.workload.push(
          { id: 'patho-nan', taskId: task.id, personId: ola.id, date: '', plannedHours: NaN, startMinutes: 7, sortIndex: 99 },
          { id: 'patho-huge', taskId: task.id, personId: ola.id, date: '', plannedHours: 9999, startMinutes: 0, sortIndex: 98 },
          { id: 'patho-neg', taskId: task.id, personId: ola.id, date: '', plannedHours: -3, startMinutes: 0, sortIndex: 97 },
        );
        localStorage.setItem(KEY, JSON.stringify(data));
        return 'injected';
      });
      result.notes.push(`pathological inject: ${injected}`);
      await page.reload({ waitUntil: 'networkidle' });
    }

    // `oversized` scenario: inject a single 30h bin row for Ola (same
    // PATHO-style localStorage-injection pattern as above), then reload so the
    // v5 loader processes it before the calendar mounts. `ensureStartMinutes`
    // merges duplicate bin rows for the same (personId, taskId) pair on every
    // load (storage.ts:462-501) — Ola's seeded data already has a 3h bin row
    // on `tasks[0]`, so injecting onto that same task would land as 33h, not
    // 30h. Pick a task Ola has no existing bin row for instead, so the
    // injected row stays a clean, isolated 30h card.
    if (SCENARIO === 'oversized') {
      const injected = await page.evaluate(() => {
        const KEY = 'n2hub.data.v1';
        const raw = localStorage.getItem(KEY);
        if (!raw) return 'no-store';
        const data = JSON.parse(raw);
        const ola = data.people.find((p) => p.name && p.name.includes('Ola'));
        if (!ola) return 'no-person';
        const olaBinTaskIds = new Set(
          data.workload.filter((w) => w.personId === ola.id && w.date === '').map((w) => w.taskId),
        );
        const task = data.tasks.find((t) => !olaBinTaskIds.has(t.id)) ?? data.tasks[0];
        if (!task) return 'no-task';
        const maxSort = data.workload.reduce(
          (m, w) => (w.personId === ola.id && w.date === '' ? Math.max(m, w.sortIndex) : m),
          -1,
        );
        data.workload.push({
          id: 'oversized-30h',
          taskId: task.id,
          personId: ola.id,
          date: '',
          plannedHours: 30,
          startMinutes: 0,
          sortIndex: maxSort + 1,
        });
        localStorage.setItem(KEY, JSON.stringify(data));
        return 'injected';
      });
      result.notes.push(`oversized inject: ${injected}`);
      await page.reload({ waitUntil: 'networkidle' });
    }

    // Navigate to the calendar week view (sidebar nav link specifically).
    await page.locator('a.app-nav-link[href="/calendar"]').click();
    await page.locator('.week-bin-block').first().waitFor({ timeout: 10000 });
    const binBefore = await page.locator('.week-bin-block').count();
    result.notes.push(`bin cards before drag: ${binBefore}`);

    // Install the main-thread heartbeat.
    await page.evaluate(() => {
      window.__hb = Date.now();
      window.__hbTimer = setInterval(() => (window.__hb = Date.now()), 100);
    });

    await shot(page, '01-before-drag');

    const modalCard = page.locator('.task-modal-card[role="dialog"]');
    // Robust "click a block → modal opens → close it" liveness helper.
    async function clickBlockOpensModal(label) {
      const b = page.locator('.week-block').first();
      if (!(await b.count())) {
        result.notes.push(`${label}: no grid block present`);
        return null;
      }
      await b.click({ timeout: 3000, force: true }).catch((e) =>
        result.notes.push(`${label}: block click threw ${e.message}`),
      );
      const opened = await modalCard
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (opened) {
        await page.keyboard.press('Escape').catch(() => {});
        await modalCard.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      }
      result.notes.push(`${label}: modal opens = ${opened}`);
      return opened;
    }

    // BASELINE (before any drag): the probe itself must pass on a healthy page.
    result.baselineModalOpens = await clickBlockOpensModal('baseline (no drag)');

    // --- Perform the drag: bin card center → scenario target slot ---
    // `oversized` targets the specific injected 30h row by its hours text
    // (several bin cards are present); every other scenario keeps dragging
    // whichever card renders first, unchanged.
    const card =
      SCENARIO === 'oversized'
        ? page
            .locator('.week-bin-block')
            .filter({ has: page.locator('.week-bin-block-hours', { hasText: /^30h$/ }) })
            .first()
        : page.locator('.week-bin-block').first();
    await card.waitFor({ timeout: 10000 });
    const cardBox = await card.boundingBox();
    // Map the desired (col, startMinutes) to viewport coords off the LIVE grid
    // rect (which carries the scroll offset), exactly like the component's math.
    const gr = await page.evaluate(() => {
      const g = document.querySelector('.week-days-grid').getBoundingClientRect();
      const secondDay = document
        .querySelector('.week-day-col[data-day-index="1"]')
        .getBoundingClientRect();
      const viewport = document.querySelector('.week-days-viewport').getBoundingClientRect();
      return {
        top: g.top,
        left: g.left,
        width: g.width,
        separatorX: secondDay.left,
        viewportTop: viewport.top,
      };
    });
    const HOUR_PX = 84; // musi odpowiadać HOUR_PX w src/components/WeekView.tsx
    const colW = gr.width / 7;
    const targetX =
      SCENARIO === 'separator'
        ? gr.separatorX
        : gr.left + colW * TARGET.col + colW / 2;
    const targetY =
      SCENARIO === 'invalid'
        ? gr.viewportTop - 8
        : gr.top + (TARGET.startMin / 60) * HOUR_PX;
    result.notes.push(
      `drop target: col=${TARGET.col} startMin=${TARGET.startMin} → x=${Math.round(targetX)} y=${Math.round(targetY)}`,
    );

    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    if (SCENARIO === 'window-fallback') {
      // Pointer capture cannot be established for synthetic events. Move is
      // delivered to the source so the old implementation visibly created its
      // ghost; pointerup is then delivered to the grid. Only a window-owned
      // lifecycle can finish this drag and remove/schedule the source.
      await page.evaluate(
        ({ x, y }) => {
          const source = document.querySelector('.week-bin-block:not(.week-bin-ghost)');
          source.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerId: 77,
              pointerType: 'mouse',
              isPrimary: true,
              button: 0,
              buttons: 1,
              clientX: x,
              clientY: y,
            }),
          );
        },
        { x: startX, y: startY },
      );
      await sleep(40);
      await page.evaluate(
        ({ x, y }) => {
          const source = document.querySelector('.week-bin-block:not(.week-bin-ghost)');
          source.dispatchEvent(
            new PointerEvent('pointermove', {
              bubbles: true,
              cancelable: true,
              pointerId: 77,
              pointerType: 'mouse',
              isPrimary: true,
              button: -1,
              buttons: 1,
              clientX: x,
              clientY: y,
            }),
          );
        },
        { x: targetX, y: targetY },
      );
      await shot(page, '02-during-drag');
      await sleep(40);
      await page.evaluate(
        ({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          target.dispatchEvent(
            new PointerEvent('pointerup', {
              bubbles: true,
              cancelable: true,
              pointerId: 77,
              pointerType: 'mouse',
              isPrimary: true,
              button: -1,
              buttons: 0,
              clientX: x,
              clientY: y,
            }),
          );
        },
        { x: targetX, y: targetY },
      );
    } else {
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // >=5 intermediate steps so pointermove fires and moved.current latches.
      const STEPS = 8;
      for (let i = 1; i <= STEPS; i++) {
        const x = startX + ((targetX - startX) * i) / STEPS;
        const y = startY + ((targetY - startY) * i) / STEPS;
        await page.mouse.move(x, y);
        if (i === Math.floor(STEPS / 2)) await shot(page, '02-during-drag');
        await sleep(15);
      }
      await page.mouse.up();
    }
    await sleep(300);
    await shot(page, '03-after-drop');

    // --- Probe (a): heartbeat + eval responsiveness ---
    const hb1 = await evalWithTimeout(page, 'window.__hb', 3000);
    await sleep(500);
    const hb2 = await evalWithTimeout(page, 'window.__hb', 3000);
    result.evalResponsive = hb1.ok && hb2.ok;
    result.heartbeatAlive = hb1.ok && hb2.ok && typeof hb2.v === 'number' && hb2.v > hb1.v;
    if (!result.evalResponsive) result.notes.push('page.evaluate timed out → main thread wedged');
    else if (!result.heartbeatAlive) result.notes.push('heartbeat did not advance → render/CPU loop');

    // --- Check the drop landed: bin row gone, block on the grid ---
    const binAfter = await page.locator('.week-bin-block').count();
    result.binRowGone = binAfter < binBefore;
    result.droppedLanded = result.binRowGone;
    result.dropOutcomeCorrect = EXPECT_LAND ? result.binRowGone : binAfter === binBefore;
    result.ghostGone = (await page.locator('.week-bin-ghost').count()) === 0;
    result.notes.push(`bin cards after drop: ${binAfter}`);
    result.notes.push(
      `expected land=${EXPECT_LAND} outcome correct=${result.dropOutcomeCorrect} ghost gone=${result.ghostGone}`,
    );

    // `oversized`-only assertions: the 30h row must still be exactly itself
    // (unplaceable, never landed) and its refusal hint must point at the
    // „Zaplanuj część” recovery path (PKG-20260713-bin-split alignment).
    if (SCENARIO === 'oversized') {
      const oversizedCard = page
        .locator('.week-bin-block')
        .filter({ has: page.locator('.week-bin-block-hours', { hasText: /^30h$/ }) })
        .first();
      const stillPresent = (await oversizedCard.count()) > 0;
      result.oversizedCardStillShows30h = stillPresent;
      result.oversizedHintContainsSchedule = stillPresent
        ? ((await oversizedCard.getAttribute('title')) || '').includes('Zaplanuj część')
        : false;
      result.notes.push(
        `oversized card still shows 30h=${stillPresent} ` +
          `hint contains "Zaplanuj część"=${result.oversizedHintContainsSchedule}`,
      );
    }

    // --- Probe (b): pointer delivery still works after the drop ---
    if (result.evalResponsive) {
      // Instrument: does a raw click even reach the document? (capture phase)
      await page.evaluate(() => {
        window.__clicks = 0;
        window.__pointerdowns = 0;
        document.addEventListener('click', () => (window.__clicks += 1), true);
        document.addEventListener('pointerdown', () => (window.__pointerdowns += 1), true);
        // Is any element still holding pointer capture, or a ghost still mounted?
        window.__ghostCount = document.querySelectorAll('.week-bin-ghost').length;
      });

      const totalBlocks = await page.locator('.week-block').count();
      result.notes.push(`grid blocks available: ${totalBlocks}`);
      result.modalOpensAfterDrop = await clickBlockOpensModal('post-drop');

      // Also try a non-block interaction: the "Miesiąc" view toggle → back to week.
      const monthBtn = page.getByRole('button', { name: 'Miesiąc' });
      await monthBtn.click({ timeout: 2000, force: true }).catch((e) =>
        result.notes.push(`month toggle click threw: ${e.message}`),
      );
      const monthGridVisible = await page
        .locator('.month-grid')
        .first()
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      await page.getByRole('button', { name: 'Tydzień' }).click({ force: true }).catch(() => {});

      const diag = await page.evaluate(() => {
        const blk = document.querySelector('.week-block');
        const r = blk ? blk.getBoundingClientRect() : null;
        const topAtBlock = r
          ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          : null;
        return {
          clicks: window.__clicks,
          pointerdowns: window.__pointerdowns,
          ghostCount: window.__ghostCount,
          ghostNow: document.querySelectorAll('.week-bin-ghost').length,
          active: document.activeElement ? document.activeElement.className : '(none)',
          topAtBlock: topAtBlock ? topAtBlock.className : '(none)',
          scrims: document.querySelectorAll('.task-modal-scrim, .app-drawer-scrim').length,
        };
      });
      result.notes.push(
        `post-drop DOM clicks=${diag.clicks} pointerdowns=${diag.pointerdowns} ` +
          `ghostAtProbe=${diag.ghostCount} ghostNow=${diag.ghostNow} ` +
          `monthToggleWorked=${monthGridVisible} active="${diag.active}" ` +
          `topAtBlock="${diag.topAtBlock}" scrims=${diag.scrims}`,
      );
    } else {
      result.modalOpensAfterDrop = false;
    }

    result.maxUpdateDepth = maxDepth.length > 0;
    result.consoleErrors = consoleErrors.slice(0, 20);
    result.pageErrors = pageErrors.slice(0, 20);

    const froze =
      result.evalResponsive === false ||
      result.heartbeatAlive === false ||
      result.maxUpdateDepth ||
      result.modalOpensAfterDrop === false ||
      result.dropOutcomeCorrect === false ||
      result.ghostGone === false ||
      result.oversizedCardStillShows30h === false ||
      result.oversizedHintContainsSchedule === false;
    if (froze) await shot(page, '03-freeze');
  } catch (err) {
    result.notes.push(`HARNESS ERROR: ${err.message}`);
    result.pageErrors.push(String(err));
  } finally {
    await page.evaluate(() => window.__hbTimer && clearInterval(window.__hbTimer)).catch(() => {});
    await browser.close();
  }

  // --- Verdict ---
  const probeFail =
    result.evalResponsive === false ||
    result.heartbeatAlive === false ||
    result.maxUpdateDepth === true ||
    result.modalOpensAfterDrop === false ||
    result.dropOutcomeCorrect === false ||
    result.ghostGone === false ||
    result.oversizedCardStillShows30h === false ||
    result.oversizedHintContainsSchedule === false;

  console.log(JSON.stringify(result, null, 2));
  console.log(`\n[${ENGINE}] VERDICT: ${probeFail ? 'FAIL (freeze/broken drop)' : 'PASS'}`);
  process.exit(probeFail ? 1 : 0);
}

run();
