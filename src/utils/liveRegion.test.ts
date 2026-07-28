import { describe, it, expect, vi } from 'vitest';
import { createLiveAnnouncer, announce, liveAnnouncer } from './liveRegion';

describe('createLiveAnnouncer — dedup po (id, text, tone)', () => {
  it('pierwsze ogłoszenie wchodzi do kanału i zwraca true', () => {
    const a = createLiveAnnouncer();
    expect(a.announce({ id: 'save:task-modal', text: 'Zapisano 20:51', tone: 'polite' })).toBe(true);
    expect(a.snapshot().polite).toEqual({ id: 'save:task-modal', text: 'Zapisano 20:51', seq: 1 });
    expect(a.snapshot().assertive).toBeNull();
  });

  it('ten sam (id, text, tone) to NO-OP: false i TA SAMA referencja snapshotu', () => {
    const a = createLiveAnnouncer();
    a.announce({ id: 'save:task-modal', text: 'Zapisano 20:51', tone: 'polite' });
    const before = a.snapshot();
    expect(a.announce({ id: 'save:task-modal', text: 'Zapisano 20:51', tone: 'polite' })).toBe(false);
    expect(a.snapshot()).toBe(before);
    expect(a.snapshot().polite?.seq).toBe(1);
  });

  it('ten sam id z NOWYM tekstem podmienia wpis — jeden komunikat na kanał', () => {
    const a = createLiveAnnouncer();
    a.announce({ id: 'save:task-modal', text: 'Zapisywanie…', tone: 'polite' });
    expect(a.announce({ id: 'save:task-modal', text: 'Zapisano 20:52', tone: 'polite' })).toBe(true);
    expect(a.snapshot().polite).toEqual({ id: 'save:task-modal', text: 'Zapisano 20:52', seq: 2 });
  });

  it('inny id podmienia zawartość kanału (bez kolejki)', () => {
    const a = createLiveAnnouncer();
    a.announce({ id: 'save:project', text: 'Niezapisane zmiany', tone: 'polite' });
    a.announce({ id: 'sample-banner', text: 'Brak danych', tone: 'polite' });
    expect(a.snapshot().polite?.id).toBe('sample-banner');
  });

  it('pusty tekst nie jest ogłoszeniem', () => {
    const a = createLiveAnnouncer();
    const before = a.snapshot();
    expect(a.announce({ id: 'save:client', text: '', tone: 'polite' })).toBe(false);
    expect(a.snapshot()).toBe(before);
  });

  it('snapshot bez żadnego ogłoszenia jest stabilny referencyjnie', () => {
    const a = createLiveAnnouncer();
    expect(a.snapshot()).toBe(a.snapshot());
    expect(a.snapshot()).toEqual({ polite: null, assertive: null });
  });
});

describe('createLiveAnnouncer — niezależne kanały', () => {
  it('polite i assertive nie kasują się nawzajem', () => {
    const a = createLiveAnnouncer();
    a.announce({ id: 'save:task-modal', text: 'Zapisano 20:51', tone: 'polite' });
    a.announce({
      id: 'save:task-modal',
      text: 'Nie zapisano — zmiany nie zostały utrwalone.',
      tone: 'assertive',
    });
    expect(a.snapshot().polite?.text).toBe('Zapisano 20:51');
    expect(a.snapshot().assertive?.text).toBe('Nie zapisano — zmiany nie zostały utrwalone.');
  });

  it('ten sam (id, text) w drugim tonie NIE jest deduplikowany', () => {
    const a = createLiveAnnouncer();
    expect(a.announce({ id: 'x', text: 'Uwaga', tone: 'polite' })).toBe(true);
    expect(a.announce({ id: 'x', text: 'Uwaga', tone: 'assertive' })).toBe(true);
  });

  it('zmiana jednego kanału zachowuje OBIEKT wpisu drugiego', () => {
    const a = createLiveAnnouncer();
    a.announce({ id: 'x', text: 'Uwaga', tone: 'assertive' });
    const assertiveEntry = a.snapshot().assertive;
    a.announce({ id: 'y', text: 'Zapisywanie…', tone: 'polite' });
    expect(a.snapshot().assertive).toBe(assertiveEntry);
  });
});

describe('createLiveAnnouncer — subskrypcja', () => {
  it('powiadamia TYLKO przy realnej zmianie', () => {
    const a = createLiveAnnouncer();
    const listener = vi.fn();
    a.subscribe(listener);
    a.announce({ id: 'save:project', text: 'Zapisywanie…', tone: 'polite' });
    expect(listener).toHaveBeenCalledTimes(1);
    a.announce({ id: 'save:project', text: 'Zapisywanie…', tone: 'polite' });
    expect(listener).toHaveBeenCalledTimes(1);
    a.announce({ id: 'save:project', text: 'Zapisano 20:53', tone: 'polite' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('odsubskrybowanie odcina powiadomienia; pozostali subskrybenci dostają je dalej', () => {
    const a = createLiveAnnouncer();
    const first = vi.fn();
    const second = vi.fn();
    const off = a.subscribe(first);
    a.subscribe(second);
    off();
    a.announce({ id: 'z', text: 'Nowość', tone: 'polite' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('singleton modułowy', () => {
  it('`announce` działa oderwane od obiektu (bez `this`)', () => {
    const before = liveAnnouncer.snapshot();
    expect(announce({ id: 'singleton', text: 'Test kanału', tone: 'polite' })).toBe(true);
    expect(liveAnnouncer.snapshot()).not.toBe(before);
    expect(liveAnnouncer.snapshot().polite?.text).toBe('Test kanału');
    expect(announce({ id: 'singleton', text: 'Test kanału', tone: 'polite' })).toBe(false);
  });
});
