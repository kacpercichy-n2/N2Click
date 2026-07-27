// Testy czystej listy blokad zapisu zadania (IA-12). Bez Reacta i bez store'u —
// wejściem są gotowe wyniki bramek, wyjściem lista powodów + kotwic fokusa.
import { describe, expect, it } from 'vitest';
import { collectTaskSaveBlockers, type SaveBlockerInput } from './taskSaveBlockers';
import { MAX_TASK_PERIOD_DAYS } from '../utils/dates';

const OK: SaveBlockerInput = {
  title: 'Zadanie',
  projectValid: true,
  hasProjects: true,
  statusValid: true,
  period: null,
  assigneesValid: true,
  draftValid: true,
};

describe('collectTaskSaveBlockers', () => {
  it('poprawny formularz nie ma blokad', () => {
    expect(collectTaskSaveBlockers(OK)).toEqual([]);
  });

  it('pusty i biały tytuł blokuje zapis i celuje w pole tytułu', () => {
    for (const title of ['', '   ', '\n\t']) {
      const blockers = collectTaskSaveBlockers({ ...OK, title });
      expect(blockers.map((b) => b.id)).toEqual(['title']);
      expect(blockers[0].focusId).toBe('t-title');
    }
  });

  it('brak projektu w bazie daje inną radę niż nieodpowiedni wybór', () => {
    const noneAtAll = collectTaskSaveBlockers({ ...OK, projectValid: false, hasProjects: false });
    expect(noneAtAll[0].message).toBe('Projekt: najpierw utwórz projekt.');
    expect(noneAtAll[0].focusId).toBeNull();

    const badPick = collectTaskSaveBlockers({ ...OK, projectValid: false, hasProjects: true });
    expect(badPick[0].message).toBe('Projekt: wybierz projekt zadania.');
    expect(badPick[0].focusId).toBe('t-project');
  });

  it('nieistniejący status blokuje zapis', () => {
    const blockers = collectTaskSaveBlockers({ ...OK, statusValid: false });
    expect(blockers.map((b) => b.id)).toEqual(['status']);
    expect(blockers[0].focusId).toBe('t-status');
  });

  it('okres dłuższy niż limit ma krótką etykietę z liczbą dni', () => {
    const blockers = collectTaskSaveBlockers({ ...OK, period: 'too-long' });
    expect(blockers.map((b) => b.id)).toEqual(['period']);
    expect(blockers[0].message).toBe(`Okres: maksymalnie ${MAX_TASK_PERIOD_DAYS} dni.`);
    expect(blockers[0].focusId).toBe('t-end');
  });

  it('odwrócony okres celuje w datę końca, brakujący start w datę startu', () => {
    expect(collectTaskSaveBlockers({ ...OK, period: 'reversed' })[0].focusId).toBe('t-end');
    expect(collectTaskSaveBlockers({ ...OK, period: 'missing-start' })[0].focusId).toBe('t-start');
    expect(collectTaskSaveBlockers({ ...OK, period: 'invalid-start' })[0].focusId).toBe('t-start');
    expect(collectTaskSaveBlockers({ ...OK, period: 'missing-end' })[0].focusId).toBe('t-end');
    expect(collectTaskSaveBlockers({ ...OK, period: 'invalid-end' })[0].focusId).toBe('t-end');
  });

  it('każdy wariant błędu okresu ma własny komunikat', () => {
    const messages = (['missing-start', 'invalid-start', 'missing-end', 'invalid-end', 'reversed', 'too-long'] as const).map(
      (period) => collectTaskSaveBlockers({ ...OK, period })[0].message,
    );
    expect(new Set(messages).size).toBe(messages.length);
    for (const m of messages) expect(m.startsWith('Okres: ')).toBe(true);
  });

  it('zniknięta osoba blokuje zapis i celuje w sekcję osób', () => {
    const blockers = collectTaskSaveBlockers({ ...OK, assigneesValid: false });
    expect(blockers.map((b) => b.id)).toEqual(['assignees']);
    expect(blockers[0].focusId).toBe('t-assignees');
  });

  it('odrzucony draft bez nazwanej przyczyny daje blokadę „other”', () => {
    const blockers = collectTaskSaveBlockers({ ...OK, draftValid: false });
    expect(blockers.map((b) => b.id)).toEqual(['other']);
    expect(blockers[0].focusId).toBeNull();
  });

  it('„other” nie dubluje nazwanych przyczyn', () => {
    const blockers = collectTaskSaveBlockers({ ...OK, title: '', draftValid: false });
    expect(blockers.map((b) => b.id)).toEqual(['title']);
  });

  it('wiele przyczyn zachowuje kolejność formularza (pierwsza = cel fokusa)', () => {
    const blockers = collectTaskSaveBlockers({
      ...OK,
      title: '',
      projectValid: false,
      statusValid: false,
      period: 'too-long',
      assigneesValid: false,
      draftValid: false,
    });
    expect(blockers.map((b) => b.id)).toEqual([
      'title',
      'project',
      'status',
      'period',
      'assignees',
    ]);
  });

  it('każdy powód jest niepustym polskim zdaniem', () => {
    const blockers = collectTaskSaveBlockers({
      ...OK,
      title: '',
      projectValid: false,
      statusValid: false,
      period: 'reversed',
      assigneesValid: false,
    });
    for (const b of blockers) {
      expect(b.message.trim().length).toBeGreaterThan(0);
      expect(b.message.endsWith('.')).toBe(true);
    }
  });
});
