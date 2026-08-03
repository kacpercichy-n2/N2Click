// Content Plan — CZYSTA domena modułu. Bez Reacta, bez store, bez localStorage:
// wyłącznie typy pomocnicze, walidacja/normalizacja ładunków i helpery widoku.
// Konsumenci: reduktor (`src/store/AppStore.tsx` — akcje `*_CP_*`), sanitizer
// wczytania (`repairContentPlan` w `src/store/storage.ts`) i selektory.
//
// GRANICE
// - Encje persystowane mieszkają w `src/types.ts` (ContentPlanBrand /
//   ContentPlanPost / ...), tak jak każdy inny model aplikacji.
// - LOGIKA DAT nie jest tu dublowana: wszystko, co potrafi `src/utils/dates.ts`
//   (walidacja 'yyyy-MM-dd', granice miesiąca, etykiety, znaczniki czasu), jest
//   stamtąd importowane. Tutaj żyją WYŁĄCZNIE helpery specyficzne dla modułu,
//   czyli operacje na KLUCZU MIESIĄCA ('yyyy-MM'), którego reszta aplikacji nie
//   używa jako jednostki nawigacji.
// - MEDIA: jedyna świadoma różnica względem aplikacji źródłowej — kanał niesie
//   `{ source: 'gdrive', fileId, width?, height?, type }`. Base64 (dawne
//   `assetPreview`/`assetName`) i limit 4 MB NIE mają tu odpowiednika i nigdy
//   nie mogą wejść do stanu ani do zapisu.
//
// DWA POZIOMY SUROWOŚCI (ta sama zasada co w `commandValidation.ts` vs repair):
// - `normalize*Draft` są STRICT: jakikolwiek strukturalny błąd => `null`, a
//   reduktor zwraca TĘ SAMĄ referencję stanu (inwariant 6).
// - `sanitize*` są ŁAGODNE: naprawiają albo odrzucają POJEDYNCZY wiersz, żeby
//   jeden uszkodzony rekord nie wywrócił całego wczytania.
import type {
  ContentPlanBrand,
  ContentPlanChannel,
  ContentPlanComment,
  ContentPlanHistoryEntry,
  ContentPlanMedia,
  ContentPlanPlatform,
  ContentPlanPost,
  ContentPlanStatus,
  ContentPlanVisibility,
  DateStr,
} from '../types';
import {
  dayNumber,
  eachDayInclusive,
  formatTimestamp,
  isValidDateStr,
  monthEnd,
  monthKey,
  monthLabel,
  shiftMonth,
  weekdayAbbr,
} from '../utils/dates';

// ---- Stałe zbiory wartości -------------------------------------------------

// Zbiór statusów budujemy z `Record<ContentPlanStatus, true>`, więc dopisanie
// wartości do unii w `types.ts` BEZ dopisania jej tutaj jest błędem kompilacji.
// Kolejność kluczy string jest zachowana przez `Object.keys` — to kolejność
// prezentacji (od „Do akceptacji" po „Opublikowano").
const STATUS_MEMBERS: Record<ContentPlanStatus, true> = {
  'Do akceptacji': true,
  Uwagi: true,
  Akceptacja: true,
  Zaplanowane: true,
  'W trakcie tworzenia': true,
  'Wdrażane poprawki': true,
  Opublikowano: true,
};

/** Siedem statusów publikacji w kolejności prezentacji. Wartość JEST etykietą. */
export const CONTENT_PLAN_STATUSES = Object.keys(STATUS_MEMBERS) as ContentPlanStatus[];

/** Status świeżo utworzonego slotu (parytet z aplikacją źródłową). */
export const DEFAULT_CONTENT_PLAN_STATUS: ContentPlanStatus = 'W trakcie tworzenia';

/** Decyzja klienta na udostępnionej publikacji. Wartość JEST docelowym statusem. */
export type ContentPlanReviewDecision = Extract<ContentPlanStatus, 'Akceptacja' | 'Uwagi'>;

/** Statusy decyzji klienta — jedyne, które ustawia `REVIEW_CP_POST`. */
export const CONTENT_PLAN_REVIEW_STATUSES: ContentPlanReviewDecision[] = ['Akceptacja', 'Uwagi'];

export function isContentPlanReviewDecision(value: unknown): value is ContentPlanReviewDecision {
  return value === 'Akceptacja' || value === 'Uwagi';
}

