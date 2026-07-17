// Granica nieczysta: upload / usunięcie / rozwiązanie podpisanego URL awatara
// w prywatnym buckecie `avatars` oraz zapis referencji w `public.profiles
// .avatar_path`. Klient Supabase tworzony leniwie (w miejscu użycia, jak
// SessionProvider) — moduł można zaimportować w trybie lokalnym bez tworzenia
// klienta. Funkcje nigdy nie rzucają; zwracają dyskryminowany wynik z polskim
// błędem. Odczyt WYŁĄCZNIE przez `createSignedUrl` (nigdy `getPublicUrl`).

import { getSupabaseClient } from './client';
import { normalizeEmail } from '../auth/profile';
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_URL_TTL_SECONDS,
  avatarObjectPath,
  cachedSignedUrl,
  type SignedUrlEntry,
} from './avatarFile';

const AVATAR_BUCKET = 'avatars';

const ERRORS = {
  fetch: 'Nie udało się pobrać profilu.',
  upload: 'Nie udało się wysłać awatara. Spróbuj ponownie.',
  remove: 'Nie udało się usunąć zdjęcia. Spróbuj ponownie.',
} as const;

// Cache podpisanych URL-i na poziomie modułu (współdzielony między osobami).
const signedUrlCache = new Map<string, SignedUrlEntry>();

export interface AvatarProfile {
  profileId: string;
  avatarPath: string | null;
}

export type FetchAvatarResult =
  | { ok: true; profile: AvatarProfile | null }
  | { ok: false; error: string };

/**
 * Wiersz profilu (id + avatar_path) po e-mailu. `null` = brak konta (RLS może
 * też ukryć niewidoczny profil). Dla samego zalogowanego użytkownika wołający
 * powinien podać id sesji i pominąć to zapytanie.
 */
export async function fetchAvatarProfile(email: string): Promise<FetchAvatarResult> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('profiles')
      .select('id, avatar_path')
      .eq('email', normalizeEmail(email))
      .maybeSingle();
    if (error) return { ok: false, error: ERRORS.fetch };
    if (!data) return { ok: true, profile: null };
    return {
      ok: true,
      profile: {
        profileId: data.id as string,
        avatarPath: (data.avatar_path as string | null) ?? null,
      },
    };
  } catch {
    return { ok: false, error: ERRORS.fetch };
  }
}

export type MutationResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/**
 * Wysyła (upsert) plik do własnego folderu i zapisuje nową ścieżkę w
 * `profiles.avatar_path`. Gdy poprzednia ścieżka różni się od nowej —
 * best-effort usuwa stary obiekt (błąd usuwania ignorowany).
 */
export async function uploadAvatar({
  profileId,
  file,
  ext,
  previousPath,
}: {
  profileId: string;
  file: Blob;
  ext: string;
  previousPath?: string | null;
}): Promise<MutationResult<{ path: string }>> {
  try {
    const client = getSupabaseClient();
    const path = avatarObjectPath(profileId, ext);
    const contentType =
      Object.keys(AVATAR_ALLOWED_TYPES).find((mime) => AVATAR_ALLOWED_TYPES[mime] === ext) ??
      'application/octet-stream';
    const upload = await client.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: true, contentType });
    if (upload.error) return { ok: false, error: ERRORS.upload };

    const update = await client.from('profiles').update({ avatar_path: path }).eq('id', profileId);
    if (update.error) return { ok: false, error: ERRORS.upload };

    if (previousPath && previousPath !== path) {
      // Best-effort sprzątanie starego obiektu (np. inne rozszerzenie).
      await client.storage.from(AVATAR_BUCKET).remove([previousPath]);
      signedUrlCache.delete(previousPath);
    }
    signedUrlCache.delete(path);
    return { ok: true, path };
  } catch {
    return { ok: false, error: ERRORS.upload };
  }
}

/** Usuwa obiekt awatara i zeruje `profiles.avatar_path`. */
export async function removeAvatar({
  profileId,
  avatarPath,
}: {
  profileId: string;
  avatarPath: string;
}): Promise<MutationResult> {
  try {
    const client = getSupabaseClient();
    const removed = await client.storage.from(AVATAR_BUCKET).remove([avatarPath]);
    if (removed.error) return { ok: false, error: ERRORS.remove };
    const update = await client.from('profiles').update({ avatar_path: null }).eq('id', profileId);
    if (update.error) return { ok: false, error: ERRORS.remove };
    signedUrlCache.delete(avatarPath);
    return { ok: true };
  } catch {
    return { ok: false, error: ERRORS.remove };
  }
}

/**
 * Rozwiązuje podpisany URL dla ścieżki awatara (cache modułowy + margines
 * odświeżenia). Błąd/niepowodzenie → `null` (UI wraca do inicjałów; nieblokujące).
 */
export async function resolveAvatarUrl(
  avatarPath: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const cached = cachedSignedUrl(signedUrlCache, avatarPath, nowMs);
  if (cached) return cached;
  try {
    const { data, error } = await getSupabaseClient()
      .storage.from(AVATAR_BUCKET)
      .createSignedUrl(avatarPath, AVATAR_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    signedUrlCache.set(avatarPath, {
      url: data.signedUrl,
      expiresAtMs: nowMs + AVATAR_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  } catch {
    return null;
  }
}
