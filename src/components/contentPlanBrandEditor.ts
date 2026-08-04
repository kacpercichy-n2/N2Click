// Czysta logika edytora MARKI Content Planu: słowniki wpisywane po przecinku,
// dopasowanie platform po nazwie (z zachowaniem id i koloru) oraz GUARD
// integralności referencyjnej — nie wolno usunąć ze słownika wartości, której
// używa publikacja tej marki. Zero Reacta, zero store'u.
//
// GRANICE
// - Slug id platformy i normalizacja draftu marki: `contentplan/domain.ts`
//   (`brandSlug`, `normalizeContentPlanBrandDraft`). Tutaj nie ma własnej
//   walidacji zapisu — guard jest LUSTREM w UI, a nie drugą prawdą.
// - Reduktor celowo zostaje LIBERALNY: osierocony kanał ma zachowanie awaryjne
//   (`platformFor`), więc guard blokuje zapis w formularzu, a nie w stanie.
// - Zapis wyłącznie przez `SAVE_CP_BRAND` — stąd wychodzi draft, nigdy encja.
import type { ContentPlanBrand, ContentPlanPlatform, ContentPlanPost } from '../types';
import { brandSlug, type ContentPlanBrandDraft } from '../contentplan/domain';
import { polishCount } from '../utils/polishPlural';

/** Kolory nowych platform w cyklu (port kolejki kolorów z aplikacji źródłowej). */
export const BRAND_PLATFORM_COLORS = ['#1f6fe5', '#7b4cc2', '#0a66c2', '#111827'];

/** Wartości startowe ŚWIEŻEJ marki (port `addBrand`): marka bez słowników nie
 *  ma czym opisać publikacji, więc modal seeduje sensowne minimum. */
export const DEFAULT_BRAND_ACCENT = '#305f72';
export const DEFAULT_BRAND_PLATFORM_NAMES = ['Facebook', 'Instagram'];
export const DEFAULT_BRAND_TOPICS = ['Edukacyjne', 'Oferta', 'Lifestyle'];
export const DEFAULT_BRAND_FORMATS = ['Post', 'Story', 'Rolka'];

/** Stabilne kotwice fokusa pól formularza marki. */
export const BRAND_FIELD_IDS = {
  name: 'cp-brand-name',
  industry: 'cp-brand-industry',
  contact: 'cp-brand-contact',
  accent: 'cp-brand-accent',
  platforms: 'cp-brand-platforms',
  topics: 'cp-brand-topics',
  formats: 'cp-brand-formats',
} as const;

// ---- Słowniki tekstowe -----------------------------------------------------

/** Pozycje słownika z pola tekstowego: podział po przecinku, trim, bez pustych
 *  i bez powtórzeń (kolejność wpisania zostaje). */
