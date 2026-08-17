// Kuratorowana lista emoji pickera czatu (decyzja D6) plus czysta arytmetyka
// wstawiania w pozycji kursora. Komponent `ChatEmojiPopover.tsx` obok tylko to
// renderuje.
//
// DECYZJE:
//   * WŁASNA lista, bez nowej zależności (`emoji-mart`, `emoji-picker-element`)
//     i bez CDN-u. Pełny zestaw Unicode to setki kilobajtów danych i własny
//     indeks wyszukiwania; picker czatu ma pokryć to, czego ludzie faktycznie
//     używają w rozmowie o pracy. Klawiatury telefonów mają własne emoji —
//     ten picker jest dla desktopu.
//   * Słowa kluczowe są POLSKIE i zapisane bez ogonków oraz małymi literami,
//     dokładnie w postaci, jaką zwraca `normalizeQuery` z `chatDockView.ts`.
//     Dzięki temu filtr jest zwykłym `includes`, a nie normalizacją 600 napisów
//     przy każdym naciśnięciu klawisza. Test pilnuje tej niezmienniczości.
//   * Pierwsze słowo kluczowe jest jednocześnie etykietą dla czytnika ekranu.
//   * Sekcja „Ostatnie" żyje w pamięci sesji (`useState` w oknie rozmowy), NIE
//     w localStorage — `storage.ts` pozostaje jedyną granicą trwałego zapisu.
import { normalizeQuery } from './chatDockView';

/** Jedna pozycja pickera: znak i polskie słowa kluczowe (bez ogonków). */
export interface EmojiEntry {
  char: string;
  keywords: readonly string[];
}

/** Sekcja pickera. */
export interface EmojiCategory {
  id: string;
  label: string;
  emojis: readonly EmojiEntry[];
}

/** Ile emoji pamięta sekcja „Ostatnie". */
export const MAX_RECENT_EMOJI = 16;

