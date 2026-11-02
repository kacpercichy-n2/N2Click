// Publiczne API załączników (obrazów) w rozmowach. Właściciel: linia L2.
// Kontrakt docs/karta-v2/SPEC.md. Nazwy eksportów są wiążące dla L3.

/** Jeden obraz zapisany w `messages.attachments` (jsonb). */
export interface ChatAttachment {
  /** Ścieżka w prywatnym buckecie `chat-attachments`: `<conversationId>/<uuid>.<ext>`. */
  path: string;
  mime: 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif';
  width: number;
  height: number;
  /** Bajty po kompresji. */
  size: number;
  /** Oryginalna nazwa pliku albo „Zrzut ekranu”. */
  name: string;
}

/** Plik w kolejce kompozytora, zanim wiadomość zostanie wysłana. */
export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string;
  status: 'compressing' | 'uploading' | 'ready' | 'error';
  progress: number; // 0..1
  error: string | null;
  result: ChatAttachment | null;
}

export const CHAT_ATTACHMENT_BUCKET = 'chat-attachments';
export const CHAT_ATTACHMENTS_MAX = 10;
export const CHAT_ATTACHMENT_MAX_INPUT_BYTES = 10 * 1024 * 1024;
