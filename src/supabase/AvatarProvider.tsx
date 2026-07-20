// Jedno źródło zdjęć profilowych dla całego UI (patrz avatarDirectory.ts — cała
// czysta logika planowania żyje tam, testowalna w node).
//
// Buduje katalog „e-mail → podpisany URL awatara” ze snapshotu organizacji
// (OrgDataProvider dostarcza już profile RLS-scoped, więc nie ma dodatkowego
// zapytania po profile) i rozwiązuje podpisane URL-e dla WSZYSTKICH widocznych
// osób, nie tylko zalogowanej. W trybie lokalnym oraz przed zalogowaniem katalog
// jest pusty i żaden klient Supabase nie powstaje.
//
// Awarie są nieblokujące: nierozwiązany URL po prostu nie trafia do mapy, a
// `Avatar` renderuje emoji/inicjały jak dotąd.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { normalizeEmail } from '../auth/profile';
import type { Person } from '../types';
import { useOrgData } from './OrgDataProvider';
import { resolveAvatarUrl } from './avatarStorage';
import { AVATAR_URL_REFRESH_MARGIN_SECONDS, AVATAR_URL_TTL_SECONDS } from './avatarFile';
import {
  avatarDirectoryEntries,
  mergeResolvedAvatars,
  planAvatarFetch,
  type ResolvedAvatar,
} from './avatarDirectory';

interface AvatarContextValue {
  urls: ReadonlyMap<string, ResolvedAvatar>;
  /**
   * Natychmiastowa aktualizacja po zapisie/usunięciu zdjęcia na stronie osoby —
   * katalog nie czeka na kolejne przeładowanie snapshotu organizacji.
   */
  setPersonAvatar: (email: string, avatar: ResolvedAvatar | null) => void;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

/**
 * Odstęp odświeżania podpisów: dokładnie moment, w którym `cachedSignedUrl`
 * przestaje oddawać wpis z cache (TTL minus margines). Wcześniejsze budzenie
 * nic by nie dało — `resolveAvatarUrl` zwróciłby ten sam, wygasający URL.
 * Dzięki temu karta otwarta cały dzień nie kończy z zepsutymi obrazkami.
 */
const AVATAR_REFRESH_MS =
  (AVATAR_URL_TTL_SECONDS - AVATAR_URL_REFRESH_MARGIN_SECONDS) * 1000;

/**
 * Podpisany URL zdjęcia osoby albo `undefined`. Bezpieczne bez dostawcy (testy,
 * ekrany przed zalogowaniem) — zwraca wtedy `undefined`.
 */
export function usePersonPhotoUrl(person: Person | undefined): string | undefined {
  const ctx = useContext(AvatarContext);
  const email = normalizeEmail(person?.email);
  if (!ctx || !email) return undefined;
  return ctx.urls.get(email)?.url;
}

/** Aktualizacja katalogu po zapisie zdjęcia. No-op bez dostawcy. */
export function useSetPersonAvatar(): (email: string, avatar: ResolvedAvatar | null) => void {
  const ctx = useContext(AvatarContext);
  return useCallback(
    (email: string, avatar: ResolvedAvatar | null) => {
      ctx?.setPersonAvatar(email, avatar);
    },
    [ctx],
  );
}

export function AvatarProvider({ children }: { children: ReactNode }) {
  const org = useOrgData();
  const [urls, setUrls] = useState<ReadonlyMap<string, ResolvedAvatar>>(() => new Map());
  // Odczyt bieżącej mapy wewnątrz efektu bez ponownego uruchamiania go po
  // każdym rozwiązanym URL-u (efekt zależy tylko od snapshotu).
  const urlsRef = useRef<ReadonlyMap<string, ResolvedAvatar>>(urls);
  urlsRef.current = urls;

  const profiles = org.state.status === 'ready' ? org.state.snapshot.profiles : null;

  // Cykliczne odświeżenie podpisów (patrz AVATAR_REFRESH_MS).
  const [refreshTick, setRefreshTick] = useState(0);
  const isRefreshRef = useRef(false);
  useEffect(() => {
    if (!profiles) return;
    const id = setInterval(() => {
      isRefreshRef.current = true;
      setRefreshTick((t) => t + 1);
    }, AVATAR_REFRESH_MS);
    return () => clearInterval(id);
  }, [profiles]);

  useEffect(() => {
    if (!profiles) {
      // Wylogowanie / tryb lokalny / błąd snapshotu: katalog pusty.
      setUrls((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let cancelled = false;
    const isRefresh = isRefreshRef.current;
    isRefreshRef.current = false;
    const entries = avatarDirectoryEntries(profiles);
    // Odświeżenie podpisuje WSZYSTKIE wpisy od nowa, ale zostawia bieżące URL-e
    // w stanie do czasu nadejścia nowych — bez migotania na inicjały.
    const plan = planAvatarFetch(entries, isRefresh ? new Map() : urlsRef.current);
    if (!isRefresh && plan.changed) setUrls(plan.kept);
    if (plan.toResolve.length === 0) return;
    void (async () => {
      const resolved = await Promise.all(
        plan.toResolve.map(async (entry) => ({
          email: entry.email,
          path: entry.path,
          url: await resolveAvatarUrl(entry.path),
        })),
      );
      if (cancelled) return;
      setUrls((prev) => mergeResolvedAvatars(prev, resolved));
    })();
    return () => {
      cancelled = true;
    };
  }, [profiles, refreshTick]);

  const setPersonAvatar = useCallback((email: string, avatar: ResolvedAvatar | null) => {
    const key = normalizeEmail(email);
    if (!key) return;
    setUrls((prev) => {
      const next = new Map(prev);
      if (avatar) next.set(key, avatar);
      else next.delete(key);
      return next;
    });
  }, []);

  const value = useMemo<AvatarContextValue>(
    () => ({ urls, setPersonAvatar }),
    [urls, setPersonAvatar],
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}
