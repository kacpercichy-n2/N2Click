// Zgłoszenia: jedno miejsce, w którym zespół składa błędy, usprawnienia i
// prośby o nowe funkcje.
//
// Bez `tickets.manage` (specjalista, menadżer, handlowiec) strona jest
// WYŁĄCZNIE skrzynką nadawczą: przycisk otwierający formularz, bez żadnej
// listy — decyzja 2026-07-21 („każdy dodaje, listę widzi administrator”).
//
// Z `tickets.manage` (rola pelne) — dwa tryby (segmentowany przełącznik):
//   * „Zgłoś”     — otwiera modal zgłoszenia (?zgloszenie=new),
//   * „Zgłoszone” — pełna lista z filtrami, rozwijanym opisem, inline zmianą
//                   statusu, usuwaniem i eksportem CSV. Wiersze `zrobione` są
//                   podświetlone na zielono (.ticket-row-done; decyzja
//                   2026-07-22 — bez osobnego taba, wystarcza filtr statusu).
//
// To bramka UX — prawdziwą granicę pilnuje RLS na `public.tickets`.
import { useMemo, useState } from 'react';
import { useStore } from '../store/AppStore';
import { useCan } from '../store/useCan';
import { currentUser as currentUserSel } from '../store/selectors';
import type { Ticket, TicketKind, TicketStatus } from '../types';
import {
  TICKET_KINDS,
  TICKET_KIND_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
} from '../utils/tickets';
import { todayStr } from '../utils/dates';
import { useOpenTicket } from '../components/TicketModal';
import { ChevronRight, Plus } from '../components/icons';
import { buildTicketsCsv, ticketsCsvFilename, type TicketExportRow } from './ticketsExport';

type Mode = 'zglos' | 'zgloszone';

