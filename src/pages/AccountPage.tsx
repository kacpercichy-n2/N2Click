// Konto = pełny profil zalogowanego użytkownika (jeden adres: /account).
// Widok domyślny to skondensowany DASHBOARD tylko do odczytu: dane kontaktowe,
// czas pracy, organizacja, konto/hasło oraz zamarkowana „Strefa HR" (urlop,
// dokumenty i wnioski — przyciski wyłączone do czasu panelu HR, dane urlopowe
// liczone z realnych wydarzeń `kind: 'urlop'` przez czysty `accountHr.ts`).
// „Edytuj dane" przełącza na formularz PersonProfile (accountView) — wartości
// nie są bazowo edytowalne, edycja to jawny stan. Wejścia na
// /people/<własne id> przekierowują tutaj (PersonProfilePage).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import { PersonProfile, PasswordSection } from './PersonProfilePage';
import { CloudPasswordSection } from '../components/CloudPasswordSection';
import { Avatar } from '../components/Avatar';
import { DisabledHint } from '../components/Tooltip';
import { Pencil, TreePalm, ClipboardList } from '../components/icons';
import { getDepartment } from '../store/selectors';
import { WEEKDAY_CHIPS } from '../components/personFields';
import { formatMinutes, formatDuration } from '../utils/time';
import { formatBirthday, formatShortWithWeekday, todayStr } from '../utils/dates';
import { polishCount } from '../utils/polishPlural';
import type { AuthMode } from '../auth/mode';
import type { Person } from '../types';
import {
  DEFAULT_VACATION_ALLOWANCE_DAYS,
  personVacationRanges,
  remainingVacationDays,
  upcomingVacationRanges,
  vacationWorkDaysInYear,
} from './accountHr';

/** Wspólny powód wyłączenia akcji HR — panel wniosków dopiero powstanie. */
const HR_SOON_REASON = 'Ta funkcja pojawi się wraz z panelem HR.';

/** Zamarkowana lista dokumentów/wniosków przyszłego panelu HR. */
const HR_DOCUMENTS = [
  'Zaświadczenie o zatrudnieniu',
  'Wniosek o zaliczkę',
  'Umowa i aneksy',
  'Skierowanie na badania okresowe',
];

export function AccountPage() {
  const { state } = useStore();
  const [editing, setEditing] = useState(false);
  const person = state.people.find((p) => p.id === state.currentUserId);
  // Powłoka nie renderuje się bez zalogowanej tożsamości — to tylko siatka
  // bezpieczeństwa na niespójny stan (np. usunięta osoba).
  if (!person) {
    return (
      <section className="page">
        <div className="empty-state">
          <p className="empty-title">Brak profilu dla zalogowanego konta</p>
        </div>
      </section>
    );
  }
  if (editing) {
    return (
      <PersonProfile
        key={person.id}
        personId={person.id}
        accountView
        onExit={() => setEditing(false)}
      />
    );
  }
  return <AccountDashboard person={person} onEdit={() => setEditing(true)} />;
}

