// Focused browser check for PKG-20260804-optical-centering.
//
// Measures where glyphs and icons ACTUALLY land inside their centring box,
// instead of diffing screenshots. For each probe it neutralises the element's
// own paint (flat white background, black ink), screenshots the border box,
// decodes it back inside the page on a canvas, and computes the ink bounding
// box. The assertion is the vertical distance between the ink centre and the
// box centre.
//
// Two parts:
//   A. Synthetic probes — one 96 px circle per font token at 48 px type, where
//      the half-leading offset is large enough to be unambiguous. These are
//      the GATE: they fail the run.
//   B. Real components — the same measurement on live surfaces, reported with
//      their numbers and a looser tolerance, because their type is small
//      enough that a sub-pixel result is partly rasteriser noise.
//
// Usage: node scripts/browser-check-optical-centering.mjs [chromium|webkit]
// Requires the Vite dev server on http://localhost:5173.

import { chromium, webkit } from 'playwright';

const ENGINE = (process.argv[2] || 'chromium').toLowerCase();
const LAUNCHER = ENGINE === 'webkit' ? webkit : chromium;
const BASE = 'http://localhost:5173';

// Synthetic probes must be tight: 48 px type makes an uncorrected Plus Jakarta
// Sans land 1.70 px low, so 0.60 px cleanly separates fixed from unfixed.
const GATE_TOLERANCE_PX = 0.6;
// Live components render 11–14 px type where the true offset is ~0.4–0.5 px and
// hinting/antialiasing contribute their own fraction of a pixel.
const REPORT_TOLERANCE_PX = 1.0;

const failures = [];

function check(condition, label) {
  if (condition) console.log(`PASS: ${label}`);
  else {
    console.error(`FAIL: ${label}`);
    failures.push(label);
  }
}

/**
 * Ink bounding box of an element, in CSS pixels relative to its border box.
 * Returns null when the element paints nothing.
 */
async function measureInk(page, handle) {
  await handle.evaluate((el) => el.setAttribute('data-optical-probe', ''));
  const shot = (await handle.screenshot({ type: 'png' })).toString('base64');
  const result = await page.evaluate(
    async ({ shot }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${shot}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (data[i + 3] < 16) continue;
          // Ink is anything clearly darker than the neutralised white ground.
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum > 200) continue;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
      if (bottom < 0) return null;
      return { top, bottom, left, right, width, height };
    },
    { shot },
  );
  await handle.evaluate((el) => el.removeAttribute('data-optical-probe'));
  if (!result) return null;

  // +1 because the bounds are inclusive pixel indices.
  const inkCentreY = (result.top + result.bottom + 1) / 2;
  const inkCentreX = (result.left + result.right + 1) / 2;
  return {
    dy: inkCentreY - result.height / 2,
    dx: inkCentreX - result.width / 2,
    inkHeight: result.bottom - result.top + 1,
    box: result.height,
  };
}

const HARNESS_CSS = `
  [data-optical-probe] {
    background: #fff !important;
    background-image: none !important;
    border-color: #fff !important;
    box-shadow: none !important;
    color: #000 !important;
  }
  [data-optical-probe] *, [data-optical-probe] *::before, [data-optical-probe] *::after {
    color: #000 !important;
    background: transparent !important;
    box-shadow: none !important;
    border-color: transparent !important;
  }
  #optical-probe-host {
    position: fixed; top: 0; left: 0; z-index: 999999;
    display: flex; gap: 8px; background: #fff; padding: 8px;
  }
  #optical-probe-host .op {
    display: inline-grid; place-items: center;
    width: 96px; height: 96px; border-radius: 50%;
    line-height: 1; font-weight: 700; font-size: 48px;
    background: #fff; color: #000;
  }
`;

// One probe per font token declared in src/styles.css. Uppercase-only content
// on purpose: the ink box of "AH" is exactly the cap-height block, which is
// what `text-box-edge: cap alphabetic` targets.
const FONT_PROBES = [
  // Goły token sansa jest ŚWIADOMIE tylko raportowany (`reportOnly`): metryki
  // Plus Jakarta Sans są asymetryczne z natury, a naprawa NIE dotyka tokenu
  // (inwariant PKG-20260804) — mechanizmem jest alias per-powierzchnia niżej.
  // Ta linia dokumentuje, ile wynosi surowy offset, i wykryje podbicie wersji
  // fontu, które by go zmieniło.
  {
    id: 'sans',
    token: '--n2-font-sans',
    label: 'Plus Jakarta Sans (--n2-font-sans, goły token — informacyjnie)',
    reportOnly: true,
  },
  // BRAMKA dla sansa: DOKŁADNIE mechanizm .avatar — alias 'Plus Jakarta Sans
  // Trimmed' (fonts.css; Chrome/Firefox) + blokowy span z `text-box`
  // (Chrome/Safari). Sonda replikuje markup avatara (`glyphSpan`), bo metric
  // overrides nie działają w Safari, a text-box nie działa w Firefoksie —
  // dopiero złożenie pokrywa wszystkie silniki.
  {
    id: 'sans-trimmed',
    family: "'Plus Jakarta Sans Trimmed', var(--n2-font-sans)",
    label: 'Plus Jakarta Sans Trimmed + text-box (mechanizm .avatar)',
    glyphSpan: true,
  },
  { id: 'data', token: '--n2-font-data', label: 'Inter (--n2-font-data)' },
  { id: 'display', token: '--n2-font-display', label: 'Orbitron (--n2-font-display)' },
  { id: 'mono', token: '--n2-font-mono', label: 'Fragment Mono (--n2-font-mono)' },
];