/** Polska etykieta wpisu historii dla decyzji klienta. */
export function reviewHistoryLabel(author: string, decision: ContentPlanReviewDecision): string {
  return `${author}: ${decision === 'Akceptacja' ? 'zaakceptowano publikację' : 'zgłoszono uwagi'}`;
}

const VISIBILITY_MEMBERS: Record<ContentPlanVisibility, true> = {
  draft: true,
  published: true,
};

/** Roboczy tytuł nowego slotu. Publikacja go NIE przepuszcza (patrz
 *  {@link validatePostForPublication}) — ma wymusić świadomy tytuł. */
export const DEFAULT_POST_TITLE = 'Nowa publikacja';

/** Id grupy opisu głównego. Forma kanoniczna kanału: BRAK klucza
 *  `descriptionGroupId` ≡ ta grupa (klucz nigdy nie niesie 'main'). */
export const MAIN_DESCRIPTION_GROUP = 'main';

export function isContentPlanStatus(value: unknown): value is ContentPlanStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS_MEMBERS, value);
}

export function isContentPlanVisibility(value: unknown): value is ContentPlanVisibility {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(VISIBILITY_MEMBERS, value)
  );
}

// ---- Identyfikatory --------------------------------------------------------

/** Nowe id encji modułu. Ta sama konwencja co reduktor planera
 *  (`crypto.randomUUID`) — id marki jest wyjątkiem, patrz {@link uniqueBrandId}. */
export function contentPlanUid(): string {
  return crypto.randomUUID();
}

const POLISH_TRANSLITERATIONS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

/** Slug marki z nazwy: polskie znaki po transliteracji, reszta przez NFD.
 *  Nazwa bez ani jednego znaku alfanumerycznego => losowe id (nigdy ''). */
export function brandSlug(name: string): string {
  const transliterated = [...name.toLocaleLowerCase('pl-PL')]
    .map((character) => POLISH_TRANSLITERATIONS[character] ?? character)
    .join('')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return transliterated.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || contentPlanUid();
}

