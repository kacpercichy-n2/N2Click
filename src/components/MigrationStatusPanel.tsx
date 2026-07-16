// Panel „Stan migracji do chmury” (tryb supabase, tylko administrator). Cała
// logika żyje w src/supabase/migrationStatus.ts + cloudMirror/plannerData; ten
// komponent jest cienki (pokrycie typecheckiem). Wszystkie napisy po polsku.
//
// Renderuje: tabelę pokrycia per rodzina (Grupa / Lokalnie / Do synchronizacji /
// Poza synchronizacją) z buildCoverageReport, liczby wierszy w chmurze z
// jednorazowego „Sprawdź stan”, żywy stan synchronizacji (useCloudSync) i stan
// wycofania; przycisk kopii zapasowej (odblokowuje wycofanie) oraz handshake
// wyłączenia / przywrócenia zapisów lokalnych.
import { useMemo, useState } from 'react';
import { todayStr } from '../utils/dates';
import { useStore, usePersistence } from '../store/AppStore';
import { useAuth } from '../auth/SessionProvider';
import { useOrgData } from '../supabase/OrgDataProvider';
import { useCloudSync } from '../supabase/CloudSyncProvider';
import { getSupabaseClient } from '../supabase/client';
import { peekDataResult } from '../store/storage';
import { buildExportPayload } from '../store/exportDryRun';
import { buildCloudIdMaps } from '../supabase/cloudMirror';
import {
  createSupabasePlannerDb,
  loadPlannerSnapshot,
  writeRetirementSetting,
} from '../supabase/plannerData';
import {
  buildCoverageReport,
  runRetirementHandshake,
  type CoverageReport,
  type HandshakeResult,
} from '../supabase/migrationStatus';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CloudCounts = {
  clients: number;
  projects: number;
  milestones: number;
  tasks: number;
  assignments: number;
  workload: number;
  comments: number;
  activity: number;
};

