// Katalog motywów czatu („skinów"). JEDYNE źródło prawdy o tym, co znaczy
// `conversations.theme_id`: baza pilnuje tylko kształtu identyfikatora, a
// nieznany id (stary klient vs nowy skin) sprowadzamy tu do domyślnego.
//
// DECYZJE:
//   * Aplikacja jest wyłącznie ciemna (`color-scheme: dark` w styles.css), więc
//     motyw ma jeden wariant. Wartości to hexy, nie tokeny — test
//     `catalog.test.ts` liczy kontrast WCAG (≥ 4,5:1) dla tekstu na KAŻDYM
//     stopie gradientu mojego dymka i na cudzym dymku; `var()` nie da się
//     policzyć.
//   * Nowy skin = pliki w `public/chat-themes/` + jeden wpis niżej. Test pilnuje
//     unikalnych id w formacie bazy i istnienia wskazanych plików.
//   * Wzór tła to MASKA (czarny rysunek na przezroczystym tle, jak w Telegramie):
//     warstwa `::before` okna barwi ją akcentem motywu przez `mask-image`, więc
//     jeden plik służy każdemu kolorowi.
//   * `quickReaction` to emoji podpowiadane w pasku reakcji jako pierwsze
//     (Messenger: motyw „Love" ma serce). Musi być na liście `chatEmoji.ts`.

export type ChatThemeBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; colors: [string, string]; angle: number }
  | {
      kind: 'pattern';
      color: string;
      /** Ścieżka względem `/chat-themes/` (maska PNG/SVG, czarny na przezroczystym). */
      asset: string;
      /** Rozmiar kafla w px (CSS). */
      tile: number;
      /** Krycie warstwy wzoru (0..1). */
      opacity: number;
    }
  | {
      kind: 'image';
      /** Kolor pod obrazem (zanim się wczyta) i baza przyciemnienia. */
      color: string;
      asset: string;
      /** Przyciemnienie obrazu (0..1), żeby dymki zostały czytelne. */
      dim: number;
    };

export interface ChatTheme {
  /** `^[a-z0-9-]{1,32}$` — dokładnie to, co przepuszcza CHECK w bazie. */
  id: string;
  /** Polska nazwa: picker, wiersz systemowy „X ustawia motyw »Nazwa«". */
  name: string;
  /** Akcent: przycisk „Wyślij", obwódki, barwa wzoru tła. */
  accent: string;
  /** Tekst na akcencie (przycisk „Wyślij"). */
  accentText: string;
  bubbleMine: { gradient: [string, string]; text: string };
  bubbleTheirs: { bg: string; text: string; border: string };
  background: ChatThemeBackground;
  quickReaction: string;
}

export const DEFAULT_THEME_ID = 'lawenda';

export const CHAT_THEME_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * Domyślny motyw ODTWARZA dotychczasowy wygląd okna: gradient marki
 * (`--n2-violet` → `--n2-cosmos`), cudzy dymek jak `--n2-glass` na
 * `--n2-surface-strong`, tło okna bez wzoru.
 */
