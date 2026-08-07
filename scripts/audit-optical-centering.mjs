// Static audit for PKG-20260804-optical-centering.
//
// Produces the work list: every `src/styles.css` rule that optically centres
// a single line of text or an icon, plus the manual compensations that were
// added over the years to hide the half-leading offset.
//
// It is a heuristic reporter, not a gate — read the output, do not trust it
// blindly. Every finding carries the line number so you can open the rule.
//
// Usage:
//   node scripts/audit-optical-centering.mjs
//   node scripts/audit-optical-centering.mjs --json
//   node scripts/audit-optical-centering.mjs --only centred   # centred|padding|nudge|svg|icons

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = resolve(ROOT, 'src/styles.css');

const asJson = process.argv.includes('--json');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx === -1 ? null : process.argv[onlyIdx + 1];

/* ------------------------------------------------------------ css parse --- */

/** Flat list of top-level-ish rules: { selector, body, startLine, endLine }. */
function parseRules(source) {
  const rules = [];
  let depth = 0;
  let buf = '';
  let selectorStart = 0;
  let pendingSelector = '';
  let line = 1;
  let bodyStart = 0;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\n') line += 1;

    if (ch === '{') {
      depth += 1;
      if (depth === 1) {
        pendingSelector = buf.trim();
        selectorStart = line;
        bodyStart = i + 1;
        buf = '';
        continue;
      }
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        // Skip at-rule wrappers (@media, @supports) by re-parsing their inside.
        if (pendingSelector.startsWith('@')) {
          const inner = source.slice(bodyStart, i);
          for (const r of parseRules(inner)) {
            rules.push({ ...r, selector: r.selector, startLine: r.startLine + selectorStart - 1, nested: pendingSelector });
          }
        } else {
          rules.push({
            selector: pendingSelector.replace(/\s+/g, ' '),
            body: source.slice(bodyStart, i),
            startLine: selectorStart,
            endLine: line,
          });
        }
        buf = '';
        pendingSelector = '';
        continue;
      }
    }
    if (depth === 0) buf += ch;
  }
  return rules;
}

