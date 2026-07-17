// Czysta walidacja plików awatara oraz decyzje o ścieżce i cache podpisanych
// URL-i. Bez importu SDK Supabase i bez efektów ubocznych — testowalne w node.
//
// Konwencja ścieżki (`<id profilu>/avatar.<ext>`) odpowiada polityce Storage RLS
// z migracji 20260715210500 (`avatars_insert_own` itd.). Retencja i margines
// odświeżania podpisanego URL są ustalone: TTL 3600 s, margines 300 s.

/** Maksymalny rozmiar pliku awatara: 2 MB. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Dozwolone typy MIME → rozszerzenie zapisywanego obiektu. */
export const AVATAR_ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Rozszerzenia akceptowane w awaryjnym dopasowaniu, gdy `type` jest pusty. */
const EXTENSION_FALLBACK: Record<string, string> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

/** Czas życia podpisanego URL (sekundy). */
export const AVATAR_URL_TTL_SECONDS = 3600;
/** Margines odświeżenia przed wygaśnięciem podpisanego URL (sekundy). */
export const AVATAR_URL_REFRESH_MARGIN_SECONDS = 300;

export const AVATAR_ERRORS = {
  type: 'Nieobsługiwany format pliku. Dozwolone formaty: JPG, PNG, WebP.',
  empty: 'Plik jest pusty.',
  tooBig: 'Plik jest za duży (maksymalnie 2 MB).',
} as const;

export type AvatarValidation =
  | { ok: true; ext: string }
  | { ok: false; error: string };

/**
 * Waliduje plik awatara. Kolejność sprawdzeń: dozwolony typ (z awaryjnym
 * dopasowaniem po rozszerzeniu, gdy `type` jest pusty), rozmiar > 0, rozmiar
 * ≤ max. Zwraca rozszerzenie zapisu przy sukcesie.
 */
export function validateAvatarFile(file: {
  name: string;
  type: string;
  size: number;
}): AvatarValidation {
  const type = (file.type ?? '').trim().toLowerCase();
  let ext: string | undefined;
  if (type) {
    ext = AVATAR_ALLOWED_TYPES[type];
  } else {
    const raw = (file.name ?? '').toLowerCase().split('.').pop() ?? '';
    ext = EXTENSION_FALLBACK[raw];
  }
  if (!ext) return { ok: false, error: AVATAR_ERRORS.type };
  if (file.size <= 0) return { ok: false, error: AVATAR_ERRORS.empty };
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, error: AVATAR_ERRORS.tooBig };
  return { ok: true, ext };
}

/** Ścieżka obiektu awatara w buckecie (konwencja RLS `<id profilu>/<plik>`). */
export function avatarObjectPath(profileId: string, ext: string): string {
  return `${profileId}/avatar.${ext}`;
}

export interface SignedUrlEntry {
  url: string;
  expiresAtMs: number;
}

/**
 * Czysta decyzja o użyciu cache podpisanego URL. Zwraca URL, gdy wpis istnieje i
 * do wygaśnięcia pozostaje więcej niż margines odświeżenia; w przeciwnym razie
 * `null` (wołający musi wygenerować nowy podpis). Zegar wstrzykiwany (`nowMs`).
 */
export function cachedSignedUrl(
  cache: Map<string, SignedUrlEntry>,
  path: string,
  nowMs: number,
): string | null {
  const entry = cache.get(path);
  if (!entry) return null;
  if (entry.expiresAtMs - nowMs > AVATAR_URL_REFRESH_MARGIN_SECONDS * 1000) {
    return entry.url;
  }
  return null;
}