function entry(char: string, ...keywords: string[]): EmojiEntry {
  return { char, keywords };
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: 'buzki',
    label: 'Buźki',
    emojis: [
      entry('😀', 'usmiech', 'radosc', 'wesolo'),
      entry('😃', 'usmiech szeroki', 'radosc'),
      entry('😄', 'smiech', 'radosc'),
      entry('😁', 'usmiech z zebami', 'radosc'),
      entry('😆', 'smiech mocny', 'ubaw'),
      entry('😅', 'smiech z ulga', 'pot', 'uff'),
      entry('🤣', 'tarzam sie ze smiechu', 'smiech'),
      entry('😂', 'lzy ze smiechu', 'smiech', 'placz'),
      entry('🙂', 'lekki usmiech'),
      entry('😉', 'mrugniecie', 'zart'),
      entry('😊', 'usmiech niesmialy', 'mile'),
      entry('😍', 'zakochanie', 'serduszka', 'zachwyt'),
      entry('🥰', 'czulosc', 'kocham', 'serduszka'),
      entry('😘', 'calus', 'buziak'),
      entry('😎', 'okulary', 'luz', 'sztos'),
      entry('🤩', 'zachwyt', 'gwiazdy', 'wow'),
      entry('🤔', 'zastanowienie', 'mysle', 'hmm'),
      entry('🤨', 'uniesiona brew', 'watpliwosc'),
      entry('😐', 'obojetnosc', 'bez wyrazu'),
      entry('😴', 'sen', 'spie', 'nuda'),
      entry('🤯', 'eksplozja glowy', 'szok'),
      entry('😳', 'zaklopotanie', 'rumieniec'),
      entry('😮', 'zdziwienie', 'zaskoczenie', 'oho'),
      entry('😢', 'smutek', 'lza'),
      entry('😭', 'placz', 'rozpacz'),
      entry('😤', 'zloszcze sie', 'para z nosa'),
      entry('😡', 'zlosc', 'wsciekly'),
      entry('🤢', 'mdlosci', 'fuj'),
      entry('🤒', 'chory', 'goraczka'),
      entry('🥳', 'impreza', 'swietowanie'),
    ],
  },
  {
    id: 'gesty',
    label: 'Gesty',
    emojis: [
      entry('👍', 'kciuk w gore', 'super', 'zgoda', 'ok'),
      entry('👎', 'kciuk w dol', 'slabo', 'nie'),
      entry('👌', 'ok', 'w porzadku'),
      entry('🤌', 'szczypta', 'palce'),
      entry('✌️', 'pokoj', 'dwa palce'),
      entry('🤞', 'trzymam kciuki', 'powodzenia'),
      entry('🤟', 'kocham cie', 'gest'),
      entry('🤙', 'zadzwon', 'luz'),
      entry('👈', 'wskazuje w lewo'),
      entry('👉', 'wskazuje w prawo'),
      entry('👆', 'wskazuje w gore'),
      entry('👇', 'wskazuje w dol'),
      entry('✋', 'dlon', 'stop'),
      entry('👋', 'czesc', 'machanie', 'do zobaczenia'),
      entry('🤝', 'uscisk dloni', 'umowa'),
      entry('🙏', 'dziekuje', 'prosze', 'modlitwa'),
      entry('👏', 'brawa', 'oklaski'),
      entry('🙌', 'hurra', 'rece w gore', 'sukces'),
      entry('💪', 'sila', 'miesien', 'damy rade'),
      entry('🫶', 'serce z rak', 'czulosc'),
      entry('👀', 'oczy', 'patrze', 'sledze'),
      entry('🧠', 'mozg', 'myslenie'),
      entry('✍️', 'pisze', 'notatka'),
      entry('🤲', 'otwarte dlonie', 'prosba'),
    ],
  },
  {
    id: 'serca',
    label: 'Serca',
    emojis: [
      entry('❤️', 'serce czerwone', 'milosc'),
      entry('🧡', 'serce pomaranczowe'),
      entry('💛', 'serce zolte'),
      entry('💚', 'serce zielone'),
      entry('💙', 'serce niebieskie'),
      entry('💜', 'serce fioletowe'),
      entry('🖤', 'serce czarne'),
      entry('🤍', 'serce biale'),
      entry('🤎', 'serce brazowe'),
      entry('💖', 'serce blyszczace'),
      entry('💗', 'serce rosnace'),
      entry('💓', 'serce bijace'),
      entry('💞', 'serca wirujace'),
      entry('💕', 'dwa serca'),
      entry('💔', 'zlamane serce', 'smutek'),
      entry('❣️', 'serce wykrzyknik'),
    ],
  },
  {
    id: 'ludzie',
    label: 'Ludzie i zwierzęta',
    emojis: [
      entry('👶', 'dziecko', 'niemowle'),
      entry('🧑', 'osoba'),
      entry('👩', 'kobieta'),
      entry('👨', 'mezczyzna'),
      entry('👵', 'babcia', 'starsza pani'),
      entry('👴', 'dziadek', 'starszy pan'),
      entry('👩‍💻', 'programistka', 'praca przy komputerze'),
      entry('👨‍💻', 'programista', 'praca przy komputerze'),
      entry('🧑‍🎨', 'grafik', 'artysta', 'projektant'),
      entry('🕺', 'tancerz', 'zabawa'),
      entry('💃', 'tancerka', 'zabawa'),
      entry('🐶', 'pies', 'piesek'),
      entry('🐱', 'kot', 'kotek'),
      entry('🐭', 'mysz'),
      entry('🐹', 'chomik'),
      entry('🐰', 'krolik', 'zajac'),
      entry('🦊', 'lis'),
      entry('🐻', 'niedzwiedz', 'mis'),
      entry('🐼', 'panda'),
      entry('🦁', 'lew'),
      entry('🐮', 'krowa'),
      entry('🐷', 'swinia'),
      entry('🐵', 'malpa'),
      entry('🐝', 'pszczola'),
      entry('🦄', 'jednorozec'),
    ],
  },
  {
    id: 'jedzenie',
    label: 'Jedzenie',
    emojis: [
      entry('☕', 'kawa', 'przerwa'),
      entry('🍵', 'herbata'),
      entry('🥤', 'napoj'),
      entry('🍺', 'piwo'),
      entry('🍻', 'piwa', 'toast', 'zdrowie'),
      entry('🥂', 'szampan', 'toast'),
      entry('🍷', 'wino'),
      entry('🍾', 'butelka szampana', 'sukces'),
      entry('🍎', 'jablko'),
      entry('🍌', 'banan'),
      entry('🍓', 'truskawka'),
      entry('🍉', 'arbuz'),
      entry('🍇', 'winogrona'),
      entry('🥑', 'awokado'),
      entry('🥕', 'marchewka'),
      entry('🍞', 'chleb'),
      entry('🧀', 'ser'),
      entry('🍕', 'pizza'),
      entry('🍔', 'burger'),
      entry('🌮', 'taco'),
      entry('🍟', 'frytki'),
      entry('🍿', 'popcorn', 'film'),
      entry('🍫', 'czekolada'),
      entry('🍩', 'paczek'),
      entry('🎂', 'tort', 'urodziny'),
      entry('🍪', 'ciastko'),
    ],
  },
  {
    id: 'aktywnosc',
    label: 'Aktywność',
    emojis: [
      entry('🎉', 'konfetti', 'impreza', 'sukces', 'gratulacje'),
      entry('🎊', 'kula konfetti', 'swietowanie'),
      entry('🎈', 'balon', 'urodziny'),
      entry('🎁', 'prezent'),
      entry('🏆', 'puchar', 'wygrana'),
      entry('🥇', 'zloty medal', 'pierwsze miejsce'),
      entry('⚽', 'pilka nozna'),
      entry('🏀', 'koszykowka'),
      entry('🎾', 'tenis'),
      entry('🏐', 'siatkowka'),
      entry('🏃', 'bieg', 'sprint'),
      entry('🚴', 'rower'),
      entry('🏋️', 'silownia', 'trening'),
      entry('🧘', 'joga', 'medytacja', 'spokoj'),
      entry('🏊', 'plywanie'),
      entry('⛷️', 'narty'),
      entry('🎯', 'cel', 'tarcza', 'w punkt'),
      entry('🎮', 'gra', 'pad'),
      entry('🎲', 'kostka', 'losowanie'),
      entry('🎤', 'mikrofon', 'karaoke'),
      entry('🎧', 'sluchawki', 'muzyka'),
      entry('🎸', 'gitara'),
      entry('🎬', 'film', 'klaps'),
      entry('🎨', 'paleta', 'sztuka', 'projekt'),
      entry('📸', 'aparat', 'zdjecie'),
    ],
  },
  {
    id: 'obiekty',
    label: 'Obiekty',
    emojis: [
      entry('🚀', 'rakieta', 'start', 'wdrozenie'),
      entry('💡', 'zarowka', 'pomysl'),
      entry('📌', 'pinezka', 'przypiete'),
      entry('📎', 'spinacz', 'zalacznik'),
      entry('📁', 'folder', 'katalog'),
      entry('📄', 'dokument', 'plik'),
      entry('📊', 'wykres slupkowy', 'raport'),
      entry('📈', 'wzrost', 'wykres w gore'),
      entry('📉', 'spadek', 'wykres w dol'),
      entry('📅', 'kalendarz', 'termin'),
      entry('⏰', 'budzik', 'przypomnienie'),
      entry('⌛', 'klepsydra', 'czekanie'),
      entry('💻', 'laptop', 'komputer'),
      entry('🖥️', 'monitor'),
      entry('📱', 'telefon', 'komorka'),
      entry('⌨️', 'klawiatura'),
      entry('🖨️', 'drukarka'),
      entry('🔒', 'klodka', 'zamkniete', 'bezpieczne'),
      entry('🔑', 'klucz', 'dostep'),
      entry('💰', 'pieniadze', 'budzet'),
      entry('💳', 'karta platnicza', 'platnosc'),
      entry('📧', 'mail', 'koperta'),
      entry('📞', 'sluchawka', 'rozmowa'),
      entry('🔔', 'dzwonek', 'powiadomienie'),
      entry('🔍', 'lupa', 'szukam'),
      entry('✏️', 'olowek', 'edycja'),
      entry('📝', 'notatka', 'notes'),
    ],
  },
  {
    id: 'symbole',
    label: 'Symbole',
    emojis: [
      entry('🔥', 'ogien', 'sztos', 'goraco'),
      entry('✨', 'iskry', 'nowe', 'blask'),
      entry('⭐', 'gwiazda', 'ulubione'),
      entry('🌟', 'gwiazda blyszczaca'),
      entry('💫', 'zawroty glowy', 'gwiazdki'),
      entry('⚡', 'blyskawica', 'szybko'),
      entry('✅', 'zrobione', 'ptaszek', 'ok'),
      entry('❌', 'krzyzyk', 'nie', 'blad'),
      entry('⚠️', 'ostrzezenie', 'uwaga'),
      entry('❗', 'wykrzyknik', 'wazne'),
      entry('❓', 'pytajnik', 'pytanie'),
      entry('💯', 'sto procent', 'na maksa'),
      entry('🆗', 'ok napis'),
      entry('🔴', 'czerwone kolo'),
      entry('🟠', 'pomaranczowe kolo'),
      entry('🟡', 'zolte kolo'),
      entry('🟢', 'zielone kolo'),
      entry('🔵', 'niebieskie kolo'),
      entry('🟣', 'fioletowe kolo'),
      entry('⚫', 'czarne kolo'),
      entry('⚪', 'biale kolo'),
      entry('🔁', 'powtorz', 'petla'),
      entry('➕', 'plus', 'dodaj'),
      entry('➖', 'minus', 'usun'),
      entry('🚫', 'zakaz', 'stop'),
      entry('♻️', 'recykling', 'odswiez'),
    ],
  },
];

