// Czysta warstwa danych czatu: granica bazy (wstrzykiwany `ChatDb`), mapowanie
// wierszy snake_case → typy domenowe i operacje (overview, DM, grupa, strona
// wiadomości, wysyłka, odczyt). Zero Reacta, zero SDK w logice — testowalne w
// node na atrapie klienta (patrz `chatData.test.ts`).
//
// GRANICE / INVARIANTY:
//   * Ten moduł nie dotyka localStorage ani reduktora aplikacji.
//   * Mapowanie jest ŁAGODNE: wiersz nie do odczytania jest POMIJANY, nigdy nie
//     wyrzuca wyjątku — jedna zepsuta wiadomość nie może wygasić całej listy.
//   * Błędy wracają jako polski komunikat w `ChatResult`; surowy tekst SDK
//     zostaje w warstwie technicznej.
//   * Klient Supabase jest przypięty do schematu `n2click` (src/supabase/client.ts),
//     więc `from('messages')` trafia w `n2click.messages`.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHAT_MESSAGES,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  isChatConversationKind,
  isChatMemberRole,
  type ChatConversation,
  type ChatLastMessage,
  type ChatMember,
  type ChatMessage,
  type ChatMessageCursor,
  type ChatMessagesPage,
  type ChatResult,
} from './types';

// ---- Granica bazy (wstrzykiwana) --------------------------------------------

export type ChatRow = Record<string, unknown>;

/** Błąd z PostgREST w minimalnym kształcie (kod potrzebny do 23505). */
export interface ChatDbError {
  code: string | null;
  message: string;
}

/** Zapytanie o wiadomości jednej rozmowy (kursor jako gotowy filtr `or`). */
export interface ChatMessagesQuery {
  conversationId: string;
  /** Filtr kursora dla `.or(...)`; null = pierwsza strona / brak zawężenia. */
  orFilter: string | null;
  /** Kierunek `created_at`/`id`: false = najnowsze pierwsze (strona wstecz). */
  ascending: boolean;
  limit: number;
}

export interface ChatDb {
  /** RPC `chat_overview()` — rozmowy zalogowanego (RLS filtruje po stronie bazy). */
  overview(): Promise<{ rows: ChatRow[]; error: ChatDbError | null }>;
  selectMessages(query: ChatMessagesQuery): Promise<{ rows: ChatRow[]; error: ChatDbError | null }>;
  /** Atomowe znajdź-albo-załóż DM-u (RPC `chat_open_direct`): rozmowa pary
   *  + komplet członków w JEDNEJ transakcji serwera. Definer widzi i leczy
   *  także osierocony DM (rozmowa bez członków), którego RLS ukrywa przed
   *  nie-twórcą — klejenie z osobnych żądań kończyło się tam twardym błędem
   *  bez ścieżki naprawy (zgłoszenie 2026-08-24). */
  openDirectAtomic(otherUserId: string): Promise<{ id: string | null; error: ChatDbError | null }>;
  /** Atomowe utworzenie grupy (RPC `chat_create_group`): rozmowa + komplet
   *  członków w JEDNEJ transakcji serwera. Grupa nie ma `direct_key`, więc
   *  częściowy zapis składu nie miałby ścieżki naprawy. */
  createGroupAtomic(
    title: string,
    memberIds: string[],
  ): Promise<{ id: string | null; error: ChatDbError | null }>;
  insertMessage(row: ChatRow): Promise<{ row: ChatRow | null; error: ChatDbError | null }>;
  updateLastReadAt(
    conversationId: string,
    userId: string,
    atIso: string,
  ): Promise<{ error: ChatDbError | null }>;
}

function toDbError(error: unknown, fallback: string): ChatDbError {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === 'string' ? e.code : null,
      message: typeof e.message === 'string' ? e.message : fallback,
    };
  }
  return { code: null, message: error instanceof Error ? error.message : fallback };
}

