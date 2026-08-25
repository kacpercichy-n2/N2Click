// Czysty model widoku okna rozmowy: grupowanie wiadomości, separatory dat,
// tytuł/status nagłówka, wskaźnik pisania i stan kompozytora. Komponent
// `ChatWindow.tsx` obok tylko to renderuje.
import { polishCount } from '../../utils/polishPlural';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatConversation,
  type ChatMessage,
  type ChatReactionGroup,
} from '../types';
import {
  conversationTitle,
  isConversationOnline,
  otherMemberIds,
  personFirstName,
  type ChatDirectory,
} from './chatPeople';
import { dayKey, formatClock, formatDaySeparator } from './chatTime';
import { themeById } from '../themes/catalog';

/** Wiadomości tego samego autora w tym oknie czasu sklejają się w jedną grupę. */
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Tekst zastępczy miękko usuniętej wiadomości (renderowany kursywą). */
export const DELETED_MESSAGE_TEXT = 'Wiadomość usunięta';

export interface ChatMessageView {
  id: string;
  /** Treść albo '' dla wiadomości usuniętej (wtedy `deleted === true`). */
  body: string;
  deleted: boolean;
  edited: boolean;
  /** „14:05"; '' gdy znacznik nie do sparsowania. */
  time: string;
}

export type ChatWindowItem =
  | { kind: 'day'; key: string; label: string }
  /** Wiersz systemowy (np. zmiana motywu): jedna wyśrodkowana linia. */
  | { kind: 'system'; key: string; id: string; text: string }
  | {
      kind: 'group';
      key: string;
      authorId: string;
      authorName: string;
      /** Autor to zalogowany użytkownik (dymek po prawej, gradient). */
      mine: boolean;
      /** Podpis autora nad dymkiem — tylko cudze wiadomości w grupie. */
      showAuthor: boolean;
      messages: ChatMessageView[];
    };

export interface WindowItemsInput {
  messages: readonly ChatMessage[];
  selfId: string | null;
  directory: ChatDirectory;
  /** Rozmowa grupowa: nad cudzym dymkiem staje imię autora. */
  isGroup: boolean;
  /** Dzisiejsza data 'yyyy-MM-dd' (wstrzykiwana — moduł zostaje czysty). */
  todayStr: string;
}

function toMessageView(message: ChatMessage): ChatMessageView {
  const deleted = message.deletedAt !== null;
  return {
    id: message.id,
    body: deleted ? '' : message.body,
    deleted,
    edited: !deleted && message.editedAt !== null,
    time: formatClock(message.createdAt),
  };
}

/**
 * Lista renderowalna: separator dnia przy każdej zmianie daty i grupy dymków
 * jednego autora. Wejście przychodzi rosnąco (kontrakt rdzenia), więc lecimy
 * jednym przebiegiem bez sortowania.
 */
export function buildWindowItems(input: WindowItemsInput): ChatWindowItem[] {
  const items: ChatWindowItem[] = [];
  let currentDay = '';
  let openGroup: Extract<ChatWindowItem, { kind: 'group' }> | null = null;
  let lastAt = 0;

  for (const message of input.messages) {
    const day = dayKey(message.createdAt);
    const at = new Date(message.createdAt).getTime();
    const validAt = Number.isFinite(at) ? at : 0;

    if (day !== currentDay) {
      currentDay = day;
      openGroup = null;
      items.push({
        kind: 'day',
        key: `day-${day}-${message.id}`,
        label: formatDaySeparator(message.createdAt, input.todayStr),
      });
    }

    // Wiersz systemowy przerywa grupę: nie ma autora w sensie dymka, a dwie
    // wiadomości tej samej osoby po obu stronach nie powinny się sklejać.
    if (message.kind === 'system') {
      openGroup = null;
      lastAt = validAt;
      items.push({
        kind: 'system',
        key: `system-${message.id}`,
        id: message.id,
        text: systemMessageText(message, input.directory),
      });
      continue;
    }

    const sameAuthor = openGroup !== null && openGroup.authorId === message.authorId;
    const closeInTime = validAt - lastAt <= MESSAGE_GROUP_WINDOW_MS;
    if (openGroup !== null && sameAuthor && closeInTime) {
      openGroup.messages.push(toMessageView(message));
    } else {
      const mine = message.authorId === input.selfId;
      openGroup = {
        kind: 'group',
        key: `group-${message.id}`,
        authorId: message.authorId,
        authorName: personFirstName(input.directory, message.authorId),
        mine,
        showAuthor: input.isGroup && !mine,
        messages: [toMessageView(message)],
      };
      items.push(openGroup);
    }
    lastAt = validAt;
  }

  return items;
}

/** Tytuł nagłówka okna: nazwisko rozmówcy (DM) albo nazwa grupy. */
export function windowTitle(
  conversation: ChatConversation,
  selfId: string | null,
  directory: ChatDirectory,
): string {
  return conversationTitle(conversation, selfId, directory);
}

/**
 * Podpis pod tytułem. DM: „Aktywna teraz" tylko gdy rozmówca jest online (brak
 * obecności NIE jest twierdzeniem o kimś — kanał presence może po prostu nie
 * dojechać, więc wtedy nie piszemy nic). Grupa zawsze niesie liczbę osób.
 */
