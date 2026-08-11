// Focused browser check for role landing, the phone shell (bottom tab bar +
// „Więcej" sheet) and calendar pseudo-button keyboard activation.
//
// PKG-20260728-mobile-nav-day-view retired the mobile drawer: below 760 px the
// sidebar is not rendered at all and navigation lives in `.app-bottom-nav`.
// The assertions that used to cover the drawer (inertness, Tab trap, Escape
// restore) were retargeted onto what replaced them — the sheet runs on the
// shared `useOverlay` shell, so this file asserts THAT shell's real contract:
// no focus stealing on open, roving tabindex over `[role="menuitem"]`, arrow
// wrapping, Escape close + focus return. There is deliberately no focus trap
// and no `inert` background anymore, and the checks below say so explicitly.
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

    // Jeden wspólny home dla KAŻDEJ roli (od 2026-07-22, run 258): login ląduje
    // na /dashboard, „/my-work" jest tylko legacy redirectem, a osoby na
    // liście logowania są podpisane STANOWISKIEM z seeda (np. „Projektantka"),
    // nie poziomem uprawnień — stare etykiety PRACOWNIK/ADMINISTRATOR nie
    // istnieją w UI.
    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await page.getByRole('button').filter({ hasText: 'Projektantka' }).first().click();
    await page.waitForURL('**/dashboard');
    check(new URL(page.url()).pathname === '/dashboard', 'login lands on the shared /dashboard home');
    await clearPendingIntro(page);

    // Legacy trasa /my-work przekierowuje na wspólny home.
    await page.goto(`${BASE}/my-work`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/dashboard');
    check(new URL(page.url()).pathname === '/dashboard', 'legacy /my-work redirects to /dashboard');

    await page.setViewportSize({ width: 375, height: 812 });
    // `#app-drawer` is now the DESKTOP sidebar only (kept as its stable handle);
    // the phone shell below 760 px does not render it at all.
    const drawer = page.locator('#app-drawer');
    const main = page.locator('main.app-main');
    const bottomNav = page.locator('.app-bottom-nav');
    // matchMedia change delivery is asynchronous relative to setViewportSize —
    // wait for the phone shell before asserting anything about it.
    await bottomNav.waitFor({ state: 'visible', timeout: 5000 });
    check((await drawer.count()) === 0, 'phone shell renders no sidebar/drawer at all');

    const tabs = bottomNav.locator('.app-bottom-nav-item');
    check((await tabs.count()) === 5, 'phone shell renders five bottom-nav tabs');
    const tabLabels = await bottomNav
      .locator('.app-bottom-nav-label')
      .evaluateAll((els) => els.map((el) => (el.textContent || '').trim()));
    check(
      tabLabels.join('|') === 'Panel|Kalendarz|Zadania|Zasobnik|Więcej',
      'bottom-nav tabs are Panel, Kalendarz, Zadania, Zasobnik, Więcej in that order',
    );
    // Active tab marking (class + aria-current) comes from the shared
    // `activeTabPath` rule; the „Zasobnik" deep-link tab must NOT light up.
    const currentTab = bottomNav.locator('[aria-current="page"]');
    check((await currentTab.count()) === 1, 'exactly one bottom-nav tab is marked aria-current="page"');
    check(
      ((await currentTab.first().getAttribute('href')) || '').endsWith('/dashboard'),
      'the current tab on /dashboard is Panel',
    );
    check(
      ((await currentTab.first().getAttribute('class')) || '').split(/\s+/).includes('active'),
      'the current bottom-nav tab also carries the .active class',
    );

    // Exactly ONE GlobalSearch is mounted on the phone (top bar). Two mounts
    // would register two Ctrl+K listeners that toggle each other, so the palette
    // would never end up visible — this assertion is the regression guard.
    const palette = page.locator('.gs-panel');
    await page.keyboard.press('Control+k');
    await palette.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    check(
      await palette.isVisible().catch(() => false),
      'Ctrl+K opens the search palette on the phone (single GlobalSearch mount)',
    );
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

    const moreTrigger = page.getByRole('button', { name: 'Więcej', exact: true });
    const moreSheet = page.locator('.app-more-sheet');
    const sheetItems = moreSheet.locator('[role="menuitem"]');
    check((await moreSheet.count()) === 0, 'the „Więcej" sheet is absent from the DOM until opened');
    check((await moreTrigger.getAttribute('aria-expanded')) === 'false', 'the „Więcej" trigger starts collapsed');
    // Replaces the old „open drawer makes background content inert" pair: the
    // sheet is a NON-modal popover, so the background stays interactive by
    // design. Asserted positively so a future re-introduction of `inert` here
    // is caught rather than silently accepted.
    check(!(await main.evaluate((element) => element.inert)), 'phone shell never makes the main content inert');

    await moreTrigger.focus();
    await page.keyboard.press('Enter');
    await moreSheet.waitFor({ state: 'visible', timeout: 3000 });
    check((await moreTrigger.getAttribute('aria-expanded')) === 'true', 'opening the sheet marks its trigger expanded');
    check((await moreSheet.getAttribute('role')) === 'menu', 'the sheet exposes role="menu"');
    check((await sheetItems.count()) > 0, 'the sheet renders menu items');
    // `useOverlay` deliberately does NOT steal focus on open (menus opened by
    // pointer keep today's feel), so this is the real contract — not a trap.
    check(
      await moreTrigger.evaluate((element) => element === document.activeElement),
      'opening the sheet keeps focus on its trigger (useOverlay never steals focus)',
    );
    const itemTabIndexes = await sheetItems.evaluateAll((els) => els.map((el) => el.tabIndex));
    check(
      itemTabIndexes.filter((t) => t === 0).length === 1 &&
        itemTabIndexes.every((t) => t === 0 || t === -1),
      'roving tabindex leaves exactly one sheet item in the Tab order',
    );
    // The sheet carries the NON-primary routes plus the pinned actions; a tab
    // that already lives in the bottom bar must never be duplicated here.
    const itemNames = await sheetItems.evaluateAll((els) =>
      els.map((el) => (el.textContent || '').trim()),
    );
    check(
      itemNames.includes('Ustawienia') && itemNames.includes('Wyloguj'),
      'the sheet carries Ustawienia and Wyloguj',
    );
    check(
      !itemNames.includes('Panel') && !itemNames.includes('Kalendarz') && !itemNames.includes('Zadania'),
      'the sheet never duplicates a primary bottom-nav tab',
    );

    // Arrow keys replace the old Tab-trap wrapping: `resolveMenuNavKey` moves
    // the roving focus and wraps at both ends of the `role="menuitem"` list.
    await page.keyboard.press('ArrowDown');
    check(
      await page.evaluate(() => Boolean(document.activeElement?.closest('.app-more-sheet'))),
      'ArrowDown moves focus from the trigger into the sheet',
    );
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    check(
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.app-more-sheet [role="menuitem"]'));
        return document.activeElement === items[0];
      }),
      'ArrowDown wraps from the last sheet item to the first',
    );
    await page.keyboard.press('ArrowUp');
    check(
      await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.app-more-sheet [role="menuitem"]'));
        return document.activeElement === items.at(-1);
      }),
      'ArrowUp wraps from the first sheet item to the last',
    );

    await page.keyboard.press('Escape');
    await moreSheet.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    check((await moreSheet.count()) === 0, 'Escape closes the „Więcej" sheet');
    check((await moreTrigger.getAttribute('aria-expanded')) === 'false', 'the closed sheet marks its trigger collapsed');
    // Focus return runs in a passive effect cleanup, i.e. after the node is gone.
    await page
      .waitForFunction(() => Boolean(document.activeElement?.closest('.app-bottom-nav')))
      .catch(() => {});
    check(
      await moreTrigger.evaluate((element) => element === document.activeElement),
      'closing restores focus to the „Więcej" trigger',
    );
    check(!(await main.evaluate((element) => element.inert)), 'the background stays interactive after closing');

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