/** Cienki adapter nad klientem Supabase — jedyne miejsce, które zna SDK. */
export function createSupabaseChatDb(client: SupabaseClient): ChatDb {
  const rows = (data: unknown): ChatRow[] =>
    Array.isArray(data) ? (data as unknown as ChatRow[]) : [];
  return {
    async overview() {
      try {
        const { data, error } = await client.rpc('chat_overview');
        if (error) return { rows: [], error: toDbError(error, 'Błąd zapytania.') };
        return { rows: rows(data), error: null };
      } catch (e) {
        return { rows: [], error: toDbError(e, 'Błąd zapytania.') };
      }
    },
    async selectMessages(query) {
      try {
        let q = client.from('messages').select('*').eq('conversation_id', query.conversationId);
        if (query.orFilter) q = q.or(query.orFilter);
        const { data, error } = await q
          .order('created_at', { ascending: query.ascending })
          .order('id', { ascending: query.ascending })
          .limit(query.limit);
        if (error) return { rows: [], error: toDbError(error, 'Błąd zapytania.') };
        return { rows: rows(data), error: null };
      } catch (e) {
        return { rows: [], error: toDbError(e, 'Błąd zapytania.') };
      }
    },
    async openDirectAtomic(otherUserId) {
      try {
        const { data, error } = await client.rpc('chat_open_direct', {
          p_other_user_id: otherUserId,
        });
        if (error) return { id: null, error: toDbError(error, 'Błąd zapisu.') };
        return { id: typeof data === 'string' && data !== '' ? data : null, error: null };
      } catch (e) {
        return { id: null, error: toDbError(e, 'Błąd zapisu.') };
      }
    },
    async createGroupAtomic(title, memberIds) {
      try {
        const { data, error } = await client.rpc('chat_create_group', {
          p_title: title,
          p_member_ids: memberIds,
        });
        if (error) return { id: null, error: toDbError(error, 'Błąd zapisu.') };
        return { id: typeof data === 'string' && data !== '' ? data : null, error: null };
      } catch (e) {
        return { id: null, error: toDbError(e, 'Błąd zapisu.') };
      }
    },
    async insertMessage(row) {
      try {
        const { data, error } = await client.from('messages').insert(row).select('*').maybeSingle();
        if (error) return { row: null, error: toDbError(error, 'Błąd zapisu.') };
        return { row: (data ?? null) as ChatRow | null, error: null };
      } catch (e) {
        return { row: null, error: toDbError(e, 'Błąd zapisu.') };
      }
    },
    async updateLastReadAt(conversationId, userId, atIso) {
      try {
        const { error } = await client
          .from('conversation_members')
          .update({ last_read_at: atIso })
          .eq('conversation_id', conversationId)
          .eq('user_id', userId);
        if (error) return { error: toDbError(error, 'Błąd zapisu.') };
        return { error: null };
      } catch (e) {
        return { error: toDbError(e, 'Błąd zapisu.') };
      }
    },
  };
}

// ---- Mapowanie wierszy -------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

function count(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** jsonb bywa już sparsowany przez SDK, ale bronimy się też przed stringiem. */
function asRecord(v: unknown): ChatRow | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as ChatRow;
  if (typeof v === 'string' && v !== '') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as ChatRow;
    } catch {
      return null;
    }
  }
  return null;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v !== '') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

export function toChatMember(value: unknown): ChatMember | null {
  const row = asRecord(value);
  if (!row) return null;
  const userId = str(row.user_id);
  if (userId === '') return null;
  const role = isChatMemberRole(row.role) ? row.role : 'member';
  return { userId, role, lastReadAt: nullableStr(row.last_read_at) };
}

export function toChatLastMessage(value: unknown): ChatLastMessage | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = str(row.id);
  const createdAt = str(row.created_at);
  if (id === '' || createdAt === '') return null;
  return {
    id,
    authorId: str(row.author_id),
    body: str(row.body),
    createdAt,
    deletedAt: nullableStr(row.deleted_at),
  };
}

/** Wiersz `chat_overview()` → rozmowa. Zły wiersz => null (pomijamy). */
export function toChatConversation(row: ChatRow): ChatConversation | null {
  const id = str(row.id);
  if (id === '' || !isChatConversationKind(row.kind)) return null;
  const members = asArray(row.members)
    .map(toChatMember)
    .filter((m): m is ChatMember => m !== null);
  return {
    id,
    kind: row.kind,
    title: nullableStr(row.title),
    members,
    createdBy: nullableStr(row.created_by),
    lastMessageAt: nullableStr(row.last_message_at),
    lastMessage: toChatLastMessage(row.last_message),
    unreadCount: count(row.unread_count),
  };
}

/** Wiersz `messages` → wiadomość. Brak id/rozmowy/autora/daty => null. */
export function toChatMessage(row: unknown): ChatMessage | null {
  const record = asRecord(row);
  if (!record) return null;
  const id = str(record.id);
  const conversationId = str(record.conversation_id);
  const authorId = str(record.author_id);
  const createdAt = str(record.created_at);
  if (id === '' || conversationId === '' || authorId === '' || createdAt === '') return null;
  return {
    id,
    conversationId,
    authorId,
    body: str(record.body),
    createdAt,
    editedAt: nullableStr(record.edited_at),
    deletedAt: nullableStr(record.deleted_at),
    replyTo: nullableStr(record.reply_to),
  };
}