/** Slug marki wolny od kolizji w podanym zbiorze (`nazwa`, `nazwa-2`, ...). */
export function uniqueBrandId(name: string, brands: readonly ContentPlanBrand[]): string {
  const base = brandSlug(name);
  const used = new Set(brands.map((brand) => brand.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

// ---- Klucz miesiąca ('yyyy-MM') -------------------------------------------
//
// Jednostka nawigacji modułu. Wszystko poniżej stoi na `utils/dates.ts` — tutaj
// jest tylko przejście klucz <-> data i etykieta.

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY_RE.test(value) && isValidDateStr(`${value}-01`);
}

/** Klucz miesiąca daty 'yyyy-MM-dd' (''=niepoprawne wejście). */
export function monthKeyOf(date: string): string {
  return isValidDateStr(date) ? monthKey(date) : '';
}

/** Przesunięcie klucza miesiąca o `delta` miesięcy (''=niepoprawny klucz). */
export function shiftMonthKey(key: string, delta: number): string {
  if (!isMonthKey(key)) return '';
  return monthKey(shiftMonth(`${key}-01`, delta));
}

/** Etykieta miesiąca po polsku z wielkiej litery, np. „Listopad 2024". */
export function monthKeyLabel(key: string): string {
  if (!isMonthKey(key)) return '';
  const label = monthLabel(`${key}-01`);
  return label.charAt(0).toLocaleUpperCase('pl-PL') + label.slice(1);
}

/** Jeden dzień siatki miesiąca modułu (kalendarz jest listą dni, nie siatką 6×7). */
export interface ContentPlanMonthDay {
  date: DateStr;
  day: number;
  weekday: string; // skrót dnia tygodnia po polsku, np. „pon"
}

/** Wszystkie dni miesiąca (28–31 pozycji). Niepoprawny klucz => []. */
export function monthKeyDays(key: string): ContentPlanMonthDay[] {
  if (!isMonthKey(key)) return [];
  const first = `${key}-01`;
  return eachDayInclusive(first, monthEnd(first)).map((date) => ({
    date,
    day: dayNumber(date),
    weekday: weekdayAbbr(date),
  }));
}

/** Czy publikacja należy do miesiąca (porównanie kanonicznych prefiksów dat). */
export function isPostInMonth(post: ContentPlanPost, key: string): boolean {
  return post.date.slice(0, 7) === key;
}

// ---- Prezentacja: platformy, grupy opisów, tagi -----------------------------

/** Platforma kanału z zachowaniem awaryjnym: nieznane id => pierwsza platforma
 *  marki (kanał osierocony przez zmianę słownika nadal się renderuje). */
export function platformFor(
  brand: ContentPlanBrand,
  platformId: string,
): ContentPlanPlatform | undefined {
  return brand.platforms.find((platform) => platform.id === platformId) ?? brand.platforms[0];
}

/** Grupa opisu: kanały dzielące jedną treść (główna + warianty dedykowane). */
export interface ContentPlanDescriptionGroup {
  id: string;
  channels: ContentPlanChannel[];
  isMain: boolean;
}

/** Id grupy opisu kanału (brak klucza ≡ grupa główna). */
export function descriptionGroupId(channel: ContentPlanChannel): string {
  return channel.descriptionGroupId ?? MAIN_DESCRIPTION_GROUP;
}

/** Grupy opisów publikacji; grupa główna zawsze pierwsza, reszta w kolejności
 *  pierwszego wystąpienia kanału. */
export function getDescriptionGroups(post: ContentPlanPost): ContentPlanDescriptionGroup[] {
  const map = new Map<string, ContentPlanChannel[]>();
  for (const channel of post.channels) {
    const groupId = descriptionGroupId(channel);
    const bucket = map.get(groupId);
    if (bucket) bucket.push(channel);
    else map.set(groupId, [channel]);
  }
  return Array.from(map.entries())
    .map(([id, channels]) => ({ id, channels, isMain: id === MAIN_DESCRIPTION_GROUP }))
    .sort((a, b) => Number(b.isMain) - Number(a.isMain));
}

/** Tagi grupy: dziedziczone z posta, dopóki wariant ich jawnie nie nadpisze. */
export function groupTags(post: ContentPlanPost, group: ContentPlanDescriptionGroup): string {
  if (group.isMain) return post.baseTags;
  const first = group.channels[0];
  return first?.overrideTags ? first.tags : post.baseTags;
}

// ---- Prezentacja: proporcje mediów -----------------------------------------

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Proporcja z samego formatu, gdy plik nie zna swoich wymiarów. */
export function fallbackAspectRatio(format: string): string {
  const key = format.toLocaleLowerCase('pl-PL');
  if (key.includes('story') || key.includes('rolka') || key.includes('reel') || key.includes('short')) {
    return '9 / 16';
  }
  if (key.includes('video') || key.includes('film')) return '16 / 9';
  if (key.includes('post') || key.includes('karuzel')) return '4 / 5';
  return '1 / 1';
}

/** Proporcja kadru kanału: rzeczywisty wymiar pliku Drive ma pierwszeństwo nad
 *  formatem publikacji. */
export function mediaAspectRatio(
  channel: ContentPlanChannel | undefined,
  format: string,
): string {
  const media = channel?.media;
  if (media?.width && media.height) return `${media.width} / ${media.height}`;
  return fallbackAspectRatio(format);
}

/** Skrócona proporcja pliku („4:5"); `null` gdy wymiary nie są znane. */
export function mediaRatioLabel(channel: ContentPlanChannel | undefined): string | null {
  const media = channel?.media;
  if (!media?.width || !media.height) return null;
  const divisor = gcd(media.width, media.height);
  return `${media.width / divisor}:${media.height / divisor}`;
}

// ---- Komentarze ------------------------------------------------------------

/** Odpowiedzi zgrupowane po rodzicu (kolejność źródłowej listy komentarzy). */
export function commentRepliesByParent(
  comments: readonly ContentPlanComment[],
): Map<string, ContentPlanComment[]> {
  const map = new Map<string, ContentPlanComment[]>();
  for (const comment of comments) {
    if (comment.parentId === undefined) continue;
    const bucket = map.get(comment.parentId);
    if (bucket) bucket.push(comment);
    else map.set(comment.parentId, [comment]);
  }
  return map;
}

/** Spłaszczenie wątku w kolejności drzewa. Odporne na cykl w danych: każdy
 *  komentarz odwiedzany najwyżej raz. */
export function flattenCommentReplies(
  parentId: string,
  childrenByParent: Map<string, ContentPlanComment[]>,
): ContentPlanComment[] {
  const result: ContentPlanComment[] = [];
  const visited = new Set<string>([parentId]);
  const collect = (id: string): void => {
    for (const reply of childrenByParent.get(id) ?? []) {
      if (visited.has(reply.id)) continue;
      visited.add(reply.id);
      result.push(reply);
      collect(reply.id);
    }
  };
  collect(parentId);
  return result;
}

/** Etykieta momentu komentarza/historii — FORMAT 2 z `utils/dates.ts`.
 *  Niepoprawna wartość wraca w oryginale (nigdy nie rzuca). */
export function formatCommentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatTimestamp(value);
}

// ---- Walidacja publikacji --------------------------------------------------

/** Pole, przy którym UI pokazuje komunikat blokujący udostępnienie. */
export type ContentPlanIssueField = 'title' | 'channels' | 'copy';

export interface ContentPlanPublicationIssue {
  field: ContentPlanIssueField;
  message: string;
}

/**
 * Braki blokujące udostępnienie publikacji klientowi. Pusta lista = wolno
 * ustawić `visibility: 'published'`. Egzekwowane RÓWNIEŻ w reduktorze
 * (`SAVE_CP_POST`, `PUBLISH_CP_MONTH`), nie tylko w UI.
 */
export function validatePostForPublication(
  post: Pick<ContentPlanPost, 'title' | 'channels'>,
): ContentPlanPublicationIssue[] {
  const issues: ContentPlanPublicationIssue[] = [];
  if (!post.title.trim() || post.title === DEFAULT_POST_TITLE) {
    issues.push({ field: 'title', message: 'Uzupełnij roboczy tytuł publikacji.' });
  }
  if (!post.channels.length) {
    issues.push({ field: 'channels', message: 'Dodaj co najmniej jedną platformę.' });
  }
  if (!post.channels.some((channel) => channel.copy.trim())) {
    issues.push({ field: 'copy', message: 'Dodaj opis dla co najmniej jednej platformy.' });
  }
  return issues;
}

// ---- Nowy slot publikacji --------------------------------------------------

/**
 * Pusty slot publikacji na dany dzień: pierwsza platforma marki, pierwszy temat
 * i format ze słowników, status roboczy i jeden wpis historii. Data NIE jest tu
 * walidowana — robi to reduktor przy zapisie.
 */
export function makeEmptyPost(brand: ContentPlanBrand, date: string): ContentPlanPost {
  const firstPlatform = brand.platforms[0];
  const stamp = new Date().toISOString();
  return {
    id: contentPlanUid(),
    brandId: brand.id,
    date,
    title: DEFAULT_POST_TITLE,
    topic: brand.topics[0] ?? '',
    format: brand.formats[0] ?? '',
    status: DEFAULT_CONTENT_PLAN_STATUS,
    visibility: 'draft',
    baseTags: '',
    channels: firstPlatform
      ? [
          {
            id: contentPlanUid(),
            platformId: firstPlatform.id,
            copy: '',
            tags: '',
            overrideTags: false,
          },
        ]
      : [],
    comments: [],
    history: [{ id: contentPlanUid(), label: 'Utworzono slot publikacji', at: stamp }],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

// ---- Drafty ładunków reduktora ---------------------------------------------

/** Draft marki. `id` NIE jest częścią draftu — przy tworzeniu nadaje go
 *  reduktor przez {@link uniqueBrandId}, edycja adresuje wiersz `brandId`. */
export interface ContentPlanBrandDraft {
  name: string;
  industry: string;
  contact: string;
  accent: string;
  platforms: ContentPlanPlatform[];
  topics: string[];
  formats: string[];
}

/** Draft publikacji. `comments`/`history` NIE są częścią draftu: komentarz
 *  dokłada `ADD_CP_COMMENT`, a wpisy historii dopisuje reduktor. */
export interface ContentPlanPostDraft {
  brandId: string;
  date: string;
  title: string;
  topic: string;
  format: string;
  status: ContentPlanStatus;
  visibility: ContentPlanVisibility;
  baseTags: string;
  channels: ContentPlanChannel[];
}

// ---- Wspólne prymitywy normalizacji ----------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Dodatni, całkowity wymiar piksela; wszystko inne => `undefined`. */
function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

/** Lista unikalnych, przyciętych, niepustych wartości słownika. */
function normalizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// ---- Media -----------------------------------------------------------------

/** STRICT: `undefined` = brak klucza (poprawne), `'invalid'` = odrzucenie. */
function normalizeMedia(value: unknown): ContentPlanMedia | 'invalid' | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return 'invalid';
  if (value.source !== 'gdrive') return 'invalid';
  const fileId = str(value.fileId).trim();
  if (fileId === '') return 'invalid';
  if (value.type !== 'image' && value.type !== 'video') return 'invalid';
  const width = positiveInt(value.width);
  const height = positiveInt(value.height);
  if (value.width !== undefined && width === undefined) return 'invalid';
  if (value.height !== undefined && height === undefined) return 'invalid';
  return {
    source: 'gdrive',
    fileId,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    type: value.type,
  };
}

/** ŁAGODNE: zły kształt => brak mediów (kanał zostaje, traci tylko plik). */
function sanitizeMedia(value: unknown): ContentPlanMedia | undefined {
  const normalized = normalizeMedia(value);
  return normalized === 'invalid' ? undefined : normalized;
}

// ---- Kanały ----------------------------------------------------------------

function canonicalGroupId(value: unknown): string | undefined {
  const trimmed = str(value).trim();
  if (trimmed === '' || trimmed === MAIN_DESCRIPTION_GROUP) return undefined;
  return trimmed;
}

/**
 * STRICT normalizacja kanałów draftu. `null` przy: nie-tablicy, wierszu
 * nie-obiekcie, pustym `id`/`platformId`, duplikacie `id`, nie-stringowym
 * `copy`/`tags`, nie-boolowskim `overrideTags` albo niepoprawnych mediach.
 * Przynależność `platformId` do słownika marki NIE jest wymagana — kanał
 * osierocony przez zmianę słownika musi dać się dalej zapisać (render ma
 * zachowanie awaryjne w {@link platformFor}).
 */
export function normalizeContentPlanChannels(value: unknown): ContentPlanChannel[] | null {
  if (!Array.isArray(value)) return null;
  const out: ContentPlanChannel[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const id = str(raw.id).trim();
    const platformId = str(raw.platformId).trim();
    if (id === '' || platformId === '' || seen.has(id)) return null;
    if (typeof raw.copy !== 'string' || typeof raw.tags !== 'string') return null;
    if (typeof raw.overrideTags !== 'boolean') return null;
    if (raw.descriptionGroupId !== undefined && typeof raw.descriptionGroupId !== 'string') {
      return null;
    }
    const media = normalizeMedia(raw.media);
    if (media === 'invalid') return null;
    const groupId = canonicalGroupId(raw.descriptionGroupId);
    seen.add(id);
    out.push({
      id,
      platformId,
      copy: raw.copy,
      tags: raw.tags,
      overrideTags: raw.overrideTags,
      ...(groupId !== undefined ? { descriptionGroupId: groupId } : {}),
      ...(media !== undefined ? { media } : {}),
    });
  }
  return out;
}

/** ŁAGODNA wersja: wiersz bez `id`/`platformId` albo z duplikatem `id` odpada,
 *  reszta jest koercjonowana. */
function sanitizeChannels(value: unknown): ContentPlanChannel[] {
  if (!Array.isArray(value)) return [];
  const out: ContentPlanChannel[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id).trim();
    const platformId = str(raw.platformId).trim();
    if (id === '' || platformId === '' || seen.has(id)) continue;
    seen.add(id);
    const groupId = canonicalGroupId(raw.descriptionGroupId);
    const media = sanitizeMedia(raw.media);
    out.push({
      id,
      platformId,
      copy: str(raw.copy),
      tags: str(raw.tags),
      overrideTags: raw.overrideTags === true,
      ...(groupId !== undefined ? { descriptionGroupId: groupId } : {}),
      ...(media !== undefined ? { media } : {}),
    });
  }
  return out;
}

// ---- Komentarze i historia (tylko ścieżka wczytania) -----------------------

function sanitizeComments(value: unknown): ContentPlanComment[] {
  if (!Array.isArray(value)) return [];
  const rows: Array<{ id: string; author: string; body: string; at: string; parentId: string }> =
    [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id).trim();
    const body = str(raw.body).trim();
    if (id === '' || body === '' || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, author: str(raw.author), body, at: str(raw.at), parentId: str(raw.parentId) });
  }
  // Rodzic spoza tej publikacji (albo wskazujący sam siebie) NIE wyrzuca
  // komentarza — traci tylko powiązanie i wraca do wątku głównego, więc treść
  // klienta nigdy nie znika z widoku.
  return rows.map(({ parentId, ...rest }) => ({
    ...rest,
    ...(parentId !== '' && parentId !== rest.id && seen.has(parentId) ? { parentId } : {}),
  }));
}

