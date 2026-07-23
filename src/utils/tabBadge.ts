// Badge karty przeglądarki (favicon + tytuł) dla nieprzeczytanych powiadomień.
// Logika etykiet, licznika i maszyna stanu apply/restore są CZYSTE i testowane
// w środowisku node (patrz tabBadge.test.ts) — DOM i canvas żyją wyłącznie w
// cienkiej warstwie `createDomTabBadgeHost` / `drawBadgeFaviconDataUrl`,
// wpinanej przez hook `useTabBadge`. Zero zmian w bazie/syncu/reducerach.
import type { Notification } from '../types';

/** Etykieta kropki: 0 (lub wartość niepoprawna) => brak badge'a, 1–9 => cyfra,
 *  powyżej => `9+` (czytelne także przy 16×16). */
export function unreadBadgeLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 9 ? '9+' : String(Math.floor(count));
}

/** Tytuł karty z licznikiem, np. `(3) N2Hub Planer`; licznik 0 => bazowy tytuł. */
export function titleWithBadge(baseTitle: string, count: number): string {
  const label = unreadBadgeLabel(count);
  return label === '' ? baseTitle : `(${label}) ${baseTitle}`;
}

/**
 * Licznik nieprzeczytanych powiadomień odbiorcy — te same kryteria co karta
 * „Powiadomienia” na Panelu (`unreadNotificationsForPerson`): odbiorca =
 * wskazana osoba, `readAt === ''`. Brak osoby (wylogowanie) => 0.
 */
export function unreadNotificationCountFor(
  notifications: ReadonlyArray<Pick<Notification, 'recipientId' | 'readAt'>>,
  personId: string | null | undefined,
): number {
  if (!personId) return 0;
  let count = 0;
  for (const n of notifications) {
    if (n.recipientId === personId && n.readAt === '') count += 1;
  }
  return count;
}

/** Granica DOM dla appliera — w testach podmieniana na fałszywkę. */
export interface TabBadgeHost {
  getTitle(): string;
  setTitle(title: string): void;
  /** Narysuj/podmień faviconę z kropką o danej etykiecie (niepustej). */
  applyFavicon(label: string): void;
  /** Przywróć oryginalną faviconę (lub usuń utworzony link-element). */
  restoreFavicon(): void;
}

export interface TabBadgeApplier {
  /** Zastosuj licznik; zwraca false, gdy etykieta się nie zmieniła (zero
   *  przerysowań => brak migotania). */
  apply(count: number): boolean;
  /** Przywróć tytuł i faviconę, jeśli badge jest aktywny (cleanup hooka). */
  dispose(): void;
}

/**
 * Czysta maszyna stanu badge'a: zapamiętuje bazowy tytuł przy pierwszej
 * aktywacji (więc `(5)` nigdy nie nakłada się na `(2)`), pomija powtórzenia tej
 * samej etykiety (10 → 11 zostaje `9+`) i przy zeru przywraca stan wyjściowy.
 */
export function createTabBadgeApplier(host: TabBadgeHost): TabBadgeApplier {
  let baseTitle: string | null = null; // null => badge nieaktywny
  let lastLabel = '';
  const apply = (count: number): boolean => {
    const label = unreadBadgeLabel(count);
    if (label === lastLabel) return false;
    lastLabel = label;
    if (label === '') {
      if (baseTitle !== null) host.setTitle(baseTitle);
      baseTitle = null;
      host.restoreFavicon();
    } else {
      if (baseTitle === null) baseTitle = host.getTitle();
      host.setTitle(titleWithBadge(baseTitle, count));
      host.applyFavicon(label);
    }
    return true;
  };
  return { apply, dispose: () => void apply(0) };
}

// ---- Cienka warstwa DOM/canvas (bez testów jednostkowych — patrz nagłówek) ----

/**
 * Rysuje 32×32 faviconę z czerwoną kropką w prawym górnym rogu i zwraca
 * data-URL (null, gdy canvas niedostępny). `base` to opcjonalna bazowa favicona;
 * bez niej rysujemy ciemny kafelek w motywie aplikacji (index.html nie deklaruje
 * dziś `<link rel="icon">`, więc to jest ścieżka domyślna).
 */
export function drawBadgeFaviconDataUrl(label: string, base?: CanvasImageSource | null): string | null {
  if (typeof document === 'undefined') return null;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (base) {
    try {
      ctx.drawImage(base, 0, 0, size, size);
    } catch {
      // uszkodzony podkład => zostaje sam kafelek z kropką
    }
  }
  if (!base) {
    ctx.fillStyle = '#050406';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(0.5, 0.5, size - 1, size - 1, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillRect(0, 0, size, size);
    }
  }
  // Kropka zajmuje ~2/3 wysokości ikony, żeby liczba była czytelna przy 16×16.
  const cx = 21;
  const cy = 11;
  ctx.beginPath();
  ctx.arc(cx, cy, 10.5, 0, Math.PI * 2);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.strokeStyle = '#050406';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${label.length > 1 ? 11 : 14}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 1);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Host DOM: zarządza link-elementem favicony. Gdy `index.html` ma
 * `link[rel~="icon"]`, podmieniamy jego `href` i przy przywracaniu oddajemy
 * oryginał (bazowa grafika jest doładowywana raz i użyta jako podkład kropki);
 * gdy nie ma — tworzymy własny link i przy przywracaniu go usuwamy.
 */
export function createDomTabBadgeHost(doc: Document): TabBadgeHost {
  let managed: HTMLLinkElement | null = null;
  let createdByUs = false;
  let originalHref: string | null = null;
  let baseImage: HTMLImageElement | null = null;
  let baseImageRequested = false;
  let currentLabel = '';

  const ensureLink = (): HTMLLinkElement => {
    if (managed && managed.isConnected) return managed;
    const existing = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (existing) {
      managed = existing;
      createdByUs = false;
      originalHref = existing.getAttribute('href');
    } else {
      const link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
      managed = link;
      createdByUs = true;
      originalHref = null;
    }
    return managed;
  };

  const redraw = () => {
    if (!managed || currentLabel === '') return;
    const url = drawBadgeFaviconDataUrl(currentLabel, baseImage);
    if (url) managed.setAttribute('href', url);
  };

  return {
    getTitle: () => doc.title,
    setTitle: (title) => {
      doc.title = title;
    },
    applyFavicon: (label) => {
      currentLabel = label;
      ensureLink();
      redraw();
      // Jednorazowe doładowanie bazowej favicony jako podkładu; do czasu
      // wczytania (i przy błędzie) zostaje kafelek narysowany wyżej.
      if (originalHref && !originalHref.startsWith('data:') && !baseImageRequested) {
        baseImageRequested = true;
        const img = new Image();
        img.onload = () => {
          baseImage = img;
          redraw();
        };
        img.src = originalHref;
      }
    },
    restoreFavicon: () => {
      currentLabel = '';
      if (!managed) return;
      if (createdByUs) {
        managed.remove();
      } else if (originalHref !== null) {
        managed.setAttribute('href', originalHref);
      }
      managed = null;
    },
  };
}
