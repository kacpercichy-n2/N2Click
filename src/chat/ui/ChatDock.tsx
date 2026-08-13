// Dok czatu w wariancie „bąbelki" (chat heads): pionowa kolumna pływających
// awatarów w prawym dolnym rogu, okno rozmowy na lewo od niej, popover lupy z
// wyszukiwarką i modal „Nowa grupa".
//
// GRANICE / DECYZJE:
//   * `enabled === false` (tryb lokalny, wylogowany) => `null`. Dok montuje się
//     jako rodzeństwo routera, więc nie zna tras i niczego z nich nie potrzebuje.
//   * Nazwiska, inicjały i zdjęcia biorą się ze snapshotu organizacji
//     (`useOrgData`) oraz z map `AvatarUrlsProvider` — czat nie ma własnego
//     źródła tożsamości.
//   * „Ostatnio otwierane" żyją w pamięci sesji (useState). Świadomie NIE
//     zapisujemy ich w localStorage: jedyną granicą trwałości jest
//     `store/storage.ts`, a dok nie jest danymi planera.
//   * Cała decyzyjność (które bąbelki, jaka etykieta, jaka odznaka) siedzi w
//     `chatDockView.ts`; ten plik jest cienki.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Search } from '../../components/icons';
import { useOrgData } from '../../supabase/OrgDataProvider';
import { useChat } from '../ChatProvider';
import { ChatAvatar } from './ChatAvatar';
import { ChatGroupModal } from './ChatGroupModal';
import { ChatSearchPopover } from './ChatSearchPopover';
import { ChatWindow } from './ChatWindow';
import { buildDirectory, type ChatPerson } from './chatPeople';
import { buildDockBubbles, pushRecent, unreadPhrase } from './chatDockView';

const NO_PEOPLE: ChatPerson[] = [];

/**
 * Bramka trybu. Hooki stanu doku żyją w `ChatDockInner`, żeby wyjście przez
 * `null` nie zmieniało kolejności hooków między renderami.
 */
export function ChatDock() {
  const chat = useChat();
  if (!chat.enabled) return null;
  return <ChatDockInner />;
}

function ChatDockInner() {
  const chat = useChat();
  const org = useOrgData();
  const reduceMotion = useReducedMotion();
  const searchTriggerRef = useRef<HTMLButtonElement>(null);

  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const people = useMemo<ChatPerson[]>(
    () =>
      org.state.status === 'ready'
        ? org.state.snapshot.profiles.map((profile) => ({
            id: profile.id,
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
          }))
        : NO_PEOPLE,
    [org.state],
  );
  const directory = useMemo(() => buildDirectory(people), [people]);

  const openId = chat.openConversationId;
  useEffect(() => {
    if (openId === null) return;
    setRecentIds((list) => pushRecent(list, openId));
    setCollapsed(false);
  }, [openId]);

  const bubbles = useMemo(
    () =>
      buildDockBubbles({
        conversations: chat.conversations,
        selfId: chat.selfId,
        directory,
        presence: chat.presence,
        openConversationId: openId,
        recentIds,
      }),
    [chat.conversations, chat.selfId, directory, chat.presence, openId, recentIds],
  );

  const openConversation =
    chat.conversations.find((conversation) => conversation.id === openId) ?? null;

  const selectConversation = (conversationId: string): void => {
    if (conversationId === openId) {
      setCollapsed((value) => !value);
      return;
    }
    chat.openConversation(conversationId);
    setCollapsed(false);
  };

  const totalUnread = unreadPhrase(chat.totalUnread);

  return (
    <div className={`n2chat-dock${openConversation !== null ? ' has-window' : ''}`}>
      <AnimatePresence>
        {openConversation !== null && (
          <ChatWindow
            key={openConversation.id}
            conversation={openConversation}
            directory={directory}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((value) => !value)}
          />
        )}
      </AnimatePresence>

      <div className="n2chat-column">
        {bubbles.map((bubble) => (
          <m.button
            key={bubble.conversationId}
            type="button"
            className={`n2chat-bubble${bubble.active ? ' is-active' : ''}`}
            aria-label={bubble.ariaLabel}
            onClick={() => selectConversation(bubble.conversationId)}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.8 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <ChatAvatar
              peerId={bubble.peerId}
              initials={bubble.initials}
              directory={directory}
              size={44}
              isGroup={bubble.kind === 'group'}
            />
            {bubble.online && <span className="n2chat-dot" aria-hidden />}
            {bubble.badge !== '' && (
              <span className="n2chat-badge" aria-hidden>
                {bubble.badge}
              </span>
            )}
          </m.button>
        ))}

        <button
          type="button"
          ref={searchTriggerRef}
          className={`n2chat-bubble n2chat-bubble-search${searchOpen ? ' is-active' : ''}`}
          aria-label={
            totalUnread === '' ? 'Czat: rozmowy i osoby' : `Czat: rozmowy i osoby, ${totalUnread}`
          }
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((value) => !value)}
        >
          <Search size={20} aria-hidden />
        </button>
      </div>

      <AnimatePresence>
        {searchOpen && (
          <ChatSearchPopover
            key="n2chat-popover"
            directory={directory}
            people={people}
            triggerRef={searchTriggerRef}
            onClose={() => setSearchOpen(false)}
            onOpenConversation={(conversationId) => {
              selectConversation(conversationId);
              setSearchOpen(false);
            }}
            onNewGroup={() => {
              setSearchOpen(false);
              setGroupOpen(true);
            }}
          />
        )}
      </AnimatePresence>

      {groupOpen && (
        <ChatGroupModal
          people={people}
          directory={directory}
          onClose={() => setGroupOpen(false)}
        />
      )}
    </div>
  );
}