function sanitizeHistory(value: unknown): ContentPlanHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ContentPlanHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id).trim();
    const label = str(raw.label).trim();
    if (id === '' || label === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, at: str(raw.at) });
  }
  return out;
}

// ---- Platformy -------------------------------------------------------------

/** STRICT: `null` przy nie-tablicy, wierszu bez `id`/`name` albo duplikacie id. */
function normalizePlatforms(value: unknown): ContentPlanPlatform[] | null {
  if (!Array.isArray(value)) return null;
  const out: ContentPlanPlatform[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const id = str(raw.id).trim();
    const name = str(raw.name).trim();
    if (id === '' || name === '' || seen.has(id)) return null;
    if (raw.color !== undefined && typeof raw.color !== 'string') return null;
    seen.add(id);
    out.push({ id, name, color: str(raw.color).trim() });
  }
  return out;
}

function sanitizePlatforms(value: unknown): ContentPlanPlatform[] {
  if (!Array.isArray(value)) return [];
  const out: ContentPlanPlatform[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id).trim();
    const name = str(raw.name).trim();
    if (id === '' || name === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, color: str(raw.color).trim() });
  }
  return out;
}

// ---- Drafty: normalizacja STRICT -------------------------------------------

/** Znormalizowany draft marki (pola gotowe do zapisu). */
export interface NormalizedBrandDraft {
  name: string;
  industry: string;
  contact: string;
  accent: string;
  platforms: ContentPlanPlatform[];
  topics: string[];
  formats: string[];
}

