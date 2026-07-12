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

    // The advanced calendar tour is intentionally a real exercise, not a
    // narrated mock. Move the highlighted block with actual mouse events and
    // confirm that the tutorial detects the persisted calendar interaction.
    await page.locator('.sidebar-help').click();
    await center.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const advanced = center.locator('.tutorial-module-row').filter({
      hasText: 'Kalendarz: planowanie zaawansowane',
    });
    await advanced.getByRole('button', { name: 'Uruchom' }).click();
    await page.locator('.week-block[data-tour="calendar.block"]').first().waitFor({ timeout: 5000 });
    await coachmark.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const practice = coachmark.locator('.onboarding-practice');
    const next = coachmark.getByRole('button', { name: 'Dalej' });
    check(await practice.isVisible().catch(() => false), 'advanced calendar step exposes a live exercise');
    check(await next.isDisabled().catch(() => false), 'the exercise must be completed or explicitly skipped before continuing');

    // Find a free slot for the highlighted person's real block. The geometry
    // comes from the live, scrolled grid; this catches regressions in both the
    // calendar drag projection and the non-blocking practice overlay without
    // baking a particular seed ordering into the regression test.
    const drag = await page.evaluate(() => {
      const block = document.querySelector('.week-block[data-tour="calendar.block"]');
      const grid = document.querySelector('.week-days-grid');
      const viewport = document.querySelector('.week-days-viewport');
      if (!(block instanceof HTMLElement) || !(grid instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return null;
      const blockRect = block.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const startX = blockRect.left + blockRect.width / 2;
      const startY = blockRect.top + blockRect.height / 2;
      const visibleBlock = document.elementFromPoint(startX, startY)?.closest('.week-block');
      if (visibleBlock !== block) return null;
      const person = block.title.match(/— (.*?): \d{1,2}:\d{2}/)?.[1];
      const sourceColumn = block.closest('.week-day-col');
      if (!person || !(sourceColumn instanceof HTMLElement)) return null;
      const sourceIndex = Number(sourceColumn.dataset.dayIndex);
      const duration = Number.parseFloat(block.style.height);
      const columns = Array.from(document.querySelectorAll('.week-day-col[data-day-index]'));
      const starts = [8, 9, 10, 11, 12, 13, 14, 15].map((hour) => hour * 48);
      for (const column of columns) {
        if (!(column instanceof HTMLElement) || Number(column.dataset.dayIndex) === sourceIndex) continue;
        const columnRect = column.getBoundingClientRect();
        for (const candidateStart of starts) {
          const candidateEnd = candidateStart + duration;
          const hasCollision = Array.from(column.querySelectorAll('.week-block')).some((other) => {
            if (!(other instanceof HTMLElement) || other === block || !other.title.includes(`— ${person}:`)) return false;
            const otherStart = Number.parseFloat(other.style.top);
            const otherEnd = otherStart + Number.parseFloat(other.style.height);
            return candidateStart < otherEnd && candidateEnd > otherStart;
          });
          // TimedBlock projects a move from the grabbed point, rather than
          // from the grid origin. Keep the pointer at the same relative point
          // inside the card (its centre here) when aiming at the free slot.
          const targetY = startY + candidateStart - Number.parseFloat(block.style.top);
          if (!hasCollision && targetY >= viewportRect.top && targetY < viewportRect.bottom) {
            return {
              startX,
              startY,
              targetX: columnRect.left + columnRect.width / 2,
              targetY,
            };
          }
        }
      }
      return null;
    });
    check(Boolean(drag), 'highlighted calendar block remains directly draggable during the exercise');
    if (drag) {
      await page.mouse.move(drag.startX, drag.startY);
      await page.mouse.down();
      for (let index = 1; index <= 8; index += 1) {
        await page.mouse.move(
          drag.startX + ((drag.targetX - drag.startX) * index) / 8,
          drag.startY + ((drag.targetY - drag.startY) * index) / 8,
        );
        // Keep this close to a human drag: React must see individual pointer
        // frames rather than a single coalesced final coordinate.
        await page.waitForTimeout(15);
      }
      await page.mouse.up();
      await coachmark.locator('.onboarding-practice.done').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
    const exerciseDone = await coachmark.locator('.onboarding-practice.done').isVisible().catch(() => false);
    check(exerciseDone, 'a real block move completes the live exercise');
    check(!(await next.isDisabled().catch(() => true)), 'a completed exercise unlocks the next step');

    // Continue to the resize step and pull the top handle up by one 15-minute
    // snap. This is a real resize on the currently highlighted calendar card.
    await next.click();
    const resizeHeading = coachmark.getByRole('heading', { name: 'Zmień długość bloku' });
    await resizeHeading.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    await coachmark.locator('.onboarding-practice:not(.done)').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    check(
      (await resizeHeading.isVisible().catch(() => false)) &&
        (await coachmark.locator('.onboarding-practice:not(.done)').isVisible().catch(() => false)),
      'the next calendar step asks for a real resize',
    );
    const resize = await page.evaluate(() => {
      const handle = document.querySelector('.week-block[data-tour="calendar.block"] .week-block-handle.top');
      const viewport = document.querySelector('.week-days-viewport');
      if (!(handle instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return null;
      const rect = handle.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;
      const visibleHandle = document.elementFromPoint(startX, startY);
      if (visibleHandle !== handle || startY - 12 < viewportRect.top) return null;
      return { startX, startY, targetY: startY - 12 };
    });
    check(Boolean(resize), 'the highlighted block exposes a usable resize handle during the exercise');
    if (resize) {
      await page.mouse.move(resize.startX, resize.startY);
      await page.mouse.down();
      await page.mouse.move(resize.startX, resize.targetY);
      await page.waitForTimeout(30);
      await page.mouse.up();
      await coachmark.locator('.onboarding-practice.done').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
    check(await coachmark.locator('.onboarding-practice.done').isVisible().catch(() => false), 'a real resize completes the live exercise');
    await page.keyboard.press('Escape');

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
