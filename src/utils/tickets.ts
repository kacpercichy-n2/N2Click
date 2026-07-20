// Stałe zbiory wartości zgłoszeń + polskie etykiety UI (wzorzec: utils/priority.ts).
// Wartości slugów są persystowane lokalnie i w chmurze — etykiety wolno zmieniać,
// slugów NIE (repair pass w storage.ts normalizuje nieznane do wartości domyślnej).
import type { TicketKind, TicketPriority, TicketStatus } from '../types';

export const TICKET_KINDS: TicketKind[] = ['blad', 'usprawnienie', 'nowa-funkcja', 'inne'];
export const TICKET_PRIORITIES: TicketPriority[] = ['niski', 'sredni', 'wysoki'];
export const TICKET_STATUSES: TicketStatus[] = ['nowe', 'w-trakcie', 'zrobione', 'odrzucone'];

/** Wartości domyślne — także cel normalizacji nieznanych wartości przy wczytaniu. */
export const DEFAULT_TICKET_KIND: TicketKind = 'inne';
export const DEFAULT_TICKET_PRIORITY: TicketPriority = 'sredni';
export const DEFAULT_TICKET_STATUS: TicketStatus = 'nowe';

export const TICKET_KIND_LABELS: Record<TicketKind, string> = {
  blad: 'Błąd',
  usprawnienie: 'Usprawnienie',
  'nowa-funkcja': 'Nowa funkcja',
  inne: 'Inne',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  niski: 'Niski',
  sredni: 'Średni',
  wysoki: 'Wysoki',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  nowe: 'Nowe',
  'w-trakcie': 'W trakcie',
  zrobione: 'Zrobione',
  odrzucone: 'Odrzucone',
};

export const isTicketKind = (v: unknown): v is TicketKind =>
  TICKET_KINDS.includes(v as TicketKind);
export const isTicketPriority = (v: unknown): v is TicketPriority =>
  TICKET_PRIORITIES.includes(v as TicketPriority);
export const isTicketStatus = (v: unknown): v is TicketStatus =>
  TICKET_STATUSES.includes(v as TicketStatus);