/**
 * STRICT normalizacja draftu marki. `null` (=> reduktor zwraca TĘ SAMĄ
 * referencję stanu, inwariant 6) przy: pustej nazwie po trim, nie-stringowym
 * polu tekstowym, złej liście platform albo złym słowniku tematów/formatów.
 * Marka BEZ platform jest dopuszczalna (świeża marka, słownik uzupełniany
 * później) — publikacji i tak nie da się wtedy udostępnić.
 */
export function normalizeContentPlanBrandDraft(draft: unknown): NormalizedBrandDraft | null {
  if (!isRecord(draft)) return null;
  const name = str(draft.name).trim();
  if (name === '') return null;
  for (const key of ['industry', 'contact', 'accent'] as const) {
    if (draft[key] !== undefined && typeof draft[key] !== 'string') return null;
  }
  const platforms = normalizePlatforms(draft.platforms);
  if (platforms === null) return null;
  const topics = normalizeStringList(draft.topics);
  if (topics === null) return null;
  const formats = normalizeStringList(draft.formats);
  if (formats === null) return null;
  return {
    name,
    industry: str(draft.industry).trim(),
    contact: str(draft.contact).trim(),
    accent: str(draft.accent).trim(),
    platforms,
    topics,
    formats,
  };
}

/** Znormalizowany draft publikacji (pola gotowe do zapisu). */
export interface NormalizedPostDraft {
  brandId: string;
  date: DateStr;
  title: string;
  topic: string;
  format: string;
  status: ContentPlanStatus;
  visibility: ContentPlanVisibility;
  baseTags: string;
  channels: ContentPlanChannel[];
}

