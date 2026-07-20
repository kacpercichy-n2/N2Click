// Czysty serializer CSV dla zakładki „Zgłoszenia”. Bez Reacta, bez DOM, bez
// zależności — cała logika formatu jest testowalna w node (vitest zbiera `.ts`).
//
// Format celuje w Excela w polskiej lokalizacji:
//   * separator `;` (Excel PL rozdziela nim kolumny, przecinek to separator dziesiętny),
//   * prefiks BOM UTF-8 (bez niego polskie znaki wychodzą jako krzaczki),
//   * końce linii CRLF,
//   * KAŻDA wartość w cudzysłowach, wewnętrzny `"` podwojony — dzięki temu
//     średnik, przecinek i wieloliniowy opis nie rozjeżdżają kolumn.
import type { Ticket } from '../types';
import {
  TICKET_KIND_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../utils/tickets';

/** Prefiks BOM UTF-8 — bez niego Excel PL czyta plik jako windows-1250. */
export const CSV_BOM = '﻿';
export const CSV_SEPARATOR = ';';
export const CSV_EOL = '\r\n';

export const TICKETS_CSV_HEADER = [
  'Nazwa zgłoszenia',
  'Funkcja / czego dotyczy',
  'Rodzaj',
  'Priorytet',
  'Status',
  'Zgłaszający',
  'Data zgłoszenia',
  'Opis',
];

/** Jeden wiersz eksportu: zgłoszenie + rozwiązana nazwa zgłaszającego. */
export interface TicketExportRow {
  ticket: Ticket;
  reporterName: string;
}

/** Otacza wartość cudzysłowami i podwaja wewnętrzne `"` (RFC 4180). */
export function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Data zgłoszenia w formacie `yyyy-MM-dd` (część dzienna znacznika ISO).
 * Pusty/nieparsowalny znacznik daje '' zamiast „Invalid Date”.
 */
export function ticketExportDate(createdAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(createdAt);
  return match ? match[1] : '';
}

/** Wiersz CSV dla jednego zgłoszenia (kolejność kolumn jak w nagłówku). */
function ticketCells(row: TicketExportRow): string[] {
  const t = row.ticket;
  return [
    t.title,
    t.area,
    TICKET_KIND_LABELS[t.kind] ?? t.kind,
    TICKET_PRIORITY_LABELS[t.priority] ?? t.priority,
    TICKET_STATUS_LABELS[t.status] ?? t.status,
    row.reporterName,
    ticketExportDate(t.createdAt),
    t.description,
  ];
}

/**
 * Serializuje DOKŁADNIE przekazany zbiór wierszy (wołający podaje aktualnie
 * przefiltrowaną listę — eksport nigdy nie sięga po pełną kolekcję).
 * Pusta lista => sam nagłówek, żeby plik dało się otworzyć i zobaczyć kolumny.
 */
export function buildTicketsCsv(rows: TicketExportRow[]): string {
  const lines = [
    TICKETS_CSV_HEADER.map(csvCell).join(CSV_SEPARATOR),
    ...rows.map((row) => ticketCells(row).map(csvCell).join(CSV_SEPARATOR)),
  ];
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

/** Nazwa pliku eksportu: `zgloszenia-<yyyy-MM-dd>.csv`. */
export function ticketsCsvFilename(today: string): string {
  return `zgloszenia-${today}.csv`;
}
