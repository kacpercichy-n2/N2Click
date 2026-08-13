// Okno rozmowy zakotwiczone na lewo od kolumny bąbelków. Cienki komponent:
// grupowanie wiadomości, etykiety i stan kompozytora liczy `chatWindowView.ts`.
//
// DECYZJE:
//   * JEDNO okno naraz (kontrakt rdzenia: `openConversationId` jest pojedyncze).
//   * `markRead()` NIE jest tu wołane — robi to `ChatProvider` po wczytaniu
//     pierwszej strony i przy każdej cudzej wiadomości w otwartej rozmowie.
//     Dublowanie tylko mnożyłoby zapisy.
//   * To NIE jest modal: bez pułapki fokusa, bez blokady scrolla, bez `inert`.
//     Fokus wchodzi do kompozytora, Escape zamyka okno, gdy fokus jest w środku.
//   * Dosuwanie scrolla działa tylko wtedy, gdy użytkownik JEST przy dole —
//     czytanie starszych wiadomości nie może być przerywane skokiem.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { ChevronDown, ChevronUp, Send, X } from '../../components/icons';
import { todayStr } from '../../utils/dates';
import { useChat } from '../ChatProvider';
import { CHAT_MESSAGE_MAX_LENGTH, type ChatConversation } from '../types';
import { ChatAvatar } from './ChatAvatar';
import {
  conversationInitials,
  directPeerId,
  isConversationOnline,
  type ChatDirectory,
} from './chatPeople';
import {
  DELETED_MESSAGE_TEXT,
  buildWindowItems,
  composerState,
  isNearBottom,
  isSendKey,
  typingLabel,
  windowSubtitle,
  windowTitle,
} from './chatWindowView';

/** Maksymalna wysokość auto-rosnącego pola treści (potem własny scroll). */
const COMPOSER_MAX_HEIGHT = 120;