export const CHAT_THEMES: readonly ChatTheme[] = [
  {
    id: 'lawenda',
    name: 'Lawenda',
    accent: '#c496ff',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#7000ff', '#3c005e'], text: '#f7f0ff' },
    bubbleTheirs: { bg: '#2f2e35', text: '#fbf8ff', border: '#3a393f' },
    background: { kind: 'solid', color: '#202024' },
    quickReaction: '💜',
  },
  {
    id: 'polnoc',
    name: 'Północ',
    accent: '#a5b4fc',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#4c1d95', '#312e81'], text: '#ede9fe' },
    bubbleTheirs: { bg: '#26213f', text: '#ede9fe', border: '#332c52' },
    background: { kind: 'gradient', colors: ['#120c24', '#1b1233'], angle: 180 },
    quickReaction: '🌟',
  },
  {
    id: 'neon',
    name: 'Neon studio',
    accent: '#f472b6',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#7c3aed', '#be185d'], text: '#fdf2f8' },
    bubbleTheirs: { bg: '#1f1b2e', text: '#f5f3ff', border: '#2e2842' },
    background: {
      kind: 'pattern',
      color: '#0b0b12',
      asset: 'patterns/dots.svg',
      tile: 24,
      opacity: 0.22,
    },
    quickReaction: '🔥',
  },
  {
    id: 'mgla',
    name: 'Mgła',
    accent: '#c7d2fe',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#4f46e5', '#6d28d9'], text: '#eef2ff' },
    bubbleTheirs: { bg: '#2a2740', text: '#eef2ff', border: '#383455' },
    background: { kind: 'gradient', colors: ['#1a1a2e', '#251a36'], angle: 160 },
    quickReaction: '⭐',
  },
  {
    id: 'glebia',
    name: 'Głębia',
    accent: '#7dd3fc',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#1d4ed8', '#6d28d9'], text: '#eff6ff' },
    bubbleTheirs: { bg: '#16233a', text: '#eff6ff', border: '#243652' },
    background: {
      kind: 'pattern',
      color: '#0c1a2e',
      asset: 'patterns/waves.svg',
      tile: 120,
      opacity: 0.16,
    },
    quickReaction: '💙',
  },
  {
    id: 'las',
    name: 'Las',
    accent: '#86efac',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#047857', '#115e59'], text: '#ecfdf5' },
    bubbleTheirs: { bg: '#17281f', text: '#ecfdf5', border: '#253a2e' },
    background: {
      kind: 'pattern',
      color: '#0d1f17',
      asset: 'patterns/fern.png',
      tile: 256,
      opacity: 0.14,
    },
    quickReaction: '💚',
  },
  {
    id: 'zachod',
    name: 'Zachód',
    accent: '#fdba74',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#be123c', '#c2410c'], text: '#fff1f2' },
    bubbleTheirs: { bg: '#332024', text: '#fff1f2', border: '#4a2e33' },
    background: { kind: 'gradient', colors: ['#2a0f14', '#2b1608'], angle: 170 },
    quickReaction: '🧡',
  },
  {
    id: 'grafit',
    name: 'Grafit',
    accent: '#d4d4d8',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#3f3f46', '#27272a'], text: '#fafafa' },
    bubbleTheirs: { bg: '#1f1f23', text: '#f4f4f5', border: '#2e2e33' },
    background: {
      kind: 'pattern',
      color: '#151517',
      asset: 'patterns/grid.svg',
      tile: 20,
      opacity: 0.12,
    },
    quickReaction: '👍',
  },
  {
    id: 'konfetti',
    name: 'Konfetti',
    accent: '#c4b5fd',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#7c3aed', '#2563eb'], text: '#f5f3ff' },
    bubbleTheirs: { bg: '#262238', text: '#f5f3ff', border: '#36304d' },
    background: {
      kind: 'pattern',
      color: '#141225',
      asset: 'patterns/confetti.png',
      tile: 256,
      opacity: 0.2,
    },
    quickReaction: '🎉',
  },
  {
    id: 'miod',
    name: 'Miód',
    accent: '#fcd34d',
    accentText: '#0b0b12',
    bubbleMine: { gradient: ['#6d28d9', '#b45309'], text: '#fffbeb' },
    bubbleTheirs: { bg: '#2a2230', text: '#fffbeb', border: '#3d3242' },
    background: { kind: 'image', color: '#1c1426', asset: 'images/miod.webp', dim: 0.45 },
    quickReaction: '✨',
  },
];

const BY_ID = new Map(CHAT_THEMES.map((theme) => [theme.id, theme]));

/** Motyw po id; nieznany/pusty id => domyślny (nigdy `undefined`). */
export function themeById(id: string | null | undefined): ChatTheme {
  return (id && BY_ID.get(id)) || (BY_ID.get(DEFAULT_THEME_ID) as ChatTheme);
}

/** Czy id istnieje w katalogu (picker pokazuje zaznaczenie tylko wtedy). */
export function isKnownThemeId(id: string): boolean {
  return BY_ID.has(id);
}
