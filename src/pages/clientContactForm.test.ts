// Unit tests for the pure ClientsPage contact-person form helpers: split/join
// round-trip, draftOf + dirty stability for a legacy client, the required-field
// matrix (form layer), and the dispatch-payload join/trim.
import { describe, expect, it } from 'vitest';
import type { Client } from '../types';
import {
  clientDraftError,
  draftOf,
  draftToActionPayload,
  emptyDraft,
  joinContactName,
  normalizedDraft,
  splitContactName,
  type ClientFormDraft,
} from './clientContactForm';

const legacy: Client = {
  id: 'c1',
  name: 'Acme',
  archived: false,
  contactName: 'Anna Maria Nowak',
  contactEmail: 'anna@acme.pl',
  contactPhone: '+48 600 100 200',
};

describe('splitContactName / joinContactName', () => {
  it('first token → firstName, rest → lastName', () => {
    expect(splitContactName('Anna Maria Nowak')).toEqual({ firstName: 'Anna', lastName: 'Maria Nowak' });
    expect(splitContactName('Anna')).toEqual({ firstName: 'Anna', lastName: '' });
    expect(splitContactName('   Anna   Nowak  ')).toEqual({ firstName: 'Anna', lastName: 'Nowak' });
    expect(splitContactName('')).toEqual({ firstName: '', lastName: '' });
  });

  it('join trims parts and uses a single space', () => {
    expect(joinContactName(' Anna ', ' Maria Nowak ')).toBe('Anna Maria Nowak');
    expect(joinContactName('Anna', '')).toBe('Anna');
    expect(joinContactName('', '')).toBe('');
  });

  it('round-trips split → join for multi-word and single-word names', () => {
    for (const name of ['Anna Maria Nowak', 'Anna', 'Jan Kowalski']) {
      const { firstName, lastName } = splitContactName(name);
      expect(joinContactName(firstName, lastName)).toBe(name);
    }
  });
});

describe('draftOf + dirty stability', () => {
  it('a legacy client opened for edit is NOT dirty (both sides split-derived)', () => {
    const d = draftOf(legacy);
    expect(normalizedDraft(d)).toBe(normalizedDraft(draftOf(legacy)));
    // Primary name split then re-joined equals the original contactName.
    expect(joinContactName(d.primary.firstName, d.primary.lastName)).toBe('Anna Maria Nowak');
  });

  it('draftOf maps additional contacts verbatim', () => {
    const withContacts: Client = {
      ...legacy,
      contacts: [{ id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '600', email: 'm@k.pl' }],
    };
    expect(draftOf(withContacts).contacts).toEqual([
      { id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '600', email: 'm@k.pl' },
    ]);
  });
});

describe('clientDraftError (form layer, first failure wins)', () => {
  const valid = (): ClientFormDraft => ({
    name: 'Acme',
    primary: { firstName: 'Anna', lastName: 'Nowak', phone: '600', email: 'a@b.pl' },
    contacts: [],
    notes: '',
  });

  it('returns "" for a complete draft', () => {
    expect(clientDraftError(valid())).toBe('');
  });

  it('flags each missing primary field with its Polish message', () => {
    expect(clientDraftError({ ...valid(), name: ' ' })).toBe('Nazwa klienta jest wymagana');
    expect(clientDraftError({ ...valid(), primary: { ...valid().primary, firstName: '' } })).toBe(
      'Imię i nazwisko głównej osoby kontaktowej są wymagane',
    );
    expect(clientDraftError({ ...valid(), primary: { ...valid().primary, lastName: '' } })).toBe(
      'Imię i nazwisko głównej osoby kontaktowej są wymagane',
    );
    expect(clientDraftError({ ...valid(), primary: { ...valid().primary, phone: '' } })).toBe(
      'Telefon głównej osoby kontaktowej jest wymagany',
    );
    expect(clientDraftError({ ...valid(), primary: { ...valid().primary, email: '' } })).toBe(
      'E-mail głównej osoby kontaktowej jest wymagany',
    );
  });

  it('flags an additional row missing its imię/nazwisko', () => {
    expect(
      clientDraftError({
        ...valid(),
        contacts: [{ id: 'k1', firstName: 'Marek', lastName: '', phone: '', email: '' }],
      }),
    ).toBe('Każda dodatkowa osoba kontaktowa musi mieć imię i nazwisko');
    // But an additional row's phone/e-mail stay optional.
    expect(
      clientDraftError({
        ...valid(),
        contacts: [{ id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '', email: '' }],
      }),
    ).toBe('');
  });
});

describe('draftToActionPayload', () => {
  it('joins the primary name, trims channels and builds trimmed contacts', () => {
    const d: ClientFormDraft = {
      name: '  Acme  ',
      primary: { firstName: ' Anna ', lastName: ' Nowak ', phone: ' 600 ', email: ' a@b.pl ' },
      contacts: [{ id: 'k1', firstName: ' Marek ', lastName: ' Kos ', phone: ' 601 ', email: ' m@k.pl ' }],
      notes: '  opis  ',
    };
    expect(draftToActionPayload(d)).toEqual({
      name: 'Acme',
      contactName: 'Anna Nowak',
      contactEmail: 'a@b.pl',
      contactPhone: '600',
      notes: 'opis',
      contacts: [{ id: 'k1', firstName: 'Marek', lastName: 'Kos', phone: '601', email: 'm@k.pl' }],
    });
  });

  it('emptyDraft yields a blank, empty-contacts payload', () => {
    expect(draftToActionPayload(emptyDraft())).toEqual({
      name: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      notes: '',
      contacts: [],
    });
  });
});
