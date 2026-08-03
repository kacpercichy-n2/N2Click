// Mapper jednorazowego importu content planu Tetra Wave Solutions (faza R6).
//
// Test jest HERMETYCZNY: fixture'y są WBUDOWANE poniżej (skopiowane z
// „Content plan/planner/src/data/tws.js" i „meta.js"), więc nic tu nie czyta
// ścieżki spoza repo i test przechodzi na czystej maszynie CI.
//
// UWAGA o polu `variants`: nagłówek `tws.js` dokumentuje je jako wariant opisu
// per platforma, ale ŻADEN z 23 realnych postów TWS go nie ma (arkusz prowadził
// jedną treść dla wszystkich platform kreacji). Fixture `POST_Z_WARIANTAMI` to
// realny post 'tws-0713-1' UZUPEŁNIONY o `variants` w udokumentowanym kształcie
// — inaczej ta gałąź mappera nie miałaby pokrycia.
//
// Mapper mieszka w `scripts/` (uruchamia go node bez kroku budowania), a typy
// bierze z sąsiedniego `.d.mts` — patrz komentarz w tamtym pliku.
import { describe, expect, it } from 'vitest';

import {
  PLANNER_STATUS_TO_MODULE,
  PUBLISHED_FROM_STEP,
  mapTwsSeed,
  plannerStatusFromSheet,
  renderSeedSql,
  type TwsSeedMeta,
} from '../../scripts/contentplan-seed-tws-mapper.mjs';

// ---- Fixture'y słowników (`planner/src/data/meta.js`) ----------------------

const META: TwsSeedMeta = {
  platforms: {
    facebook: { name: 'Facebook', color: '#1877F2' },
    instagram: { name: 'Instagram', color: '#E4405F' },
    tiktok: { name: 'TikTok', color: '#00F2EA' },
    linkedin: { name: 'LinkedIn', color: '#0A66C2' },
    youtube: { name: 'YouTube', color: '#FF0000' },
    x: { name: 'X', color: '#111111' },
  },
  statuses: {
    szkic: { step: 1 },
    'w-produkcji': { step: 2 },
    'do-akceptacji': { step: 3 },
    poprawki: { step: 4 },
    zaakceptowany: { step: 5 },
    zaplanowany: { step: 6 },
    opublikowany: { step: 7 },
  },
  contentTypes: {
    post: { name: 'Post' },
    karuzela: { name: 'Karuzela' },
    reel: { name: 'Reel' },
    story: { name: 'Story' },
    video: { name: 'Wideo' },
  },
};

const CLIENT = {
  name: 'Tetra Wave Solutions',
  handle: 'tetrawavesolutions',
  color: '#14b8a6',
};

const OPUBLIKOWANO = '📤  OPUBLIKOWANO';
const ZAPLANOWANE = '⌛  ZAPLANOWANE DO PUBLIKACJI';

// ---- Fixture'y postów (`planner/src/data/tws.js`, treści skrócone) ---------

/** Realny post bez wariantów, media obrazkowe, dwie platformy. */
const POST_ZWYKLY = {
  id: 'tws-0707-1',
  client: 'tetrawave',
  date: '2026-07-07',
  title: 'Podczas intensywnej gry liczy się każdy detal - również stabi...',
  topic: 'Produkt',
  status: 'opublikowany',
  sheetStatus: OPUBLIKOWANO,
  sheetStatuses: [OPUBLIKOWANO, OPUBLIKOWANO],
  contentType: 'post',
  platforms: ['instagram', 'facebook'],
  media: {
    kind: 'image',
    count: 3,
    source: 'gdrive',
    fileId: '1gMKksSz9a0IkIrxueOKX-b6Rs8xoq3gL',
    name: 'Post_1_1.jpg',
  },
  copy: '🥁 Podczas intensywnej gry liczy się każdy detal - również stabilność śrub perkusyjnych.',
  hashtags: ['#tws', '#tetrawavesolutions', '#diamondlock'],
  videoFile: null,
  sheetSlots: [1, 2],
};

