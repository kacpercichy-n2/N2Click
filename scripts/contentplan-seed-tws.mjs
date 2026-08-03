#!/usr/bin/env node
// Jednorazowy import content planu Tetra Wave Solutions do modułu Content Plan.
//
// CIENKA warstwa I/O wokół czystego mappera
// (`scripts/contentplan-seed-tws-mapper.mjs`): wczytuje dane appki-plannera,
// woła mapper i zapisuje plik migracji. ŻADNEGO kontaktu z bazą — skrypt nie
// otwiera połączenia, nie woła CLI Supabase i niczego nie aplikuje. Migrację
// wykonuje operator ręcznie po review.
//
// Użycie:
//   node scripts/contentplan-seed-tws.mjs
//   node scripts/contentplan-seed-tws.mjs "/inna/sciezka/planner/src/data"
//
// Wynik jest DETERMINISTYCZNY: dwa uruchomienia na tych samych danych dają plik
// bajt w bajt identyczny (id to UUID v5 z nazw źródłowych, w treści nie ma ani
// jednego znacznika czasu generowania). Skrypt można więc puścić ponownie po
// zmianie mappera i porównać wynik zwykłym `diff`.

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mapTwsSeed, renderSeedSql } from './contentplan-seed-tws-mapper.mjs';

/** Katalog `data` appki-plannera (poza tym repo; ścieżka zawiera spację). */
const DEFAULT_DATA_DIR =
  '/Users/kacpercichyn2/Documents/AI/N2Media/Content plan/planner/src/data';

/** Klucz marki w `CLIENTS` appki źródłowej. */
const CLIENT_KEY = 'tetrawave';

/** Nazwa pliku migracji ze STAŁYM literałem czasu (po 20260803160300 z fazy R1). */
const MIGRATION_NAME = '20260803170000_contentplan_seed_tws.sql';

async function main() {
  const dataDir = process.argv[2] ?? DEFAULT_DATA_DIR;
  const load = (file) => import(pathToFileURL(resolve(dataDir, file)).href);

  // `posts.js` sięga przy imporcie po `localStorage` (własny try/catch), więc
  // w node po prostu nie dokłada klientów lokalnych — czytamy sam słownik.
  const [{ TWS_POSTS }, meta, { CLIENTS }] = await Promise.all([
    load('tws.js'),
    load('meta.js'),
    load('posts.js'),
  ]);

  const client = CLIENTS[CLIENT_KEY];
  if (!client) throw new Error(`Brak klienta '${CLIENT_KEY}' w CLIENTS (${dataDir}/posts.js)`);
  if (!Array.isArray(TWS_POSTS) || TWS_POSTS.length === 0) {
    throw new Error(`Puste TWS_POSTS w ${dataDir}/tws.js`);
  }

  const seed = mapTwsSeed({
    posts: TWS_POSTS,
    client,
    clientKey: CLIENT_KEY,
    meta: {
      platforms: meta.PLATFORMS,
      statuses: meta.STATUSES,
      contentTypes: meta.CONTENT_TYPES,
    },
  });

  const target = resolve(
    fileURLToPath(new URL('../supabase/migrations/', import.meta.url)),
    MIGRATION_NAME,
  );
  writeFileSync(target, renderSeedSql(seed), 'utf8');

  // Kontrola zdrowia wsadu na stdout (NIE trafia do pliku migracji).
  const published = seed.posts.filter((post) => post.visibility === 'published').length;
  const withMedia = seed.channels.filter((channel) => channel.mediaFileId !== null).length;
  const statusCounts = seed.posts.reduce((acc, post) => {
    acc[post.status] = (acc[post.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`Zapisano: supabase/migrations/${MIGRATION_NAME}`);
  console.log(`Marki: 1 (${seed.brand.name}, platformy: ${seed.brand.platforms.length})`);
  console.log(`Publikacje: ${seed.posts.length} (published: ${published}, draft: ${seed.posts.length - published})`);
  console.log(`Kanały: ${seed.channels.length} (z mediami: ${withMedia})`);
  console.log(`Statusy: ${JSON.stringify(statusCounts)}`);
}

await main();
