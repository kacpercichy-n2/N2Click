// Popover bąbelka-lupy: wyszukiwarka rozmów i osób plus wejście do modalu
// „Nowa grupa". Zamykanie (Escape, klik poza, powrót fokusa) niesie wspólna
// powłoka `useOverlay` w wariancie NIEPOZYCJONOWANYM — jak arkusze od dołu:
// panel kotwiczy CSS przy kolumnie bąbelków, więc pomiar kotwicy jest zbędny.
//
// Modal grupy NIE jest dzieckiem tego panelu (renderuje go `ChatDock`), bo
// kliknięcie w portal modala liczy się dla `useOverlay` jako klik na zewnątrz —
// panel by się zamknął i zabrał modal ze sobą.
import { useMemo, useRef, useState, type RefObject } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { Search, Users, Volume2, VolumeX } from '../../components/icons';
import { todayStr } from '../../utils/dates';
import { useChat } from '../ChatProvider';
import { ChatAvatar } from './ChatAvatar';
import type { ChatDirectory, ChatPerson } from './chatPeople';
import { personLabel } from './chatPeople';
import {
  buildConversationRows,
  filterConversationRows,
  filterPeople,
} from './chatDockView';
import { useChatKeyboardInset } from './useChatKeyboardInset';
import { useOverlay } from '../../components/useOverlay';

export function ChatSearchPopover({
  directory,
  people,
  triggerRef,
  onClose,
  onOpenConversation,
  onNewGroup,
}: {
  directory: ChatDirectory;
  people: readonly ChatPerson[];
  triggerRef: RefObject<HTMLElement>;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
  onNewGroup: () => void;
}) {
  const chat = useChat();
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [pendingPersonId, setPendingPersonId] = useState('');

  useOverlay({ open: true, onClose, overlayRef: panelRef, triggerRef });
  // Pole szukania dostaje `autoFocus`, więc na telefonie klawiatura wychodzi
  // razem z panelem — bez tego wcięcia lista rozmów kończyłaby się pod nią.
  useChatKeyboardInset(panelRef);

  const rows = useMemo(
    () =>
      buildConversationRows({
        conversations: chat.conversations,
        selfId: chat.selfId,
        directory,
        presence: chat.presence,
        openConversationId: chat.openConversationId,
        todayStr: todayStr(),
      }),
    [chat.conversations, chat.selfId, chat.presence, chat.openConversationId, directory],
  );
  const visibleRows = useMemo(() => filterConversationRows(rows, query), [rows, query]);
  const visiblePeople = useMemo(
    () => filterPeople(people, query, chat.selfId),
    [people, query, chat.selfId],
  );

  const startDirect = async (personId: string): Promise<void> => {
    if (pendingPersonId !== '') return;
    setPendingPersonId(personId);
    const conversationId = await chat.openDirect(personId);
    setPendingPersonId('');
    if (conversationId !== null) onClose();
  };

  return (
    <m.div
      ref={panelRef}
      className="n2chat-popover"
      role="dialog"
      aria-label="Czat: rozmowy i osoby"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="n2chat-search">
        <Search size={16} aria-hidden className="n2chat-search-icon" />
        <input
          className="n2chat-search-input"
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Szukaj rozmowy lub osoby"
          aria-label="Szukaj rozmowy lub osoby"
        />
      </div>

      <div className="n2chat-popover-body">
        {chat.error !== null && (
          <div className="n2chat-retry">
            <p className="n2chat-error">{chat.error}</p>
            <button type="button" className="btn ghost" onClick={() => chat.refresh()}>
              Spróbuj ponownie
            </button>
          </div>
        )}

        <p className="n2chat-section">Rozmowy</p>
        {chat.conversationsLoading ? (
          <div className="n2chat-skeleton" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        ) : visibleRows.length === 0 ? (
          <p className="n2chat-empty">Brak rozmów.</p>
        ) : (
          visibleRows.map((row) => (
            <button
              key={row.conversationId}
              type="button"
              className={`n2chat-row${row.active ? ' is-active' : ''}`}
              onClick={() => onOpenConversation(row.conversationId)}
            >
              <span className="n2chat-row-avatar">
                <ChatAvatar
                  peerId={row.peerId}
                  initials={row.initials}
                  directory={directory}
                  size={34}
                  isGroup={row.kind === 'group'}
                />
                {row.online && <span className="n2chat-dot" aria-hidden />}
              </span>
              <span className="n2chat-row-text">
                <span className="n2chat-row-title">{row.title}</span>
                <span className="n2chat-row-preview">{row.preview}</span>
              </span>
              <span className="n2chat-row-meta">
                <span className="n2chat-row-time">{row.time}</span>
                {row.badge !== '' && (
                  <span className="n2chat-badge n2chat-badge-inline">{row.badge}</span>
                )}
              </span>
            </button>
          ))
        )}

        <p className="n2chat-section">Osoby</p>
        {visiblePeople.length === 0 ? (
          <p className="n2chat-empty">Brak osób.</p>
        ) : (
          visiblePeople.map((person) => (
            <button
              key={person.id}
              type="button"
              className="n2chat-row"
              disabled={pendingPersonId !== ''}
              onClick={() => void startDirect(person.id)}
            >
              <span className="n2chat-row-avatar">
                <ChatAvatar
                  peerId={person.id}
                  initials="?"
                  directory={directory}
                  size={34}
                />
                {chat.presence.has(person.id) && <span className="n2chat-dot" aria-hidden />}
              </span>
              <span className="n2chat-row-text">
                <span className="n2chat-row-title">{personLabel(directory, person.id)}</span>
                <span className="n2chat-row-preview">{person.email}</span>
              </span>
            </button>
          ))
        )}
      </div>

      <div className="n2chat-popover-foot">
        <button type="button" className="btn ghost n2chat-group-btn" onClick={onNewGroup}>
          <Users size={16} aria-hidden />
          Nowa grupa
        </button>
        <button
          type="button"
          className="btn ghost n2chat-sound-btn"
          aria-pressed={chat.soundEnabled}
          aria-label="Dźwięk nowych wiadomości na tym urządzeniu"
          title={
            chat.soundEnabled
              ? 'Dźwięk nowych wiadomości: włączony (to urządzenie)'
              : 'Dźwięk nowych wiadomości: wyciszony (to urządzenie)'
          }
          onClick={() => chat.setSoundEnabled(!chat.soundEnabled)}
        >
          {chat.soundEnabled ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden />}
          {chat.soundEnabled ? 'Dźwięk wł.' : 'Dźwięk wył.'}
        </button>
      </div>
    </m.div>
  );
}
