// Czysty rozbiór treści wiadomości na segmenty do renderu: zwykły tekst,
// automatyczne linki, GIF-y i „jumbo" emoji. Komponent `ChatWindow.tsx` tylko
// mapuje wynik na elementy — cała decyzyjność (i test w node) siedzi tutaj.
//
// DECYZJE:
//   * ZERO `dangerouslySetInnerHTML`. Tokenizer zwraca DANE, nie HTML, więc
//     treść wiadomości nigdy nie jest parsowana jako znaczniki. To jedyna
//     granica, która broni czatu przed wstrzyknięciem znaczników przez treść.
//   * Linkujemy WYŁĄCZNIE `http`/`https` (plus `www.` z dopisanym `https://`).
//     `javascript:`, `data:` i `mailto:` zostają zwykłym tekstem — schemat
//     nigdy nie pochodzi z treści, tylko z dopasowanego wzorca.
//   * Końcowa interpunkcja i niedomknięte `)`/`]` wypadają POZA link: zdanie
//     „wejdź na https://n2.pl." nie może skończyć się linkiem z kropką.
//   * GIF to zwykła wiadomość, której treść jest URL-em obrazka — schemat bazy
//     się nie zmienia (decyzja D5 z pakietu PKG-20260817-chat-fixes).

/** Kawałek treści: zwykły tekst albo link do otwarcia w nowej karcie. */
export type ChatSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string; label: string };

/** Rodzaj całej wiadomości — decyduje o dymku (obrazek / duże emoji / tekst). */
export type ChatContentKind = 'gif' | 'emoji' | 'text';

/**
 * Kandydat na adres. Świadomie WĄSKI: białe znaki i znaki znaczników kończą
 * dopasowanie, więc żadna treść nie przemyci `"` ani `<` do atrybutu `href`.
 */
const URL_CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Znak przed adresem, który znaczy, że to NIE jest początek adresu
 *  (`kacper@www.x.pl`, `xhttps://…`, `plik.www.x.pl`). */
const URL_PREFIX_BLOCK = /[\w@.]/;

/** Interpunkcja doklejana do adresu na końcu zdania. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?']);

/** Adres http(s) albo `null`. Nigdy nie rzuca — treść bywa dowolna. */
function safeHttpUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.hostname === '') return null;
  return parsed;
}

/** Ile razy znak występuje w tekście (domknięcie nawiasów). */
function countOf(text: string, char: string): number {
  let count = 0;
  for (const entry of text) if (entry === char) count += 1;
  return count;
}

/**
 * Obcięcie ogona dopasowania: interpunkcja zdania i nawias domykający, który
 * nie ma pary W ŚRODKU adresu. `(https://x.y/z)` daje link bez nawiasu, ale
 * `https://x.y/a_(b)` zachowuje swój — bo tam nawiasy się równoważą.
 */
function trimUrlTail(raw: string): string {
  let text = raw;
  let changed = true;
  while (changed && text.length > 0) {
    changed = false;
    const last = text.slice(-1);
    if (TRAILING_PUNCTUATION.has(last)) {
      text = text.slice(0, -1);
      changed = true;
      continue;
    }
    if (
      (last === ')' && countOf(text, ')') > countOf(text, '(')) ||
      (last === ']' && countOf(text, ']') > countOf(text, '['))
    ) {
      text = text.slice(0, -1);
      changed = true;
    }
  }
  return text;
}

/**
 * Rozbicie treści na segmenty. Nowe linie ZOSTAJĄ w segmentach tekstowych
 * (dymek ma `white-space: pre-wrap`, decyzja D7), więc Shift+Enter z
 * kompozytora wygląda w dymku tak samo jak przy pisaniu.
 */
