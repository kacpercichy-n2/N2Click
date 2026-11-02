// Powłoka doku: okno rozmowy to `ChatThread` w wariancie `dock` (nagłówek,
// motyw, minimalizacja). Ten sam wątek służy panelowi rozmowy w karcie zadania.
import { ChatThread, type ChatThreadProps } from './ChatThread';

export function ChatWindow(props: Omit<ChatThreadProps, 'variant'>) {
  return <ChatThread {...props} variant="dock" />;
}
