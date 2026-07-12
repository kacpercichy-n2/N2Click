// Browser regression for PKG-20260712c-status-done-core /
// PKG-20260712c-status-admin-ui: completion ("done") is the stored
// `Status.isDone` flag — NOT pipeline position, NOT archival. Proves in a real
// browser that:
//   a. exactly one seeded status is done (Gotowe), the rest are not.
//   b. reordering statuses (admin ▲/▲) never changes which work counts as
//      done — an overdue-but-done task stays out of "Po terminie" before AND
//      after the reorder, and Gotowe keeps isDone even after it's no longer
//      last in the pipeline.
//   c. archiving a used status doesn't hide its projects — the Kanban board
//      grows a trailing "Zarchiwizowane" column containing them.
//   d. archiving a done status doesn't revive the work in it — a task in an
//      archived done status still stays out of "Po terminie" (only possible
//      once a second status is also marked done, since the reducer refuses
//      archiving the only done status).
//   e. the admin UI pre-validates the reducer's only-active/only-done guards:
//      disabled checkbox/button with the exact Polish explanatory titles,
//      and both re-enable once a second status is marked done.
//   f. no uncaught page errors across the whole run.
//
// Drives a REAL browser (Chromium or WebKit) against the dev server on :5173.
// Uses ONE continuous flow (mirrors browser-check-savetask-multiblock.mjs's
// single-flow structure) since checks (a)-(d) build on the same seeded state;
// only check (e) explicitly resets to a clean reseed, per the handoff package.
//
// Usage:  node scripts/browser-check-status-semantics.mjs [chromium|webkit]
// Exits non-zero if any check fails. Dev server must already be on :5173.
//
// Screenshots: reviews/screenshots-20260712-status/<engine>-*.png

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const KEY = 'n2hub.data.v1';
const SHOTS = 'reviews/screenshots-20260712-status';
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
  // LOAD_SAMPLE signs in Kasia (admin) directly via seed's currentUserId; handle
  // a login screen defensively anyway (established pattern).
  const loginRow = page.locator('.login-person').first();
  if (await loginRow.isVisible().catch(() => false)) await loginRow.click();
  await page.locator('.app-nav-link').first().waitFor({ timeout: 10000 });
}