export function tokenizeMessage(body: string): ChatSegment[] {
  if (body === '') return [];
  const segments: ChatSegment[] = [];
  let cursor = 0;
  const pattern = new RegExp(URL_CANDIDATE.source, 'gi');
  let match = pattern.exec(body);
  while (match !== null) {
    const start = match.index;
    const before = start === 0 ? '' : body[start - 1];
    const candidate = trimUrlTail(match[0]);
    const bare = candidate.toLowerCase().startsWith('www.');
    // Adres w `href` jedzie DOSŁOWNIE (po walidacji), a nie jako `URL.href` —
    // normalizacja dokleiłaby `/` do domeny i link przestałby być tym, co
    // widać w dymku.
    const href = bare ? `https://${candidate}` : candidate;
    const usable =
      candidate !== '' && safeHttpUrl(href) !== null && !URL_PREFIX_BLOCK.test(before);
    if (usable) {
      if (start > cursor) segments.push({ kind: 'text', text: body.slice(cursor, start) });
      segments.push({ kind: 'link', href, label: candidate });
      cursor = start + candidate.length;
    }
    // Kolejne szukanie startuje ZA obciętym adresem, żeby ogon (`).`) wrócił do
    // tekstu, a nie został pominięty razem z całym dopasowaniem.
    pattern.lastIndex = usable ? cursor : start + match[0].length;
    match = pattern.exec(body);
  }
  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) });
  return segments;
}

/**
 * Hosty mediów KLIPY — DOKŁADNIE te cztery z „Network Requirements" (plus
 * `static.klipy.co` obserwowany 17.08.2026). Zbiór, a nie wzorzec: wzorzec
 * `static[12]?\.klipy\.(com|co)` wpuszczał też `static1.klipy.co` i
 * `static2.klipy.co`, których dokumentacja nie wymienia. To ta sama lista,
 * którą musiałby dostać `img-src` w CSP, więc nie wolno jej rozszerzać na
 * poddomeny „na wszelki wypadek".
 */
const KLIPY_MEDIA_HOSTS: ReadonlySet<string> = new Set([
  'static.klipy.com',
  'static.klipy.co',
  'static1.klipy.com',
  'static2.klipy.com',
]);

/** Hosty, których każdy adres jest animowanym GIF-em, nawet bez `.gif` w ścieżce. */
const GIF_HOSTS = /^(?:media\d*\.giphy\.com|i\.giphy\.com)$/;

/**
 * Czy adres ma ZATWIERDZONY ORIGIN. Origin to schemat + host + port, więc sam
 * host nie wystarczy: „Network Requirements" wymieniają wyłącznie HTTPS na
 * porcie 443, a `img-src https://static.klipy.com` w CSP i tak odrzuci zarówno
 * `http://`, jak i niestandardowy port. Sprawdzanie samego hosta robiłoby
 * allowlistę LUŹNIEJSZĄ niż CSP, którą ma odwzorowywać — a `http://` to jeszcze
 * ładowanie obrazka po jawnym łączu, podatne na podmianę w drodze.
 *
 * Dane logowania odrzucamy jawnie: `https://static.klipy.com@obcy.example/x`
 * ma origin `https://obcy.example`, ale forma bywa myląca przy przeglądzie.
 */
function hasApprovedOrigin(parsed: URL, allows: (host: string) => boolean): boolean {
  if (parsed.protocol !== 'https:') return false;
  if (parsed.port !== '') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  return allows(parsed.hostname.toLowerCase());
}

/**
 * Czy adres jest medium Z HOSTA KLIPY. To JEDYNY test, którym wolno przepuszczać
 * adresy przychodzące z API KLIPY.
 *
 * `isGifUrl` się do tego NIE nadaje: przepuszcza każdy adres o ścieżce kończącej
 * się na `.gif` — reguła słuszna dla linku WKLEJONEGO przez człowieka, ale przy
 * odpowiedzi API oznaczałaby, że podmieniona albo złośliwa odpowiedź wstawi
 * `https://obcy.example/pixel.gif` do `<img src>` i do treści wiadomości.
 * Origin jest tym, co egzekwuje CSP, więc origin sprawdzamy tutaj.
 */
export function isKlipyMediaUrl(url: string): boolean {
  const parsed = safeHttpUrl(url.trim());
  if (parsed === null) return false;
  return hasApprovedOrigin(parsed, (host) => KLIPY_MEDIA_HOSTS.has(host));
}