/**
 * Wyłuskuje wiersz z ładunku broadcastu `realtime.broadcast_changes`. SDK
 * opakowuje wysłany ładunek w kopertę (`{ type, event, payload }`), ale w
 * zależności od wersji/ścieżki wywołania `record` bywa też na wierzchu — obie
 * postacie obsługujemy, bo pomyłka tutaj wycisza CAŁY strumień wiadomości.
 */
export function extractBroadcastRecord(raw: unknown): ChatRow | null {
  const envelope = asRecord(raw);
  if (!envelope) return null;
  const inner = asRecord(envelope.payload);
  if (inner && 'record' in inner) return asRecord(inner.record);
  if ('record' in envelope) return asRecord(envelope.record);
  return null;
}

// ---- Pomocnicze czyste funkcje ----------------------------------------------

/**
 * Wartość do filtra PostgREST w cudzysłowie. Znaki `"`, `\`, `(`, `)` i `,`
 * rozbijają parser drzewa logicznego `or=(...)`; w uuid ani w ISO timestampie
 * nie występują, więc usunięcie ich jest no-opem na poprawnych danych i
 * zaporą na niepoprawnych.
 */
function filterValue(value: string): string {
  return `"${value.replace(/["\\(),]/g, '')}"`;
}

/** Wiersze STARSZE niż kursor w porządku `(created_at, id)`. */
export function buildOlderThanFilter(cursor: ChatMessageCursor): string {
  const at = filterValue(cursor.createdAt);
  const id = filterValue(cursor.id);
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`;
}

/** Wiersze NOWSZE niż kursor — nadrabianie luki po zerwaniu kanału. */
export function buildNewerThanFilter(cursor: ChatMessageCursor): string {
  const at = filterValue(cursor.createdAt);
  const id = filterValue(cursor.id);
  return `created_at.gt.${at},and(created_at.eq.${at},id.gt.${id})`;
}

// ---- Operacje ----------------------------------------------------------------

/** Rozmowy zalogowanego użytkownika, posortowane od najświeższej. */
export async function loadOverview(db: ChatDb): Promise<ChatResult<ChatConversation[]>> {
  const { rows, error } = await db.overview();
  if (error) return { ok: false, error: CHAT_MESSAGES.load };
  const conversations = rows
    .map(toChatConversation)
    .filter((c): c is ChatConversation => c !== null);
  return { ok: true, value: conversations };
}

/**
 * Otwiera (albo tworzy) DM z inną osobą i zwraca id rozmowy.
 *
 * Jedno wywołanie RPC = jedna transakcja serwera: znajdź-albo-załóż rozmowę
 * pary + komplet członków. Klucz pary, deduplikację i naprawę osieroconego
 * DM-u (rozmowa bez członków, niewidoczna dla nie-twórcy przez RLS) robi
 * definer `chat_open_direct` — klejenie z osobnych żądań zostawiało tam
 * zakleszczenie bez ścieżki naprawy (zgłoszenie 2026-08-24).
 */
export async function openDirect(
  db: ChatDb,
  selfId: string,
  otherUserId: string,
): Promise<ChatResult<string>> {
  if (selfId === '' || otherUserId === '') return { ok: false, error: CHAT_MESSAGES.open };
  if (selfId === otherUserId) return { ok: false, error: CHAT_MESSAGES.selfDirect };
  const opened = await db.openDirectAtomic(otherUserId);
  if (opened.error || opened.id === null) return { ok: false, error: CHAT_MESSAGES.open };
  return { ok: true, value: opened.id };
}

/**
 * Tworzy grupę i zwraca jej id. Twórca dostaje rolę `owner` i jest wstawiany
 * jako pierwszy (patrz uwaga o RLS w `openDirect`); pozostali `member`.
 */
export async function createGroup(
  db: ChatDb,
  selfId: string,
  title: string,
  memberIds: string[],
): Promise<ChatResult<string>> {
  if (selfId === '') return { ok: false, error: CHAT_MESSAGES.create };
  const cleanTitle = title.trim();
  if (cleanTitle === '') return { ok: false, error: CHAT_MESSAGES.emptyTitle };
  const others = Array.from(new Set(memberIds.filter((id) => id !== '' && id !== selfId)));
  if (others.length === 0) return { ok: false, error: CHAT_MESSAGES.noMembers };

  // Jedno wywołanie RPC = jedna transakcja serwera: rozmowa, owner i wszyscy
  // członkowie powstają razem albo wcale. Grupa nie ma `direct_key`, więc
  // klejenie składu z osobnych żądań nie miało ścieżki naprawy po padnięciu
  // w połowie (przegląd 2026-08-13).
  const created = await db.createGroupAtomic(cleanTitle, others);
  if (created.error || created.id === null) return { ok: false, error: CHAT_MESSAGES.create };
  return { ok: true, value: created.id };
}

/**
 * Strona wiadomości: zapytanie leci MALEJĄCO (najnowsze pierwsze, limit), a
 * wynik wraca ROSNĄCO — UI dostaje gotową chronologię. `hasMore` liczymy na
 * SUROWYCH wierszach (pełna strona = są starsze), a kursor bierzemy z
 * najstarszego surowego wiersza, żeby pominięta (niezmapowana) wiadomość nie
 * zapętliła paginacji na tej samej stronie.
 */
export async function loadMessagesPage(
  db: ChatDb,
  conversationId: string,
  cursor: ChatMessageCursor | null,
  limit: number = CHAT_PAGE_SIZE,
): Promise<ChatResult<ChatMessagesPage>> {
  const { rows, error } = await db.selectMessages({
    conversationId,
    orFilter: cursor ? buildOlderThanFilter(cursor) : null,
    ascending: false,
    limit,
  });
  if (error) return { ok: false, error: CHAT_MESSAGES.messages };
  const descending = rows.map(toChatMessage).filter((m): m is ChatMessage => m !== null);
  const messages = descending.slice().reverse();
  const oldestRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const oldestCursor = oldestRow ? rowCursor(oldestRow) : null;
  return {
    ok: true,
    value: {
      messages,
      hasMore: rows.length >= limit,
      cursor: oldestCursor ?? (messages.length > 0 ? messageCursor(messages[0]) : null),
    },
  };
}

function rowCursor(row: ChatRow): ChatMessageCursor | null {
  const createdAt = str(row.created_at);
  const id = str(row.id);
  if (createdAt === '' || id === '') return null;
  return { createdAt, id };
}

/** Kursor z wiadomości (najstarsza => wstecz, najnowsza => nadrabianie luki). */
export function messageCursor(message: ChatMessage): ChatMessageCursor {
  return { createdAt: message.createdAt, id: message.id };
}

/**
 * Wiadomości NOWSZE niż kursor, rosnąco. Używane po powrocie kanału
 * (`SUBSCRIBED` po przerwie): broadcast nie gwarantuje dostarczenia, więc lukę
 * z martwego okna trzeba dociągnąć zapytaniem. Brak kursora => pierwsza strona.
 */
export async function loadMessagesSince(
  db: ChatDb,
  conversationId: string,
  cursor: ChatMessageCursor | null,
  limit: number = CHAT_PAGE_SIZE,
): Promise<ChatResult<ChatMessage[]>> {
  if (!cursor) {
    const page = await loadMessagesPage(db, conversationId, null, limit);
    return page.ok ? { ok: true, value: page.value.messages } : page;
  }
  const { rows, error } = await db.selectMessages({
    conversationId,
    orFilter: buildNewerThanFilter(cursor),
    ascending: true,
    limit,
  });
  if (error) return { ok: false, error: CHAT_MESSAGES.messages };
  return { ok: true, value: rows.map(toChatMessage).filter((m): m is ChatMessage => m !== null) };
}

/**
 * Wysyła wiadomość i zwraca WSTAWIONY wiersz (id i `created_at` pochodzą z
 * serwera). Zwrotka jest podstawą deduplikacji echa: provider dokłada ją do
 * listy od razu, a późniejszy broadcast INSERT z tym samym id niczego nie dubluje.
 */
export async function sendMessage(
  db: ChatDb,
  conversationId: string,
  authorId: string,
  body: string,
  replyTo: string | null = null,
): Promise<ChatResult<ChatMessage>> {
  const clean = body.trim();
  if (clean === '') return { ok: false, error: CHAT_MESSAGES.emptyBody };
  if (clean.length > CHAT_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: CHAT_MESSAGES.tooLongBody };
  }
  const row: ChatRow = {
    conversation_id: conversationId,
    author_id: authorId,
    body: clean,
    ...(replyTo ? { reply_to: replyTo } : {}),
  };
  const { row: inserted, error } = await db.insertMessage(row);
  if (error) return { ok: false, error: CHAT_MESSAGES.send };
  const message = toChatMessage(inserted);
  if (!message) return { ok: false, error: CHAT_MESSAGES.send };
  return { ok: true, value: message };
}

/** Przesuwa watermark odczytu zalogowanego uczestnika; zwraca użyty znacznik. */
export async function markRead(
  db: ChatDb,
  conversationId: string,
  userId: string,
  atIso: string = new Date().toISOString(),
): Promise<ChatResult<string>> {
  if (conversationId === '' || userId === '') {
    return { ok: false, error: CHAT_MESSAGES.markRead };
  }
  const { error } = await db.updateLastReadAt(conversationId, userId, atIso);
  if (error) return { ok: false, error: CHAT_MESSAGES.markRead };
  return { ok: true, value: atIso };
}
