// Czysta warstwa KLIPY API v1 (decyzja D5b po zmianie dostawcy): budowanie
// adresów zapytań i mapowanie odpowiedzi na model kafelka. ZERO `fetch` — sieć
// zostaje w `ChatGifPopover.tsx`, dzięki czemu cały kontrakt zewnętrznego API
// testuje się w node bez atrap serwera.
//
// DLACZEGO KLIPY: poprzedni dostawca zamknął wydawanie nowych kluczy w styczniu
// 2026 i wyłączył integracje 30.06.2026 (historia w
// `handoffs/research/gif-provider-klipy-2026-08-17.md`). KLIPY wydaje klucz
// samoobsługowo, a jego regulamin WPROST wymaga, żeby zapytania szły z
// przeglądarki użytkownika, czyli dokładnie tak, jak potrafi SPA bez backendu.
//
// DECYZJE:
//   * Klucz `VITE_KLIPY_API_KEY` jest PUBLICZNY i jedzie jako SEGMENT ŚCIEŻKI
//     (tak go dokumentuje KLIPY — nie nagłówek, nie parametr zapytania).
//     `VITE_*` i tak ląduje w bundlu; klucz traktujemy jak opublikowany i w
//     razie nadużycia rotujemy z Partner Panelu. Brak klucza NIE psuje czatu:
//     przycisk GIF po prostu się nie renderuje.
//   * Podgląd w siatce bierzemy z warstwy `sm` (zapas `xs`), a do wiadomości
//     wysyłamy `md` (zapas `hd`) — siatka nie może ciągnąć megabajtów na
//     kafelek, a dymek ma pokazać coś ostrzejszego niż miniaturę.
//   * Rendition wybieramy CZYTAJĄC `file[tier].gif.url`, nigdy nie zgadując po
//     końcówce adresu: ta sama warstwa niesie też `webp`/`jpg`/`mp4`/`webm`.
//   * Parser jest TOLERANCYJNY: odpowiedź to kształt cudzego API (a oficjalne
//     DTO Androida deklarują KAŻDE pole jako nullowalne), więc rekord bez
//     `slug` albo bez użytecznego adresu po prostu wypada z listy zamiast
//     wywracać picker. Pozycje reklamowe (`type: 'ad'`) odpadają tak samo.
//   * Kolejności wyników NIE ruszamy i niczego nie dofiltrowujemy po stronie
//     klienta — „Integration Requirements" tego zabraniają; filtr treści
//     ustawia parametr `content_filter`.
import { isKlipyMediaUrl } from './chatRichText';

/** Baza API; klucz doklejamy jako pierwszy segment ścieżki po `/v1`. */
export const KLIPY_BASE = 'https://api.klipy.com/api/v1';

/** Ile kafelków ciągniemy na stronę. 24 mieści się w obu widełkach naraz
 *  (search: 8–50, trending: 1–50) i jest też dokumentowaną wartością domyślną. */
export const KLIPY_DEFAULT_PER_PAGE = 24;

/** Widełki `per_page` osobno dla obu endpointów (dokumentacja KLIPY). */
const PER_PAGE_BOUNDS = { search: { min: 8, max: 50 }, trending: { min: 1, max: 50 } };

const KLIPY_KEY_VAR = 'VITE_KLIPY_API_KEY';

/** Klucz KLIPY ze wstrzykniętego rekordu zmiennych; '' = przycisk GIF znika. */
export function klipyApiKey(env: Record<string, unknown>): string {
  const raw = env[KLIPY_KEY_VAR];
  return typeof raw === 'string' ? raw.trim() : '';
}

export interface KlipyQuery {
  apiKey: string;
  /** Fraza; pusta kieruje zapytanie na listę startową (`trending`). */
  query: string;
  /** Numer strony liczony od 1 (KLIPY nie ma kursora ani offsetu). */
  page?: number;
  perPage?: number;
  /** Stabilny, nieprzezroczysty identyfikator użytkownika (u nas `selfId`). */
  customerId?: string;
}

function clampInt(raw: number | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}

/**
 * Adres listy GIF-ów. Pusta fraza idzie na `trending`, niepusta na `search`.
 * Kodowanie parametrów niesie `URLSearchParams`, więc polska fraza jedzie
 * poprawnie procentowo.
 *
 * `customer_id` doklejamy TYLKO gdy jest niepuste: dokumentacja opisuje je jako
 * opcjonalne i wymaga wartości STAŁEJ dla danego użytkownika, więc pusty
 * parametr byłby gorszy niż jego brak.
 */
export function buildKlipySearchUrl(input: KlipyQuery): string {
  const query = input.query.trim();
  const search = query !== '';
  const bounds = search ? PER_PAGE_BOUNDS.search : PER_PAGE_BOUNDS.trending;
  const params = new URLSearchParams();
  if (search) params.set('q', query);
  params.set('page', String(clampInt(input.page, 1, 1, Number.MAX_SAFE_INTEGER)));
  params.set(
    'per_page',
    String(clampInt(input.perPage, KLIPY_DEFAULT_PER_PAGE, bounds.min, bounds.max)),
  );
  const customerId = (input.customerId ?? '').trim();
  if (customerId !== '') params.set('customer_id', customerId);
  params.set('locale', 'pl_PL');
  // Narzędzie pracownicze: najostrzejszy filtr treści, jaki KLIPY wystawia.
  params.set('content_filter', 'high');
  // Tylko renditiony `gif` — dymek czatu niesie adres obrazka, nie wideo.
  params.set('format_filter', 'gif');
  const path = search ? 'gifs/search' : 'gifs/trending';
  return `${KLIPY_BASE}/${encodeURIComponent(input.apiKey.trim())}/${path}?${params.toString()}`;
}

