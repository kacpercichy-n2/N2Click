// Stały zbiór rodzajów dokumentów projektu + polskie etykiety UI
// (wzorzec: utils/tickets.ts). Slugi są persystowane lokalnie i w chmurze —
// etykiety wolno zmieniać, slugów NIE (repair w storage.ts normalizuje nieznane
// wartości do rodzaju domyślnego).
import type { ProjectDocumentKind } from '../types';

export const PROJECT_DOCUMENT_KINDS: ProjectDocumentKind[] = [
  'oferta',
  'wycena',
  'brief',
  'link',
];

/** Wartość domyślna — także cel normalizacji nieznanego rodzaju przy wczytaniu. */
export const DEFAULT_PROJECT_DOCUMENT_KIND: ProjectDocumentKind = 'link';

export const PROJECT_DOCUMENT_KIND_LABELS: Record<ProjectDocumentKind, string> = {
  oferta: 'Oferta',
  wycena: 'Wycena',
  brief: 'Brief',
  link: 'Link',
};

export const isProjectDocumentKind = (v: unknown): v is ProjectDocumentKind =>
  PROJECT_DOCUMENT_KINDS.includes(v as ProjectDocumentKind);

/** Jedyne dozwolone schematy odnośnika. Projekty są danymi WSPÓŁDZIELONYMI w
 *  organizacji (chmura), więc adres wpisany przez jedną osobę renderuje się
 *  jako klikalny `href` u innych — `javascript:` czy `data:` byłyby wtedy
 *  przechowywanym XSS-em, a nie kwestią UX. */
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null; // nie da się sparsować (np. brak schematu)
  }
}

/**
 * Normalizuje adres dokumentu do postaci nadającej się do zapisania i wstawienia
 * w `href`, albo zwraca `null`, gdy adres ma zostać ODRZUCONY.
 *
 * Reguły (parsowanie wyłącznie przez `new URL`, bez regexów):
 * 1. Adres z rozpoznanym schematem musi mieć `http:` albo `https:` — cokolwiek
 *    innego (`javascript:`, `data:`, `file:`, `mailto:`…) jest odrzucane.
 * 2. Adres BEZ schematu (`example.test/oferta.pdf`) jest dopuszczony i
 *    normalizowany przez dopisanie `https://` — próba prefiksowania biegnie
 *    TYLKO wtedy, gdy pierwsze parsowanie się nie powiodło, więc
 *    `javascript:...` nigdy nie przemyci się jako „adres bez schematu”.
 * 3. Poza dopisaniem schematu adres zostaje dosłownie taki, jaki podał
 *    użytkownik (bez przepisywania na `URL.href`).
 */
export function normalizeProjectDocumentUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  const direct = parseUrl(value);
  if (direct) {
    return ALLOWED_URL_PROTOCOLS.includes(direct.protocol) ? value : null;
  }
  const prefixed = `https://${value}`;
  const fallback = parseUrl(prefixed);
  return fallback && ALLOWED_URL_PROTOCOLS.includes(fallback.protocol) ? prefixed : null;
}
