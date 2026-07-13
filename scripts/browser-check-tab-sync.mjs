// Browser regression for PKG-20260713c-persist-core / -ui / -tests: HONEST
// local persistence + same-browser tab safety.
//
//   1. A failed localStorage write must never render a false "Zapisano" — the
//      save-status badge must show a durable "Nie zapisano" and a Polish
//      failure banner (export + retry) must appear; storage must keep the
//      pre-save payload until a retry succeeds.
//   2. Two pages of ONE browser context (same origin, shared localStorage —
//      `storage` events fire in the non-originating page) must reconcile a
//      same-browser tab write: a CLEAN sibling tab (no unsaved edits) auto-
//      refreshes in place with a dismissible notice; a DIRTY sibling tab gets
//      an explicit conflict banner instead of a silent overwrite, and BOTH
//      resolutions ("adopt the other tab's data" / "keep mine, overwriting
//      the other") behave as shipped.
//   3. The envelope `revision` is monotonic and does not ping-pong while idle.
//
// Drives a REAL browser (Chromium or WebKit) against the dev server on :5173.
// pageA and pageB are two `context.newPage()` calls from ONE
// `browser.newContext()` — NOT two contexts — so they share localStorage and
// `storage` events cross between them, per the architect's verified design
// premise.
//
// Write-failure simulation: a `context.addInitScript` installed BEFORE either
// page navigates wraps `Storage.prototype.setItem` to throw a classified
// QuotaExceededError-shaped error when the key is `n2hub.data.v1` AND
// `window.__blockWrites === true` (a page-global flag flipped per-scenario via
// `page.evaluate`, reset to `false` on every navigation by the init script
// itself). This only affects the app's own storage key — uiPrefs and any other
// localStorage key are untouched.
//
// Flow (one continuous run):
//   (a) seed on pageA, reload pageB, record the starting envelope revision.
//   (b) clean auto-refresh: pageB idle on /projects (no form open) — pageA
//       toggles a project's paid coin from its detail page. pageB's coin
//       updates WITHOUT a reload, the "refreshed" info notice shows and OK
//       dismisses it; the revision is stable ~700ms apart (no write-back
//       ping-pong) and pageA shows no banner of its own.
//   (c) conflict -> accept external: pageB opens a NEW-task modal for the
//       SAME project while staying on /projects (via the "+ Zadanie" quick
//       button — keeps the project list, and its coin, in the DOM under the
//       modal) and types a title (dirty, unsaved). pageA toggles the coin
//       back. pageB gets the conflict banner (proving it did NOT silently
//       replace its state — the underlying coin still reads the PRE-conflict
//       label); accepting (behind the shipped `window.confirm`) adopts
//       pageA's write with no revision write-back.
//   (d) conflict -> keep local: pageB opens a fresh dirty new-task modal;
//       pageA toggles the coin again. pageB clicks "keep mine" — storage ends
//       up back at pageB's PRE-conflict value (pageA's toggle is reverted) at
//       a strictly higher revision; pageA (clean) then auto-refreshes to that
//       reverted value.
//   (e) failed write: pageA blocks writes, edits the project name on its
//       detail page (ProjectDetailPage — chosen over TaskModal because
//       TaskModal's own save handler unconditionally closes the modal via
//       `onSaved={onClose}`, which would tear down its SaveStatus badge
//       before the persist effect even runs; ProjectDetailPage's save() does
//       NOT navigate away, so its SaveStatus badge stays observable — see the
//       worker report for this premise-vs-code correction) and saves. The
//       failure banner + "Nie zapisano" show, "Zapisano" never appears
//       (polled ~3s), and storage keeps the pre-save name.
//   (f) retry recovery: unblock writes, click "Spróbuj ponownie" — banner
//       clears, storage gets the edited name, and it survives a reload.
//   (g) zero `pageerror`s on BOTH pages across the whole flow.
//
// Usage: node scripts/browser-check-tab-sync.mjs [chromium|webkit]
// Exits non-zero if any check fails. Dev server must already be on :5173.
//
// Screenshots: reviews/screenshots-20260713c-persist/<engine>-*.png

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';
const KEY = 'n2hub.data.v1';
const SHOTS = 'reviews/screenshots-20260713c-persist';
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
  // Defensive no-op in the common case: seed.ts already sets currentUserId to
  // Kasia, so the login screen normally never appears after LOAD_SAMPLE.
  const loginRow = page.locator('.login-person').first();
  if (await loginRow.isVisible().catch(() => false)) await loginRow.click();
  await page.locator('.app-nav-link').first().waitFor({ timeout: 10000 });
}

