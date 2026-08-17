// Wykrywanie NOWEJ WERSJI aplikacji w otwartej karcie. To SPA bez service
// workera: karta otwarta przed publikacją na Vercelu chodzi na starym pakiecie
// tak długo, aż ktoś ją odświeży — a czat jest żywy (Realtime), więc taka karta
// żyje godzinami i dostaje wiadomości, których stary kod nie umie pokazać
// (17.08.2026: GIF renderował się u nadawcy, u odbiorcy był surowym adresem).
//
// Odcisk wersji to adres głównego skryptu modułu w `index.html` — Vite wpina
// tam hash zawartości (`/assets/index-XXXX.js`), więc każda publikacja zmienia
// go bez osobnego pliku wersji. Ten moduł jest czysty (parsowanie + porównanie);
// pobieranie i zegar siedzą w `UpdateBanner.tsx`.

/**
 * `src` pierwszego `<script type="module" src="…">` w HTML-u powłoki albo
 * `null`, gdy go nie ma (strona logowania Vercela, błąd, pusta odpowiedź).
 * Kolejność atrybutów jest dowolna — Vite pisze `type` przed `src`, ale
 * `crossorigin` między nimi, więc szukamy w obrębie jednego znacznika.
 */
export function moduleScriptSrc(html: string): string | null {
  const tags = html.match(/<script\b[^>]*>/gi);
  if (tags === null) return null;
  for (const tag of tags) {
    if (!/\btype\s*=\s*["']?module["']?/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (src !== null && src[1] !== '') return src[1];
  }
  return null;
}

/**
 * Czy pobrany HTML wskazuje INNY pakiet niż ten, który karta ma załadowany.
 * Brak którejkolwiek strony (`null`) to „nie wiem" = brak baneru: fałszywy
 * baner „odśwież" jest gorszy niż brak baneru, bo psuje zaufanie do
 * prawdziwego.
 */
export function isNewerBuild(current: string | null, fetched: string | null): boolean {
  if (current === null || fetched === null) return false;
  return current !== fetched;
}
