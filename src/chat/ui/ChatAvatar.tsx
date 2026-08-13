// Awatar rozmowy: zdjęcie profilowe rozmówcy (DM) albo kółko z inicjałami
// tytułu (grupa). Zdjęcia bierze `AvatarBase` z `components/Avatar.tsx` — ten
// sam mechanizm co reszta aplikacji (mapa podpisanych URL-i z
// `AvatarUrlsProvider`), więc czat nie ma własnej ścieżki do bucketu.
import { AvatarBase } from '../../components/Avatar';
import { Users } from '../../components/icons';
import type { ChatDirectory } from './chatPeople';

export function ChatAvatar({
  peerId,
  initials,
  directory,
  size = 40,
  isGroup = false,
}: {
  /** Chmurowe uuid rozmówcy (DM); null dla grupy. */
  peerId: string | null;
  initials: string;
  directory: ChatDirectory;
  size?: number;
  isGroup?: boolean;
}) {
  const person = peerId === null ? undefined : directory.get(peerId);
  if (person) {
    return <AvatarBase identity={person} size={size} />;
  }
  // Grupa (albo profil poza zasięgiem RLS): kółko na gradiencie marki.
  // Inicjały tytułu czytają się lepiej niż ikona, więc ikona wchodzi dopiero,
  // gdy z tytułu nie da się nic złożyć.
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  return (
    <span className="avatar n2chat-avatar-group" style={style} aria-hidden>
      {initials === '?' && isGroup ? (
        <Users size={Math.round(size * 0.5)} aria-hidden />
      ) : (
        <span className="avatar-glyphs">{initials}</span>
      )}
    </span>
  );
}