/** Realny post rolkowy: `videoFile` + miniatura obrazkowa na Dysku. */
const POST_Z_WIDEO = {
  id: 'tws-0708-1',
  client: 'tetrawave',
  date: '2026-07-08',
  title: 'Mały detal, duży spokój.',
  topic: 'Produkt',
  status: 'opublikowany',
  sheetStatus: OPUBLIKOWANO,
  sheetStatuses: [OPUBLIKOWANO, OPUBLIKOWANO, OPUBLIKOWANO],
  contentType: 'reel',
  platforms: ['instagram', 'facebook', 'tiktok'],
  media: {
    kind: 'video',
    source: 'gdrive',
    fileId: '1KJ8-O9MAC5CUyFxx7zkRHtfnnu8Wz1Gu',
    name: 'Min_1_1.jpg',
  },
  copy: 'Mały detal, duży spokój.\n💎 Blokady Diamond Lock pomagają utrzymać wybraną pozycję śruby.',
  hashtags: ['#tws', '#diamondlock'],
  videoFile: 'DIAMOND_LOCK_ROLKA#1.mp4',
  videoUrl: 'https://drive.google.com/file/d/1BL3BFzxfmDyQA_LJiirjCHsWapivFAPC/view?usp=drive_link',
  sheetSlots: [1, 3, 2],
};

/** Realny post o RÓŻNYCH statusach slotów (merge bierze najmniej zaawansowany). */
const POST_MIESZANE_STATUSY = {
  id: 'tws-0711-1',
  client: 'tetrawave',
  date: '2026-07-11',
  title: 'Niski dźwięk, wysoka precyzja - poznaj mikrofon, który rozumi...',
  topic: 'Produkt',
  status: 'zaplanowany',
  sheetStatus: OPUBLIKOWANO,
  sheetStatuses: [OPUBLIKOWANO, ZAPLANOWANE, ZAPLANOWANE],
  contentType: 'reel',
  platforms: ['instagram', 'facebook', 'tiktok'],
  media: {
    kind: 'video',
    source: 'gdrive',
    fileId: '1vySHBFyUTUzJ-7mB0nZF_Rfmvvt8fqsx',
    name: 'Min_2_1.jpg',
  },
  copy: 'Niski dźwięk, wysoka precyzja - poznaj mikrofon, który rozumie niskie dźwięki.',
  hashtags: ['#tws', '#midsub'],
  videoFile: 'MID-SUB_ROLKA#2.mp4',
  sheetSlots: [1, 3, 2],
};

/** Realny post 'tws-0713-1' UZUPEŁNIONY o `variants` (patrz nagłówek pliku). */
const POST_Z_WARIANTAMI = {
  id: 'tws-0713-1',
  client: 'tetrawave',
  date: '2026-07-13',
  title: 'Dobry setup mikrofonowy zaczyna się od precyzyjnego ustawieni...',
  topic: 'O firmie',
  status: 'zaplanowany',
  sheetStatus: OPUBLIKOWANO,
  sheetStatuses: [OPUBLIKOWANO, ZAPLANOWANE],
  contentType: 'post',
  platforms: ['instagram', 'facebook', 'tiktok'],
  media: {
    kind: 'image',
    count: 3,
    source: 'gdrive',
    fileId: '1VGflfh2QN6sOu5tQOuY7cMFPi1Oa4EGd',
    name: 'Post_3_1.jpg',
  },
  copy: '🎙️ Dobry setup mikrofonowy zaczyna się od precyzyjnego ustawienia.',
  variants: {
    facebook: 'Wersja na Facebooka: dobry setup zaczyna się od ustawienia mikrofonu.',
    tiktok: 'Wersja na Facebooka: dobry setup zaczyna się od ustawienia mikrofonu.',
  },
  hashtags: ['#xy', '#ORTF'],
  videoFile: null,
  sheetSlots: [1, 2],
};

function seedOf(posts: unknown[]) {
  return mapTwsSeed({ posts, client: CLIENT, clientKey: 'tetrawave', meta: META });
}

const WSZYSTKIE = [POST_ZWYKLY, POST_Z_WIDEO, POST_MIESZANE_STATUSY, POST_Z_WARIANTAMI];