function AccountDashboard({ person, onEdit }: { person: Person; onEdit: () => void }) {
  const { state } = useStore();
  const { mode } = useAuth();

  const department = getDepartment(state, person.departmentId)?.name ?? null;
  const company = state.companies.find((c) => c.id === person.companyId)?.name ?? null;
  const supervisor = person.supervisorId
    ? state.people.find((p) => p.id === person.supervisorId)
    : undefined;
  const subordinates = state.people.filter((p) => p.supervisorId === person.id);

  const today = todayStr();
  const year = Number(today.slice(0, 4));
  const vacations = personVacationRanges(state.events, person.id);
  const usedDays = vacationWorkDaysInYear(vacations, person.workDays, year);
  const remaining = remainingVacationDays(usedDays, DEFAULT_VACATION_ALLOWANCE_DAYS);
  const upcoming = upcomingVacationRanges(vacations, today);
  const usedRatio = Math.min(1, usedDays / DEFAULT_VACATION_ALLOWANCE_DAYS);

  return (
    <section className="page account-page">
      <div className="page-head">
        <h1 className="profile-title">
          <Avatar person={person} size={56} />
          <span>
            {person.name}
            <span className="profile-subtitle">
              {[person.role, department, company].filter(Boolean).join(' · ')}
            </span>
          </span>
        </h1>
        <div className="page-head-actions">
          <button type="button" className="btn ghost" onClick={onEdit}>
            <Pencil size={16} aria-hidden /> Edytuj dane
          </button>
        </div>
      </div>

      <div className="account-grid">
        <div className="editor-section account-tile">
          <h2>Dane kontaktowe</h2>
          <dl className="account-facts">
            <div>
              <dt>E-mail</dt>
              <dd>
                {person.email ? (
                  <a href={`mailto:${person.email}`} className="profile-link">
                    {person.email}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Telefon</dt>
              <dd>
                {person.phone ? (
                  <a href={`tel:${person.phone.replace(/\s+/g, '')}`} className="profile-link">
                    {person.phone}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Data urodzenia</dt>
              <dd>{person.birthDate ? `🎂 ${formatBirthday(person.birthDate)}` : '—'}</dd>
            </div>
          </dl>
        </div>

        <div className="editor-section account-tile">
          <h2>Czas pracy</h2>
          <div className="weekday-chips" role="img" aria-label={`Dni robocze: ${formatWorkDaysLabel(person.workDays)}`}>
            {WEEKDAY_CHIPS.map((c) => (
              <span
                key={c.iso}
                aria-hidden
                className={`weekday-chip readonly${person.workDays.includes(c.iso) ? ' on' : ''}`}
              >
                {c.label}
              </span>
            ))}
          </div>
          <dl className="account-facts">
            <div>
              <dt>Godziny pracy</dt>
              <dd>
                {formatMinutes(person.workStartMinutes)}–{formatMinutes(person.workEndMinutes)}
              </dd>
            </div>
            <div>
              <dt>Dostępność</dt>
              <dd>{formatDuration(person.capacity)}/dzień</dd>
            </div>
          </dl>
        </div>

        <div className="editor-section account-tile">
          <h2>Organizacja</h2>
          <dl className="account-facts">
            <div>
              <dt>Dział</dt>
              <dd>{department ?? '—'}</dd>
            </div>
            <div>
              <dt>Spółka</dt>
              <dd>{company ?? '—'}</dd>
            </div>
            <div>
              <dt>Przełożony</dt>
              <dd>
                {supervisor ? (
                  <Link to={`/people/${supervisor.id}`} className="profile-link">
                    {supervisor.name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            {subordinates.length > 0 && (
              <div>
                <dt>Podwładni</dt>
                <dd className="profile-fact-links">
                  {subordinates.map((p, i) => (
                    <span key={p.id}>
                      <Link to={`/people/${p.id}`} className="profile-link">
                        {p.name}
                      </Link>
                      {i < subordinates.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <SecurityTile person={person} mode={mode} />
      </div>

      <div className="account-hr-head">
        <h2>Strefa HR</h2>
        <span className="account-soon">W przygotowaniu</span>
      </div>
      <div className="account-grid account-grid-hr">
        <div className="editor-section account-tile">
          <h2>
            <TreePalm size={16} aria-hidden className="account-tile-icon" /> Urlop
          </h2>
          <dl className="account-facts">
            <div>
              <dt>Do wykorzystania w {year}</dt>
              <dd>
                <strong>
                  {remaining} {polishCount(remaining, 'dzień', 'dni', 'dni')}
                </strong>{' '}
                z {DEFAULT_VACATION_ALLOWANCE_DAYS}
              </dd>
            </div>
          </dl>
          <div className="account-meter" role="img" aria-label={`Wykorzystane ${usedDays} z ${DEFAULT_VACATION_ALLOWANCE_DAYS} dni urlopu`}>
            <i className="account-meter-fill" style={{ width: `${usedRatio * 100}%` }} />
          </div>
          <p className="field-hint">
            Wykorzystane: {usedDays}{' '}
            {polishCount(usedDays, 'dzień roboczy', 'dni robocze', 'dni roboczych')} (z urlopów w
            kalendarzu) · limit domyślny.
          </p>
          <h3 className="account-subhead">Nadchodzące urlopy</h3>
          {upcoming.length === 0 ? (
            <p className="field-hint">Brak zaplanowanych urlopów.</p>
          ) : (
            <ul className="account-row-list">
              {upcoming.map((r) => (
                <li key={r.start}>
                  {r.start === r.end
                    ? formatShortWithWeekday(r.start)
                    : `${formatShortWithWeekday(r.start)} – ${formatShortWithWeekday(r.end)}`}
                </li>
              ))}
            </ul>
          )}
          <div className="account-tile-actions">
            <DisabledHint reason={HR_SOON_REASON} id="account-hr-vacation">
              <button type="button" className="btn primary" disabled>
                Złóż wniosek urlopowy
              </button>
            </DisabledHint>
          </div>
        </div>

        <div className="editor-section account-tile">
          <h2>
            <ClipboardList size={16} aria-hidden className="account-tile-icon" /> Dokumenty i
            wnioski
          </h2>
          <p className="field-hint">
            Podstawowe dokumenty pracownicze będą dostępne tutaj, do pobrania i złożenia online.
          </p>
          <ul className="account-row-list">
            {HR_DOCUMENTS.map((doc) => (
              <li key={doc}>
                <span>{doc}</span>
                <span className="account-soon">Wkrótce</span>
              </li>
            ))}
          </ul>
          <div className="account-tile-actions">
            <DisabledHint reason={HR_SOON_REASON} id="account-hr-request">
              <button type="button" className="btn ghost" disabled>
                Złóż zapotrzebowanie
              </button>
            </DisabledHint>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Kafelek „Konto i bezpieczeństwo": status powiadomień + zmiana hasła jako
 * jawne rozwinięcie (formularz osadzony, bez zagnieżdżonej karty). Tryb
 * Supabase zmienia hasło realnego konta, lokalny — hash w tej przeglądarce.
 */
function SecurityTile({ person, mode }: { person: Person; mode: AuthMode }) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  return (
    <div className="editor-section account-tile">
      <h2>Konto i bezpieczeństwo</h2>
      <dl className="account-facts">
        <div>
          <dt>Powiadomienia mailowe</dt>
          <dd>{person.emailNotifications === true ? 'Włączone' : 'Wyłączone'}</dd>
        </div>
        <div>
          <dt>Hasło</dt>
          <dd>
            <button
              type="button"
              className="btn ghost small"
              aria-expanded={passwordOpen}
              onClick={() => setPasswordOpen((v) => !v)}
            >
              {passwordOpen ? 'Zwiń' : 'Zmień hasło'}
            </button>
          </dd>
        </div>
      </dl>
      {passwordOpen && (
        <div className="account-pass">
          {mode === 'supabase' ? (
            <CloudPasswordSection embedded />
          ) : (
            <PasswordSection person={person} embedded />
          )}
        </div>
      )}
    </div>
  );
}

/** Etykieta dni roboczych do `aria-label` (chipy są czysto wizualne). */
function formatWorkDaysLabel(workDays: readonly number[]): string {
  const on = WEEKDAY_CHIPS.filter((c) => workDays.includes(c.iso)).map((c) => c.label);
  return on.length > 0 ? on.join(', ') : 'brak';
}