/** Indeks znak → pierwsze słowo kluczowe (etykieta czytnika ekranu). */
const LABEL_BY_CHAR = new Map<string, string>(
  EMOJI_CATEGORIES.flatMap((category) =>
    category.emojis.map((emoji) => [emoji.char, emoji.keywords[0] ?? 'emoji'] as const),
  ),
);

/** Etykieta emoji dla czytnika ekranu; 'emoji' dla znaku spoza listy. */
export function emojiLabel(char: string): string {
  return LABEL_BY_CHAR.get(char) ?? 'emoji';
}

/**
 * Filtr pickera po słowach kluczowych. Puste zapytanie zwraca WSZYSTKIE
 * kategorie (picker startuje pełną listą); kategorie bez trafień wypadają.
 */
export function filterEmoji(query: string): EmojiCategory[] {
  const needle = normalizeQuery(query);
  if (needle === '') return EMOJI_CATEGORIES.map((category) => ({ ...category }));
  const result: EmojiCategory[] = [];
  for (const category of EMOJI_CATEGORIES) {
    const emojis = category.emojis.filter((emoji) =>
      emoji.keywords.some((keyword) => keyword.includes(needle)),
    );
    if (emojis.length > 0) result.push({ ...category, emojis });
  }
  return result;
}

/** Ostatnio użyte: znak na czoło, bez duplikatów, przycięte do limitu. */
export function pushRecentEmoji(
  list: readonly string[],
  char: string,
  max: number = MAX_RECENT_EMOJI,
): string[] {
  if (char === '') return list.slice();
  return [char, ...list.filter((entry) => entry !== char)].slice(0, Math.max(1, max));
}