export function windowSubtitle(
  conversation: ChatConversation,
  selfId: string | null,
  presence: ReadonlySet<string>,
): string {
  const online = isConversationOnline(conversation, selfId, presence);
  if (conversation.kind === 'direct') return online ? 'Aktywna teraz' : '';
  const count = otherMemberIds(conversation, selfId).length + 1;
  const people = `${count} ${polishCount(count, 'osoba', 'osoby', 'osób')}`;
  return online ? `${people}, aktywna teraz` : people;
}

/** „Ola pisze…" / „Ola i Marek piszą…" / „Kilka osób pisze…"; '' gdy nikt. */
export function typingLabel(
  typingUserIds: readonly string[],
  directory: ChatDirectory,
): string {
  const names = typingUserIds
    .filter((userId) => userId !== '')
    .map((userId) => personFirstName(directory, userId));
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} pisze…`;
  if (names.length === 2) return `${names[0]} i ${names[1]} piszą…`;
  return 'Kilka osób pisze…';
}

export interface ComposerState {
  /** Treść po przycięciu — dokładnie to leci do `sendMessage`. */
  value: string;
  length: number;
  canSend: boolean;
  overLimit: boolean;
  /** Polski komunikat pod polem; '' gdy wszystko w porządku. */
  hint: string;
}

/** Stan kompozytora: pusty tekst i przekroczony limit blokują wysyłkę. */
export function composerState(raw: string): ComposerState {
  const value = raw.trim();
  const length = raw.length;
  const overLimit = length > CHAT_MESSAGE_MAX_LENGTH;
  return {
    value,
    length,
    canSend: value !== '' && !overLimit,
    overLimit,
    hint: overLimit
      ? `Za długa wiadomość o ${length - CHAT_MESSAGE_MAX_LENGTH} ${polishCount(
          length - CHAT_MESSAGE_MAX_LENGTH,
          'znak',
          'znaki',
          'znaków',
        )}.`
      : '',
  };
}

/** Enter wysyła, Shift+Enter robi nową linię (klawiatura kompozytora). */
export function isSendKey(event: {
  key: string;
  shiftKey: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}): boolean {
  if (event.key !== 'Enter') return false;
  if (event.isComposing === true) return false;
  return !event.shiftKey && event.altKey !== true && event.ctrlKey !== true && event.metaKey !== true;
}

/**
 * Czy lista jest „przy dole". Nowa wiadomość dosuwa scroll TYLKO wtedy — kto
 * czyta starsze, nie zostaje wyrzucony na dół w środku zdania.
 */
export function isNearBottom(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  slack = 80,
): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= slack;
}

/**
 * Który picker kompozytora jest otwarty; najwyżej jeden, bo dzielą miejsce.
 * `react` = ten sam panel emoji, ale w trybie „wybierz jedno" jako reakcja na
 * wiadomość wskazaną przez okno (nie wstawia do pola treści).
 */
export type ComposerPicker = 'none' | 'emoji' | 'gif' | 'react';

/** Panel, który da się otworzyć (czyli wszystko poza „żaden"). */
export type ComposerPickerId = Exclude<ComposerPicker, 'none'>;

/** Klik w przycisk kompozytora: ten sam panel gasi, inny przełącza. */
export function togglePicker(current: ComposerPicker, which: ComposerPickerId): ComposerPicker {
  return current === which ? 'none' : which;
}

/**
 * Sygnał „zamknij" od powłoki popovera (Escape, klik poza). ADRESOWANY: gasi
 * WYŁĄCZNIE panel, który nadal jest otwarty.
 *
 * Bez tego warunku przełączanie emoji↔GIF miało wyścig: `AnimatePresence`
 * trzyma wychodzący panel zamontowanym na czas animacji wyjścia, więc jego
 * `useOverlay` jeszcze żyje i pierwsze kliknięcie w NOWO otwarty panel widzi
 * jako „na zewnątrz". Bezwarunkowe zamknięcie gasiło wtedy świeży panel.
 */
export function dismissPicker(current: ComposerPicker, which: ComposerPickerId): ComposerPicker {
  return current === which ? 'none' : current;
}

// ---- Reakcje ----------------------------------------------------------------

/**
 * Etykieta pigułki reakcji dla czytnika ekranu: nazwa emoji, kto zareagował
 * (imiona, „Ty” dla zalogowanego) i liczba. Nazwa jest STAŁA niezależnie od
 * stanu — czy to moja reakcja, niesie `aria-pressed`, nie tekst.
 */
export function reactionPillLabel(
  group: ChatReactionGroup,
  directory: ChatDirectory,
  selfId: string | null,
  labelOf: (emoji: string) => string,
): string {
  const names = group.userIds.map((userId) =>
    userId === selfId ? 'Ty' : personFirstName(directory, userId),
  );
  const who = names.length > 0 ? `: ${names.join(', ')}` : '';
  const count = group.count > 1 ? ` (${group.count})` : '';
  return `${labelOf(group.emoji)}${who}${count}`;
}

/**
 * Polska treść wiersza systemowego z `meta`. Czas teraźniejszy („ustawia")
 * omija formę rodzajową czasownika — profile nie niosą płci. Brak/nieznane
 * `meta` => zapasowe `body` z serwera.
 */
export function systemMessageText(message: ChatMessage, directory: ChatDirectory): string {
  const meta = message.meta;
  if (meta && meta.type === 'theme_changed') {
    const who = personFirstName(directory, meta.actorId);
    return `${who} ustawia motyw „${themeById(meta.themeId).name}”`;
  }
  return message.body;
}