export function MigrationStatusPanel() {
  const { state } = useStore();
  const { retryPersist } = usePersistence();
  const { mode } = useAuth();
  const org = useOrgData();
  const cloud = useCloudSync();

  const snapshot = org.state.status === 'ready' ? org.state.snapshot : null;
  const profile = snapshot?.profile ?? null;
  const isAdmin = profile?.cloudRole === 'administrator';

  const maps = useMemo(
    () => (snapshot ? buildCloudIdMaps(state, snapshot) : null),
    [state, snapshot],
  );
  const coverage: CoverageReport | null = useMemo(
    () => (maps ? buildCoverageReport(state, maps) : null),
    [state, maps],
  );

  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [cloudCounts, setCloudCounts] = useState<CloudCounts | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handshake, setHandshake] = useState<HandshakeResult | null>(null);
  const [reverseNote, setReverseNote] = useState<string | null>(null);

  // Tryb lokalny / niegotowy snapshot / brak profilu / nie-administrator: nic.
  if (mode !== 'supabase' || !snapshot || !profile || !isAdmin || !maps || !coverage) {
    return null;
  }

  const getDb = () => createSupabasePlannerDb(getSupabaseClient());

  const handleBackup = () => {
    const result = peekDataResult();
    if (!result.ok) {
      setCheckError(result.error.message);
      return;
    }
    setCheckError(null);
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
    setBackupDownloaded(true);
  };

  const handleCheck = async () => {
    setBusy(true);
    setCheckError(null);
    try {
      const snap = await loadPlannerSnapshot(getDb(), maps, state);
      if (!snap.ok) {
        setCheckError(snap.error);
        setCloudCounts(null);
        return;
      }
      const p = snap.payload;
      setCloudCounts({
        clients: p.clients.length,
        projects: p.projects.length,
        milestones: p.milestones.length,
        tasks: p.tasks.length,
        assignments: p.assignments.length,
        workload: p.workload.length,
        comments: p.comments.length,
        activity: p.activity.length,
      });
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'Nie udało się połączyć z Supabase.');
    } finally {
      setBusy(false);
    }
  };

  const probeTaskId = state.tasks.find((t) => UUID_RE.test(t.id))?.id ?? '';

  const canRetire =
    cloud.status === 'ready' &&
    cloud.pendingCount === 0 &&
    cloud.error === null &&
    cloud.dropped.length === 0 &&
    coverage.clean &&
    backupDownloaded &&
    !cloud.retired;

  const handleRetire = async () => {
    setBusy(true);
    setHandshake(null);
    try {
      const result = await runRetirementHandshake(getDb(), state, maps, {
        rowId: crypto.randomUUID(),
        taskId: probeTaskId,
        profileId: profile.id,
      });
      setHandshake(result);
      if (result.ok) cloud.applyRetirement(true);
    } catch (e) {
      setHandshake({
        ok: false,
        steps: [
          {
            label: 'Błąd',
            ok: false,
            detail: e instanceof Error ? e.message : 'Nie udało się połączyć z Supabase.',
          },
        ],
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReverse = async () => {
    setBusy(true);
    setReverseNote(null);
    try {
      const res = await writeRetirementSetting(getDb(), false, profile.id);
      if (res.error) {
        setReverseNote(`Nie udało się przywrócić: ${res.error.message}`);
        return;
      }
      cloud.applyRetirement(false);
      retryPersist(); // jeden pełny zapis lokalny po przywróceniu
      setReverseNote('Przywrócono zapisy lokalne. Kopia lokalna i plik kopii zapasowej pozostają nienaruszone.');
    } catch (e) {
      setReverseNote(e instanceof Error ? e.message : 'Nie udało się połączyć z Supabase.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor-section">
      <h2>Stan migracji do chmury</h2>
      <p className="field-hint">
        Podgląd pokrycia danych planera w chmurze oraz sterowanie wycofaniem zapisów
        lokalnych. localStorage nigdy nie jest usuwane — po wycofaniu pozostaje
        pasywną, odświeżaną kopią do odzysku.
      </p>

      <table className="dry-run-table">
        <thead>
          <tr>
            <th>Grupa</th>
            <th>Lokalnie</th>
            <th>Do synchronizacji</th>
            <th>Poza synchronizacją</th>
            <th>W chmurze</th>
          </tr>
        </thead>
        <tbody>
          {coverage.families.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td>{f.local}</td>
              <td>{f.syncable}</td>
              <td className={f.unsyncable > 0 ? 'field-error' : undefined}>{f.unsyncable}</td>
              <td>{cloudCounts ? cloudCounts[f.key as keyof CloudCounts] ?? '—' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin-add-form">
        <button type="button" className="btn ghost" onClick={handleCheck} disabled={busy}>
          Sprawdź stan
        </button>
        <button type="button" className="btn primary" onClick={handleBackup} disabled={busy}>
          Pobierz kopię zapasową
        </button>
      </div>
      {checkError && <p className="field-error">{checkError}</p>}

      <p className="field-hint">
        Synchronizacja: oczekujące zapisy {cloud.pendingCount}
        {cloud.error ? ` · błąd: ${cloud.error}` : ''}
        {cloud.dropped.length > 0 ? ` · odrzucone: ${cloud.dropped.length}` : ''}
      </p>
      <p className="field-hint">
        Zapisy lokalne: {cloud.retired ? 'wyłączone (dane w chmurze)' : 'aktywne'}
      </p>

      {!cloud.retired ? (
        <>
          <button type="button" className="btn primary" onClick={handleRetire} disabled={!canRetire || busy}>
            Zweryfikuj i wyłącz zapisy lokalne
          </button>
          {!backupDownloaded && (
            <p className="field-hint">Najpierw pobierz kopię zapasową, aby odblokować wycofanie.</p>
          )}
        </>
      ) : (
        <>
          <button type="button" className="btn ghost" onClick={handleReverse} disabled={busy}>
            Przywróć zapisy lokalne
          </button>
          <p className="field-hint">
            Zamrożona kopia lokalna oraz pobrany plik kopii zapasowej pozostają nienaruszone.
          </p>
        </>
      )}

      {reverseNote && <p className="field-hint">{reverseNote}</p>}

      {handshake && (
        <div className="import-result">
          <h4>Wynik weryfikacji</h4>
          <ul className="dry-run-blockers">
            {handshake.steps.map((s, i) => (
              <li key={`${s.label}-${i}`} className={s.ok ? undefined : 'field-error'}>
                <strong>{s.label}:</strong> {s.ok ? 'OK' : 'błąd'} — {s.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