/** Wynik wstawienia: nowa treść i pozycja kursora ZA wstawionym tekstem. */
export interface CaretInsert {
  value: string;
  caret: number;
}

/**
 * Wstawienie tekstu w pozycji kursora (albo w miejsce zaznaczenia). Czysta
 * arytmetyka na napisach — komponent tylko przekazuje `selectionStart/End`
 * pola i po renderze przywraca karetkę.
 */
export function insertAtCaret(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  insert: string,
): CaretInsert {
  const clamp = (raw: number): number => {
    if (!Number.isFinite(raw)) return value.length;
    return Math.min(Math.max(Math.trunc(raw), 0), value.length);
  };
  const a = clamp(selectionStart);
  const b = clamp(selectionEnd);
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return { value: value.slice(0, from) + insert + value.slice(to), caret: from + insert.length };
}

/**
 * Tekstowe emotikony zamieniane na emoji PRZY WYSYŁCE (`ChatWindow.send`).
 * Zamiana idzie na granicy wysyłki, a nie przy renderze: baza dostaje prawdziwe
 * emoji, więc odbiorca widzi to samo niezależnie od wersji, którą ma
 * załadowaną, a wiadomość „<3" liczy się jak jedno emoji (dymek jumbo).
 *
 * Lista świadomie KRÓTKA — te, które ludzie piszą z pamięci. Dłuższe warianty
 * stoją PRZED krótszymi (`</3` przed `<3`, `:-)` przed `:)`), bo wzorzec jest
 * alternatywą i wygrywa pierwsza gałąź, która pasuje.
 */
