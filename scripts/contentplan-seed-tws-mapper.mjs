// Mapper jednorazowego importu content planu Tetra Wave Solutions (faza R6).
//
// CZYSTY moduł: zero I/O (żadnego `fs`, `process`, żadnej ścieżki), zero
// `Date.now()` i `Math.random()`. Wejście to surowe dane appki-plannera
// (`planner/src/data/tws.js` + `meta.js` + `posts.js`), wyjście to wiersze
// `contentplan.brands` / `contentplan.posts` / `contentplan.post_channels`
// i wyrenderowany SQL. Warstwą I/O jest `scripts/contentplan-seed-tws.mjs`.
//
// DETERMINIZM: identyczne wejście => bajt w bajt identyczne wyjście. Klucze
// główne to UUID v5 (SHA-1) liczone z nazw źródłowych w stałej przestrzeni
// nazw, więc ponowne uruchomienie skryptu daje te same identyfikatory,
// a migracja pozostaje idempotentna (`on conflict (id) do nothing`).

import { createHash } from 'node:crypto';

// ---- UUID v5 (RFC 4122, SHA-1) ---------------------------------------------

/** Standardowa przestrzeń nazw URL z RFC 4122 — punkt zaczepienia poniższej. */
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToUuid(bytes) {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** UUID v5 z nazwy w podanej przestrzeni nazw (domyślnie {@link URL_NAMESPACE}). */
export function uuidV5(name, namespace = URL_NAMESPACE) {
  const digest = createHash('sha1')
    .update(Buffer.concat([Buffer.from(uuidToBytes(namespace)), Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = new Uint8Array(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // wersja 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // wariant RFC 4122
  return bytesToUuid(bytes);
}

/** Przestrzeń nazw importu — wyliczana, nie losowana, więc jest częścią kodu. */
export const TWS_IMPORT_NAMESPACE = uuidV5('n2hub.contentplan.import.tws');

/** Id wiersza `contentplan.brands` dla marki o danym kluczu źródłowym. */
export function brandUuid(clientKey) {
  return uuidV5(`brand:${clientKey}`, TWS_IMPORT_NAMESPACE);
}

/** Id wiersza `contentplan.posts` dla posta o danym id źródłowym. */
export function postUuid(sourceId) {
  return uuidV5(`post:${sourceId}`, TWS_IMPORT_NAMESPACE);
}

/** Id wiersza `contentplan.post_channels` dla pary (post źródłowy, platforma). */
export function channelUuid(sourceId, platformId) {
  return uuidV5(`channel:${sourceId}:${platformId}`, TWS_IMPORT_NAMESPACE);
}

// ---- Statusy ---------------------------------------------------------------
//
// TABELA MAPOWANIA STATUSÓW — dwa kroki, bo arkusz i planner mówią innym
// językiem niż moduł.
//
// KROK 1: surowa komórka STATUS z arkusza „Content plan - TWS.xlsx" -> klucz
// statusu plannera. Arkusz niesie tylko dwie wartości (potwierdzone nagłówkiem
// `tws.js`), obie z emoji i podwójną spacją — porównujemy po normalizacji
// (bez emoji, jedna spacja, wielkie litery).
//
//   '📤  OPUBLIKOWANO'              -> 'opublikowany'
//   '⌛  ZAPLANOWANE DO PUBLIKACJI'  -> 'zaplanowany'
//
// KROK 2: klucz plannera (`meta.js` STATUSES, 7 pozycji workflow agencji) ->
// kanoniczny status modułu (`src/contentplan/domain.ts`, 7 pozycji):
//
//   szkic           (krok 1) -> 'W trakcie tworzenia'
//   w-produkcji     (krok 2) -> 'W trakcie tworzenia'
//   do-akceptacji   (krok 3) -> 'Do akceptacji'
//   poprawki        (krok 4) -> 'Wdrażane poprawki'
//   zaakceptowany   (krok 5) -> 'Akceptacja'
//   zaplanowany     (krok 6) -> 'Zaplanowane'
//   opublikowany    (krok 7) -> 'Opublikowano'
//
// Odwzorowanie NIE jest bijekcją i taki jest zamysł: 'szkic' i 'w-produkcji'
// zlewają się w jeden status produkcyjny modułu, a modułowe 'Uwagi' (uwagi
// zgłoszone przez klienta w portalu) nie ma odpowiednika po stronie arkusza —
// żaden import nie może go ustawić.
export const SHEET_STATUS_TO_PLANNER = {
  OPUBLIKOWANO: 'opublikowany',
  'ZAPLANOWANE DO PUBLIKACJI': 'zaplanowany',
};

export const PLANNER_STATUS_TO_MODULE = {
  szkic: 'W trakcie tworzenia',
  'w-produkcji': 'W trakcie tworzenia',
  'do-akceptacji': 'Do akceptacji',
  poprawki: 'Wdrażane poprawki',
  zaakceptowany: 'Akceptacja',
  zaplanowany: 'Zaplanowane',
  opublikowany: 'Opublikowano',
};

/** Status modułu, gdy nic nie da się odczytać (parytet z DEFAULT_CONTENT_PLAN_STATUS). */
export const FALLBACK_MODULE_STATUS = 'W trakcie tworzenia';

/**
 * Od tego kroku workflow publikacja jest uzgodniona z klientem, więc wchodzi do
 * modułu jako `visibility='published'` (kroki 5-7: zaakceptowany, zaplanowany,
 * opublikowany). Kroki 1-4 to praca w toku => 'draft'. Semantyka `visibility`
 * z `domain.ts`: 'published' widzi także rola `client` w portalu, więc próg
 * musi stać dokładnie na akceptacji, nie wcześniej.
 */
export const PUBLISHED_FROM_STEP = 5;

/** Tytuł roboczy z `domain.ts` — publikacja z takim tytułem nie przechodzi walidacji. */
const DEFAULT_POST_TITLE = 'Nowa publikacja';

/** Komórka arkusza bez emoji i nadmiarowych spacji, wielkimi literami. */
function normalizeSheetStatus(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pl-PL');
}

/** Klucz plannera z komórki arkusza (`''` gdy nieznana). */
export function plannerStatusFromSheet(value) {
  return SHEET_STATUS_TO_PLANNER[normalizeSheetStatus(value)] ?? '';
}

/**
 * Klucz statusu plannera dla posta. Źródłem prawdy są komórki arkusza
 * (`sheetStatuses` — po jednej na slot scalonej kreacji); zgodnie z regułą
 * merge z nagłówka `tws.js` wygrywa NAJMNIEJ zaawansowany krok. Gdy arkusz nic
 * nie mówi, spadamy na `sheetStatus`, a na końcu na gotowy `status` posta.
 */
export function plannerStatusOf(post, statuses) {
  const stepOf = (key) => statuses[key]?.step ?? Number.MAX_SAFE_INTEGER;
  const fromSlots = (Array.isArray(post.sheetStatuses) ? post.sheetStatuses : [])
    .map((cell) => plannerStatusFromSheet(cell))
    .filter((key) => key !== '');
  if (fromSlots.length > 0) {
    return fromSlots.reduce((least, key) => (stepOf(key) < stepOf(least) ? key : least));
  }
  const fromCell = plannerStatusFromSheet(post.sheetStatus);
  if (fromCell !== '') return fromCell;
  return typeof post.status === 'string' && post.status in PLANNER_STATUS_TO_MODULE
    ? post.status
    : '';
}

// ---- Media -----------------------------------------------------------------

/**
 * Media kanału: WYŁĄCZNIE referencja do pliku na Dysku Google.
 * `media.fileId` to identyfikator kadru wskazanego w arkuszu (dla rolek jest to
 * MINIATURA — arkusz nie trzyma pliku mp4 w kolumnie MINIATURA, a schemat R1 ma
 * jedno gniazdo mediów), a `media_type` bierze się z `media.kind` LUB z
 * obecności `videoFile` (slot oznaczony jako rolka jest wideo nawet wtedy, gdy
 * miniatura jest obrazem).
 */
function mediaOf(post) {
  const media = post.media ?? {};
  const fileId = typeof media.fileId === 'string' ? media.fileId.trim() : '';
  if (media.source !== 'gdrive' || fileId === '') {
    return { mediaSource: null, mediaFileId: null, mediaType: null };
  }
  const isVideo = media.kind === 'video' || (typeof post.videoFile === 'string' && post.videoFile.trim() !== '');
  return { mediaSource: 'gdrive', mediaFileId: fileId, mediaType: isVideo ? 'video' : 'image' };
}

// ---- Kanały i grupy opisów -------------------------------------------------

/**
 * Treść kanału: wariant dedykowany platformie (`variants[platform]`) ma
 * pierwszeństwo nad wspólnym `copy` posta.
 */
function copyForPlatform(post, platformId) {
  const variant = post.variants?.[platformId];
  if (typeof variant === 'string' && variant.trim() !== '') return variant;
  return typeof post.copy === 'string' ? post.copy : '';
}

/**
 * Grupy opisów wg semantyki `domain.ts`: kanały dzielące jedną treść należą do
 * jednej grupy, a BRAK `description_group_id` (NULL) ≡ grupa główna 'main'
 * (`canonicalGroupId` w domenie zamienia 'main' na brak klucza). Dzięki temu
 * post bez wariantów hydruje się jako jeden wspólny opis dla wszystkich
 * platform — dokładnie tak, jak post utworzony w module.
 *
 * Grupą główną jest ta, która niesie wspólne `copy` posta; gdy każdy kanał ma
 * wariant, główną zostaje pierwsza grupa w kolejności platform arkusza.
 * Pozostałe dostają stabilne `wariant-<pierwsza platforma grupy>`.
 */
function descriptionGroups(post, platformIds) {
  const byCopy = new Map();
  for (const platformId of platformIds) {
    const copy = copyForPlatform(post, platformId);
    const bucket = byCopy.get(copy);
    if (bucket) bucket.push(platformId);
    else byCopy.set(copy, [platformId]);
  }
  const groups = [...byCopy.entries()].map(([copy, members]) => ({ copy, members }));
  const mainIndex = Math.max(
    0,
    groups.findIndex((group) => group.copy === post.copy),
  );
  const groupOf = new Map();
  groups.forEach((group, index) => {
    const id = index === mainIndex ? null : `wariant-${group.members[0]}`;
    for (const platformId of group.members) groupOf.set(platformId, { id, copy: group.copy });
  });
  return groupOf;
}

// ---- Marka -----------------------------------------------------------------

/** Unikalne wartości w kolejności pierwszego wystąpienia. */
function uniqueInOrder(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || value.trim() === '' || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Słowniki marki wyprowadzone WYŁĄCZNIE z danych źródłowych:
 * - `platforms` — platformy realnie użyte w postach, w kanonicznej kolejności
 *   słownika `meta.PLATFORMS` (nazwa i kolor stamtąd),
 * - `topics` — kolumna TEMAT w kolejności pierwszego wystąpienia,
 * - `formats` — kolumna RODZAJ jako etykiety `meta.CONTENT_TYPES`.
 * `industry` zostaje puste (arkusz ani `posts.js` nie niosą branży — nic tu nie
 * zgadujemy), `contact` to handle klienta, `accent` to jego kolor.
 */
function buildBrand(posts, client, clientKey, meta) {
  const used = new Set(posts.flatMap((post) => post.platforms ?? []));
  const platforms = Object.keys(meta.platforms)
    .filter((id) => used.has(id))
    .map((id) => ({ id, name: meta.platforms[id].name, color: meta.platforms[id].color ?? '' }));
  const topics = uniqueInOrder(posts.map((post) => post.topic));
  const usedFormats = new Set(posts.map((post) => post.contentType));
  const formats = Object.keys(meta.contentTypes)
    .filter((id) => usedFormats.has(id))
    .map((id) => meta.contentTypes[id].name);
  return {
    id: brandUuid(clientKey),
    name: client.name,
    industry: '',
    contact: typeof client.handle === 'string' && client.handle !== '' ? `@${client.handle}` : '',
    accent: typeof client.color === 'string' ? client.color : '',
    platforms,
    topics,
    formats,
    // Powiązanie z klientem N2Click zostaje NIEUSTAWIONE: import nie ma dostępu
    // do bazy, a zgadywanie UUID-a wiersza `n2click.clients` byłoby wymyślaniem
    // danych. Operator podepnie markę do klienta z poziomu UI.
    n2clickClientId: null,
  };
}

// ---- Mapowanie całego wsadu ------------------------------------------------

/**
 * Model plannera -> model Content Planu.
 *
 * @param {object} input
 * @param {Array} input.posts     — `TWS_POSTS` (posty już scalone per kreacja).
 * @param {object} input.client   — wpis `CLIENTS[clientKey]` z `posts.js`.
 * @param {string} input.clientKey— klucz klienta (część nazwy UUID-a marki).
 * @param {object} input.meta     — `{ platforms, statuses, contentTypes }` z `meta.js`.
 * @returns {{brand: object, posts: Array, channels: Array}}
 */
export function mapTwsSeed({ posts, client, clientKey, meta }) {
  const brand = buildBrand(posts, client, clientKey, meta);
  const rows = [];
  const channels = [];

  for (const post of posts) {
    const platformIds = uniqueInOrder(post.platforms ?? []);
    const groupOf = descriptionGroups(post, platformIds);
    const media = mediaOf(post);
    const plannerStatus = plannerStatusOf(post, meta.statuses);
    const status = PLANNER_STATUS_TO_MODULE[plannerStatus] ?? FALLBACK_MODULE_STATUS;
    const step = meta.statuses[plannerStatus]?.step ?? 0;

    const postChannels = platformIds.map((platformId) => {
      const group = groupOf.get(platformId);
      return {
        id: channelUuid(post.id, platformId),
        postId: postUuid(post.id),
        platformId,
        copy: group.copy,
        // Arkusz nie prowadzi tagów per platforma — cały zestaw hashtagów żyje
        // na poście (`base_tags`), a kanał go dziedziczy (`override_tags` false,
        // `tags` puste; patrz `groupTags` w domain.ts).
        tags: [],
        overrideTags: false,
        descriptionGroupId: group.id,
        ...media,
        mediaWidth: null,
        mediaHeight: null,
      };
    });

    const title = typeof post.title === 'string' ? post.title.trim() : '';
    // Bramka udostępnienia z `validatePostForPublication` (domain.ts): bez
    // tytułu, bez kanału albo bez ani jednego opisu publikacja nie ma prawa
    // wejść jako 'published' — inaczej reduktor odrzuciłby jej zapis.
    const publishable =
      title !== '' &&
      title !== DEFAULT_POST_TITLE &&
      postChannels.length > 0 &&
      postChannels.some((channel) => channel.copy.trim() !== '');

    rows.push({
      id: postUuid(post.id),
      sourceId: post.id,
      brandId: brand.id,
      date: post.date,
      title,
      topic: typeof post.topic === 'string' ? post.topic : '',
      format: meta.contentTypes[post.contentType]?.name ?? String(post.contentType ?? ''),
      status,
      visibility: step >= PUBLISHED_FROM_STEP && publishable ? 'published' : 'draft',
      baseTags: Array.isArray(post.hashtags) ? post.hashtags.filter((tag) => typeof tag === 'string') : [],
    });
    channels.push(...postChannels);
  }

  return { brand, posts: rows, channels };
}

// ---- Renderowanie SQL ------------------------------------------------------

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNullableText(value) {
  return value === null || value === undefined ? 'null' : sqlText(value);
}

function sqlTextArray(values) {
  if (values.length === 0) return `'{}'::text[]`;
  return `array[${values.map((value) => sqlText(value)).join(', ')}]::text[]`;
}

function sqlJsonb(value) {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

const BANNER = `-- =============================================================================
-- Migracja: 20260803170000_contentplan_seed_tws
--
-- Moduł Content Plan (faza R6): JEDNORAZOWY import realnego content planu marki
-- Tetra Wave Solutions (lipiec i sierpień 2026) z appki-plannera
-- („Content plan/planner/src/data/tws.js" — dane przeniesione 1:1 z arkusza
-- „Content plan - TWS.xlsx"). Plik jest WYGENEROWANY przez
-- \`scripts/contentplan-seed-tws.mjs\` — nie edytuj go ręcznie, zmień mapper
-- (\`scripts/contentplan-seed-tws-mapper.mjs\`) i wygeneruj plik ponownie.
--
-- ZERO zmian schematu: same wiersze do tabel z 20260803160000. Klucze główne to
-- UUID v5 liczone z identyfikatorów źródłowych, więc wygenerowany SQL jest
-- deterministyczny (te same id przy każdym uruchomieniu).
--
-- \`on conflict (id) do nothing\` (a NIE \`do update\`): to seed danych
-- historycznych, a nie źródło prawdy. Po imporcie treści żyją w module i bywają
-- redagowane przez zespół — ponowne wykonanie migracji nie może cofnąć tych
-- zmian. Wiersz brakujący zostanie dołożony, wiersz istniejący zostaje nietknięty.
--
-- Mapowanie statusów arkusz -> planner -> moduł oraz progi \`visibility\`
-- opisuje tabela w nagłówku mappera (sekcja „TABELA MAPOWANIA STATUSÓW").
-- \`n2click_client_id\` zostaje NULL — import nie zgaduje identyfikatorów
-- klientów N2Click, markę podpina operator z poziomu UI.
-- =============================================================================`;

/** Wyrenderowany, gotowy do zapisania plik migracji (kończy się nową linią). */
export function renderSeedSql({ brand, posts, channels }) {
  const lines = [BANNER, ''];

  lines.push('-- Marka wraz ze słownikami wyprowadzonymi z danych źródłowych.');
  lines.push(
    'insert into contentplan.brands',
    '  (id, name, industry, contact, accent, platforms, topics, formats, n2click_client_id)',
    'values',
    `  (${sqlText(brand.id)},`,
    `   ${sqlText(brand.name)},`,
    `   ${sqlText(brand.industry)},`,
    `   ${sqlText(brand.contact)},`,
    `   ${sqlText(brand.accent)},`,
    `   ${sqlJsonb(brand.platforms)},`,
    `   ${sqlTextArray(brand.topics)},`,
    `   ${sqlTextArray(brand.formats)},`,
    `   ${sqlNullableText(brand.n2clickClientId)})`,
    'on conflict (id) do nothing;',
    '',
  );

  lines.push(`-- Publikacje (${posts.length}) — jeden wiersz na kreację arkusza.`);
  lines.push(
    'insert into contentplan.posts',
    '  (id, brand_id, date, title, topic, format, status, visibility, base_tags)',
    'values',
  );
  posts.forEach((post, index) => {
    const suffix = index === posts.length - 1 ? '' : ',';
    lines.push(
      `  -- ${post.sourceId}`,
      `  (${sqlText(post.id)},`,
      `   ${sqlText(post.brandId)},`,
      `   ${sqlText(post.date)},`,
      `   ${sqlText(post.title)},`,
      `   ${sqlText(post.topic)},`,
      `   ${sqlText(post.format)},`,
      `   ${sqlText(post.status)},`,
      `   ${sqlText(post.visibility)},`,
      `   ${sqlTextArray(post.baseTags)})${suffix}`,
    );
  });
  lines.push('on conflict (id) do nothing;', '');

  lines.push(
    `-- Kanały (${channels.length}) — jeden wiersz na parę (publikacja, platforma).`,
    '-- NULL w `description_group_id` ≡ grupa główna opisu (patrz domain.ts).',
  );
  lines.push(
    'insert into contentplan.post_channels',
    '  (id, post_id, platform_id, copy, tags, override_tags, description_group_id,',
    '   media_source, media_file_id, media_width, media_height, media_type)',
    'values',
  );
  channels.forEach((channel, index) => {
    const suffix = index === channels.length - 1 ? '' : ',';
    lines.push(
      `  (${sqlText(channel.id)},`,
      `   ${sqlText(channel.postId)},`,
      `   ${sqlText(channel.platformId)},`,
      `   ${sqlText(channel.copy)},`,
      `   ${sqlTextArray(channel.tags)},`,
      `   ${channel.overrideTags ? 'true' : 'false'},`,
      `   ${sqlNullableText(channel.descriptionGroupId)},`,
      `   ${sqlNullableText(channel.mediaSource)},`,
      `   ${sqlNullableText(channel.mediaFileId)},`,
      `   ${channel.mediaWidth === null ? 'null' : channel.mediaWidth},`,
      `   ${channel.mediaHeight === null ? 'null' : channel.mediaHeight},`,
      `   ${sqlNullableText(channel.mediaType)})${suffix}`,
    );
  });
  lines.push('on conflict (id) do nothing;');

  return `${lines.join('\n')}\n`;
}
