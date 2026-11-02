// Real-browser test for the attachments module. Starts its own Vite server on port 5182.
// Run: zsh docs/karta-v2/heavy.sh node src/chat/attachments/attachments.e2e.mjs
import { chromium } from '/Users/kacpercichy/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const port = 5182;
const url = `http://localhost:${port}/src/chat/attachments/attachments.fixture.html`;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_AUTH_MODE: 'local' }, stdio: 'ignore' });
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);
for (let i = 0; ; i++) {
  try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
  if (i > 60) { stop(); throw new Error('Vite did not start'); }
  await new Promise(resolve => setTimeout(resolve, 500));
}
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8a8AAAAASUVORK5CYII=', 'base64');
const png = name => ({ name, mimeType: 'image/png', buffer: bytes });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);

  // Grid: 6 images show 4 thumbnails, the last carries +2; aspect boxes are square for a multi grid.
  const thumbs = page.locator('.attachment-grid').first().locator('.attachment-thumbnail');
  assert.equal(await thumbs.count(), 4);
  assert.equal((await thumbs.nth(3).textContent()).includes('+2'), true);
  const box = await thumbs.nth(0).boundingBox();
  assert.ok(Math.abs(box.width - box.height) < 2, 'multi grid cells are square');

  // Expired signature: the thumbnail signs again once and ends with an image.
  await page.locator('.attachment-grid-single img[src^="data:image/svg"]').waitFor();

  // Lightbox: open from the keyboard, arrows work with focus on the dialog card, Escape returns focus.
  await thumbs.nth(0).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.evaluate(() => document.querySelector('[role=dialog]').focus());
  await page.keyboard.press('ArrowRight');
  await dialog.getByText('2 / 6: Projekt 2').waitFor();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await dialog.getByText('6 / 6: Projekt 6').waitFor();
  assert.ok(await dialog.getByRole('link', { name: 'Pobierz obraz' }).isVisible(), 'download link');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Otwórz Projekt 1'));

  // Queue: retry after a failed first attempt, then remove.
  const input = page.getByLabel('Dodaj obrazy', { exact: true });
  await input.setInputFiles([png('retry.png')]);
  await page.getByRole('button', { name: 'Ponów wysyłanie retry.png' }).click();
  await page.getByTestId('queue-state').filter({ hasText: '1:true:1' }).waitFor();
  await page.getByRole('button', { name: 'Usuń retry.png' }).click();
  await page.getByTestId('queue-state').filter({ hasText: '0:true:0' }).waitFor();

  // Limit: 11 files are rejected as a whole.
  await input.setInputFiles(Array.from({ length: 11 }, (_, i) => png(`${i}.png`)));
  await page.getByRole('status').getByText('Możesz dodać maksymalnie 10 obrazów do wiadomości.').waitFor();
  await page.getByRole('button', { name: 'Wyczyść', exact: true }).click();

  // Paste: a clipboard image named image.png becomes "Zrzut ekranu HH:MM".
  await page.evaluate(async () => {
    const target = document.querySelector('textarea');
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    target.focus();
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.getByRole('button', { name: /^Usuń Zrzut ekranu \d\d:\d\d$/ }).waitFor();
  await page.getByRole('button', { name: 'Wyczyść', exact: true }).click();

  // Drop: dispatch a drop carrying a file on the composer wrapper.
  await page.evaluate(() => {
    const target = document.querySelector('textarea').parentElement;
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1])], 'drop.png', { type: 'image/png' }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await page.getByRole('button', { name: 'Usuń drop.png' }).waitFor();
  await page.getByRole('button', { name: 'Wyczyść', exact: true }).click();

  // Stale upload: changing the conversation drops results that finish later.
  await input.setInputFiles([png('slow.png')]);
  await page.getByRole('button', { name: 'Zmień rozmowę' }).click();
  await page.getByTestId('queue-state').filter({ hasText: '0:true:0' }).waitFor();
  await page.waitForTimeout(250);
  assert.equal(await page.getByTestId('queue-state').textContent(), '0:true:0', 'stale upload ignored');

  assert.deepEqual(errors, []);
  console.log('PASS: grid +n and square cells, expired URL refresh, lightbox keys and focus return, retry, remove, limit, paste, drop, stale upload (390 px, reduced motion).');
} finally { await browser.close(); stop(); }