// Live surfaces. `optional: true` means a missing node is reported, not failed —
// seeded data does not guarantee every badge is on screen. `path` navigates to
// the page that actually renders the surface (the dashboard alone no longer
// carries them: the circular `.app-brand-mark` logo was removed 2026-08-06 in
// favour of the typographic brand, and avatars live on /people).
const COMPONENT_PROBES = [
  { path: '/people', selector: '.avatar', label: '.avatar — initials in a circle', kind: 'text' },
  { path: '/tasks', selector: '.icon-btn', label: '.icon-btn — lucide icon in a circle', kind: 'icon' },
  { selector: '.dash-badge', label: '.dash-badge — counter pill', kind: 'text', optional: true },
  { selector: '.filter-badge', label: '.filter-badge — counter pill', kind: 'text', optional: true },
];

async function run() {
  const browser = await LAUNCHER.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Wczytaj przykładowe dane' }).click();
    await page.waitForLoadState('networkidle');
    // Dane przykładowe lądują na ekranie logowania — osoby z seedów nie mają
    // hasła, więc klik pierwszej osoby loguje wprost. Bez tego sekcja B
    // (żywe komponenty) mierzyłaby pusty ekran i wszystko SKIPowała.
    const loginPerson = page.locator('.login-person').first();
    if (await loginPerson.count()) {
      await loginPerson.click();
      await page.waitForLoadState('networkidle');
    }
    await page.evaluate(() => sessionStorage.removeItem('n2hub.onboarding.login.v1'));
    await page.addStyleTag({ content: HARNESS_CSS });
    // Webfonts must be settled or the first probe measures the fallback.
    await page.evaluate(() => document.fonts.ready);

    /* ---------------------------------------------- A. synthetic gate --- */

    console.log('\n--- A. synthetic probes (96 px circle, 48 px type) ---');
    await page.evaluate((probes) => {
      const host = document.createElement('div');
      host.id = 'optical-probe-host';
      for (const p of probes) {
        const el = document.createElement('div');
        el.className = 'op';
        el.id = `op-${p.id}`;
        el.style.fontFamily = p.family
          ? p.family
          : getComputedStyle(document.documentElement).getPropertyValue(p.token);
        // Alias .avatar istnieje wyłącznie w wadze 700 — sonda musi jej użyć,
        // inaczej przeglądarka zsyntetyzuje wagę z fallbacku bez przycięcia.
        el.style.fontWeight = '700';
        if (p.glyphSpan) {
          // Replika `.avatar-glyphs`: blokowy span-nośnik text-boxa.
          const glyphs = document.createElement('span');
          glyphs.style.display = 'block';
          glyphs.style.textBox = 'trim-both cap alphabetic';
          glyphs.textContent = 'AH';
          el.appendChild(glyphs);
        } else {
          el.textContent = 'AH';
        }
        host.appendChild(el);
      }
      document.body.appendChild(host);
    }, FONT_PROBES);
    await page.evaluate(() => document.fonts.ready);

    for (const probe of FONT_PROBES) {
      const handle = page.locator(`#op-${probe.id}`);
      const ink = await measureInk(page, handle);
      if (!ink) {
        check(false, `${probe.label} — probe painted nothing`);
        continue;
      }
      const dy = ink.dy.toFixed(2);
      const line = `${probe.label} — cap block ${dy > 0 ? `${dy} px BELOW` : `${Math.abs(dy)} px above`} centre (tol ${GATE_TOLERANCE_PX})`;
      if (probe.reportOnly) console.log(`INFO: ${line}`);
      else check(Math.abs(ink.dy) <= GATE_TOLERANCE_PX, line);
    }

    await page.evaluate(() => document.getElementById('optical-probe-host')?.remove());

    /* ------------------------------------------- B. live components ---- */

    console.log('\n--- B. live components (report, tolerance ' + REPORT_TOLERANCE_PX + ' px) ---');
    let currentPath = new URL(page.url()).pathname;
    for (const probe of COMPONENT_PROBES) {
      if (probe.path && probe.path !== currentPath) {
        await page.goto(`${BASE}${probe.path}`, { waitUntil: 'networkidle' });
        // Nawigacja gubi wstrzyknięty arkusz neutralizujący — dołóż go ponownie.
        await page.addStyleTag({ content: HARNESS_CSS });
        await page.evaluate(() => document.fonts.ready);
        currentPath = probe.path;
      }
      // Pierwszy WIDOCZNY egzemplarz — pierwszy w DOM bywa ukryty (np. avatar
      // zwiniętego sidebara), a `first()` po nim SKIPowałoby całą sondę.
      const locator = page.locator(`${probe.selector} >> visible=true`).first();
      if ((await locator.count()) === 0 || !(await locator.isVisible().catch(() => false))) {
        console.log(`SKIP: ${probe.label} — not rendered on ${currentPath} with seeded data`);
        continue;
      }
      const ink = await measureInk(page, locator);
      if (!ink) {
        console.log(`SKIP: ${probe.label} — painted nothing after neutralisation`);
        continue;
      }
      check(
        Math.abs(ink.dy) <= REPORT_TOLERANCE_PX,
        `${probe.label} — dy ${ink.dy.toFixed(2)} px, dx ${ink.dx.toFixed(2)} px, ink ${ink.inkHeight}/${ink.box} px`,
      );
    }

    console.log('');
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n${ENGINE}: ${failures.length} failing check(s)`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log(`${ENGINE}: all optical-centering checks passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