// ---- Marka -----------------------------------------------------------------

describe('marka', () => {
  const { brand } = seedOf(WSZYSTKIE);

  it('słowniki wychodzą z danych źródłowych, a klient N2Click zostaje pusty', () => {
    expect(brand.name).toBe('Tetra Wave Solutions');
    expect(brand.contact).toBe('@tetrawavesolutions');
    expect(brand.accent).toBe('#14b8a6');
    expect(brand.industry).toBe('');
    // Kolejność kanoniczna słownika `meta.PLATFORMS`, wyłącznie realnie użyte.
    expect(brand.platforms).toEqual([
      { id: 'facebook', name: 'Facebook', color: '#1877F2' },
      { id: 'instagram', name: 'Instagram', color: '#E4405F' },
      { id: 'tiktok', name: 'TikTok', color: '#00F2EA' },
    ]);
    expect(brand.topics).toEqual(['Produkt', 'O firmie']);
    expect(brand.formats).toEqual(['Post', 'Reel']);
    expect(brand.n2clickClientId).toBeNull();
  });

  it('każda publikacja i każdy kanał wskazują tę samą markę', () => {
    const seed = seedOf(WSZYSTKIE);
    expect(seed.posts.every((post) => post.brandId === seed.brand.id)).toBe(true);
    const postIds = new Set(seed.posts.map((post) => post.id));
    expect(seed.channels.every((channel) => postIds.has(channel.postId))).toBe(true);
  });
});

// ---- Statusy ---------------------------------------------------------------

describe('mapowanie statusów', () => {
  it('komórka arkusza -> klucz plannera (dwie wartości, jakie niesie arkusz)', () => {
    expect(plannerStatusFromSheet(OPUBLIKOWANO)).toBe('opublikowany');
    expect(plannerStatusFromSheet(ZAPLANOWANE)).toBe('zaplanowany');
    expect(plannerStatusFromSheet('COŚ CAŁKIEM INNEGO')).toBe('');
  });

  it('klucz plannera -> status modułu pokrywa całe workflow (7 pozycji)', () => {
    expect(PLANNER_STATUS_TO_MODULE).toEqual({
      szkic: 'W trakcie tworzenia',
      'w-produkcji': 'W trakcie tworzenia',
      'do-akceptacji': 'Do akceptacji',
      poprawki: 'Wdrażane poprawki',
      zaakceptowany: 'Akceptacja',
      zaplanowany: 'Zaplanowane',
      opublikowany: 'Opublikowano',
    });
  });

  it('scalona kreacja dostaje NAJMNIEJ zaawansowany status slotów', () => {
    const [opublikowany, mieszany] = seedOf([POST_ZWYKLY, POST_MIESZANE_STATUSY]).posts;
    expect(opublikowany.status).toBe('Opublikowano');
    // Slot 1 był OPUBLIKOWANO, ale dwa pozostałe dopiero ZAPLANOWANE.
    expect(mieszany.status).toBe('Zaplanowane');
  });

  it('bez komórek arkusza spada na gotowy `status` posta', () => {
    const szkic = { ...POST_ZWYKLY, status: 'szkic', sheetStatus: null, sheetStatuses: [] };
    expect(seedOf([szkic]).posts[0].status).toBe('W trakcie tworzenia');
  });

  it('nieznany status z obu źródeł nie wywraca importu', () => {
    const nieznany = { ...POST_ZWYKLY, status: 'kosmos', sheetStatus: '???', sheetStatuses: [] };
    expect(seedOf([nieznany]).posts[0].status).toBe('W trakcie tworzenia');
  });
});

// ---- Widoczność ------------------------------------------------------------

