import { describe, expect, it } from 'vitest';
import {
  gifAttribution,
  isKlipyMediaUrl,
  isEmojiOnly,
  isGifUrl,
  messageContentKind,
  tokenizeMessage,
  type ChatSegment,
} from './chatRichText';

/** Skrót do asercji: same linki z wyniku tokenizera. */
function links(body: string): ChatSegment[] {
  return tokenizeMessage(body).filter((segment) => segment.kind === 'link');
}

describe('tokenizeMessage', () => {
  it('pusta treść nie daje segmentów', () => {
    expect(tokenizeMessage('')).toEqual([]);
  });

  it('tekst bez adresu zostaje jednym segmentem', () => {
    expect(tokenizeMessage('Cześć, jak leci?')).toEqual([
      { kind: 'text', text: 'Cześć, jak leci?' },
    ]);
  });

  it('adres w środku zdania rozbija tekst na trzy segmenty', () => {
    expect(tokenizeMessage('zobacz https://n2.pl/oferta i wróć')).toEqual([
      { kind: 'text', text: 'zobacz ' },
      { kind: 'link', href: 'https://n2.pl/oferta', label: 'https://n2.pl/oferta' },
      { kind: 'text', text: ' i wróć' },
    ]);
  });

  it('kropka kończąca zdanie zostaje POZA linkiem', () => {
    expect(tokenizeMessage('wejdź na https://n2.pl.')).toEqual([
      { kind: 'text', text: 'wejdź na ' },
      { kind: 'link', href: 'https://n2.pl', label: 'https://n2.pl' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('obcina każdą interpunkcję zdania z ogona adresu', () => {
    for (const mark of ['.', ',', ';', ':', '!', '?']) {
      expect(links(`link https://n2.pl/a${mark}`)).toEqual([
        { kind: 'link', href: 'https://n2.pl/a', label: 'https://n2.pl/a' },
      ]);
    }
  });

  it('forma `www.` dostaje https w href i oryginał w etykiecie', () => {
    expect(tokenizeMessage('pisz na www.n2.pl')).toEqual([
      { kind: 'text', text: 'pisz na ' },
      { kind: 'link', href: 'https://www.n2.pl', label: 'www.n2.pl' },
    ]);
  });

  it('nawias domykający bez pary wypada z linku', () => {
    expect(tokenizeMessage('(https://x.y/z)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', href: 'https://x.y/z', label: 'https://x.y/z' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('zrównoważone nawiasy zostają w linku', () => {
    expect(links('https://pl.wikipedia.org/wiki/Rok_(film)')).toEqual([
      {
        kind: 'link',
        href: 'https://pl.wikipedia.org/wiki/Rok_(film)',
        label: 'https://pl.wikipedia.org/wiki/Rok_(film)',
      },
    ]);
  });

  it('zachowuje zapytanie i kotwicę', () => {
    expect(links('https://a.b/c?d=1&e=2#f')).toEqual([
      { kind: 'link', href: 'https://a.b/c?d=1&e=2#f', label: 'https://a.b/c?d=1&e=2#f' },
    ]);
  });

  it('javascript:, data: i mailto: NIE stają się linkami', () => {
    expect(links('javascript:alert(1)')).toEqual([]);
    expect(links('data:text/html,<script>x</script>')).toEqual([]);
    expect(links('mailto:kacper@n2.pl')).toEqual([]);
    expect(tokenizeMessage('javascript:alert(1)')).toEqual([
      { kind: 'text', text: 'javascript:alert(1)' },
    ]);
  });

  it('adres wewnątrz słowa albo adresu e-mail nie jest linkiem', () => {
    expect(links('kacper@www.n2.pl')).toEqual([]);
    expect(links('xhttps://n2.pl')).toEqual([]);
  });

  it('wielolinijkowa treść zachowuje znaki nowej linii', () => {
    expect(tokenizeMessage('pierwsza\ndruga https://n2.pl\ntrzecia')).toEqual([
      { kind: 'text', text: 'pierwsza\ndruga ' },
      { kind: 'link', href: 'https://n2.pl', label: 'https://n2.pl' },
      { kind: 'text', text: '\ntrzecia' },
    ]);
  });

  it('dwa adresy w jednej wiadomości dają dwa linki', () => {
    expect(links('https://a.pl oraz www.b.pl!')).toEqual([
      { kind: 'link', href: 'https://a.pl', label: 'https://a.pl' },
      { kind: 'link', href: 'https://www.b.pl', label: 'www.b.pl' },
    ]);
  });

  it('zostawia domykający nawias i przecinek po adresie', () => {
    expect(tokenizeMessage('zobacz (https://n2.pl/oferta), potem wróć')).toEqual([
      { kind: 'text', text: 'zobacz (' },
      { kind: 'link', href: 'https://n2.pl/oferta', label: 'https://n2.pl/oferta' },
      { kind: 'text', text: '), potem wróć' },
    ]);
  });

  it('nie linkuje samego prefiksu https://', () => {
    expect(tokenizeMessage('adres https://')).toEqual([{ kind: 'text', text: 'adres https://' }]);
  });

  it('linkuje domenę Unicode bez zmiany widocznej etykiety', () => {
    expect(links('https://żółw.pl/ścieżka')).toEqual([
      {
        kind: 'link',
        href: 'https://żółw.pl/ścieżka',
        label: 'https://żółw.pl/ścieżka',
      },
    ]);
  });

  it('zostawia pytajnik zdania poza adresem', () => {
    expect(tokenizeMessage('wejść na https://n2.pl?')).toEqual([
      { kind: 'text', text: 'wejść na ' },
      { kind: 'link', href: 'https://n2.pl', label: 'https://n2.pl' },
      { kind: 'text', text: '?' },
    ]);
  });
});

describe('isGifUrl', () => {
  it('rozpoznaje ścieżkę .gif niezależnie od wielkości liter', () => {
    expect(isGifUrl('https://n2.pl/kot.gif')).toBe(true);
    expect(isGifUrl('https://n2.pl/KOT.GIF')).toBe(true);
    expect(isGifUrl('https://n2.pl/kot.gif?w=200')).toBe(true);
  });

  it('rozpoznaje hosty KLIPY i Giphy, także bez końcówki .gif', () => {
    expect(isGifUrl('https://static.klipy.com/abc123/kot')).toBe(true);
    expect(isGifUrl('https://static.klipy.co/abc123/kot')).toBe(true);
    expect(isGifUrl('https://static1.klipy.com/abc123/kot')).toBe(true);
    expect(isGifUrl('https://static2.klipy.com/abc123/kot')).toBe(true);
    expect(isGifUrl('https://media.giphy.com/media/abc/giphy.webp')).toBe(true);
    expect(isGifUrl('https://media3.giphy.com/media/abc/giphy.webp')).toBe(true);
    expect(isGifUrl('https://i.giphy.com/abc')).toBe(true);
  });

  it('odrzuca podobne, ale nie-GIF-owe adresy', () => {
    expect(isGifUrl('https://n2.pl/kot.gifs')).toBe(false);
    expect(isGifUrl('http://x.pl/y.gif.exe')).toBe(false);
    expect(isGifUrl('https://klipy.com/view/kot-123')).toBe(false);
    expect(isGifUrl('https://static.klipy.com.zly.example/kot')).toBe(false);
    expect(isGifUrl('https://static3.klipy.com/kot')).toBe(false);
    expect(isGifUrl('zwykły tekst')).toBe(false);
    expect(isGifUrl('javascript:alert(1)')).toBe(false);
    expect(isGifUrl('ftp://n2.pl/kot.gif')).toBe(false);
  });
});

describe('gifAttribution', () => {
  it('podpisuje wyłącznie GIF-y z hostów KLIPY', () => {
    expect(gifAttribution('https://static.klipy.com/abc123/kot.gif')).toBe('klipy');
    expect(gifAttribution('  https://STATIC.KLIPY.CO/abc123/kot  ')).toBe('klipy');
    expect(gifAttribution('https://static2.klipy.com/abc123/kot')).toBe('klipy');
    expect(gifAttribution('https://media.giphy.com/media/abc/giphy.gif')).toBeNull();
    expect(gifAttribution('https://n2.pl/kot.gif')).toBeNull();
  });

  it('adres bez schematu http(s) nie dostaje podpisu', () => {
    expect(gifAttribution('static.klipy.com/abc/kot.gif')).toBeNull();
    expect(gifAttribution('javascript:alert(1)')).toBeNull();
    expect(gifAttribution('')).toBeNull();
  });
});

describe('isEmojiOnly', () => {
  it('przyjmuje od jednej do trzech emoji', () => {
    expect(isEmojiOnly('👍')).toBe(true);
    expect(isEmojiOnly('😂😂😂')).toBe(true);
    expect(isEmojiOnly('🎉 🔥')).toBe(true);
  });

  it('modyfikator koloru skóry i sekwencja ZWJ to JEDNA emoji', () => {
    expect(isEmojiOnly('👍🏽')).toBe(true);
    expect(isEmojiOnly('👩‍💻')).toBe(true);
    expect(isEmojiOnly('👩‍💻👨‍💻👍🏽')).toBe(true);
    expect(isEmojiOnly('❤️')).toBe(true);
  });

  it('traktuje flagę i keycap jako pojedyncze grafemy emoji', () => {
    expect(isEmojiOnly('🇵🇱')).toBe(true);
    expect(isEmojiOnly('1️⃣')).toBe(true);
    expect(isEmojiOnly('🇵🇱 1️⃣ 👨‍👩‍👧‍👦')).toBe(true);
  });

  it('odrzuca tekst z emoji, cztery emoji i pustkę', () => {
    expect(isEmojiOnly('ok 👍')).toBe(false);
    expect(isEmojiOnly('😂😂😂😂')).toBe(false);
    expect(isEmojiOnly('')).toBe(false);
    expect(isEmojiOnly('   ')).toBe(false);
  });
});

describe('messageContentKind', () => {
  it('sam adres GIF-a to wiadomość GIF', () => {
    expect(messageContentKind('https://static.klipy.com/abc/kot')).toBe('gif');
    expect(messageContentKind('  https://n2.pl/kot.gif  ')).toBe('gif');
  });

  it('adres GIF-a z komentarzem zostaje tekstem', () => {
    expect(messageContentKind('zobacz https://n2.pl/kot.gif')).toBe('text');
  });

  it('1–3 emoji to wiadomość emoji, więcej to tekst', () => {
    expect(messageContentKind('🔥')).toBe('emoji');
    expect(messageContentKind('🙏 🙏')).toBe('emoji');
    expect(messageContentKind('🙏🙏🙏🙏')).toBe('text');
  });

  it('pusta i zwykła treść to tekst', () => {
    expect(messageContentKind('')).toBe('text');
    expect(messageContentKind('   ')).toBe('text');
    expect(messageContentKind('cześć')).toBe('text');
  });
});

describe('isKlipyMediaUrl', () => {
  it('przepuszcza DOKŁADNIE cztery udokumentowane hosty', () => {
    for (const host of ['static.klipy.com', 'static.klipy.co', 'static1.klipy.com', 'static2.klipy.com']) {
      expect(isKlipyMediaUrl(`https://${host}/abc/sm.gif`)).toBe(true);
    }
    expect(isKlipyMediaUrl('  https://STATIC.KLIPY.COM/abc/sm.gif  ')).toBe(true);
  });

  it('nie rozszerza się na inne poddomeny ani na hosty niewymienione w dokumentacji', () => {
    for (const host of [
      'static1.klipy.co',
      'static2.klipy.co',
      'static3.klipy.com',
      'klipy.com',
      'api.klipy.com',
      'static.klipy.com.zly.example',
      'zly-static.klipy.com',
    ]) {
      expect(isKlipyMediaUrl(`https://${host}/abc/sm.gif`)).toBe(false);
    }
  });

  it('NIE daje się obejść samą końcówką .gif w ścieżce', () => {
    // Sedno różnicy wobec `isGifUrl`: obcy host z rozszerzeniem `.gif` jest
    // legalną treścią WKLEJONĄ przez człowieka, ale nigdy odpowiedzią KLIPY.
    expect(isGifUrl('https://obcy.example/pixel.gif')).toBe(true);
    expect(isKlipyMediaUrl('https://obcy.example/pixel.gif')).toBe(false);
  });

  it('odrzuca wszystko poza dokładnym originem HTTPS i podszywanie się przez userinfo', () => {
    expect(isKlipyMediaUrl('http://static.klipy.com/a.gif')).toBe(false);
    expect(isKlipyMediaUrl('https://static.klipy.com:444/a.gif')).toBe(false);
    expect(isKlipyMediaUrl('javascript:alert(1)')).toBe(false);
    expect(isKlipyMediaUrl('data:image/gif;base64,AAA')).toBe(false);
    expect(isKlipyMediaUrl('https://static.klipy.com@obcy.example/a.gif')).toBe(false);
    expect(isKlipyMediaUrl('https://ktos@static.klipy.com/a.gif')).toBe(false);
    expect(isKlipyMediaUrl('')).toBe(false);
  });
});

describe('isGifUrl — gałąź allowlisty hostów', () => {
  it('trzyma ten sam ORIGIN co isKlipyMediaUrl: tylko https na porcie domyślnym', () => {
    // Regresja: gałąź allowlisty dopasowywała sam HOST, więc obrazek z
    // zatwierdzonego hosta jechał też po `http://` i po dowolnym porcie —
    // czyli luźniej, niż pozwoli `img-src` w CSP.
    expect(isGifUrl('http://static.klipy.com/abc/kot')).toBe(false);
    expect(isGifUrl('http://i.giphy.com/abc')).toBe(false);
    expect(isGifUrl('https://i.giphy.com:8443/abc')).toBe(false);
    expect(isGifUrl('https://static.klipy.com:8443/abc/kot')).toBe(false);
    expect(isGifUrl('https://static.klipy.com@obcy.example/abc/kot')).toBe(false);
  });

  it('zatwierdzony origin bez rozszerzenia .gif nadal jest GIF-em', () => {
    expect(isGifUrl('https://i.giphy.com/abc')).toBe(true);
    expect(isGifUrl('https://static.klipy.com/abc/kot')).toBe(true);
    expect(isGifUrl('https://static.klipy.com:443/abc/kot')).toBe(true);
  });

  it('reguła ścieżki .gif zostaje luźna — to linki WKLEJANE przez ludzi', () => {
    expect(isGifUrl('http://obcy.example/kot.gif')).toBe(true);
    expect(isGifUrl('https://obcy.example:8443/kot.gif')).toBe(true);
  });
});
