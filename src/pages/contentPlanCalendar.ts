// Czysta logika WIDOKU kalendarza modułu Content Plan: grupowanie publikacji po
// dniach, liczniki nagłówka, model karty i ładunki kopiuj/wklej. Zero Reacta,
// zero store'u — `ContentPlanPage.tsx` zostaje cienką warstwą renderu, a całość
// „dane → co widać" testuje się w node (jak `contentPlanRoute.ts`).
//
// GRANICE
// - Arytmetyka miesiąca i dat: `contentplan/domain.ts` nad `utils/dates.ts`.
// - Filtrowanie po marce i miesiącu: selektory (`contentPlanPostsForMonth`) —
//   tutaj przychodzi już GOTOWA lista publikacji jednej marki.
// - Zapis: WYŁĄCZNIE przez `SAVE_CP_POST` (inwariant: jedna granica mutacji),
//   dlatego helpery zwracają DRAFTY, nigdy gotowe encje ze stanu.
import type {
  ContentPlanBrand,
  ContentPlanChannel,
  ContentPlanPlatform,
  ContentPlanPost,
} from '../types';
import type { ContentPlanMonthStats } from '../store/selectors';
import {
  DEFAULT_CONTENT_PLAN_STATUS,
  contentPlanUid,
  makeEmptyPost,
  mediaAspectRatio,
  mediaRatioLabel,
  platformFor,
  type ContentPlanMonthDay,
  type ContentPlanPostDraft,
} from '../contentplan/domain';
import { sortByNamePl } from '../utils/collation';

// ---- Wybór marki -----------------------------------------------------------

/** Pozycja listy wyboru marki. */
export interface ContentPlanBrandOption {
  id: string;
  name: string;
}

/** Marki w kolejności polskiej kolacji (jedyne źródło sortowania nazw w repo). */
export function contentPlanBrandOptions(
  brands: readonly ContentPlanBrand[],
): ContentPlanBrandOption[] {
  return sortByNamePl(brands).map((brand) => ({ id: brand.id, name: brand.name }));
}

/**
 * Marka do pokazania: żądana, jeśli nadal istnieje, w przeciwnym razie PIERWSZA
 * po polsku (usunięcie marki nie może zostawić pustego widoku). Brak marek =>
 * '' — wtedy strona pokazuje pusty stan zamiast siatki.
 */
export function resolveContentPlanBrandId(
  brands: readonly ContentPlanBrand[],
  requested: string,
): string {
  if (requested !== '' && brands.some((brand) => brand.id === requested)) return requested;
  return contentPlanBrandOptions(brands)[0]?.id ?? '';
}

// ---- Siatka dni ------------------------------------------------------------

/** Dzień siatki wraz z publikacjami tego dnia (kolejność listy wejściowej). */
export interface ContentPlanCalendarDay extends ContentPlanMonthDay {
  posts: ContentPlanPost[];
}

/**
 * Publikacje rozłożone na dni miesiąca. Wejście jest już zawężone do jednej
 * marki i jednego miesiąca (selektor), więc publikacja spoza listy dni po
 * prostu nie ma gdzie usiąść i jest pomijana — siatka nigdy nie gubi dnia.
 */
export function contentPlanDaysWithPosts(
  days: readonly ContentPlanMonthDay[],
  posts: readonly ContentPlanPost[],
): ContentPlanCalendarDay[] {
  const byDate = new Map<string, ContentPlanPost[]>();
  for (const post of posts) {
    const bucket = byDate.get(post.date);
    if (bucket) bucket.push(post);
    else byDate.set(post.date, [post]);
  }
  return days.map((day) => ({ ...day, posts: byDate.get(day.date) ?? [] }));
}

// ---- Liczniki miesiąca -----------------------------------------------------

/** Ile publikacji czeka na decyzję (statusy klienta: „Do akceptacji", „Uwagi"). */
export function contentPlanReviewCount(stats: ContentPlanMonthStats): number {
  return stats.byStatus['Do akceptacji'] + stats.byStatus.Uwagi;
}

/** Trzeci licznik nagłówka: decyzje mają pierwszeństwo, w ich braku szkice
 *  (parytet z aplikacją źródłową — jedno pole, dwa znaczenia). */
export function contentPlanDecisionMetric(stats: ContentPlanMonthStats): {
  value: number;
  label: string;
} {
  const review = contentPlanReviewCount(stats);
  return review > 0
    ? { value: review, label: 'wymaga decyzji' }
    : { value: stats.drafts, label: 'robocze' };
}

/** Jedna pozycja rozkładu kanałów w nagłówku miesiąca. */
export interface ContentPlanPlatformCount {
  platform: ContentPlanPlatform;
  count: number;
}

/**
 * Ile KANAŁÓW przypada na platformę marki (publikacja z trzema platformami
 * liczy się trzy razy — to rozkład pracy, nie liczba publikacji). Platformy bez
 * ani jednego kanału odpadają; kolejność zostaje słownikowa (kolejność marki).
 */
export function contentPlanPlatformBreakdown(
  brand: ContentPlanBrand,
  posts: readonly ContentPlanPost[],
): ContentPlanPlatformCount[] {
  return brand.platforms
    .map((platform) => ({
      platform,
      count: posts.reduce(
        (sum, post) =>
          sum + post.channels.filter((channel) => channel.platformId === platform.id).length,
        0,
      ),
    }))
    .filter(({ count }) => count > 0);
}