/** Jeden kafelek pickera. */
export interface KlipyGif {
  /** `slug` — stabilny klucz KLIPY; na nim keyuje każdy endpoint zapisu. */
  id: string;
  title: string;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  /** Adres wysyłany jako treść wiadomości. */
  sendUrl: string;
  /** Gotowy `data:image/...` — rozmyty zastępnik na czas wczytywania GIF-a. */
  blurPreview?: string;
}

/** Strona wyników plus informacja, czy jest kolejna. */
export interface KlipyPage {
  gifs: KlipyGif[];
  hasNext: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Adres renditionu przepuszczony przez ALLOWLISTĘ HOSTÓW KLIPY — nic innego nie
 * trafia do `<img src>` ani do treści wiadomości.
 *
 * Świadomie NIE `isGifUrl`: tamta funkcja przepuszcza każdą ścieżkę kończącą się
 * na `.gif`, więc podmieniona albo złośliwa odpowiedź API przemyciłaby
 * `https://obcy.example/pixel.gif` — adres, który wyszedłby z przeglądarki
 * użytkownika i wylądował w bazie jako treść wiadomości.
 */
function asGifUrl(value: unknown): string {
  const raw = asText(value).trim();
  return raw !== '' && isKlipyMediaUrl(raw) ? raw : '';
}

function asSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Zastępnik `blur_preview`. Wpuszczamy WYŁĄCZNIE base64-owy data URI obrazu i
 * to bez znaków, które mogłyby wyjść poza `url()` w stylu — wartość trafia
 * przecież prosto do `background-image`.
 */
const BLUR_PREVIEW = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

function asBlurPreview(value: unknown): string | undefined {
  const raw = asText(value).trim();
  return BLUR_PREVIEW.test(raw) ? raw : undefined;
}

/** Warstwy renditionów w kolejności preferencji. */
type KlipyTier = 'hd' | 'md' | 'sm' | 'xs';

/** Pierwszy dostępny adres `gif` z podanych warstw plus jego wymiary. */
function pickGif(
  file: Record<string, unknown> | null,
  tiers: readonly KlipyTier[],
): { url: string; width: number; height: number } {
  for (const tier of tiers) {
    const gif = asRecord(asRecord(file?.[tier])?.gif);
    const url = asGifUrl(gif?.url);
    if (url !== '') return { url, width: asSize(gif?.width), height: asSize(gif?.height) };
  }
  return { url: '', width: 0, height: 0 };
}

/**
 * Mapowanie odpowiedzi KLIPY. Koperta to `{ result, data }`, a lista pozycji
 * siedzi w `data.data`; `has_next` steruje doładowaniem kolejnej strony.
 * Nigdy nie rzuca — obcy kształt daje pustą stronę.
 */
export function parseKlipyResponse(json: unknown): KlipyPage {
  const envelope = asRecord(json);
  const page = asRecord(envelope?.data);
  const items = Array.isArray(page?.data) ? page.data : [];
  const gifs: KlipyGif[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record === null) continue;
    // Reklamy przychodzą w tej samej tablicy; rozróżnia je `type`.
    if (asText(record.type) !== 'gif') continue;
    const slug = asText(record.slug).trim();
    if (slug === '') continue;
    const file = asRecord(record.file);
    const preview = pickGif(file, ['sm', 'xs']);
    const send = pickGif(file, ['md', 'hd']);
    if (preview.url === '' || send.url === '') continue;
    const title = asText(record.title).trim();
    gifs.push({
      id: slug,
      title: title === '' ? 'GIF' : title,
      previewUrl: preview.url,
      previewWidth: preview.width,
      previewHeight: preview.height,
      sendUrl: send.url,
      blurPreview: asBlurPreview(record.blur_preview),
    });
  }
  return { gifs, hasNext: page?.has_next === true };
}

export interface KlipyShare {
  apiKey: string;
  /** `slug` kafelka z odpowiedzi KLIPY. */
  slug: string;
  /** Ten sam identyfikator, który poszedł w zapytaniu o listę. */
  customerId: string;
  /** Fraza, po której GIF został znaleziony ('' dla listy startowej). */
  query: string;
}

/** Adres i ciało zgłoszenia udostępnienia. */
export interface KlipyShareRequest {
  url: string;
  body: { customer_id: string; q?: string };
}

/**
 * Zgłoszenie udostępnienia — KLIPY uczy na nim personalizację i listę
 * „ostatnich". Wołamy je PO udanej wysyłce wiadomości, nigdy przy najechaniu
 * ani przy malowaniu siatki.
 *
 * `null` znaczy „nie ma czego zgłaszać" (brak klucza, sluga albo identyfikatora
 * użytkownika) — wywołujący pomija wtedy zapytanie zamiast strzelać w
 * niekompletny adres. `q` pomijamy przy liście startowej, bo dokumentacja
 * każe trzymać je puste poza wyszukiwaniem.
 */
export function buildKlipyShareRequest(input: KlipyShare): KlipyShareRequest | null {
  const apiKey = input.apiKey.trim();
  const slug = input.slug.trim();
  const customerId = input.customerId.trim();
  if (apiKey === '' || slug === '' || customerId === '') return null;
  const query = input.query.trim();
  const url = `${KLIPY_BASE}/${encodeURIComponent(apiKey)}/gifs/share/${encodeURIComponent(slug)}`;
  return { url, body: query === '' ? { customer_id: customerId } : { customer_id: customerId, q: query } };
}
