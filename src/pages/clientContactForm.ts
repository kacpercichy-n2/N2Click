// Pure (no-React) helpers for the ClientsPage contact-person form. The form
// renders a list of contact persons; row 1 is the „Główna osoba kontaktowa”,
// which maps to the legacy single-string fields
// (contactName/contactEmail/contactPhone) via split/join, and rows 2+ map to the
// additive `Client.contacts` list. Kept out of the component so the split/join
// round-trip, the required-field rule and the dispatch payload are unit-testable
// without React. The FORM rule here is deliberately STRICTER than the reducer
// gate (isValidClientDraft): it also enforces the first+last split, so a draft
// this module reports valid can never be reducer-rejected.
import type { Client, ClientContact } from '../types';

/** Jeden wiersz osoby kontaktowej w formularzu (zawsze stringi, id stabilne). */
export interface ClientContactRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

/** Główna osoba kontaktowa rozbita na pola (row 1 formularza). */
export interface ClientPrimaryContact {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export interface ClientFormDraft {
  name: string;
  primary: ClientPrimaryContact;
  contacts: ClientContactRow[]; // dodatkowe osoby (rows 2+)
  notes: string;
}

export function newContactRow(): ClientContactRow {
  return { id: crypto.randomUUID(), firstName: '', lastName: '', phone: '', email: '' };
}

export function emptyDraft(): ClientFormDraft {
  return {
    name: '',
    primary: { firstName: '', lastName: '', phone: '', email: '' },
    contacts: [],
    notes: '',
  };
}

/** Rozbij pełną nazwę na imię + nazwisko: pierwszy token → `firstName`, reszta
 *  złączona pojedynczymi spacjami → `lastName` („Anna Maria Nowak” → „Anna” +
 *  „Maria Nowak”; „Anna” → „Anna” + „”). */
export function splitContactName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter((p) => p !== '');
  if (parts.length === 0) return { firstName: '', lastName: '' };
  const [first, ...rest] = parts;
  return { firstName: first, lastName: rest.join(' ') };
}

/** Złącz imię i nazwisko (po trim) pojedynczą spacją. */
export function joinContactName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter((p) => p !== '').join(' ');
}

export function draftOf(c: Client): ClientFormDraft {
  const { firstName, lastName } = splitContactName(c.contactName ?? '');
  return {
    name: c.name,
    primary: {
      firstName,
      lastName,
      phone: c.contactPhone ?? '',
      email: c.contactEmail ?? '',
    },
    contacts: (c.contacts ?? []).map((k) => ({
      id: k.id,
      firstName: k.firstName,
      lastName: k.lastName,
      phone: k.phone,
      email: k.email,
    })),
    notes: c.notes ?? '',
  };
}

/** Pierwszy niespełniony wymóg jako polski komunikat ('' = draft poprawny).
 *  Reguła FORMULARZA (bramkuje submit ORAZ auto-zapis): nazwa; główna osoba
 *  imię ORAZ nazwisko ORAZ telefon ORAZ e-mail; każda dodatkowa osoba imię ORAZ
 *  nazwisko (jej telefon/e-mail są opcjonalne). */
export function clientDraftError(d: ClientFormDraft): string {
  if (!d.name.trim()) return 'Nazwa klienta jest wymagana';
  if (!d.primary.firstName.trim() || !d.primary.lastName.trim()) {
    return 'Imię i nazwisko głównej osoby kontaktowej są wymagane';
  }
  if (!d.primary.phone.trim()) return 'Telefon głównej osoby kontaktowej jest wymagany';
  if (!d.primary.email.trim()) return 'E-mail głównej osoby kontaktowej jest wymagany';
  for (const row of d.contacts) {
    if (!row.firstName.trim() || !row.lastName.trim()) {
      return 'Każda dodatkowa osoba kontaktowa musi mieć imię i nazwisko';
    }
  }
  return '';
}

/** Pola do wysłania w ADD_CLIENT / SAVE_CLIENT: złączona główna nazwa, przycięte
 *  kanały główne, dodatkowe osoby jako `ClientContact[]` (reduktor je przycina i
 *  pomija pusty klucz). */
export function draftToActionPayload(d: ClientFormDraft): {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  contacts: ClientContact[];
} {
  return {
    name: d.name.trim(),
    contactName: joinContactName(d.primary.firstName, d.primary.lastName),
    contactEmail: d.primary.email.trim(),
    contactPhone: d.primary.phone.trim(),
    notes: d.notes.trim(),
    contacts: d.contacts.map((row) => ({
      id: row.id,
      firstName: row.firstName.trim(),
      lastName: row.lastName.trim(),
      phone: row.phone.trim(),
      email: row.email.trim(),
    })),
  };
}

/** Znormalizowana (po wartości) migawka draftu do porównania „dirty”. Obie strony
 *  przechodzą przez `draftToActionPayload`, więc samo otwarcie edytora legacy
 *  klienta (split → join tej samej nazwy) NIE jest brudne. */
export function normalizedDraft(d: ClientFormDraft): string {
  return JSON.stringify(draftToActionPayload(d));
}
