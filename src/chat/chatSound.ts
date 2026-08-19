// Ping dźwiękowy nowej wiadomości czatu. Dźwięk „Marimba" jest SYNTEZOWANY
// w Web Audio (dwa uderzenia pałeczką, D5 → A5), więc w repo nie ma żadnego
// pliku audio ani licencji do pilnowania; barwę i głośność zmienia się liczbą.
//
// GRANICE / DECYZJE:
//   * Polityka autoplay (Chrome, Safari): kontekst audio wolno uruchomić dopiero
//     po geście użytkownika. `armChatSound()` zakłada JEDNORAZOWE nasłuchy
//     `pointerdown` / `keydown` na dokumencie i przy pierwszym geście tworzy
//     kontekst + `resume()`. Ping przed gestem jest po prostu pomijany
//     (nie kolejkujemy — spóźniony dźwięk tylko myli).
//   * W UKRYTEJ karcie Web Audio gra, o ile wyzwala je zdarzenie sieciowe
//     (broadcast Supabase), a nie timer. Dlatego `playChatPing` jest
//     synchroniczne i nie używa `setTimeout`.
//   * Decyzja „czy pingować" (`decideChatPing`) jest CZYSTA i testowalna:
//     nie ma w niej DOM-u ani audio. Provider dostarcza fakty, funkcja mówi
//     `play` + poziom głośności. Dławik: najwyżej jeden ping na 3 s, żeby
//     seria 20 wiadomości dała jeden dźwięk, a nie karabin.
//   * Preferencja „dźwięk włączony" jest per URZĄDZENIE; czyta/zapisuje ją
//     `store/storage.ts` (jedyna granica localStorage), ten moduł jej nie dotyka.

/** Minimalny odstęp między dwoma pingami (ms). */
export const CHAT_PING_THROTTLE_MS = 3000;

/** Głośność pinga: karta ukryta (pełna) i karta widoczna, ale rozmowa nie otwarta. */
export const CHAT_PING_LEVEL_HIDDEN = 0.35;
export const CHAT_PING_LEVEL_VISIBLE = 0.18;

export interface ChatPingFacts {
  /** Autor wiadomości (uuid) i my (uuid). */
  authorId: string;
  selfId: string;
  /** Rozmowa wiadomości i rozmowa aktualnie otwarta w doku (`null` = żadna). */
  conversationId: string;
  openConversationId: string | null;
  /** `document.hidden` w chwili nadejścia. */
  documentHidden: boolean;
  /** Preferencja urządzenia. */
  enabled: boolean;
  /** Czas ostatniego zagranego pinga (ms, `Date.now()`); `null` = jeszcze nie grał. */
  lastPingAt: number | null;
  now: number;
}

export type ChatPingDecision = { play: false } | { play: true; level: number };

/**
 * Czy ta wiadomość ma zagrać, i jak głośno. Reguły (w tej kolejności):
 *   1. wyłączony dźwięk, własna wiadomość → cisza;
 *   2. rozmowa otwarta I karta widoczna → cisza (użytkownik patrzy na nią);
 *   3. dławik 3 s → cisza;
 *   4. karta ukryta → pełny poziom; karta widoczna, rozmowa nieotwarta → ciszej.
 */
export function decideChatPing(facts: ChatPingFacts): ChatPingDecision {
  if (!facts.enabled) return { play: false };
  if (facts.authorId === facts.selfId) return { play: false };
  if (facts.conversationId === facts.openConversationId && !facts.documentHidden) {
    return { play: false };
  }
  if (facts.lastPingAt !== null && facts.now - facts.lastPingAt < CHAT_PING_THROTTLE_MS) {
    return { play: false };
  }
  return {
    play: true,
    level: facts.documentHidden ? CHAT_PING_LEVEL_HIDDEN : CHAT_PING_LEVEL_VISIBLE,
  };
}

