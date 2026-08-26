// Kafelek „Kalendarz Google" na stronie konta: podpięcie konta (popup GIS),
// lista kalendarzy z przełącznikiem importu, poziom udostępniania dla zespołu,
// „Synchronizuj teraz", odłączenie. Renderowany wyłącznie w trybie Supabase.
import { useEffect } from 'react';
import { CalendarDays } from '../components/icons';
import { DisabledHint } from '../components/Tooltip';
import { useConfirm } from '../components/ConfirmProvider';
import { formatTimestamp } from '../utils/dates';
import { useGoogleCalendar } from './GoogleCalendarProvider';
import { googleCalendarDisabledReason } from './googleConnect';
import { SHARE_LEVEL_LABELS, isGoogleShareLevel, type GoogleShareLevel } from './types';

const SHARE_LEVELS: GoogleShareLevel[] = ['busy', 'details', 'hidden'];

export function GoogleCalendarTile() {
  const gcal = useGoogleCalendar();
  const confirm = useConfirm();
  const disabledReason = googleCalendarDisabledReason();

  useEffect(() => {
    if (gcal.enabled) gcal.loadSettings();
  }, [gcal.enabled, gcal.loadSettings]);

  if (!gcal.enabled) return null;
  const { account, calendars, busy } = gcal;

  const onDisconnect = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Odłączyć konto Google?',
      consequences: 'Wydarzenia z tego kalendarza znikną z N2Hub. Możesz podpiąć konto ponownie w każdej chwili.',
      confirmLabel: 'Odłącz',
      tone: 'danger',
    });
    if (ok) await gcal.disconnect();
  };

  return (
    <div className="editor-section account-tile gcal-tile">
      <h2>
        <CalendarDays size={16} aria-hidden className="account-tile-icon" /> Kalendarz Google
      </h2>
      {gcal.settingsLoading && account === null ? (
        <p className="field-hint">Sprawdzanie połączenia…</p>
      ) : account === null ? (
        <>
          <p className="field-hint">
            Podepnij swoje konto Google, a spotkania z Twojego kalendarza pojawią się w widoku Tydzień i
            Miesiąc obok wydarzeń N2Hub. Import jest tylko do odczytu; nic nie zapisujemy w Google.
          </p>
          <div className="account-tile-actions">
            <DisabledHint reason={disabledReason} id="gcal-connect-hint">
              <button
                type="button"
                className="btn primary"
                disabled={disabledReason !== null || busy}
                onClick={() => void gcal.connect()}
              >
                {busy ? 'Łączenie…' : 'Podepnij konto Google'}
              </button>
            </DisabledHint>
          </div>
        </>
      ) : (
        <>
          <dl className="account-facts">
            <div>
              <dt>Konto</dt>
              <dd>{account.googleEmail}</dd>
            </div>
            <div>
              <dt>Stan</dt>
              <dd>
                {account.status === 'active' && 'Połączone'}
                {account.status === 'revoked' && 'Dostęp cofnięty. Podepnij konto ponownie.'}
                {account.status === 'error' && (account.lastError ?? 'Błąd synchronizacji')}
              </dd>
            </div>
            <div>
              <dt>Ostatnia synchronizacja</dt>
              <dd>{account.lastSyncAt ? formatTimestamp(account.lastSyncAt) : 'jeszcze nie było'}</dd>
            </div>
          </dl>

          <h3 className="account-subhead">Które kalendarze importować</h3>
          {calendars.length === 0 ? (
            <p className="field-hint">Lista kalendarzy pojawi się po pierwszej synchronizacji.</p>
          ) : (
            <ul className="account-row-list gcal-calendars">
              {calendars.map((calendar) => (
                <li key={calendar.id}>
                  <label className="checkbox-field account-inline-check">
                    <input
                      type="checkbox"
                      checked={calendar.selected}
                      disabled={busy}
                      onChange={(event) => void gcal.setCalendarSelected(calendar.id, event.target.checked)}
                    />
                    <span
                      className="gcal-calendar-dot"
                      style={calendar.color ? { background: calendar.color } : undefined}
                      aria-hidden
                    />
                    {calendar.summary || calendar.googleCalendarId}
                    {calendar.isPrimary && <span className="muted"> (główny)</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}

          <h3 className="account-subhead">Co widzi reszta zespołu</h3>
          <label className="field">
            <span className="sr-only">Poziom udostępniania</span>
            <select
              value={account.shareLevel}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                if (isGoogleShareLevel(next)) void gcal.setShareLevel(next);
              }}
            >
              {SHARE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {SHARE_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">
            Twoje wydarzenia z Google pokazują się innym dopiero, gdy zawężą kalendarz do Ciebie w filtrze
            osób. Osoby zaproszone na spotkanie widzą jego szczegóły zawsze. Wydarzenia oznaczone w Google
            jako prywatne widzisz tylko Ty.
          </p>

          <div className="account-tile-actions">
            {account.status === 'revoked' ? (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void gcal.connect()}>
                Podepnij ponownie
              </button>
            ) : (
              <button type="button" className="btn ghost" disabled={busy} onClick={() => void gcal.syncNow()}>
                {busy ? 'Pracuję…' : 'Synchronizuj teraz'}
              </button>
            )}
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void onDisconnect()}>
              Odłącz konto
            </button>
          </div>
        </>
      )}
      {gcal.settingsError !== null && <p className="field-error">{gcal.settingsError}</p>}
    </div>
  );
}