export function TicketsPage() {
  const { state, dispatch } = useStore();
  const can = useCan();
  const canManage = can('tickets.manage');
  const me = currentUserSel(state);
  const { openNewTicket, openTicket } = useOpenTicket();

  const [mode, setMode] = useState<Mode>('zgloszone');
  const [statusFilter, setStatusFilter] = useState<'' | TicketStatus>('');
  const [kindFilter, setKindFilter] = useState<'' | TicketKind>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const nameOfReporter = (reporterId: string): string =>
    state.people.find((p) => p.id === reporterId)?.name ?? 'nieznany';

  // Zakres + filtry + sort od najnowszych. Jedno źródło dla tabeli i eksportu,
  // więc „Eksportuj” zawsze zapisuje DOKŁADNIE to, co widać.
  const visible = useMemo(() => {
    const scoped = canManage
      ? state.tickets
      : state.tickets.filter((t) => me !== undefined && t.reporterId === me.id);
    return scoped
      .filter((t) => (statusFilter === '' || t.status === statusFilter))
      .filter((t) => (kindFilter === '' || t.kind === kindFilter))
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state.tickets, canManage, me, statusFilter, kindFilter]);

  const handleExport = () => {
    const rows: TicketExportRow[] = visible.map((ticket) => ({
      ticket,
      reporterName: nameOfReporter(ticket.reporterId),
    }));
    const blob = new Blob([buildTicketsCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = ticketsCsvFilename(todayStr());
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleDelete = (ticket: Ticket) => {
    if (!canManage) return;
    if (window.confirm(`Usunąć zgłoszenie „${ticket.title}”?`)) {
      dispatch({ type: 'DELETE_TICKET', ticketId: ticket.id });
    }
  };

  // Bez `tickets.manage`: sama skrzynka nadawcza — każda rola może zgłosić,
  // ale listę (także własnych zgłoszeń) obsługuje wyłącznie administrator.
  if (!canManage) {
    return (
      <section className="page">
        <div className="page-head">
          <h1>Zgłoszenia</h1>
          <div className="page-head-actions">
            <button type="button" className="btn primary" onClick={openNewTicket}>
              <Plus size={16} aria-hidden /> Nowe zgłoszenie
            </button>
          </div>
        </div>
        <div className="empty-state">
          <p className="empty-title">Zgłoś błąd, usprawnienie lub nową funkcję</p>
          <p className="empty-hint">
            Formularz otwiera się w oknie nad tą stroną. Wypełnij nazwę i opis — reszta pól ma
            sensowne wartości domyślne. Zgłoszenie trafia do administratora.
          </p>
          <button type="button" className="btn primary" onClick={openNewTicket}>
            Otwórz formularz
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head">
        <h1>Zgłoszenia</h1>
        <div className="page-head-actions">
          {mode === 'zgloszone' && canManage && (
            <button
              type="button"
              className="btn"
              onClick={handleExport}
              title="Zapisz widoczne zgłoszenia jako plik CSV"
            >
              Eksportuj
            </button>
          )}
          <button type="button" className="btn primary" onClick={openNewTicket}>
            <Plus size={16} aria-hidden /> Nowe zgłoszenie
          </button>
        </div>
      </div>

      <div className="ticket-mode-toggle" role="tablist" aria-label="Tryb zgłoszeń">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'zglos'}
          className={mode === 'zglos' ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => {
            setMode('zglos');
            openNewTicket();
          }}
        >
          Zgłoś
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'zgloszone'}
          className={mode === 'zgloszone' ? 'toggle-btn active' : 'toggle-btn'}
          onClick={() => setMode('zgloszone')}
        >
          Zgłoszone
        </button>
      </div>

      {mode === 'zglos' ? (
        <div className="empty-state">
          <p className="empty-title">Zgłoś błąd, usprawnienie lub nową funkcję</p>
          <p className="empty-hint">
            Formularz otwiera się w oknie nad tą stroną. Wypełnij nazwę i opis — reszta pól ma
            sensowne wartości domyślne.
          </p>
          <button type="button" className="btn primary" onClick={openNewTicket}>
            Otwórz formularz
          </button>
        </div>
      ) : (
        <>
          <div className="ticket-filters">
            <label className="field-inline">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as '' | TicketStatus)}
              >
                <option value="">Wszystkie</option>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TICKET_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-inline">
              <span>Rodzaj</span>
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value as '' | TicketKind)}
              >
                <option value="">Wszystkie</option>
                {TICKET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {TICKET_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <span className="ticket-count">
              {visible.length} {visible.length === 1 ? 'zgłoszenie' : 'zgłoszeń'}
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">Brak zgłoszeń</p>
              <p className="empty-hint">
                {canManage
                  ? 'Nikt jeszcze nic nie zgłosił albo filtry nic nie przepuszczają.'
                  : 'Nie masz jeszcze żadnych zgłoszeń. Użyj przycisku „Zgłoś”.'}
              </p>
            </div>
          ) : (
            <div className="ticket-table-wrap">
              <table className="ticket-table">
                <thead>
                  <tr>
                    <th scope="col" aria-label="Rozwiń" />
                    <th scope="col">Nazwa</th>
                    <th scope="col">Funkcja</th>
                    <th scope="col">Rodzaj</th>
                    <th scope="col">Priorytet</th>
                    <th scope="col">Status</th>
                    <th scope="col">Zgłaszający</th>
                    <th scope="col">Data</th>
                    {canManage && <th scope="col" aria-label="Akcje" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => {
                    const expanded = expandedId === t.id;
                    const done = t.status === 'zrobione';
                    return [
                      <tr key={t.id} className={done ? 'ticket-row-done' : undefined}>
                        <td>
                          <button
                            type="button"
                            className="card-action-btn"
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Zwiń opis' : 'Pokaż opis'}
                            onClick={() => setExpandedId(expanded ? null : t.id)}
                          >
                            <ChevronRight
                              size={16}
                              aria-hidden
                              className={expanded ? 'ticket-chevron open' : 'ticket-chevron'}
                            />
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="ticket-title-btn"
                            onClick={() => openTicket(t.id)}
                          >
                            {t.title}
                          </button>
                        </td>
                        <td>{t.area || '—'}</td>
                        <td>{TICKET_KIND_LABELS[t.kind]}</td>
                        <td>{TICKET_PRIORITY_LABELS[t.priority]}</td>
                        <td>
                          {canManage ? (
                            <select
                              value={t.status}
                              aria-label={`Status zgłoszenia „${t.title}”`}
                              onChange={(e) =>
                                dispatch({
                                  type: 'SET_TICKET_STATUS',
                                  ticketId: t.id,
                                  status: e.target.value as TicketStatus,
                                })
                              }
                            >
                              {TICKET_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {TICKET_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            TICKET_STATUS_LABELS[t.status]
                          )}
                        </td>
                        <td>{nameOfReporter(t.reporterId)}</td>
                        <td>{t.createdAt.slice(0, 10)}</td>
                        {canManage && (
                          <td>
                            <button
                              type="button"
                              className="btn danger-ghost"
                              onClick={() => handleDelete(t)}
                            >
                              Usuń
                            </button>
                          </td>
                        )}
                      </tr>,
                      expanded ? (
                        <tr key={`${t.id}-desc`} className="ticket-desc-row">
                          <td colSpan={canManage ? 9 : 8}>
                            <p className="ticket-desc">{t.description || 'Brak opisu.'}</p>
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
