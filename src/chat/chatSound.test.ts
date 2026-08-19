// Testy pinga dźwiękowego czatu: czysta decyzja „czy grać i jak głośno",
// preferencja urządzenia w storage.ts oraz zachowanie modułu audio bez
// Web Audio (node) — ping ma milczeć, nie rzucać.
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHAT_PING_LEVEL_HIDDEN,
  CHAT_PING_LEVEL_VISIBLE,
  CHAT_PING_THROTTLE_MS,
  armChatSound,
  chatSoundReady,
  decideChatPing,
  playChatPing,
  resetChatSoundForTests,
  type ChatPingFacts,
} from './chatSound';
import { readChatSoundEnabled, writeChatSoundEnabled } from '../store/storage';

const BASE: ChatPingFacts = {
  authorId: 'peer',
  selfId: 'self',
  conversationId: 'conv-1',
  openConversationId: null,
  documentHidden: true,
  enabled: true,
  lastPingAt: null,
  now: 1_000_000,
};

describe('decideChatPing', () => {
  it('gra pełnym poziomem, gdy karta ukryta i wiadomość od kogoś innego', () => {
    expect(decideChatPing(BASE)).toEqual({ play: true, level: CHAT_PING_LEVEL_HIDDEN });
  });

  it('milczy przy wyłączonym dźwięku', () => {
    expect(decideChatPing({ ...BASE, enabled: false })).toEqual({ play: false });
  });

  it('milczy dla własnej wiadomości (echo broadcastu)', () => {
    expect(decideChatPing({ ...BASE, authorId: 'self' })).toEqual({ play: false });
  });

  it('milczy, gdy rozmowa jest otwarta i karta widoczna', () => {
    expect(
      decideChatPing({ ...BASE, openConversationId: 'conv-1', documentHidden: false }),
    ).toEqual({ play: false });
  });

  it('gra ciszej, gdy karta widoczna, ale rozmowa nie jest otwarta', () => {
    expect(decideChatPing({ ...BASE, documentHidden: false })).toEqual({
      play: true,
      level: CHAT_PING_LEVEL_VISIBLE,
    });
    expect(
      decideChatPing({ ...BASE, documentHidden: false, openConversationId: 'conv-2' }),
    ).toEqual({ play: true, level: CHAT_PING_LEVEL_VISIBLE });
  });

  it('gra pełnym poziomem w otwartej rozmowie, gdy karta jest ukryta', () => {
    expect(decideChatPing({ ...BASE, openConversationId: 'conv-1' })).toEqual({
      play: true,
      level: CHAT_PING_LEVEL_HIDDEN,
    });
  });

  it('dławi serię: drugi ping w oknie 3 s milczy, po oknie gra', () => {
    const first = decideChatPing(BASE);
    expect(first.play).toBe(true);
    expect(
      decideChatPing({ ...BASE, lastPingAt: BASE.now, now: BASE.now + CHAT_PING_THROTTLE_MS - 1 }),
    ).toEqual({ play: false });
    expect(
      decideChatPing({ ...BASE, lastPingAt: BASE.now, now: BASE.now + CHAT_PING_THROTTLE_MS }),
    ).toEqual({ play: true, level: CHAT_PING_LEVEL_HIDDEN });
  });
});

// Środowisko testów to `node`: localStorage i document stubujemy na czas testu,
// tak jak robi to `storage.test.ts`.
function withLocalStorage<T>(initial: Record<string, string>, fn: () => T): T {
  const store = new Map<string, string>(Object.entries(initial));
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  g.localStorage = stub;
  try {
    return fn();
  } finally {
    g.localStorage = prev;
  }
}

describe('preferencja dźwięku (storage.ts)', () => {
  it('brak klucza = włączony; zapis wyłączenia i włączenia wraca po odczycie', () => {
    withLocalStorage({}, () => {
      expect(readChatSoundEnabled()).toBe(true);
      writeChatSoundEnabled(false);
      expect(readChatSoundEnabled()).toBe(false);
      writeChatSoundEnabled(true);
      expect(readChatSoundEnabled()).toBe(true);
    });
  });

  it('uszkodzony klucz = włączony (bezpieczny domyślny)', () => {
    withLocalStorage({ 'n2hub.chatSound.v1': '{nope' }, () => {
      expect(readChatSoundEnabled()).toBe(true);
    });
  });

  it('bez localStorage w ogóle: odczyt = włączony, zapis nie rzuca', () => {
    const g = globalThis as { localStorage?: Storage };
    const prev = g.localStorage;
    g.localStorage = undefined;
    try {
      expect(readChatSoundEnabled()).toBe(true);
      expect(() => writeChatSoundEnabled(false)).not.toThrow();
    } finally {
      g.localStorage = prev;
    }
  });
});

describe('moduł audio bez Web Audio', () => {
  afterEach(() => resetChatSoundForTests());

  it('bez dokumentu i kontekstu: ping milczy, uzbrojenie zwraca no-op, nic nie rzuca', () => {
    expect(chatSoundReady()).toBe(false);
    expect(playChatPing(0.35)).toBe(false);
    const disarm = armChatSound();
    expect(typeof disarm).toBe('function');
    expect(() => disarm()).not.toThrow();
  });

  it('z dokumentem, ale bez Web Audio: gest nie odblokowuje, uzbrojenie jest idempotentne', () => {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    const fakeDocument = {
      addEventListener: (type: string, fn: (event: Event) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (event: Event) => void) => {
        listeners.get(type)?.delete(fn);
      },
      dispatch: (type: string) => {
        listeners.get(type)?.forEach((fn) => fn(new Event(type)));
      },
    };
    const g = globalThis as { document?: unknown };
    const prev = g.document;
    g.document = fakeDocument;
    try {
      const disarm = armChatSound();
      const again = armChatSound();
      expect(again).toBe(disarm);
      expect(listeners.get('pointerdown')?.size).toBe(1);
      expect(listeners.get('keydown')?.size).toBe(1);
      fakeDocument.dispatch('pointerdown');
      expect(chatSoundReady()).toBe(false);
      expect(playChatPing(0.35)).toBe(false);
      disarm();
      expect(listeners.get('pointerdown')?.size).toBe(0);
      expect(listeners.get('keydown')?.size).toBe(0);
    } finally {
      g.document = prev;
    }
  });
});