const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;}]+)`, 'i'));
  return m ? m[1].trim() : null;
};

/* -------------------------------------------------------------- finders --- */

// Comments are blanked (not removed) so line numbers stay true to the file.
const source = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) =>
  m.replace(/[^\n]/g, ' '),
);
const rules = parseRules(source);
const findings = { centred: [], padding: [], nudge: [], svg: [], icons: [] };

for (const rule of rules) {
  const b = rule.body;
  const display = decl(b, 'display') || '';
  const align = decl(b, 'align-items') || '';
  const place = decl(b, 'place-items') || '';
  const justify = decl(b, 'justify-content') || '';
  const height = decl(b, 'height');
  const width = decl(b, 'width');
  const radius = decl(b, 'border-radius') || '';
  const lineHeight = decl(b, 'line-height');
  const padding = decl(b, 'padding');
  const transform = decl(b, 'transform') || '';
  const isFlexish = /flex|grid/.test(display);
  const isCentred = /center/.test(align) || /center/.test(place);

  // 1. Optically-centred boxes — the surfaces that need the fix.
  // A round box counts even without a CSS size: several components (Avatar,
  // Coin) take their width/height from an inline style prop in the .tsx.
  const circularHere = /50%|9999px|var\(--n2-radius-pill\)/.test(radius);
  if (isFlexish && isCentred && (height || width || circularHere)) {
    const circular = circularHere;
    findings.centred.push({
      selector: rule.selector,
      line: rule.startLine,
      display,
      size: [width, height].filter(Boolean).join(' × '),
      circular,
      lineHeight,
      hasExplicitLineHeight: Boolean(lineHeight),
      justify: justify || null,
    });
  }

  // 2. Asymmetric vertical padding — usually a hand-rolled compensation.
  if (padding) {
    const parts = padding.split(/\s+/).filter(Boolean);
    let top = null;
    let bottom = null;
    if (parts.length === 3) [top, , bottom] = parts;
    if (parts.length === 4) [top, , bottom] = parts;
    if (top && bottom && top !== bottom) {
      findings.padding.push({ selector: rule.selector, line: rule.startLine, padding, top, bottom });
    }
  }

  // 3. Sub-pixel translate nudges that are NOT hover/press affordances.
  const nudge = transform.match(/translateY\((-?[0-3](?:\.\d+)?)px\)/);
  if (nudge) {
    const interactive = /:hover|:active|:focus|:checked|\[data-state/.test(rule.selector);
    if (!interactive) {
      findings.nudge.push({ selector: rule.selector, line: rule.startLine, transform, px: Number(nudge[1]) });
    }
  }

  // 4. svg rules — confirm display:block is present where it matters.
  if (/\bsvg\b/.test(rule.selector)) {
    findings.svg.push({
      selector: rule.selector,
      line: rule.startLine,
      display: display || null,
      ok: display === 'block',
    });
  }
}

/* ------------------------------------------- lucide icons with asymmetry --- */

// Glyphs whose ink centroid is measurably off their viewBox centre. Lucide
// draws on a 24×24 grid with a 2px stroke and does NOT pre-compensate, unlike
// Material. These are the only ones worth a manual offset — everything else in
// the set is symmetric enough that a nudge would be noise.
const ASYMMETRIC = ['Play', 'SkipForward', 'SkipBack', 'FastForward', 'Rewind', 'Send', 'Navigation', 'LocateFixed'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

for (const file of walk(resolve(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('lucide-react')) continue;
  const lines = text.split('\n');
  lines.forEach((lineText, i) => {
    for (const icon of ASYMMETRIC) {
      if (new RegExp(`<${icon}\\b`).test(lineText)) {
        findings.icons.push({ file: relative(ROOT, file), line: i + 1, icon, code: lineText.trim().slice(0, 90) });
      }
    }
  });
}

/* --------------------------------------------------------------- report --- */

if (asJson) {
  console.log(JSON.stringify(findings, null, 2));
  process.exit(0);
}

const section = (key, title, render) => {
  if (only && only !== key) return;
  const list = findings[key];
  console.log(`\n\n=== ${title} — ${list.length} ===\n`);
  if (!list.length) {
    console.log('  (nothing)');
    return;
  }
  list.forEach(render);
};

section('centred', 'Optically centred boxes (candidates for the text-box fix)', (f) => {
  const flag = f.circular ? 'circle/pill' : 'box';
  const lh = f.hasExplicitLineHeight ? `line-height:${f.lineHeight}` : 'line-height:INHERITED ← check';
  console.log(`  styles.css:${String(f.line).padEnd(6)} ${f.selector}`);
  console.log(`  ${''.padEnd(6)}      ${flag}, ${f.size || 'auto'}, ${lh}`);
});

section('padding', 'Asymmetric vertical padding (possible hand-rolled compensation)', (f) => {
  console.log(`  styles.css:${String(f.line).padEnd(6)} ${f.selector}`);
  console.log(`  ${''.padEnd(6)}      padding: ${f.padding}   (top ${f.top} vs bottom ${f.bottom})`);
});

section('nudge', 'Non-interactive translateY nudges', (f) => {
  console.log(`  styles.css:${String(f.line).padEnd(6)} ${f.selector}  →  ${f.transform}`);
});

section('svg', 'svg rules — display:block present?', (f) => {
  console.log(`  ${f.ok ? 'ok  ' : 'MISS'} styles.css:${String(f.line).padEnd(6)} ${f.selector}  (display: ${f.display ?? 'not set'})`);
});

section('icons', 'lucide icons with an off-centre ink centroid', (f) => {
  console.log(`  ${f.file}:${f.line}  <${f.icon}>`);
  console.log(`  ${''.padEnd(String(f.line).length)}    ${f.code}`);
});

console.log(`

Summary
  centred boxes to fix : ${findings.centred.length}  (of which ${findings.centred.filter((f) => f.circular).length} circular/pill)
  asymmetric padding   : ${findings.padding.length}
  stray nudges         : ${findings.nudge.length}
  svg rules missing    : ${findings.svg.filter((f) => !f.ok).length} of ${findings.svg.length}
  asymmetric icons     : ${findings.icons.length}
`);
