// Admin-only, READ-ONLY tool: download a sanitized JSON backup of the persisted
// planner data and render a Supabase migration DRY-RUN report. It never writes
// to Supabase and never mutates localStorage or app state — it only calls the
// side-effect-free peekDataResult() plus the pure builders in exportDryRun.ts.
// Gating is inherited from AdminPage (isAdminUser) and the App route (admin.panel);
// this component adds no gating of its own.
import { useState } from 'react';
import { todayStr } from '../utils/dates';
import type { LoadFailureReason } from '../store/storage';
import { peekDataResult } from '../store/storage';
import type { DryRunReport } from '../store/exportDryRun';
import { buildDryRunReport, buildExportPayload } from '../store/exportDryRun';

// Reason-appropriate follow-up hint shown under the error message.
const REASON_HINT: Record<LoadFailureReason, string> = {
  unavailable: 'Pamięć przeglądarki jest niedostępna — sprawdź ustawienia prywatności.',
  malformed: 'Zapisany JSON jest uszkodzony i nie da się go odczytać.',
  invalid: 'Zapisane dane mają nieprawidłową strukturę.',
};

const COUNT_LABELS: Array<[string, keyof DryRunReport['counts']['source']]> = [
  ['Klienci', 'clients'],
  ['Działy', 'departments'],
  ['Typy usług', 'serviceTypes'],
  ['Kategorie prac', 'workCategories'],
  ['Statusy', 'statuses'],
  ['Projekty', 'projects'],
  ['Kamienie milowe', 'milestones'],
  ['Zadania', 'tasks'],
  ['Osoby', 'people'],
  ['Przypisania', 'assignments'],
  ['Zaplanowane godziny', 'workload'],
  ['Komentarze', 'comments'],
  ['Dziennik aktywności', 'activity'],
  ['Zapisane filtry', 'savedFilters'],
];

const TARGET_LABELS: Array<[string, keyof DryRunReport['counts']['target']]> = [
  ['departments', 'departments'],
  ['profiles', 'profiles'],
  ['projects', 'projects'],
  ['project_members', 'project_members'],
  ['tasks', 'tasks'],
  ['task_assignments', 'task_assignments'],
];

export function ExportDryRunPanel() {
  const [error, setError] = useState<{ message: string; hint: string } | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);

  const handleDownload = () => {
    const result = peekDataResult();
    if (!result.ok) {
      setReport(null);
      setError({ message: result.error.message, hint: REASON_HINT[result.reason] });
      return;
    }
    setError(null);
    const payload = buildExportPayload(result.data, result.storedVersion, new Date());
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `n2hub-kopia-zapasowa-${todayStr()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleDryRun = () => {
    const result = peekDataResult();
    if (!result.ok) {
      setReport(null);
      setError({ message: result.error.message, hint: REASON_HINT[result.reason] });
      return;
    }
    setError(null);
    setReport(buildDryRunReport(result.data));
  };

  return (
    <div className="editor-section">
      <h2>Eksport danych i symulacja migracji</h2>
      <p className="field-hint">
        Narzędzie tylko do odczytu (dry run): niczego nie zapisuje w Supabase ani nie
        zmienia danych w tej przeglądarce.
      </p>

      <div className="admin-add-form">
        <button type="button" className="btn primary" onClick={handleDownload}>
          Pobierz kopię zapasową (JSON)
        </button>
        <button type="button" className="btn ghost" onClick={handleDryRun}>
          Uruchom symulację migracji
        </button>
      </div>

      {error && (
        <div className="field-error" role="alert">
          <p>{error.message}</p>
          <p>{error.hint}</p>
        </div>
      )}

      {report && (
        <div className="dry-run-report">
          <h3>Wynik symulacji (bez zapisu)</h3>

          <h4>Liczności</h4>
          <table className="dry-run-table">
            <thead>
              <tr>
                <th>Kolekcja (localStorage)</th>
                <th>Liczba</th>
              </tr>
            </thead>
            <tbody>
              {COUNT_LABELS.map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{report.counts.source[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Tabele docelowe (Supabase)</h4>
          <table className="dry-run-table">
            <thead>
              <tr>
                <th>Tabela</th>
                <th>Wiersze</th>
              </tr>
            </thead>
            <tbody>
              {TARGET_LABELS.map(([label, key]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{report.counts.target[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4>Mapowanie ról</h4>
          <ul>
            {report.roleMapping.map((r) => (
              <li key={r.sourceRole}>
                {r.sourceRole} → {r.targetRole} ({r.count})
              </li>
            ))}
          </ul>

          <h4>Mapowanie identyfikatorów</h4>
          <ul>
            {report.idMappings.map((m) => (
              <li key={m.entity}>
                <strong>
                  {m.entity} ({m.count})
                </strong>
                : {m.description}
              </li>
            ))}
          </ul>

          <h4>Dane bez odpowiednika w Supabase</h4>
          {report.unsupported.collections.length === 0 ? (
            <p className="field-hint">Brak całych kolekcji do pominięcia.</p>
          ) : (
            <ul>
              {report.unsupported.collections.map((c) => (
                <li key={c.name}>
                  {c.name} ({c.count})
                </li>
              ))}
            </ul>
          )}
          <ul>
            {report.unsupported.fields.map((f) => (
              <li key={f.entity}>
                <strong>{f.entity}</strong>: {f.fields.join(', ')}
              </li>
            ))}
          </ul>

          {report.warnings.length > 0 && (
            <>
              <h4>Ostrzeżenia</h4>
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={`${w.table}-${w.entityId}-${i}`}>
                    <code>{w.table}</code> ({w.entityId}): {w.message}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4>Blokery migracji</h4>
          {report.blockers.length === 0 ? (
            <p className="field-hint">Brak blokerów — dane spełniają ograniczenia schematu.</p>
          ) : (
            <ul className="dry-run-blockers">
              {report.blockers.map((b, i) => (
                <li key={`${b.table}-${b.entityId}-${i}`} className="field-error">
                  <code>{b.table}</code> ({b.entityId}): {b.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