const EMOTICONS: ReadonlyArray<readonly [string, string]> = [
  ['</3', '💔'],
  ['<3', '❤️'],
  [":'(", '😢'],
  [':-)', '🙂'],
  [':)', '🙂'],
  ['(:', '🙂'],
  [':-D', '😀'],
  [':D', '😀'],
  [';-)', '😉'],
  [';)', '😉'],
  [':-(', '🙁'],
  [':(', '🙁'],
  [':-P', '😛'],
  [':P', '😛'],
  [':p', '😛'],
  [';P', '😜'],
  [';p', '😜'],
  [':-O', '😮'],
  [':O', '😮'],
  [':o', '😮'],
  [':-*', '😘'],
  [':*', '😘'],
  [':-|', '😐'],
  [':|', '😐'],
  [':-/', '😕'],
  [':/', '😕'],
  ['xD', '😆'],
  ['XD', '😆'],
  ['^^', '😊'],
  ['-_-', '😑'],
];

const EMOTICON_MAP: ReadonlyMap<string, string> = new Map(EMOTICONS);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

const EMOTICON_ALTERNATION = EMOTICONS.map(([text]) => escapeRegExp(text)).join('|');

/**
 * Emotikony muszą stać OSOBNO: ciąg jednego lub kilku sklejonych (`<3<3<3`,
 * `:):)`) na początku tekstu albo po białym znaku, a za nim koniec, biały znak
 * lub interpunkcja zdania. Dzięki temu `https://x` (`:/` po literze) ani `a:)b`
 * nie są ruszane, a „super :)", „hej :)!" i „<3<3" — tak.
 */
const EMOTICON_RUN = new RegExp(`(^|\\s)((?:${EMOTICON_ALTERNATION})+)(?=$|\\s|[.,!?])`, 'g');
/** Rozbiór ciągu na pojedyncze emotikony (dłuższe warianty pierwsze). */
const EMOTICON_ONE = new RegExp(EMOTICON_ALTERNATION, 'g');

/** Zamiana samodzielnych emotikonów tekstowych na emoji; reszta bez zmian. */
export function replaceEmoticons(text: string): string {
  if (text === '') return text;
  return text.replace(
    EMOTICON_RUN,
    (_match, lead: string, run: string) =>
      lead + run.replace(EMOTICON_ONE, (one) => EMOTICON_MAP.get(one) ?? one),
  );
}