// ---- Web Audio ---------------------------------------------------------------

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;
let armed = false;
let disarm: (() => void) | null = null;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Odblokowanie z BIEŻĄCEGO gestu użytkownika (np. klik w „Dźwięk wł."): tworzy
 * kontekst i wznawia go od razu, bez czekania na kolejny `pointerdown`. Wołać
 * tylko z handlera zdarzenia wejściowego — poza gestem przeglądarka zostawi
 * kontekst zawieszony i ping nadal będzie milczał.
 */
export function unlockChatSound(): void {
  unlockFromGesture();
}

/** Tworzy (raz) kontekst i próbuje go wznowić. Wywoływać TYLKO z gestu. */
function unlockFromGesture(): void {
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    if (!context) context = new Ctor();
    if (context.state === 'suspended') void context.resume();
  } catch {
    context = null;
  }
}

/**
 * Zakłada jednorazowe nasłuchy gestu na dokumencie. Idempotentne; zwraca
 * sprzątanie (zdejmuje nasłuchy, nie zamyka kontekstu — ten jest tani i
 * współdzielony do końca życia karty).
 */
export function armChatSound(): () => void {
  if (armed || typeof document === 'undefined') return disarm ?? (() => {});
  armed = true;
  // `onGesture` i `teardown` wskazują na siebie nawzajem; oba są wywoływane
  // dopiero ze zdarzenia, więc kolejność deklaracji nie ma znaczenia.
  const teardown = (): void => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
  };
  function onGesture(): void {
    unlockFromGesture();
    if (context && context.state === 'running') teardown();
  }
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  disarm = () => {
    teardown();
    armed = false;
    disarm = null;
  };
  return disarm;
}

/** Czy ping może zagrać teraz (kontekst istnieje i nie jest zawieszony). */
export function chatSoundReady(): boolean {
  return context !== null && context.state === 'running';
}

/**
 * Gra „Marimbę" na podanym poziomie (0..1). Zwraca `false`, gdy audio nie jest
 * jeszcze odblokowane gestem albo przeglądarka nie ma Web Audio — wtedy ping
 * po prostu się nie odzywa (brak kolejki, patrz nagłówek).
 */
export function playChatPing(level: number): boolean {
  if (!chatSoundReady() || !context) return false;
  const gain = Math.max(0, Math.min(1, level));
  if (gain === 0) return false;
  try {
    const master = context.createGain();
    master.gain.value = gain;
    master.connect(context.destination);
    playMarimba(context, master, context.currentTime + 0.02);
    return true;
  } catch {
    return false;
  }
}

interface ToneSpec {
  freq: number;
  t0: number;
  gain: number;
  decay: number;
  attack: number;
}

/** Pojedynczy ton sinusoidalny z obwiednią: miękki atak, wykładnicze wybrzmienie. */
function tone(ctx: AudioContext, dest: AudioNode, spec: ToneSpec): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(spec.freq, spec.t0);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, spec.t0);
  env.gain.exponentialRampToValueAtTime(spec.gain, spec.t0 + spec.attack);
  env.gain.exponentialRampToValueAtTime(0.0001, spec.t0 + spec.attack + spec.decay);
  osc.connect(env);
  env.connect(dest);
  osc.start(spec.t0);
  osc.stop(spec.t0 + spec.attack + spec.decay + 0.05);
}

/**
 * „Marimba": D5 (587 Hz) → A5 (880 Hz), 110 ms odstępu. Ton podstawowy plus
 * czwarta harmoniczna, która gaśnie szybciej — tak brzmi prawdziwa sztabka.
 * Całość ~380 ms. Parametry jak w makiecie
 * `reports/n2hub-ping-dzwiekowy-chat-2026-08-19.html`.
 */
export function playMarimba(ctx: AudioContext, dest: AudioNode, t0: number): void {
  tone(ctx, dest, { freq: 587.33, gain: 0.55, decay: 0.26, attack: 0.003, t0 });
  tone(ctx, dest, { freq: 2349.3, gain: 0.12, decay: 0.07, attack: 0.002, t0 });
  tone(ctx, dest, { freq: 880, gain: 0.5, decay: 0.3, attack: 0.003, t0: t0 + 0.11 });
  tone(ctx, dest, { freq: 3520, gain: 0.1, decay: 0.07, attack: 0.002, t0: t0 + 0.11 });
}

/** Tylko do testów: zerowanie stanu modułu. */
export function resetChatSoundForTests(): void {
  disarm?.();
  context = null;
  armed = false;
  disarm = null;
}