/**
 * STRICT normalizacja draftu publikacji. `null` przy: nieznanej marce,
 * niepoprawnej dacie 'yyyy-MM-dd', pustym tytule po trim, statusie/widoczności
 * spoza zbioru, nie-stringowych tagach/temacie/formacie, złych kanałach ORAZ
 * przy próbie udostępnienia (`visibility: 'published'`) publikacji, której
 * brakuje tytułu, kanału albo opisu ({@link validatePostForPublication}) —
 * dokładnie ta sama bramka co w aplikacji źródłowej, tyle że po stronie
 * reduktora, a nie komunikatu w UI.
 */
export function normalizeContentPlanPostDraft(
  draft: unknown,
  brands: readonly ContentPlanBrand[],
): NormalizedPostDraft | null {
  if (!isRecord(draft)) return null;
  const brandId = str(draft.brandId).trim();
  if (brandId === '' || !brands.some((brand) => brand.id === brandId)) return null;
  const date = str(draft.date);
  if (!isValidDateStr(date)) return null;
  const title = str(draft.title).trim();
  if (title === '') return null;
  if (!isContentPlanStatus(draft.status)) return null;
  if (!isContentPlanVisibility(draft.visibility)) return null;
  for (const key of ['topic', 'format', 'baseTags'] as const) {
    if (draft[key] !== undefined && typeof draft[key] !== 'string') return null;
  }
  const channels = normalizeContentPlanChannels(draft.channels);
  if (channels === null) return null;
  const normalized: NormalizedPostDraft = {
    brandId,
    date,
    title,
    topic: str(draft.topic).trim(),
    format: str(draft.format).trim(),
    status: draft.status,
    visibility: draft.visibility,
    baseTags: str(draft.baseTags),
    channels,
  };
  if (normalized.visibility === 'published' && validatePostForPublication(normalized).length > 0) {
    return null;
  }
  return normalized;
}