const readStore = (page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

// Scoped locator for one status row in the admin status list, found via its
// name input's aria-label (`Nazwa statusu ${name}`) — stable across reorders.
const statusRow = (page, name) =>
  page.locator('li.admin-status').filter({ has: page.getByLabel(`Nazwa statusu ${name}`) });

// Whether the "Po terminie" alert group on /my-work currently lists a task
// with this exact title. Absence of the group entirely (no overdue tasks) is
// treated as "not present".
async function overdueListContains(page, taskTitle) {
  const group = page
    .locator('.my-work-alert-group')
    .filter({ has: page.locator('h3.my-work-alert-title', { hasText: 'Po terminie' }) });
  if ((await group.count()) === 0) return false;
  const text = (await group.first().textContent()) || '';
  return text.includes(taskTitle);
}

// Dates safely in the past regardless of TZ/DST edge cases, computed from the
// LOCAL clock (matches the app's todayStr()/new Date() convention).
function pastDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function flowStatusSemantics(browser) {
  const { context, page, pageErrors } = await newPage(browser);
  try {
    await seed(page);

    // --- (a) exactly one done status, and it is Gotowe ---
    let store = await readStore(page);
    const doneStatuses = store.statuses.filter((s) => s.isDone === true);
    ok(
      doneStatuses.length === 1 && doneStatuses[0].name === 'Gotowe',
      `a: exactly one done status, named Gotowe (got ${JSON.stringify(doneStatuses.map((s) => s.name))})`,
    );

    // --- (b) reorder safety ---
    const pastEnd = pastDateStr(10);
    const pastStart = pastDateStr(20);
    const fixtureB = await page.evaluate(
      ({ key, pastEnd, pastStart }) => {
        const data = JSON.parse(localStorage.getItem(key));
        const gotowe = data.statuses.find((s) => s.name === 'Gotowe');
        const kasiaId = data.currentUserId;
        const task = data.tasks[0];
        task.statusId = gotowe.id;
        task.startDate = pastStart;
        task.endDate = pastEnd;
        if (!data.assignments.some((a) => a.taskId === task.id && a.personId === kasiaId)) {
          data.assignments.push({ id: `fixture-b-assign-${Date.now()}`, taskId: task.id, personId: kasiaId });
        }
        localStorage.setItem(key, JSON.stringify(data));
        return { taskId: task.id, taskTitle: task.title, gotoweId: gotowe.id, kasiaId };
      },
      { key: KEY, pastEnd, pastStart },
    );
    await page.reload({ waitUntil: 'networkidle' });

    await page.goto(`${BASE}/my-work`, { waitUntil: 'networkidle' });
    ok(
      !(await overdueListContains(page, fixtureB.taskTitle)),
      'b: past-due Gotowe task does NOT appear under Po terminie (before reorder)',
    );

    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    await page.getByLabel('Przesuń Gotowe wcześniej').click();
    await page.getByLabel('Przesuń Gotowe wcześniej').click();
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-b-admin-reorder.png` });

    await page.goto(`${BASE}/my-work`, { waitUntil: 'networkidle' });
    ok(
      !(await overdueListContains(page, fixtureB.taskTitle)),
      'b: past-due Gotowe task still does NOT appear under Po terminie (after reorder)',
    );

    store = await readStore(page);
    const gotoweAfterReorder = store.statuses.find((s) => s.id === fixtureB.gotoweId);
    const lastByOrder = store.statuses.reduce((last, s) => (s.order >= last.order ? s : last), store.statuses[0]);
    ok(gotoweAfterReorder.isDone === true, 'b: Gotowe still isDone:true after reorder');
    ok(
      lastByOrder.id !== gotoweAfterReorder.id && lastByOrder.isDone === false,
      `b: the now-last pipeline status is NOT done (got "${lastByOrder.name}", isDone=${lastByOrder.isDone})`,
    );

    // --- (c) archive visibility ---
    const fixtureC = await page.evaluate((key) => {
      const data = JSON.parse(localStorage.getItem(key));
      const wip = data.statuses.find((s) => s.name === 'W trakcie');
      const project = data.projects[0];
      project.statusId = wip.id; // deterministic — matches the seeded default anyway
      localStorage.setItem(key, JSON.stringify(data));
      return { projectId: project.id, projectName: project.name };
    }, KEY);
    await page.reload({ waitUntil: 'networkidle' });

    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    const wipArchiveBtn = statusRow(page, 'W trakcie').getByRole('button', { name: 'Archiwizuj' });
    ok(!(await wipArchiveBtn.isDisabled()), 'c: W trakcie archive button is enabled');
    await wipArchiveBtn.click();

    await page.goto(`${BASE}/kanban`, { waitUntil: 'networkidle' });
    const archivedCol = page.locator('.kanban-col.archived-col');
    await archivedCol.waitFor({ timeout: 10000 }).catch(() => {});
    const archivedColVisible = await archivedCol.isVisible().catch(() => false);
    ok(archivedColVisible, 'c: trailing Zarchiwizowane kanban column exists');
    const headerText = ((await archivedCol.locator('.kanban-col-name').textContent().catch(() => '')) || '').trim();
    ok(headerText === 'Zarchiwizowane', `c: archived column header text is "Zarchiwizowane" (got "${headerText}")`);
    const cardTitles = await archivedCol.locator('.kanban-card-title').allTextContents();
    ok(
      cardTitles.some((t) => t.trim() === fixtureC.projectName),
      `c: archived column contains the project's card (got ${JSON.stringify(cardTitles)})`,
    );
    const countText = ((await archivedCol.locator('.kanban-col-count').textContent().catch(() => '')) || '').trim();
    ok(
      Number(countText) === cardTitles.length,
      `c: archived column count matches its card count (header "${countText}" vs ${cardTitles.length} cards)`,
    );
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-c-kanban-archived.png` });

    // --- (d) archiving a done status does not revive completed work ---
    await page.evaluate((key) => {
      const data = JSON.parse(localStorage.getItem(key));
      const akceptacja = data.statuses.find((s) => s.name === 'Akceptacja');
      akceptacja.isDone = true;
      localStorage.setItem(key, JSON.stringify(data));
    }, KEY);
    await page.reload({ waitUntil: 'networkidle' });

    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    const gotoweArchiveBtn = statusRow(page, 'Gotowe').getByRole('button', { name: 'Archiwizuj' });
    ok(
      !(await gotoweArchiveBtn.isDisabled()),
      'd: Gotowe archive button is enabled once Akceptacja is also done',
    );
    await gotoweArchiveBtn.click();

    await page.goto(`${BASE}/my-work`, { waitUntil: 'networkidle' });
    ok(
      !(await overdueListContains(page, fixtureB.taskTitle)),
      'd: archiving Gotowe does not revive the past-due task under Po terminie',
    );
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-d-mywork-no-revive.png` });

    // --- (e) guard pre-validation on a CLEAN reseeded state ---
    await page.evaluate(() => localStorage.clear());
    await seed(page);

    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    const gotoweRow = statusRow(page, 'Gotowe');
    const gotoweCheckbox = gotoweRow.locator('input[type="checkbox"]');
    const gotoweCheckboxLabel = gotoweRow.locator('label.admin-status-done');
    const gotoweArchiveBtn2 = gotoweRow.getByRole('button', { name: 'Archiwizuj' });

    ok(await gotoweCheckbox.isDisabled(), 'e: Gotowe Ukończenie checkbox is disabled (only done status)');
    const checkboxTitle = await gotoweCheckboxLabel.getAttribute('title');
    ok(
      checkboxTitle === 'To jedyny status oznaczający ukończenie — najpierw oznacz inny status.',
      `e: Gotowe checkbox title matches the guard copy (got "${checkboxTitle}")`,
    );
    ok(await gotoweArchiveBtn2.isDisabled(), 'e: Gotowe archive button is disabled (only done status)');
    const archiveTitle = await gotoweArchiveBtn2.getAttribute('title');
    ok(
      archiveTitle === 'Nie można zarchiwizować jedynego statusu ukończenia — najpierw oznacz inny status.',
      `e: Gotowe archive title matches the guard copy (got "${archiveTitle}")`,
    );
    await page.screenshot({ path: `${SHOTS}/${ENGINE}-e-admin-guard.png` });

    await statusRow(page, 'Akceptacja').locator('input[type="checkbox"]').click();

    ok(!(await gotoweCheckbox.isDisabled()), 'e: Gotowe checkbox re-enabled once Akceptacja is also done');
    ok(!(await gotoweArchiveBtn2.isDisabled()), 'e: Gotowe archive button re-enabled once Akceptacja is also done');

    // --- (f) console: no page errors across the whole flow ---
    ok(pageErrors.length === 0, `f: no page errors across the flow (${pageErrors.join('; ')})`);
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
    await flowStatusSemantics(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n=== ${ENGINE} — status semantics browser gate ===`);
  for (const n of notes) console.log(n);
  console.log(`\n[${ENGINE}] VERDICT: ${failures.length ? `FAIL (${failures.length})` : 'PASS'}`);
  process.exit(failures.length ? 1 : 0);
}

run();
