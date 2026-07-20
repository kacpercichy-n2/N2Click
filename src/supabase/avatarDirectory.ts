// Czysta logika katalogu awatarów: z listy profilów chmury (RLS-scoped) buduje
// mapę „e-mail → ścieżka obiektu awatara” i planuje, dla których wpisów trzeba
// wygenerować NOWY podpisany URL, a które można zachować z poprzedniego stanu.
//
// Klucz to znormalizowany e-mail, bo lokalny planer wiąże osoby z kontami po
// e-mailu (patrz `findPersonByEmail`), a nie po id profilu chmury.
//
// Bez importu SDK Supabase i bez Reacta — testowalne w node. Warstwa nieczysta
// (podpisane URL-e, cykl życia) żyje w AvatarProvider.tsx.

import { normalizeEmail } from '../auth/profile';

/** Rozwiązany awatar jednej osoby: ścieżka obiektu + jej podpisany URL. */
export interface ResolvedAvatar {
  path: string;
  url: string;
}

/** Wpis katalogu: znormalizowany e-mail + ścieżka obiektu do podpisania. */
export interface AvatarDirectoryEntry {
  email: string;
  path: string;
}

/**
 * Wpisy katalogu z profilów chmury: tylko profile z niepustą ścieżką awatara i
 * niepustym e-mailem. Duplikaty e-maila rozstrzyga PIERWSZY wiersz (kolejność
 * snapshotu), żeby wynik był deterministyczny.
 */
export function avatarDirectoryEntries(
  profiles: readonly { email: string; avatarPath: string | null }[],
): AvatarDirectoryEntry[] {
  const seen = new Set<string>();
  const entries: AvatarDirectoryEntry[] = [];
  for (const profile of profiles) {
    if (!profile.avatarPath) continue;
    const email = normalizeEmail(profile.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    entries.push({ email, path: profile.avatarPath });
  }
  return entries;
}

export interface AvatarFetchPlan {
  /** Wpisy wymagające nowego podpisanego URL (brak w cache albo zmiana ścieżki). */
  toResolve: AvatarDirectoryEntry[];
  /** Stan wyjściowy: wyłącznie wpisy nadal obecne w katalogu i z tą samą ścieżką. */
  kept: Map<string, ResolvedAvatar>;
  /** Czy `kept` różni się od `known` (sterowanie setState bez zbędnego renderu). */
  changed: boolean;
}

/**
 * Planuje odświeżenie katalogu wobec już rozwiązanych awatarów. Wpis zachowany,
 * gdy ta sama osoba ma tę samą ścieżkę; zmiana ścieżki (nowe zdjęcie) i wejścia
 * nieznane trafiają do `toResolve`; osoby, które zniknęły z katalogu (usunięte
 * zdjęcie albo utrata widoczności RLS), są z mapy usuwane.
 */
export function planAvatarFetch(
  entries: readonly AvatarDirectoryEntry[],
  known: ReadonlyMap<string, ResolvedAvatar>,
): AvatarFetchPlan {
  const toResolve: AvatarDirectoryEntry[] = [];
  const kept = new Map<string, ResolvedAvatar>();
  for (const entry of entries) {
    const cached = known.get(entry.email);
    if (cached && cached.path === entry.path) {
      kept.set(entry.email, cached);
      continue;
    }
    toResolve.push(entry);
  }
  const changed = kept.size !== known.size;
  return { toResolve, kept, changed };
}

/**
 * Scala rozwiązane URL-e w nową mapę. `null` oznacza nieudane podpisanie —
 * wpis jest pomijany (UI wraca do inicjałów), nigdy nie blokuje renderu.
 */
export function mergeResolvedAvatars(
  base: ReadonlyMap<string, ResolvedAvatar>,
  resolved: readonly { email: string; path: string; url: string | null }[],
): Map<string, ResolvedAvatar> {
  const next = new Map(base);
  for (const item of resolved) {
    if (!item.url) {
      next.delete(item.email);
      continue;
    }
    next.set(item.email, { path: item.path, url: item.url });
  }
  return next;
}
