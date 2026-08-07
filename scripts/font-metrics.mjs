// Font metric extractor for the optical-centering work (PKG-20260804-optical-centering).
//
// Reads the self-hosted woff2 files that `src/fonts.css` already points at and
// reports, per family/weight, how far the cap-height block sits BELOW the
// centre of the CSS content area. That offset is the whole bug: a flex/grid
// container centres the content area (ascent + descent), not the glyphs.
//
// Pure Node — no dependencies. woff2 is parsed directly (only `head`, `hhea`
// and `OS/2` are needed and none of them are ever transform-compressed;
// `zlib.brotliDecompressSync` handles the container).
//
// Usage:
//   node scripts/font-metrics.mjs                 # table for every declared font
//   node scripts/font-metrics.mjs --css           # also print the @font-face override block
//   node scripts/font-metrics.mjs --json          # machine-readable
//
// Exit code is always 0 — this is a reporting tool, not a gate.

import { readFileSync, existsSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The four families declared as tokens in src/styles.css (--n2-font-*).
// Weight choice mirrors the weights fonts.css actually ships.
const TARGETS = [
  { token: '--n2-font-sans', family: 'Plus Jakarta Sans', pkg: 'plus-jakarta-sans', weights: [400, 500, 600, 700] },
  { token: '--n2-font-data', family: 'Inter', pkg: 'inter', weights: [400, 500, 600, 700] },
  { token: '--n2-font-display', family: 'Orbitron', pkg: 'orbitron', weights: [700] },
  { token: '--n2-font-mono', family: 'Fragment Mono', pkg: 'fragment-mono', weights: [400] },
];

/* ---------------------------------------------------------------- woff2 --- */

// Table tags by known-index, in the order fixed by the WOFF2 spec.
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

function readUIntBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[pos + i];
    if (i === 0 && byte === 0x80) throw new Error('woff2: leading zero in UIntBase128');
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, pos + i + 1];
  }
  throw new Error('woff2: UIntBase128 too long');
}

/** Returns a Map of tag -> Buffer for the tables we care about. */
function readWoff2Tables(file) {
  const buf = readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error(`not a woff2 file: ${file}`);

  const numTables = buf.readUInt16BE(12);
  let pos = 48;
  const dir = [];

  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[pos];
    pos += 1;
    const knownIndex = flags & 0x3f;
    let tag;
    if (knownIndex === 0x3f) {
      tag = buf.toString('latin1', pos, pos + 4);
      pos += 4;
    } else {
      tag = KNOWN_TAGS[knownIndex];
    }
    const transformVersion = (flags >> 6) & 0x03;
    let origLength;
    [origLength, pos] = readUIntBase128(buf, pos);

    // glyf/loca: transformed unless version 3. Everything else: transformed only at version 3.
    const isGlyfOrLoca = tag === 'glyf' || tag === 'loca';
    const hasTransformLength = isGlyfOrLoca ? transformVersion !== 3 : transformVersion === 3;
    let length = origLength;
    if (hasTransformLength) [length, pos] = readUIntBase128(buf, pos);

    dir.push({ tag, length });
  }

  const data = brotliDecompressSync(buf.subarray(pos));
  const tables = new Map();
  let offset = 0;
  for (const { tag, length } of dir) {
    tables.set(tag, data.subarray(offset, offset + length));
    offset += length;
  }
  return tables;
}

function readMetrics(file) {
  const t = readWoff2Tables(file);
  const head = t.get('head');
  const hhea = t.get('hhea');
  const os2 = t.get('OS/2');
  if (!head || !hhea || !os2) throw new Error(`missing metric tables in ${file}`);

  const unitsPerEm = head.readUInt16BE(18);
  const version = os2.readUInt16BE(0);
  return {
    unitsPerEm,
    hheaAscent: hhea.readInt16BE(4),
    hheaDescent: hhea.readInt16BE(6),
    hheaLineGap: hhea.readInt16BE(8),
    typoAscent: os2.readInt16BE(68),
    typoDescent: os2.readInt16BE(70),
    typoLineGap: os2.readInt16BE(72),
    winAscent: os2.readUInt16BE(74),
    winDescent: os2.readUInt16BE(76),
    xHeight: version >= 2 ? os2.readInt16BE(86) : null,
    capHeight: version >= 2 ? os2.readInt16BE(88) : null,
  };
}

/* ------------------------------------------------------------- analysis --- */

