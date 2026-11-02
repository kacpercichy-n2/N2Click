// Shared Playwright + base-URL resolution for scripts/browser-check-*.mjs.
//
// Playwright is not a package.json dependency. Resolution order:
//   1. `import('playwright')` (after `npm install --no-save playwright@1.61.1`)
//   2. $PLAYWRIGHT_MODULE (path to playwright/index.mjs)
//   3. the machine-local npx cache copy (FALLBACK_MODULE below)
// When the fallback copy is used, no Playwright-managed Chromium is assumed, so
// Chromium launches with the installed Google Chrome (channel 'chrome'). Force
// or disable that with BROWSER_CHECK_CHANNEL ('' = Playwright's own Chromium).
//
// Base URL: http://localhost:5173 unless $BROWSER_CHECK_BASE is set (use it to
// run a check against a dev server on another port, e.g. a parallel worktree).
const FALLBACK_MODULE =
  '/Users/kacpercichy/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

let pw;
let usedFallback = false;
try {
  pw = await import('playwright');
} catch {
  pw = await import(process.env.PLAYWRIGHT_MODULE || FALLBACK_MODULE);
  usedFallback = true;
}

export const chromium = pw.chromium;
export const webkit = pw.webkit;
export const BASE = process.env.BROWSER_CHECK_BASE || 'http://localhost:5173';

export function launchOptions(launcher) {
  const options = { headless: true };
  if (launcher === chromium) {
    const channel = process.env.BROWSER_CHECK_CHANNEL ?? (usedFallback ? 'chrome' : '');
    if (channel) options.channel = channel;
  }
  return options;
}