describe('widoczność', () => {
  it('publikacja od kroku „zaakceptowany" w górę wchodzi jako published', () => {
    expect(PUBLISHED_FROM_STEP).toBe(5);
    const seed = seedOf(WSZYSTKIE);
    expect(seed.posts.map((post) => post.visibility)).toEqual([
      'published', // opublikowany (7)
      'published', // opublikowany (7)
      'published', // zaplanowany (6)
      'published', // zaplanowany (6)
    ]);
  });

  it('praca w toku (kroki 1-4) zostaje szkicem', () => {
    const wProdukcji = { ...POST_ZWYKLY, status: 'w-produkcji', sheetStatus: null, sheetStatuses: [] };
    const doAkceptacji = { ...POST_ZWYKLY, status: 'do-akceptacji', sheetStatus: null, sheetStatuses: [] };
    const zaakceptowany = { ...POST_ZWYKLY, status: 'zaakceptowany', sheetStatus: null, sheetStatuses: [] };
    const seed = seedOf([wProdukcji, doAkceptacji, zaakceptowany]);
    expect(seed.posts.map((post) => post.visibility)).toEqual(['draft', 'draft', 'published']);
  });

  it('publikacja bez opisu nie przechodzi bramki udostępnienia (zostaje szkicem)', () => {
    const bezOpisu = { ...POST_ZWYKLY, copy: '   ' };
    expect(seedOf([bezOpisu]).posts[0].visibility).toBe('draft');
  });
});

// ---- Kanały ----------------------------------------------------------------

describe('kanały', () => {
  it('post bez wariantów: kanał per platforma ze WSPÓLNYM opisem (grupa główna)', () => {
    const seed = seedOf([POST_ZWYKLY]);
    expect(seed.channels).toHaveLength(2);
    expect(seed.channels.map((channel) => channel.platformId)).toEqual(['instagram', 'facebook']);
    for (const channel of seed.channels) {
      expect(channel.copy).toBe(POST_ZWYKLY.copy);
      // NULL ≡ grupa główna opisu (domain.ts: brak klucza ≡ 'main').
      expect(channel.descriptionGroupId).toBeNull();
      expect(channel.tags).toEqual([]);
      expect(channel.overrideTags).toBe(false);
    }
    expect(seed.posts[0].baseTags).toEqual(['#tws', '#tetrawavesolutions', '#diamondlock']);
  });

  it('post z wariantami: wspólny opis zostaje główny, warianty dostają własną grupę', () => {
    const seed = seedOf([POST_Z_WARIANTAMI]);
    expect(seed.channels).toHaveLength(3);
    const [instagram, facebook, tiktok] = seed.channels;
    expect(instagram.platformId).toBe('instagram');
    expect(instagram.copy).toBe(POST_Z_WARIANTAMI.copy);
    expect(instagram.descriptionGroupId).toBeNull();
    // Facebook i TikTok dzielą JEDEN wariant, więc siedzą w tej samej grupie.
    expect(facebook.copy).toBe(POST_Z_WARIANTAMI.variants.facebook);
    expect(tiktok.copy).toBe(POST_Z_WARIANTAMI.variants.tiktok);
    expect(facebook.descriptionGroupId).toBe('wariant-facebook');
    expect(tiktok.descriptionGroupId).toBe('wariant-facebook');
  });

  it('liczba kanałów to suma platform wszystkich publikacji', () => {
    const seed = seedOf(WSZYSTKIE);
    expect(seed.channels).toHaveLength(2 + 3 + 3 + 3);
  });
});

// ---- Media -----------------------------------------------------------------