function analyse(m) {
  const { unitsPerEm: upm, hheaAscent: asc, hheaDescent: desc, capHeight: cap } = m;
  if (!cap) return null;
  // Content area spans asc..desc around the baseline; the visible uppercase
  // block spans cap..baseline. Centring the former puts the latter this far
  // below the container centre, as a fraction of font-size.
  const offset = (asc + desc - cap) / 2 / upm;
  return {
    capRatio: cap / upm,
    ascRatio: asc / upm,
    descRatio: -desc / upm,
    offset,
    ascentOverride: (cap / upm) * 100,
    // Descender depth actually needed so that g/j/p/y and ą/ę are not clipped.
    descentOverride: (-desc / upm) * 100,
  };
}

function fontFile(pkg, weight) {
  const p = resolve(ROOT, `node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2`);
  return existsSync(p) ? p : null;
}

/* ---------------------------------------------------------------- main ---- */

const asJson = process.argv.includes('--json');
const withCss = process.argv.includes('--css');
const rows = [];

for (const target of TARGETS) {
  for (const weight of target.weights) {
    const file = fontFile(target.pkg, weight);
    if (!file) {
      rows.push({ ...target, weight, error: 'woff2 not found — run npm install' });
      continue;
    }
    try {
      const metrics = readMetrics(file);
      const a = analyse(metrics);
      if (!a) {
        rows.push({ ...target, weight, error: 'OS/2 < v2, no capHeight' });
        continue;
      }
      rows.push({ token: target.token, family: target.family, weight, ...a, metrics });
    } catch (err) {
      rows.push({ ...target, weight, error: err.message });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const px = (ratio, size) => (ratio * size).toFixed(2);

console.log('\nOptical offset per declared font — how far below the container centre');
console.log('the cap-height block lands when a flex/grid box centres it.\n');
console.log(
  'family / weight'.padEnd(28) +
    'cap%'.padStart(7) +
    'offset%'.padStart(9) +
    '@14px'.padStart(8) +
    '@24px'.padStart(8) +
    '@36px'.padStart(8) +
    '  verdict',
);
console.log('-'.repeat(96));

for (const r of rows) {
  const label = `${r.family} ${r.weight}`.padEnd(28);
  if (r.error) {
    console.log(label + `  !! ${r.error}`);
    continue;
  }
  const verdict =
    Math.abs(r.offset) < 0.005
      ? 'symmetric — leave alone'
      : Math.abs(r.offset) < 0.02
        ? 'minor — fix only on large type'
        : 'ASYMMETRIC — needs correction';
  console.log(
    label +
      (r.capRatio * 100).toFixed(1).padStart(7) +
      (r.offset * 100).toFixed(2).padStart(9) +
      px(r.offset, 14).padStart(8) +
      px(r.offset, 24).padStart(8) +
      px(r.offset, 36).padStart(8) +
      '  ' +
      verdict,
  );
}

if (withCss) {
  console.log('\n\n/* ---- generated: paste into src/fonts.css, AFTER the existing @font-face ---- */');
  console.log('/* Trimmed aliases. Use ONLY on single-line optically-centred surfaces  */');
  console.log('/* with an explicit line-height. See PKG-20260804-optical-centering.    */\n');
  const seen = new Set();
  for (const r of rows) {
    if (r.error || Math.abs(r.offset) < 0.005) continue;
    const key = `${r.family}-${r.weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pkg = TARGETS.find((t) => t.family === r.family).pkg;
    console.log(`@font-face {
  font-family: '${r.family} Trimmed';
  font-style: normal;
  font-display: swap;
  font-weight: ${r.weight};
  src: url(../node_modules/@fontsource/${pkg}/files/${pkg}-latin-${r.weight}-normal.woff2) format('woff2');
  ascent-override: ${r.ascentOverride.toFixed(2)}%;
  descent-override: ${r.descentOverride.toFixed(2)}%;
  line-gap-override: 0%;
}`);
  }
  console.log(`
/* NOTE: descent-override keeps the real descender depth on purpose, so the
   box stays cap→descender rather than cap→baseline. That leaves the block
   still ${'{offset}'} off-centre for pure-uppercase text but never clips
   g/j/p/y or ą/ę inside overflow:hidden pills. For uppercase-only surfaces
   (.avatar initials) use descent-override: 0% instead — verified safe there
   because the content is always [A-ZĄĆĘŁŃÓŚŹŻ]{1,2}. */`);
}

console.log('');