// ---- Model karty publikacji ------------------------------------------------

/** Wszystko, co karta dnia pokazuje o publikacji — policzone RAZ, poza JSX-em. */
export interface ContentPlanCardView {
  /** Platformy kanałów, bez powtórzeń, w kolejności kanałów publikacji. */
  platforms: ContentPlanPlatform[];
  /** Pierwszy niepusty opis (albo '' — wtedy karta pisze o braku opisu). */
  primaryCopy: string;
  /** Czy publikacja niesie jakiekolwiek tagi (własne kanału albo bazowe). */
  hasTags: boolean;
  /** Czy pierwszy kanał z plikiem niesie wideo (miniatura ma inny podpis). */
  isVideo: boolean;
  /** Identyfikator pliku Drive pierwszego kanału z mediami; '' = brak pliku. */
  mediaFileId: string;
  /** Skrócona proporcja pliku („4:5") albo null, gdy wymiary nie są znane. */
  ratioLabel: string | null;
  /** Proporcja kadru miniatury (CSS `aspect-ratio`). */
  aspectRatio: string;
}

export function contentPlanCardView(
  brand: ContentPlanBrand,
  post: ContentPlanPost,
): ContentPlanCardView {
  const platforms: ContentPlanPlatform[] = [];
  const seen = new Set<string>();
  for (const channel of post.channels) {
    // `platformFor` ma zachowanie awaryjne: kanał osierocony przez zmianę
    // słownika nadal pokazuje pigułkę (pierwszej platformy marki).
    const platform = platformFor(brand, channel.platformId);
    if (!platform || seen.has(platform.id)) continue;
    seen.add(platform.id);
    platforms.push(platform);
  }
  const withMedia = post.channels.find((channel) => channel.media !== undefined);
  const overrideTags = post.channels.some(
    (channel) => channel.overrideTags && channel.tags.trim() !== '',
  );
  return {
    platforms,
    primaryCopy: post.channels.find((channel) => channel.copy.trim() !== '')?.copy ?? '',
    hasTags: overrideTags || post.baseTags.trim() !== '',
    isVideo: withMedia?.media?.type === 'video',
    mediaFileId: withMedia?.media?.fileId ?? '',
    ratioLabel: mediaRatioLabel(withMedia),
    aspectRatio: mediaAspectRatio(withMedia, post.format),
  };
}

// ---- Drafty: nowy slot i wklejenie -----------------------------------------

/** Ładunek `SAVE_CP_POST` dla PUSTEGO slotu w danym dniu. Encję i tak buduje
 *  reduktor — stąd wychodzi wyłącznie draft, bez id, historii i znaczników. */
export function contentPlanEmptyDraft(brand: ContentPlanBrand, date: string): ContentPlanPostDraft {
  const post = makeEmptyPost(brand, date);
  return {
    brandId: post.brandId,
    date: post.date,
    title: post.title,
    topic: post.topic,
    format: post.format,
    status: post.status,
    visibility: post.visibility,
    baseTags: post.baseTags,
    channels: post.channels,
  };
}

/**
 * Ładunek `SAVE_CP_POST` dla WKLEJENIA skopiowanej publikacji w inny dzień
 * (port `pastePost` z aplikacji źródłowej):
 * - kanały spoza słownika marki odpadają, reszta dostaje ŚWIEŻE id (dwie
 *   publikacje nie mogą dzielić identyfikatora kanału),
 * - brak pasującego kanału => jeden kanał na pierwszej platformie marki
 *   z opisem oryginału (marka bez platform zostaje bez kanałów — draft i tak
 *   jest poprawny, udostępnić się go nie da),
 * - temat i format spadają na pierwszą wartość słownika, gdy oryginalna do
 *   marki nie należy,
 * - kopia zawsze startuje jako SZKIC w statusie roboczym: wklejenie nie może
 *   po cichu udostępnić czegoś klientowi.
 * Generator id jest wstrzykiwany, żeby test mógł sprawdzić wartości.
 */
export function contentPlanPasteDraft(
  source: ContentPlanPost,
  brand: ContentPlanBrand,
  date: string,
  uid: () => string = contentPlanUid,
): ContentPlanPostDraft {
  const kept: ContentPlanChannel[] = source.channels
    .filter((channel) => brand.platforms.some((platform) => platform.id === channel.platformId))
    .map((channel) => ({ ...channel, id: uid() }));
  const firstPlatform = brand.platforms[0];
  const channels =
    kept.length > 0
      ? kept
      : firstPlatform
        ? [
            {
              id: uid(),
              platformId: firstPlatform.id,
              copy: source.channels[0]?.copy ?? '',
              tags: '',
              overrideTags: false,
            },
          ]
        : [];
  return {
    brandId: brand.id,
    date,
    title: source.title,
    topic: brand.topics.includes(source.topic) ? source.topic : (brand.topics[0] ?? ''),
    format: brand.formats.includes(source.format) ? source.format : (brand.formats[0] ?? ''),
    status: DEFAULT_CONTENT_PLAN_STATUS,
    visibility: 'draft',
    baseTags: source.baseTags,
    channels,
  };
}