/**
 * Czy adres wskazuje animowany GIF. Reguła ROZPOZNAWANIA TREŚCI dymka, nie
 * reguła zaufania: obejmuje też ścieżkę `.gif` na dowolnym hoście, bo człowiek
 * wkleja linki z całego internetu. Do walidacji odpowiedzi API służy
 * `isKlipyMediaUrl`.
 */
export function isGifUrl(url: string): boolean {
  const parsed = safeHttpUrl(url.trim());
  if (parsed === null) return false;
  if (/\.gif$/i.test(parsed.pathname)) return true;
  // Gałąź ALLOWLISTY (host bez rozszerzenia `.gif` w ścieżce) chodzi po tej
  // samej regule originu co `isKlipyMediaUrl` — inaczej `http://i.giphy.com/x`
  // albo `http://static.klipy.com/x` renderowałoby się jako obrazek po jawnym
  // łączu. Reguła ścieżki `.gif` wyżej zostaje luźna świadomie: to linki
  // WKLEJANE przez ludzi z całego internetu, nie treść od dostawcy.
  return hasApprovedOrigin(parsed, (host) => KLIPY_MEDIA_HOSTS.has(host) || GIF_HOSTS.test(host));
}

/**
 * Dostawca GIF-a do podpisania w dymku. Regulamin KLIPY („API Terms of Use")
 * wymaga widocznego „Powered by KLIPY" w aplikacji, nie tylko w pickerze —
 * dymek z obrazkiem z hosta KLIPY dostaje więc własny mały podpis.
 * `null` = adres spoza znanego dostawcy (np. wklejony ręcznie link `.gif`),
 * dymek zostaje wtedy bez podpisu.
 */
export function gifAttribution(url: string): 'klipy' | null {
  return isKlipyMediaUrl(url) ? 'klipy' : null;
}

/**
 * Jedna „grafemowa" emoji: znak piktograficzny z modyfikatorami (selektor
 * wariantu, kolor skóry) oraz sekwencje ZWJ (`👩‍💻` to JEDNA emoji, nie dwie).
 * Świadomie bez `Intl.Segmenter` — moduł ma zostać czysty i przewidywalny.
 */
const EMOJI_ATOM = '\\p{Extended_Pictographic}[\\uFE0E\\uFE0F\\p{Emoji_Modifier}]*';
const EMOJI_PICTOGRAPH = `${EMOJI_ATOM}(?:\\u200D${EMOJI_ATOM})*`;
/** Flaga państwa to para wskaźników regionalnych, nie `Extended_Pictographic`. */
const EMOJI_FLAG = '[\\u{1F1E6}-\\u{1F1FF}]{2}';
/** Keycap: cyfra, `#` albo `*`, opcjonalny VS16 i znak łączący. */
const EMOJI_KEYCAP = '[0-9#*]\\uFE0F?\\u20E3';
const EMOJI_CLUSTER = `(?:${EMOJI_PICTOGRAPH}|${EMOJI_FLAG}|${EMOJI_KEYCAP})`;
/** 1–3 emoji i nic poza białymi znakami — powyżej trzech to już zwykły tekst. */
const EMOJI_ONLY = new RegExp(
  `^\\s*(?:${EMOJI_CLUSTER})(?:\\s*(?:${EMOJI_CLUSTER})){0,2}\\s*$`,
  'u',
);

/** Czy treść to same emoji (1–3 sztuki) — dymek renderuje je wtedy większe. */
export function isEmojiOnly(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === '') return false;
  return EMOJI_ONLY.test(trimmed);
}

/**
 * Rodzaj wiadomości dla dymka i podglądu na liście rozmów. GIF wygrywa z emoji,
 * emoji z tekstem; wiadomość „URL + komentarz" jest zwykłym tekstem z linkiem.
 */
export function messageContentKind(body: string): ChatContentKind {
  const trimmed = body.trim();
  if (trimmed === '') return 'text';
  if (!/\s/.test(trimmed) && isGifUrl(trimmed)) return 'gif';
  if (isEmojiOnly(trimmed)) return 'emoji';
  return 'text';
}