export function ChatWindow({
  conversation,
  directory,
  collapsed,
  onToggleCollapse,
}: {
  conversation: ChatConversation;
  directory: ChatDirectory;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const chat = useChat();
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** Czy lista była przy dole PRZED dojściem nowej wiadomości. */
  const stickRef = useRef(true);

  const title = windowTitle(conversation, chat.selfId, directory);
  const subtitle = windowSubtitle(conversation, chat.selfId, chat.presence);
  const online = isConversationOnline(conversation, chat.selfId, chat.presence);
  const items = useMemo(
    () =>
      buildWindowItems({
        messages: chat.messages,
        selfId: chat.selfId,
        directory,
        isGroup: conversation.kind === 'group',
        todayStr: todayStr(),
      }),
    [chat.messages, chat.selfId, directory, conversation.kind],
  );
  const typing = typingLabel(chat.typingUserIds, directory);
  const composer = composerState(draft);

  // Nowa rozmowa => szkic i pozycja scrolla zaczynają od zera.
  useEffect(() => {
    setDraft('');
    stickRef.current = true;
  }, [conversation.id]);

  // Fokus wchodzi do kompozytora przy otwarciu i po rozwinięciu okna.
  useEffect(() => {
    if (!collapsed) composerRef.current?.focus();
  }, [conversation.id, collapsed]);

  // Dosunięcie do dołu PRZED malowaniem — bez migotania listy.
  useLayoutEffect(() => {
    const box = listRef.current;
    if (box === null || collapsed || !stickRef.current) return;
    box.scrollTop = box.scrollHeight;
  }, [items, collapsed]);

  const resizeComposer = (element: HTMLTextAreaElement): void => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  };

  const send = async (): Promise<void> => {
    if (!composer.canSend || sending) return;
    setSending(true);
    const ok = await chat.sendMessage(composer.value);
    setSending(false);
    if (!ok) return;
    setDraft('');
    stickRef.current = true;
    const element = composerRef.current;
    if (element !== null) {
      element.style.height = 'auto';
      element.focus();
    }
  };

  return (
    <m.section
      className={`n2chat-window${collapsed ? ' is-collapsed' : ''}`}
      aria-label={`Rozmowa: ${title}`}
      initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') chat.closeConversation();
      }}
    >
      <header className="n2chat-window-head">
        <ChatAvatar
          peerId={directPeerId(conversation, chat.selfId)}
          initials={conversationInitials(conversation, chat.selfId, directory)}
          directory={directory}
          size={32}
          isGroup={conversation.kind === 'group'}
        />
        <button
          type="button"
          className="n2chat-window-title-btn"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
        >
          <span className="n2chat-window-title">{title}</span>
          {subtitle !== '' && (
            <span className={`n2chat-window-status${online ? ' is-online' : ''}`}>{subtitle}</span>
          )}
        </button>
        <button
          type="button"
          className="n2chat-icon-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Rozwiń rozmowę' : 'Zwiń rozmowę'}
        >
          {collapsed ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </button>
        <button
          type="button"
          className="n2chat-icon-btn"
          onClick={() => chat.closeConversation()}
          aria-label="Zamknij rozmowę"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      {!collapsed && (
        <>
          <div
            className="n2chat-messages"
            ref={listRef}
            onScroll={() => {
              const box = listRef.current;
              if (box !== null) stickRef.current = isNearBottom(box);
            }}
          >
            {chat.hasMore && (
              <div className="n2chat-older">
                <button
                  type="button"
                  className="btn ghost n2chat-older-btn"
                  onClick={() => chat.loadOlder()}
                  disabled={chat.messagesLoading}
                >
                  {chat.messagesLoading ? 'Wczytywanie…' : 'Starsze wiadomości'}
                </button>
              </div>
            )}
            {chat.messagesLoading && chat.messages.length === 0 && (
              <p className="n2chat-empty">Wczytywanie wiadomości…</p>
            )}
            {!chat.messagesLoading && chat.messages.length === 0 && (
              <p className="n2chat-empty">Brak wiadomości. Napisz pierwszą.</p>
            )}
            {items.map((item) =>
              item.kind === 'day' ? (
                <p key={item.key} className="n2chat-day">
                  <span>{item.label}</span>
                </p>
              ) : (
                <div
                  key={item.key}
                  className={`n2chat-group${item.mine ? ' is-mine' : ''}`}
                >
                  {item.showAuthor && <span className="n2chat-author">{item.authorName}</span>}
                  {item.messages.map((message) => (
                    <p
                      key={message.id}
                      className={`n2chat-bubble-msg${message.deleted ? ' is-deleted' : ''}`}
                    >
                      <span className="n2chat-msg-text">
                        {message.deleted ? DELETED_MESSAGE_TEXT : message.body}
                      </span>
                      <span className="n2chat-msg-time">
                        {message.time}
                        {message.edited && ' (edytowana)'}
                      </span>
                    </p>
                  ))}
                </div>
              ),
            )}
          </div>

          <div className="n2chat-composer">
            {typing !== '' && (
              <p className="n2chat-typing" aria-live="polite">
                {typing}
              </p>
            )}
            {chat.error !== null && <p className="n2chat-error">{chat.error}</p>}
            <div className="n2chat-composer-row">
              <textarea
                ref={composerRef}
                className="n2chat-input"
                rows={1}
                value={draft}
                maxLength={CHAT_MESSAGE_MAX_LENGTH}
                placeholder="Napisz wiadomość…"
                aria-label="Treść wiadomości"
                onChange={(event) => {
                  setDraft(event.target.value);
                  resizeComposer(event.target);
                  chat.sendTyping();
                }}
                onKeyDown={(event) => {
                  if (!isSendKey(event)) return;
                  event.preventDefault();
                  void send();
                }}
              />
              <button
                type="button"
                className="n2chat-send"
                onClick={() => void send()}
                disabled={!composer.canSend || sending}
                aria-label="Wyślij wiadomość"
              >
                <Send size={16} aria-hidden />
              </button>
            </div>
            {composer.hint !== '' && <p className="n2chat-error">{composer.hint}</p>}
          </div>
        </>
      )}
    </m.section>
  );
}
