// Serializer CSV zgłoszeń: format pod Excela PL (BOM, `;`, CRLF, cudzysłowy).
import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  buildTicketsCsv,
  csvCell,
  ticketExportDate,
  ticketsCsvFilename,
  type TicketExportRow,
} from './ticketsExport';
import type { Ticket } from '../types';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'id-1',
    title: 'Kalendarz gubi blok',
    area: 'Kalendarz',
    description: 'Po przeciągnięciu blok wraca na stare miejsce.',
    kind: 'blad',
    priority: 'wysoki',
    status: 'nowe',
    reporterId: 'p1',
    createdAt: '2026-07-19T10:30:00.000Z',
    updatedAt: '2026-07-19T10:30:00.000Z',
    ...overrides,
  };
}

const row = (overrides: Partial<Ticket> = {}, reporterName = 'Kacper Nowak'): TicketExportRow => ({
  ticket: ticket(overrides),
  reporterName,
});

describe('buildTicketsCsv', () => {
  it('zaczyna się od BOM, kończy CRLF i rozdziela kolumny średnikiem', () => {
    const csv = buildTicketsCsv([row()]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const lines = csv.slice(CSV_BOM.length).split('\r\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2); // nagłówek + jeden wiersz
    expect(lines[0]).toBe(
      '"Nazwa zgłoszenia";"Funkcja / czego dotyczy";"Rodzaj";"Priorytet";"Status";"Zgłaszający";"Data zgłoszenia";"Opis"',
    );
    expect(lines[1]).toBe(
      '"Kalendarz gubi blok";"Kalendarz";"Błąd";"Wysoki";"Nowe";"Kacper Nowak";"2026-07-19";"Po przeciągnięciu blok wraca na stare miejsce."',
    );
  });

  it('tłumaczy slugi enumów na polskie etykiety', () => {
    const csv = buildTicketsCsv([
      row({ kind: 'nowa-funkcja', priority: 'niski', status: 'w-trakcie' }),
    ]);
    expect(csv).toContain('"Nowa funkcja";"Niski";"W trakcie"');
  });

  it('podwaja cudzysłowy i nie rozbija wartości ze średnikiem ani nową linią', () => {
    const csv = buildTicketsCsv([
      row({ title: 'Błąd w "kalendarzu"', description: 'Krok 1; krok 2\nkrok 3' }),
    ]);
    expect(csv).toContain('"Błąd w ""kalendarzu"""');
    expect(csv).toContain('"Krok 1; krok 2\nkrok 3"');
  });

  it('pusta lista daje sam nagłówek', () => {
    const csv = buildTicketsCsv([]);
    const lines = csv.slice(CSV_BOM.length).split('\r\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
  });

  it('serializuje DOKŁADNIE przekazany zbiór (eksport = aktualny filtr)', () => {
    const csv = buildTicketsCsv([row({ title: 'Pierwsze' }), row({ title: 'Drugie' })]);
    expect(csv).toContain('"Pierwsze"');
    expect(csv).toContain('"Drugie"');
    expect(csv.slice(CSV_BOM.length).split('\r\n').filter((l) => l !== '')).toHaveLength(3);
  });
});

describe('pomocnicze', () => {
  it('csvCell otacza cudzysłowami i escapuje', () => {
    expect(csvCell('a')).toBe('"a"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('')).toBe('""');
  });

  it('ticketExportDate bierze część dzienną ISO, a śmieci dają pusty string', () => {
    expect(ticketExportDate('2026-07-19T10:30:00.000Z')).toBe('2026-07-19');
    expect(ticketExportDate('')).toBe('');
    expect(ticketExportDate('brak-daty')).toBe('');
  });

  it('nazwa pliku zawiera dzisiejszą datę', () => {
    expect(ticketsCsvFilename('2026-07-20')).toBe('zgloszenia-2026-07-20.csv');
  });
});
