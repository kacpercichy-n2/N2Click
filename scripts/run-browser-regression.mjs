// Deterministic release browser regression runner.
//
// Builds the app for production, serves it with Vite preview on
// http://localhost:5173, runs the five declared release-critical browser
// checks in Chromium and WebKit, then tears the server down. Exits 0 only if
// every (script, engine) pair passed; exits 1 on any failure or setup problem.
//
// Usage:
//   node scripts/run-browser-regression.mjs                 # full matrix (5 scripts x chromium+webkit)
//   node scripts/run-browser-regression.mjs --engine chromium
//   node scripts/run-browser-regression.mjs --engine chromium --engine webkit
//   node scripts/run-browser-regression.mjs --only onboarding
//   node scripts/run-browser-regression.mjs --skip-build    # reuse a prior production build
//
// Clean-install prerequisite: Playwright is intentionally NOT a package.json
// dependency (kept out to keep scheduler installs light), so after `npm ci` it
// is missing. Install its browsers first:
//   npm install --no-save playwright@1.61.1 && npx playwright install chromium webkit
//
// This runner owns its own preview server: it refuses to start if anything is
// already listening on port 5173, and it always kills the server it spawned.

import { spawn } from 'node:child_process';

const BASE = 'http://localhost:5173';
const PORT = 5173;
const PREVIEW_TIMEOUT_MS = 30_000;

// The exact five release-critical checks declared by
// openwiki/n2hub/testing-and-automation.md. The other browser-check-*.mjs
// scripts are deliberately excluded from the release matrix.
const SCRIPTS = [
  { suffix: 'bin-drag', file: 'scripts/browser-check-bin-drag.mjs' },
  { suffix: 'bin-split', file: 'scripts/browser-check-bin-split.mjs' },
  { suffix: 'placement', file: 'scripts/browser-check-placement.mjs' },
  { suffix: 'tab-sync', file: 'scripts/browser-check-tab-sync.mjs' },
  { suffix: 'onboarding', file: 'scripts/browser-check-onboarding.mjs' },
];

const ALL_ENGINES = ['chromium', 'webkit'];
const INSTALL_HINT =
  'npm install --no-save playwright@1.61.1 && npx playwright install chromium webkit';

function parseArgs(argv) {
  const engines = [];
  let only = null;
  let skipBuild = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--engine') {
      const value = (argv[i + 1] || '').toLowerCase();
      i += 1;
      if (!ALL_ENGINES.includes(value)) {
        throw new Error(`--engine must be one of ${ALL_ENGINES.join('|')}, got "${value}"`);
      }
      if (!engines.includes(value)) engines.push(value);
    } else if (arg === '--only') {
      only = (argv[i + 1] || '').toLowerCase();
      i += 1;
    } else if (arg === '--skip-build') {
      skipBuild = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    engines: engines.length ? engines : [...ALL_ENGINES],
    only,
    skipBuild,
  };
}

async function probe(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.status;
  } catch {
    return null;
  }
}

function runToCompletion(command, args, label) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(`[${label}] failed to spawn: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const { engines, only, skipBuild } = parseArgs(process.argv.slice(2));

  const scripts = only ? SCRIPTS.filter((s) => s.suffix === only) : SCRIPTS;
  if (only && scripts.length === 0) {
    console.error(
      `--only "${only}" matched no release script. Known suffixes: ${SCRIPTS.map((s) => s.suffix).join(', ')}`,
    );
    process.exit(1);
  }

  // Prerequisite: Playwright must be importable (browsers installed too).
  try {
    await import('playwright');
  } catch {
    console.error(
      'Playwright is not available. It is intentionally not a package.json dependency.\n' +
        `Install it (and its browsers) before running the release matrix:\n  ${INSTALL_HINT}`,
    );
    process.exit(1);
  }

  // Port guard: the runner must own its own server, never reuse an unknown one.
  const existing = await probe(BASE);
  if (existing !== null) {
    console.error(
      `Something is already responding on ${BASE} (HTTP ${existing}). ` +
        'Stop it first; this runner starts and owns its own preview server.',
    );
    process.exit(1);
  }

  // Build unless explicitly skipped.
  if (!skipBuild) {
    console.log('> building production bundle (npm run build)…');
    const buildCode = await runToCompletion('npm', ['run', 'build'], 'build');
    if (buildCode !== 0) {
      console.error(`Build failed (exit ${buildCode}).`);
      process.exit(buildCode || 1);
    }
  } else {
    console.log('> --skip-build: reusing existing production build.');
  }

  let preview = null;
  let previewKilled = false;
  let previewExited = false;
  let previewExitReason = null;

  const killPreview = () =>
    new Promise((resolve) => {
      if (!preview || previewKilled || previewExited) {
        resolve();
        return;
      }
      previewKilled = true;
      preview.once('exit', () => resolve());
      preview.kill('SIGTERM');
      // Escalate if it refuses to die.
      setTimeout(() => {
        if (!previewExited) preview.kill('SIGKILL');
      }, 5_000);
    });

  const onSignal = (signal) => {
    console.error(`\nReceived ${signal}, tearing down preview server…`);
    killPreview().then(() => process.exit(1));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const results = [];
  try {
    // Serve directly via vite's binary so killing the pid kills Vite (not an
    // npm wrapper that would leave the server orphaned).
    console.log('> starting Vite preview on port 5173…');
    preview = spawn(
      'node',
      ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
      { stdio: 'inherit' },
    );
    preview.on('exit', (code, signal) => {
      previewExited = true;
      if (!previewKilled) {
        previewExitReason = `preview exited early (code ${code}, signal ${signal})`;
      }
    });
    preview.on('error', (error) => {
      previewExited = true;
      previewExitReason = `preview failed to spawn: ${error.message}`;
    });

    // Poll until the preview answers with HTTP 200, or bail on timeout / early exit.
    const deadline = Date.now() + PREVIEW_TIMEOUT_MS;
    let serving = false;
    while (Date.now() < deadline) {
      if (previewExited) {
        console.error(previewExitReason || 'preview exited before serving.');
        await killPreview();
        process.exit(1);
      }
      const status = await probe(BASE);
      if (status === 200) {
        serving = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!serving) {
      console.error(`Preview did not serve HTTP 200 on ${BASE} within ${PREVIEW_TIMEOUT_MS}ms.`);
      await killPreview();
      process.exit(1);
    }
    console.log(`> preview is serving ${BASE}. Running matrix…`);

    // Run every (script, engine) pair sequentially; keep going after failures
    // so the release run reports the whole matrix.
    for (const script of scripts) {
      for (const engine of engines) {
        const label = `${script.suffix} / ${engine}`;
        console.log(`\n=== ${label} ===`);
        const code = await runToCompletion('node', [script.file, engine], label);
        results.push({ script: script.suffix, engine, passed: code === 0 });
      }
    }
  } finally {
    await killPreview();
  }

  // Summary table.
  console.log('\n===== Browser regression summary =====');
  let anyFailed = false;
  for (const { script, engine, passed } of results) {
    if (!passed) anyFailed = true;
    console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${script} / ${engine}`);
  }
  console.log('======================================');

  process.exit(anyFailed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