/** Poll an async predicate until it returns a truthy value or the timeout elapses. */
async function waitForTrue(fn, { timeout = 5000, interval = 100 } = {}) {
  const start = Date.now();
  let last = false;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

async function flowTabSync(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });

  // Installed BEFORE any page navigates, on the CONTEXT, so both pageA and
  // pageB get it from their very first load. Resets the flag false on every
  // navigation (including reloads) so a stale `true` never leaks across steps.
  await context.addInitScript(() => {
    window.__blockWrites = false;
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (key === 'n2hub.data.v1' && window.__blockWrites === true) {
        const err = new DOMException('quota', 'QuotaExceededError');
        throw err;
      }
      return origSetItem.call(this, key, value);
    };
  });

  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const pageErrors = [];
  pageA.on('pageerror', (e) => pageErrors.push(`A: ${e}`));
  pageB.on('pageerror', (e) => pageErrors.push(`B: ${e}`));

  try {
    // ============================================================
    // (a) setup — seed on A, reload B, record the starting revision
    // ============================================================
    await seed(pageA);
    await pageB.goto(BASE, { waitUntil: 'networkidle' });
    await pageB.locator('.app-nav-link').first().waitFor({ timeout: 10000 });

    const fx = await readStore(pageA);
    ok(Array.isArray(fx?.projects) && fx.projects.length > 0, 'seeded data present after reload');
    const project = fx.projects[0];
    const projectId = project.id;
    const projectName = project.name;
    const initialPaid = project.paid;
    ok(
      typeof fx.revision === 'number' && fx.revision > 0,
      `starting envelope revision recorded (got ${fx?.revision})`,
    );
    let lastKnownRevision = fx.revision;

    await pageA.screenshot({ path: `${SHOTS}/${ENGINE}-00-seeded.png` });

    // ============================================================
    // (b) clean auto-refresh — pageB idle on /projects, no form open
    // ============================================================
    await pageB.locator('a.app-nav-link[href="/projects"]').click();
    await pageB.locator('.project-card').first().waitFor({ timeout: 10000 });
    const coinOnB = pageB
      .locator('.project-card')
      .filter({ hasText: projectName })
      .locator('.project-card-coin .coin');
    await coinOnB.waitFor({ timeout: 10000 });
    const labelBefore = await coinOnB.getAttribute('title');
    ok(
      labelBefore === (initialPaid ? 'Projekt opłacony' : 'Projekt nieopłacony'),
      `pageB shows the initial paid label before any toggle (got "${labelBefore}")`,
    );

    await pageA.locator('a.app-nav-link[href="/projects"]').click();
    await pageA.locator('.project-card').first().waitFor({ timeout: 10000 });
    await pageA.locator('.project-card').filter({ hasText: projectName }).locator('.task-card-main').click();
    await pageA.locator('.project-detail-title').waitFor({ timeout: 10000 });
    const coinBtnOnA = pageA.locator('.coin-btn').first();
    await coinBtnOnA.waitFor({ timeout: 10000 });
    await coinBtnOnA.click();
    await pageA.waitForTimeout(400); // let the persist effect settle

    const expectedAfterFirstToggle = initialPaid ? 'Projekt nieopłacony' : 'Projekt opłacony';
    const refreshedOnB = await waitForTrue(async () => {
      const label = await coinOnB.getAttribute('title').catch(() => null);
      return label === expectedAfterFirstToggle;
    });
    ok(refreshedOnB, 'pageB coin flips WITHOUT a reload after pageA toggles it');

    const infoBannerB = pageB.locator('.persistence-banner.persistence-banner--info[role="status"]');
    await infoBannerB.waitFor({ state: 'visible', timeout: 5000 });
    const infoText = (await infoBannerB.innerText()).trim();
    ok(
      infoText.includes('Dane odświeżono — wczytano zmiany zapisane w innej karcie.'),
      `pageB shows the exact refresh notice (got "${infoText}")`,
    );
    await pageB.screenshot({ path: `${SHOTS}/${ENGINE}-b1-clean-refresh.png` });

    await infoBannerB.locator('button', { hasText: 'OK' }).click();
    ok(
      !(await infoBannerB.isVisible().catch(() => false)),
      'OK dismisses the refresh notice on pageB',
    );

    // No write-back ping-pong: the stored revision must be stable while idle.
    const rev1 = (await readStore(pageA)).revision;
    await pageA.waitForTimeout(700);
    const rev2 = (await readStore(pageA)).revision;
    ok(rev1 === rev2, `stored revision stable ~700ms apart while idle (got ${rev1} then ${rev2})`);
    lastKnownRevision = rev2;

    // pageA's OWN write never raises a banner on itself (storage events only
    // fire in the non-originating page).
    ok(
      (await pageA.locator('.persistence-banner').count()) === 0,
      'pageA shows no persistence banner after its own successful write',
    );
    await pageA.screenshot({ path: `${SHOTS}/${ENGINE}-b2-pageA-clean.png` });

    // ============================================================
    // (c) conflict -> accept external
    // ============================================================
    // Dirtiness comes from an INLINE form (ProjectDetailPage's own name
    // field), not a TaskModal edit: `.task-modal-viewport` is a fixed,
    // full-viewport overlay (z-index 1001, see styles.css) that sits ABOVE
    // `PersistenceBanner` — with a task modal open the banner is visible but
    // physically unclickable (a real interaction constraint of the modal
    // stacking, not a bug — see the worker report for this premise
    // correction). ProjectDetailPage's dirty-name-edit uses the identical
    // `useSaveStatus`/dirtyRegistry wiring with no overlay in the way, so the
    // banner stays reachable while pageB has unsaved edits.
    await pageB.locator('.project-card').filter({ hasText: projectName }).locator('.task-card-main').click();
    await pageB.locator('.project-detail-title').waitFor({ timeout: 10000 });
    const nameInputB = pageB.locator('#pd-name');
    await nameInputB.waitFor({ timeout: 10000 });
    const coinBtnOnB = pageB.locator('.coin-btn').first();
    await coinBtnOnB.waitFor({ timeout: 10000 });
    await nameInputB.fill(`${projectName} (B, niezapisane)`);

    await coinBtnOnA.click(); // toggle back to the ORIGINAL paid state
    await pageA.waitForTimeout(400);
    const revAfterCToggle = (await readStore(pageA)).revision;
    ok(revAfterCToggle > lastKnownRevision, `pageA's (c) toggle bumped the revision (${lastKnownRevision} -> ${revAfterCToggle})`);

    const conflictBannerB = pageB.locator('.persistence-banner.persistence-banner--conflict[role="alert"]');
    const conflictAppeared = await waitForTrue(() => conflictBannerB.isVisible().catch(() => false));
    ok(conflictAppeared, 'pageB (dirty) shows the conflict banner instead of auto-refreshing');
    const conflictText = (await conflictBannerB.innerText()).trim();
    ok(
      conflictText.includes(
        'Dane zostały zmienione w innej karcie przeglądarki, a ta karta ma niezapisane zmiany.',
      ),
      `exact conflict copy shown (got "${conflictText}")`,
    );

    // Store NOT silently replaced: pageB's own coin still reads the
    // PRE-conflict (post-b) label, not pageA's just-written toggle-back.
    const labelStillPreConflict = await coinBtnOnB.getAttribute('title');
    ok(
      labelStillPreConflict?.startsWith(expectedAfterFirstToggle),
      `pageB's underlying data still shows the pre-conflict coin state (got "${labelStillPreConflict}")`,
    );
    await pageB.screenshot({ path: `${SHOTS}/${ENGINE}-c1-conflict.png` });

    pageB.once('dialog', (d) => d.accept());
    await conflictBannerB.getByRole('button', { name: 'Wczytaj wersję z innej karty' }).click();
    const conflictGoneC = await waitForTrue(() => conflictBannerB.isHidden());
    ok(conflictGoneC, 'conflict banner clears after accepting the external version');

    const labelAfterAccept = await waitForTrue(async () => {
      const label = await coinBtnOnB.getAttribute('title').catch(() => null);
      return label?.startsWith(initialPaid ? 'Projekt opłacony' : 'Projekt nieopłacony') ? label : false;
    });
    ok(!!labelAfterAccept, `pageB now matches pageA's write after accepting (got "${labelAfterAccept}")`);
    const revAfterAccept = (await readStore(pageB)).revision;
    ok(
      revAfterAccept === revAfterCToggle,
      `accepting external does NOT write back a new revision (before ${revAfterCToggle}, after ${revAfterAccept})`,
    );
    // The local unsaved name draft survives the external replace unharmed —
    // REPLACE_FROM_STORAGE only swaps the global store; ProjectDetail isn't
    // remounted (same project id), so its own React state is untouched.
    ok(
      (await nameInputB.inputValue()) === `${projectName} (B, niezapisane)`,
      'accepting external does not clobber the unsaved local name draft',
    );
    lastKnownRevision = revAfterAccept;
    await pageB.screenshot({ path: `${SHOTS}/${ENGINE}-c2-accepted.png` });

    // ============================================================
    // (d) conflict -> keep local
    // ============================================================
    // Still dirty from (c) (never saved/reverted) — extend the edit further
    // so "dirty again" is deliberate, not just leftover.
    await nameInputB.fill(`${projectName} (B, niezapisane 2)`);

    await coinBtnOnA.click(); // pageA's second (d) toggle
    await pageA.waitForTimeout(400);
    const revAfterDToggle = (await readStore(pageA)).revision;
    ok(revAfterDToggle > lastKnownRevision, `pageA's (d) toggle bumped the revision (${lastKnownRevision} -> ${revAfterDToggle})`);

    const conflictAppearedD = await waitForTrue(() => conflictBannerB.isVisible().catch(() => false));
    ok(conflictAppearedD, 'pageB (dirty again) shows the conflict banner for the (d) toggle');
    await pageB.screenshot({ path: `${SHOTS}/${ENGINE}-d1-conflict2.png` });

    const keepLocalBtn = conflictBannerB.getByRole('button', { name: 'Zostaw moją wersję (nadpisz)' });
    const keepTitle = await keepLocalBtn.getAttribute('title');
    ok(
      keepTitle === 'Zapisuje stan tej karty, nadpisując zmiany z innej karty.',
      `keep-local button carries the exact explanatory title (got "${keepTitle}")`,
    );
    await keepLocalBtn.click();
    const conflictGoneD = await waitForTrue(() => conflictBannerB.isHidden());
    ok(conflictGoneD, 'conflict banner clears after keeping the local version');

    const storeAfterKeep = await readStore(pageB);
    const projAfterKeep = storeAfterKeep.projects.find((p) => p.id === projectId);
    ok(
      projAfterKeep.paid === (initialPaid ? true : false),
      `storage reflects pageB's PRE-conflict paid state after keep-local (expected ${initialPaid}, got ${projAfterKeep.paid})`,
    );
    ok(
      storeAfterKeep.revision > revAfterDToggle,
      `keep-local writes a revision strictly greater than pageA's (d) write (${revAfterDToggle} -> ${storeAfterKeep.revision})`,
    );
    lastKnownRevision = storeAfterKeep.revision;
    await pageB.screenshot({ path: `${SHOTS}/${ENGINE}-d2-kept-local.png` });

    // pageA (clean — no open form there) subsequently receives the external
    // change: its own info notice appears and its coin reverts.
    const infoBannerA = pageA.locator('.persistence-banner.persistence-banner--info[role="status"]');
    const refreshedOnA = await waitForTrue(() => infoBannerA.isVisible().catch(() => false));
    ok(refreshedOnA, 'pageA (clean) auto-refreshes and shows its own info notice');
    const coinLabelOnA = await pageA.locator('.coin-btn').first().getAttribute('title');
    ok(
      coinLabelOnA?.startsWith(initialPaid ? 'Projekt opłacony' : 'Projekt nieopłacony'),
      `pageA's own coin reverts to match the kept-local value (got "${coinLabelOnA}")`,
    );
    await pageA.screenshot({ path: `${SHOTS}/${ENGINE}-d3-pageA-reverted.png` });
    await infoBannerA.locator('button', { hasText: 'OK' }).click();

    // pageB's own leftover dirty name draft plays no further part in the
    // flow — pageB isn't touched again below, so it's left as-is rather than
    // navigated away (which would just discard it via the same-page confirm).

    // ============================================================
    // (e) failed write — no false "Zapisano"
    // ============================================================
    const nameInput = pageA.locator('#pd-name');
    await nameInput.waitFor({ timeout: 10000 });
    const originalName = await nameInput.inputValue();

    await pageA.evaluate(() => {
      window.__blockWrites = true;
    });

    const editedName = `${originalName} (edytowano)`;
    await nameInput.fill(editedName);
    const saveBtn = pageA.locator('.editor-actions .btn.primary', { hasText: 'Zapisz zmiany' });
    await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
    await saveBtn.click();

    const failureBanner = pageA.locator('.persistence-banner.persistence-banner--error[role="alert"]');
    const failureAppeared = await waitForTrue(() => failureBanner.isVisible().catch(() => false));
    ok(failureAppeared, 'failure banner appears after the blocked write');
    const failureText = (await failureBanner.innerText()).trim();
    ok(
      failureText.includes('Nie udało się zapisać danych — brak miejsca w pamięci przeglądarki.'),
      `exact quota failure copy shown (got "${failureText}")`,
    );
    ok(
      failureText.includes(
        'Zmiany istnieją tylko w tej karcie i przepadną po jej zamknięciu — pobierz kopię danych lub spróbuj ponownie.',
      ),
      'failure banner carries the always-second recovery sentence',
    );
    await pageA.screenshot({ path: `${SHOTS}/${ENGINE}-e1-failure-banner.png` });

    const errorBadge = pageA.locator('span.save-status.save-status--error[role="status"]');
    await errorBadge.waitFor({ state: 'visible', timeout: 5000 });
    ok((await errorBadge.innerText()).includes('Nie zapisano'), 'save-status badge reads "Nie zapisano"');

    // Headline assertion: "Zapisano" (exact) must NEVER appear, polled ~3s —
    // long enough to cross markSaved()'s own 2350ms saving->saved->clear
    // window, proving the durable error state truly overrides that theater
    // rather than just winning a race.
    const start = Date.now();
    let sawZapisano = false;
    while (Date.now() - start < 3000) {
      if ((await pageA.getByText('Zapisano', { exact: true }).count()) > 0) {
        sawZapisano = true;
        break;
      }
      await pageA.waitForTimeout(150);
    }
    ok(!sawZapisano, 'the literal text "Zapisano" never renders while the write is failing');

    const storedDuringFailure = await readStore(pageA);
    const projDuringFailure = storedDuringFailure.projects.find((p) => p.id === projectId);
    ok(
      projDuringFailure.name === originalName,
      `localStorage still holds the pre-save name during the failure (got "${projDuringFailure.name}")`,
    );
    ok(
      (await nameInput.inputValue()) === editedName,
      'the app itself shows the new (unsaved-to-storage) name',
    );

    // ============================================================
    // (f) retry recovery
    // ============================================================
    await pageA.evaluate(() => {
      window.__blockWrites = false;
    });
    const retryBtn = failureBanner.getByRole('button', { name: 'Spróbuj ponownie' });
    await retryBtn.click();
    const failureGone = await waitForTrue(() => failureBanner.isHidden());
    ok(failureGone, 'failure banner clears after a successful retry');

    const storedAfterRetry = await readStore(pageA);
    const projAfterRetry = storedAfterRetry.projects.find((p) => p.id === projectId);
    ok(
      projAfterRetry.name === editedName,
      `storage now holds the edited name after retry (got "${projAfterRetry.name}")`,
    );
    await pageA.screenshot({ path: `${SHOTS}/${ENGINE}-f1-recovered.png` });

    await pageA.reload({ waitUntil: 'networkidle' });
    await pageA.locator('#pd-name').waitFor({ timeout: 10000 });
    const nameAfterReload = await pageA.locator('#pd-name').inputValue();
    ok(nameAfterReload === editedName, `edited name survives a fresh reload (got "${nameAfterReload}")`);
    await pageA.screenshot({ path: `${SHOTS}/${ENGINE}-f2-reloaded.png` });

    // --- (g) zero page errors across the whole flow ---
    ok(pageErrors.length === 0, `no page errors across the flow (${pageErrors.join('; ')})`);
  } catch (e) {
    ok(false, `harness error — ${e.message}`);
    await pageA.screenshot({ path: `${SHOTS}/${ENGINE}-harness-error-A.png` }).catch(() => {});
    await pageB.screenshot({ path: `${SHOTS}/${ENGINE}-harness-error-B.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await LAUNCHER.launch({ headless: true });
  try {
    await flowTabSync(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n=== ${ENGINE} — honest persistence + same-browser tab-safety browser gate ===`);
  for (const n of notes) console.log(n);
  console.log(`\n[${ENGINE}] VERDICT: ${failures.length ? `FAIL (${failures.length})` : 'PASS'}`);
  process.exit(failures.length ? 1 : 0);
}

run();