// ---- Sanityzacja wczytania (ŁAGODNA) ---------------------------------------

/**
 * Naprawa kolekcji marek z zapisu. Wiersz bez stringowego `id` albo z pustą
 * nazwą po trim jest ODRZUCANY (nie da się go ani pokazać, ani zaadresować);
 * duplikat `id` odpada (pierwszy wygrywa). Reszta jest koercjonowana.
 * Idempotentna po wartości.
 */
export function sanitizeContentPlanBrands(value: unknown): ContentPlanBrand[] {
  if (!Array.isArray(value)) return [];
  const out: ContentPlanBrand[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id).trim();
    const name = str(raw.name).trim();
    if (id === '' || name === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      industry: str(raw.industry).trim(),
      contact: str(raw.contact).trim(),
      accent: str(raw.accent).trim(),
      platforms: sanitizePlatforms(raw.platforms),
      topics: sanitizeStringList(raw.topics),
      formats: sanitizeStringList(raw.formats),
      createdAt: str(raw.createdAt),
      updatedAt: str(raw.updatedAt),
    });
  }
  return out;
}

/**
 * Naprawa kolekcji publikacji z zapisu. Wiersz odpada, gdy nie da się go
 * zaadresować albo umieścić w kalendarzu: brak `id`, duplikat `id`, brak
 * `brandId`, pusty tytuł po trim albo `date` niebędące poprawnym 'yyyy-MM-dd'.
 * `brandId` wskazujący NIEISTNIEJĄCĄ markę jest ZACHOWYWANY (parytet z
 * `reporterId` zgłoszeń — kolejność wczytania kolekcji nie może kasować danych;
 * osierocone publikacje po prostu nie mają widoku). Nieznany status/widoczność
 * spadają na wartości domyślne zamiast wywracać wczytanie.
 * Idempotentna po wartości.
 */
export function sanitizeContentPlanPosts(value: unknown): ContentPlanPost[] {
  if (!Array.isArray(value)) return [];
  const out: ContentPlanPost[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id).trim();
    const brandId = str(raw.brandId).trim();
    const title = str(raw.title).trim();
    const date = str(raw.date);
    if (id === '' || brandId === '' || title === '' || seen.has(id)) continue;
    if (!isValidDateStr(date)) continue;
    seen.add(id);
    out.push({
      id,
      brandId,
      date,
      title,
      topic: str(raw.topic).trim(),
      format: str(raw.format).trim(),
      status: isContentPlanStatus(raw.status) ? raw.status : DEFAULT_CONTENT_PLAN_STATUS,
      visibility: isContentPlanVisibility(raw.visibility) ? raw.visibility : 'draft',
      baseTags: str(raw.baseTags),
      channels: sanitizeChannels(raw.channels),
      comments: sanitizeComments(raw.comments),
      history: sanitizeHistory(raw.history),
      createdAt: str(raw.createdAt),
      updatedAt: str(raw.updatedAt),
    });
  }
  return out;
}