describe('media z Dysku Google', () => {
  it('post obrazkowy: gdrive + fileId + typ image', () => {
    const [channel] = seedOf([POST_ZWYKLY]).channels;
    expect(channel.mediaSource).toBe('gdrive');
    expect(channel.mediaFileId).toBe('1gMKksSz9a0IkIrxueOKX-b6Rs8xoq3gL');
    expect(channel.mediaType).toBe('image');
    expect(channel.mediaWidth).toBeNull();
    expect(channel.mediaHeight).toBeNull();
  });

  it('post z `videoFile`: typ video, fileId z kadru wskazanego w arkuszu', () => {
    const seed = seedOf([POST_Z_WIDEO]);
    for (const channel of seed.channels) {
      expect(channel.mediaType).toBe('video');
      expect(channel.mediaFileId).toBe('1KJ8-O9MAC5CUyFxx7zkRHtfnnu8Wz1Gu');
    }
  });

  it('sam `videoFile` bez `media.kind` też daje typ video', () => {
    const rolka = {
      ...POST_ZWYKLY,
      videoFile: 'ROLKA#12.mp4',
      media: { ...POST_ZWYKLY.media, kind: 'image' },
    };
    expect(seedOf([rolka]).channels[0].mediaType).toBe('video');
  });

  it('brak pliku na Dysku zostawia media puste (bez wymyślania źródła)', () => {
    const bezMediow = { ...POST_ZWYKLY, media: { kind: 'image' }, videoFile: null };
    const [channel] = seedOf([bezMediow]).channels;
    expect(channel.mediaSource).toBeNull();
    expect(channel.mediaFileId).toBeNull();
    expect(channel.mediaType).toBeNull();
  });
});

// ---- Determinizm -----------------------------------------------------------

describe('determinizm', () => {
  it('dwa wywołania mappera dają identyczny wynik', () => {
    expect(seedOf(WSZYSTKIE)).toEqual(seedOf(WSZYSTKIE));
    expect(JSON.stringify(seedOf(WSZYSTKIE))).toBe(JSON.stringify(seedOf(WSZYSTKIE)));
  });

  it('dwa renderowania dają bajt w bajt ten sam SQL', () => {
    expect(renderSeedSql(seedOf(WSZYSTKIE))).toBe(renderSeedSql(seedOf(WSZYSTKIE)));
  });

  it('identyfikatory są PRZYPIĘTE do nazw źródłowych (UUID v5, nie losowe)', () => {
    const seed = seedOf(WSZYSTKIE);
    // Zmiana przestrzeni nazw albo schematu nazw rozjedzie seed z bazą, w której
    // migracja już siedzi — dlatego trzy id są tu przypięte wprost.
    expect(seed.brand.id).toBe('db1ac512-2c44-50ea-9760-c21e417fe2f8');
    expect(seed.posts[0].id).toBe('b4fe133c-d098-54c4-99c0-a51f78646fec');
    expect(seed.channels[0].id).toBe('0bdca87e-a4d8-5344-bd33-bfb548466f1f');
    for (const id of [seed.brand.id, seed.posts[0].id, seed.channels[0].id]) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('identyfikatory kanałów są unikalne w całym wsadzie', () => {
    const seed = seedOf(WSZYSTKIE);
    expect(new Set(seed.channels.map((channel) => channel.id)).size).toBe(seed.channels.length);
    expect(new Set(seed.posts.map((post) => post.id)).size).toBe(seed.posts.length);
  });
});

// ---- Renderowanie SQL ------------------------------------------------------

describe('render SQL', () => {
  const sql = renderSeedSql(seedOf(WSZYSTKIE));

  it('pełna kwalifikacja nazw i idempotentne wstawienia', () => {
    expect(sql).toContain('insert into contentplan.brands');
    expect(sql).toContain('insert into contentplan.posts');
    expect(sql).toContain('insert into contentplan.post_channels');
    expect(sql.match(/on conflict \(id\) do nothing;/g)).toHaveLength(3);
    // Żadnej niekwalifikowanej tabeli i żadnej zmiany schematu.
    expect(sql).not.toMatch(/insert into (?!contentplan\.)/);
    expect(sql).not.toMatch(/create table|alter table|drop /);
  });

  it('apostrof w treści jest podwajany, a NULL nie jest cytowany', () => {
    const zApostrofem = { ...POST_ZWYKLY, copy: "Detal, który 'trzyma' setup" };
    const rendered = renderSeedSql(seedOf([zApostrofem]));
    expect(rendered).toContain("'Detal, który ''trzyma'' setup'");
    // `n2click_client_id` marki i wymiary mediów zostają realnym NULL-em.
    expect(rendered).toContain('   null)');
    expect(rendered).not.toContain("'null'");
  });

  it('plik kończy się nową linią (parytet z pozostałymi migracjami)', () => {
    expect(sql.endsWith('\n')).toBe(true);
  });
});
