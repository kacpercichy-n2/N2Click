// Rozwiązane, podpisane URL-e zdjęć profilowych dla CAŁEJ aplikacji.
//
// Źródło prawdy: OrgSnapshot.profiles[].avatarPath (profiles.avatar_path).
// Bucket `avatars` jest prywatny, więc <img> potrzebuje podpisanego URL-a —
// provider rozwiązuje je po każdej zmianie snapshotu (cache TTL w
// avatarStorage) i udostępnia mapy profil-id / e-mail -> URL. Komponent
// Avatar sięga po nie bez propsów, więc zdjęcie działa w każdym miejscu UI
// (panel, zespół, komentarze, kalendarz). W trybie lokalnym i bez zdjęć:
// puste mapy — render identyczny jak przed zmianą (emoji/inicjały).
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { normalizeEmail } from '../auth/profile';
import { useOrgData } from './OrgDataProvider';
import { resolveAvatarUrl } from './avatarStorage';

export interface AvatarUrls {
  byProfileId: ReadonlyMap<string, string>;
  byEmail: ReadonlyMap<string, string>;
}

const EMPTY: AvatarUrls = { byProfileId: new Map(), byEmail: new Map() };

const AvatarUrlsContext = createContext<AvatarUrls>(EMPTY);

/** Mapy zdjęć profilowych; poza providerem (tryb lokalny) — puste mapy. */
export function useAvatarUrls(): AvatarUrls {
  return useContext(AvatarUrlsContext);
}

export function AvatarUrlsProvider({ children }: { children: ReactNode }) {
  const org = useOrgData();
  const [urls, setUrls] = useState<AvatarUrls>(EMPTY);

  const profiles = org.state.status === 'ready' ? org.state.snapshot.profiles : null;

  useEffect(() => {
    if (!profiles) {
      setUrls(EMPTY);
      return;
    }
    const withPhoto = profiles.flatMap((p) => {
      const path = p.avatarPath;
      return path ? [{ profile: p, path }] : [];
    });
    if (withPhoto.length === 0) {
      setUrls(EMPTY);
      return;
    }
    let cancelled = false;
    void Promise.all(
      withPhoto.map(async ({ profile, path }) => ({
        profile,
        url: await resolveAvatarUrl(path),
      })),
    ).then((resolved) => {
      if (cancelled) return;
      const byProfileId = new Map<string, string>();
      const byEmail = new Map<string, string>();
      for (const { profile, url } of resolved) {
        if (!url) continue; // błąd podpisu => inicjały (nieblokujące)
        byProfileId.set(profile.id, url);
        const email = normalizeEmail(profile.email);
        if (email !== '') byEmail.set(email, url);
      }
      setUrls({ byProfileId, byEmail });
    });
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  return <AvatarUrlsContext.Provider value={urls}>{children}</AvatarUrlsContext.Provider>;
}