export function parseDictionary(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(',')) {
    const value = raw.trim();
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Słownik z powrotem do pola tekstowego. */
export function formatDictionary(values: readonly string[]): string {
  return values.join(', ');
}

/**
 * Platformy marki z listy NAZW. Dopasowanie po nazwie (case-insensitive,
 * `pl-PL`) ZACHOWUJE istniejącą platformę razem z jej `id` i kolorem — kanały
 * publikacji wskazują platformę po id, więc przepisanie nazwy nie może
 * osierocić ani jednego kanału. Nowa nazwa dostaje slug id (z sufiksem
 * antykolizyjnym) i kolor z cyklu.
 */
export function resolvePlatforms(
  existing: readonly ContentPlanPlatform[],
  names: readonly string[],
): ContentPlanPlatform[] {
  const used = new Set(existing.map((platform) => platform.id));
  const out: ContentPlanPlatform[] = [];
  names.forEach((name, index) => {
    const key = name.toLocaleLowerCase('pl-PL');
    const match = existing.find(
      (platform) => platform.name.toLocaleLowerCase('pl-PL') === key,
    );
    if (match !== undefined) {
      out.push(match);
      return;
    }
    const base = brandSlug(name);
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    out.push({
      id,
      name,
      color: BRAND_PLATFORM_COLORS[index % BRAND_PLATFORM_COLORS.length],
    });
  });
  return out;
}

// ---- Guard integralności referencyjnej -------------------------------------

/** Trzy słowniki marki po rozwiązaniu z pól tekstowych. */
export interface ContentPlanDictionaries {
  platforms: readonly ContentPlanPlatform[];
  topics: readonly string[];
  formats: readonly string[];
}

export const EMPTY_DICTIONARY_MESSAGE = 'Każdy słownik musi zawierać co najmniej jedną pozycję.';

function dictionaryKindLabel(kind: 'platforma' | 'temat' | 'typ publikacji'): string {
  return `Nie można usunąć używanej pozycji (${kind}). Najpierw zmień przypisane publikacje.`;
}

/**
 * Powód blokujący zapis słowników (port `saveDictionaries`): pusty słownik albo
 * usunięcie pozycji, której używa publikacja TEJ marki. `null` = wolno zapisać.
 * Puste wartości (`topic`/`format` nieustawione) nie liczą się jako użycie.
 */
export function dictionaryIntegrityIssue(
  brand: Pick<ContentPlanBrand, 'id'>,
  posts: readonly ContentPlanPost[],
  next: ContentPlanDictionaries,
): string | null {
  if (next.platforms.length === 0 || next.topics.length === 0 || next.formats.length === 0) {
    return EMPTY_DICTIONARY_MESSAGE;
  }
  const usedPlatforms = new Set<string>();
  const usedTopics = new Set<string>();
  const usedFormats = new Set<string>();
  for (const post of posts) {
    if (post.brandId !== brand.id) continue;
    for (const channel of post.channels) {
      if (channel.platformId !== '') usedPlatforms.add(channel.platformId);
    }
    if (post.topic !== '') usedTopics.add(post.topic);
    if (post.format !== '') usedFormats.add(post.format);
  }
  if ([...usedPlatforms].some((id) => !next.platforms.some((platform) => platform.id === id))) {
    return dictionaryKindLabel('platforma');
  }
  if ([...usedTopics].some((topic) => !next.topics.includes(topic))) {
    return dictionaryKindLabel('temat');
  }
  if ([...usedFormats].some((format) => !next.formats.includes(format))) {
    return dictionaryKindLabel('typ publikacji');
  }
  return null;
}

// ---- Formularz marki -------------------------------------------------------

/** Stan formularza marki: słowniki żyją jako TEKST, dopóki nie zostaną zapisane. */
export interface ContentPlanBrandForm {
  name: string;
  industry: string;
  contact: string;
  accent: string;
  platformsText: string;
  topicsText: string;
  formatsText: string;
}

/** Seed formularza: istniejąca marka albo wartości startowe nowej. */
export function buildBrandForm(brand?: ContentPlanBrand): ContentPlanBrandForm {
  if (brand === undefined) {
    return {
      name: '',
      industry: '',
      contact: '',
      accent: DEFAULT_BRAND_ACCENT,
      platformsText: formatDictionary(DEFAULT_BRAND_PLATFORM_NAMES),
      topicsText: formatDictionary(DEFAULT_BRAND_TOPICS),
      formatsText: formatDictionary(DEFAULT_BRAND_FORMATS),
    };
  }
  return {
    name: brand.name,
    industry: brand.industry,
    contact: brand.contact,
    // `<input type="color">` nie przyjmuje pustej wartości — marka bez akcentu
    // dostaje kolor startowy, a nie niepoprawną kontrolkę.
    accent: brand.accent === '' ? DEFAULT_BRAND_ACCENT : brand.accent,
    platformsText: formatDictionary(brand.platforms.map((platform) => platform.name)),
    topicsText: formatDictionary(brand.topics),
    formatsText: formatDictionary(brand.formats),
  };
}

/** Słowniki formularza rozwiązane względem platform istniejącej marki. */
export function brandFormDictionaries(
  form: ContentPlanBrandForm,
  existing: readonly ContentPlanPlatform[],
): ContentPlanDictionaries {
  return {
    platforms: resolvePlatforms(existing, parseDictionary(form.platformsText)),
    topics: parseDictionary(form.topicsText),
    formats: parseDictionary(form.formatsText),
  };
}

/** Ładunek `SAVE_CP_BRAND` z formularza. */
export function brandFormToDraft(
  form: ContentPlanBrandForm,
  existing: readonly ContentPlanPlatform[],
): ContentPlanBrandDraft {
  const dictionaries = brandFormDictionaries(form, existing);
  return {
    name: form.name.trim(),
    industry: form.industry.trim(),
    contact: form.contact.trim(),
    accent: form.accent.trim(),
    platforms: [...dictionaries.platforms],
    topics: [...dictionaries.topics],
    formats: [...dictionaries.formats],
  };
}

/** Powód blokujący zapis nazwy (`null` = nazwa w porządku). */
export function brandNameIssue(name: string): string | null {
  return name.trim() === '' ? 'Nazwa marki jest wymagana.' : null;
}

/** Zdanie o skutkach usunięcia marki (kaskada na publikacje). */
export function brandDeleteConsequence(postCount: number): string {
  if (postCount === 0) return 'Ta marka nie ma jeszcze publikacji.';
  return `To usunie ${postCount} ${polishCount(postCount, 'publikację', 'publikacje', 'publikacji')} tej marki.`;
}

/** Ile publikacji należy do marki (licznik do potwierdzenia usunięcia). */
export function brandPostCount(
  brandId: string,
  posts: readonly ContentPlanPost[],
): number {
  return posts.reduce((sum, post) => sum + (post.brandId === brandId ? 1 : 0), 0);
}
