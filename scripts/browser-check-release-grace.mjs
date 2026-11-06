// Regresja 2026-11-06 („gumowe” cofanie szybkiego przeciągnięcia na gładziku
// Maca). Ślad z urządzenia: pointerdown → ruchy z buttons=1 →
// lostpointercapture + pointermove(buttons=0) → ~16 ms → pointerup NA KOLUMNIE
// DNIA (nie na bloku). Dawniej ruch bez przycisku anulował gest. Teraz okno
// łaski (RELEASE_GRACE_MS) czeka na puszczenie w dowolnym miejscu okna.
//
// Scenariusze (blok siatki i karta zasobnika):
//   mac-release: sekwencja jak wyżej → ruch MA się zapisać,
//   outside:     ruch bez przycisku i brak puszczenia → gest MA się cofnąć.
// Usage: node scripts/browser-check-release-grace.mjs (dev server na :5173,
// tryb lokalny: VITE_SUPABASE_URL= npx vite --port 5173)
import { chromium, BASE, launchOptions } from './lib/browser-env.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(launchOptions(chromium));
let failures = 0;

async function setup() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?dragdebug=1', { waitUntil: 'networkidle' });
  if (process.env.DEBUG) page.on('console', (m) => { if (m.text().includes('drag-sync')) console.log('   ', m.text()); });
  await page.getByRole('button', { name: 'Wczytaj przykładowe dane' }).click();
  const loginRow = page.locator('.login-person').first();
  if (await loginRow.isVisible().catch(() => false)) await loginRow.click();
  await page.locator('a.app-nav-link[href="/calendar"]').click();
  await page.locator('.week-block').first().waitFor();
  // Zapis przykładowych danych do localStorage jest odroczony: czekamy, aż
  // bloki będą na dysku, inaczej „przed” byłoby puste.
  await page.waitForFunction(
    () => (JSON.parse(localStorage.getItem('n2hub.data.v1') ?? '{}').workload ?? []).length > 0,
  );
  await sleep(1200);
  return { ctx, page };
}

// Tylko geometria bloków: reszta zapisu (filtry, znaczniki) zmienia się sama.
const snapshot = (page) =>
  page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('n2hub.data.v1') ?? '{}');
    return JSON.stringify(
      (data.workload ?? [])
        .map((w) => `${w.id}|${w.date}|${w.startMinutes}|${w.plannedHours}`)
        .sort(),
    );
  });

// Ruch bez przycisku + utrata przechwycenia, dokładnie jak na macOS.
const macGlitch = (page, selector, x, y) =>
  page.evaluate(
    ({ selector, x, y }) => {
      const el = document.querySelector(selector);
      for (const id of [1, 0]) {
        try {
          if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
        } catch {}
      }
      el.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
      const target = document.elementFromPoint(x, y) ?? el;
      target.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: x, clientY: y }),
      );
    },
    { selector, x, y },
  );

async function run(kind, scenario) {
  const { ctx, page } = await setup();
  const sel = kind === 'grid' ? '.week-block.dragging' : '.week-bin-block';
  const src =
    kind === 'grid'
      ? page.locator('.week-block', { hasText: 'Pakiet kreacji do prem' }).first()
      : page.locator('.week-bin-block').first();
  const box = await src.boundingBox();
  const sx = box.x + box.width / 2;
  const sy = box.y + 20;
  // Siatka: 2 h w dół w tej samej kolumnie. Zasobnik: wolny piątek 11:00
  // (ten sam cel co browser-check-bin-drag `free`).
  let tx = sx;
  let ty = sy + 168;
  if (kind === 'bin') {
    const gr = await page.evaluate(() => {
      const g = document.querySelector('.week-days-grid').getBoundingClientRect();
      return { left: g.left, top: g.top, width: g.width };
    });
    tx = gr.left + (gr.width / 7) * 4.5;
    ty = gr.top + 11 * 84 + 10;
  }
  const before = await snapshot(page);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + tx) / 2, (sy + ty) / 2);
  await page.mouse.move(tx, ty);
  await macGlitch(page, kind === 'grid' ? sel : '.week-bin-block', tx, ty);
  if (scenario === 'mac-release') {
    await sleep(16);
    await page.mouse.up();
  } else {
    await sleep(400); // okno łaski minęło bez puszczenia
  }
  if (scenario === 'outside') await page.mouse.up(); // posprzątaj stan Playwrighta
  await sleep(1200); // zapis do localStorage jest odroczony
  const after = await snapshot(page);
  const moved = before !== after;
  if (process.env.DEBUG && moved) {
    const b = new Set(JSON.parse(before));
    const a = new Set(JSON.parse(after));
    console.log('   removed', [...b].filter((x) => !a.has(x)), 'added', [...a].filter((x) => !b.has(x)));
  }
  const expect = scenario === 'mac-release';
  const ok = moved === expect;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${kind} ${scenario}: moved=${moved} (oczekiwane ${expect})`);
  await ctx.close();
}

for (const kind of ['grid', 'bin']) {
  for (const scenario of ['mac-release', 'outside']) await run(kind, scenario);
}
await browser.close();
console.log(failures === 0 ? 'VERDICT: PASS' : `VERDICT: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
