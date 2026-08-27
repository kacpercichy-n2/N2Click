import { describe, expect, it } from 'vitest';
import {
  KLIPY_BASE,
  SEND_MAX_BYTES,
  buildKlipySearchUrl,
  buildKlipyShareRequest,
  klipyApiKey,
  parseKlipyResponse,
} from './chatGifs';

const KEY = 'testowy-klucz';
const CUSTOMER = 'b3f0c9a2-1111-4222-8333-444455556666';

/** Realistyczny wycinek odpowiedzi KLIPY: koperta `{result, data:{data:[…]}}`. */
const FIXTURE = {
  result: true,
  data: {
    current_page: 1,
    per_page: 24,
    has_next: true,
    data: [
      {
        id: 8041071659142944,
        slug: 'kot-przy-klawiaturze-abc123',
        title: 'Kot przy klawiaturze',
        type: 'gif',
        blur_preview: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
        tags: ['kot', 'praca'],
        file: {
          hd: { gif: { url: 'https://static.klipy.com/abc/hd.gif', width: 800, height: 450 } },
          md: {
            gif: {
              url: 'https://static.klipy.com/abc/md.gif',
              width: 480,
              height: 270,
              size: SEND_MAX_BYTES,
            },
          },
          sm: {
            gif: {
              url: 'https://static.klipy.com/abc/sm.gif',
              width: 220,
              height: 124,
              size: 210_000,
            },
            webp: { url: 'https://static.klipy.com/abc/sm.webp', width: 220, height: 124 },
          },
          xs: { gif: { url: 'https://static.klipy.com/abc/xs.gif', width: 120, height: 68 } },
        },
      },
      // Reklama w tej samej tablicy — musi wypaść.
      { type: 'ad', width: 320, height: 240, content: '<div>reklama</div>' },
      // Brak sluga — musi wypaść.
      {
        type: 'gif',
        title: 'Bez sluga',
        file: {
          sm: { gif: { url: 'https://static.klipy.com/x/sm.gif' } },
          md: { gif: { url: 'https://static.klipy.com/x/md.gif' } },
        },
      },
      // Sam `xs` i `hd` — zapasowe warstwy obu łańcuchów.
      {
        type: 'gif',
        slug: 'zapasowe-warstwy',
        title: '',
        file: {
          xs: { gif: { url: 'https://static2.klipy.com/y/xs.gif', width: 100, height: 100 } },
          hd: { gif: { url: 'https://static2.klipy.com/y/hd.gif', width: 900, height: 900 } },
        },
      },
    ],
  },
};

describe('buildKlipySearchUrl', () => {
  it('pusta fraza idzie na trending, bez parametru q', () => {
    const url = new URL(buildKlipySearchUrl({ apiKey: KEY, query: '', customerId: CUSTOMER }));
    expect(`${url.origin}${url.pathname}`).toBe(`${KLIPY_BASE}/${KEY}/gifs/trending`);
    expect(url.searchParams.get('q')).toBeNull();
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('per_page')).toBe('24');
    expect(url.searchParams.get('customer_id')).toBe(CUSTOMER);
    expect(url.searchParams.get('locale')).toBe('pl_PL');
    expect(url.searchParams.get('content_filter')).toBe('high');
    expect(url.searchParams.get('format_filter')).toBe('gif');
  });

  it('niepusta fraza idzie na search', () => {
    const url = new URL(buildKlipySearchUrl({ apiKey: KEY, query: 'kot', page: 3 }));
    expect(`${url.origin}${url.pathname}`).toBe(`${KLIPY_BASE}/${KEY}/gifs/search`);
    expect(url.searchParams.get('q')).toBe('kot');
    expect(url.searchParams.get('page')).toBe('3');
  });

  it('klucz jedzie SEGMENTEM ŚCIEŻKI, nie parametrem zapytania', () => {
    const url = new URL(buildKlipySearchUrl({ apiKey: KEY, query: 'kot' }));
    expect(url.pathname.startsWith(`/api/v1/${KEY}/`)).toBe(true);
    expect(url.searchParams.get('key')).toBeNull();
    expect(url.searchParams.get('app_key')).toBeNull();
  });

  it('koduje polskie znaki i spacje we frazie', () => {
    const raw = buildKlipySearchUrl({ apiKey: KEY, query: 'ćma nocą' });
    expect(raw).toContain('q=%C4%87ma+noc%C4%85');
    expect(new URL(raw).searchParams.get('q')).toBe('ćma nocą');
  });

  it('przycina frazę, a pusta po przycięciu wraca na trending', () => {
    expect(new URL(buildKlipySearchUrl({ apiKey: KEY, query: '   ' })).pathname).toContain(
      'gifs/trending',
    );
    expect(
      new URL(buildKlipySearchUrl({ apiKey: KEY, query: '  kot  ' })).searchParams.get('q'),
    ).toBe('kot');
  });

  it('pusty identyfikator użytkownika jest POMIJANY, nie wysyłany pusty', () => {
    const blank = new URL(buildKlipySearchUrl({ apiKey: KEY, query: 'kot', customerId: '  ' }));
    expect(blank.searchParams.get('customer_id')).toBeNull();
    const missing = new URL(buildKlipySearchUrl({ apiKey: KEY, query: 'kot' }));
    expect(missing.searchParams.has('customer_id')).toBe(false);
  });

  it('trzyma per_page i page w dokumentowanych widełkach', () => {
    const search = (perPage: number) =>
      new URL(buildKlipySearchUrl({ apiKey: KEY, query: 'kot', perPage })).searchParams.get(
        'per_page',
      );
    const trending = (perPage: number) =>
      new URL(buildKlipySearchUrl({ apiKey: KEY, query: '', perPage })).searchParams.get('per_page');
    // search: 8–50, trending: 1–50.
    expect(search(1)).toBe('8');
    expect(search(999)).toBe('50');
    expect(trending(1)).toBe('1');
    expect(trending(999)).toBe('50');
    expect(
      new URL(buildKlipySearchUrl({ apiKey: KEY, query: 'kot', page: 0 })).searchParams.get('page'),
    ).toBe('1');
  });
});

describe('parseKlipyResponse', () => {
  it('czyta kopertę data.data i mapuje warstwy sm/md', () => {
    const page = parseKlipyResponse(FIXTURE);
    expect(page.hasNext).toBe(true);
    expect(page.gifs).toHaveLength(2);
    expect(page.gifs[0]).toEqual({
      id: 'kot-przy-klawiaturze-abc123',
      title: 'Kot przy klawiaturze',
      previewUrl: 'https://static.klipy.com/abc/sm.gif',
      previewWidth: 220,
      previewHeight: 124,
      sendUrl: 'https://static.klipy.com/abc/md.gif',
      blurPreview: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
    });
  });

  it('id kafelka to SLUG, nie liczbowe id z odpowiedzi', () => {
    expect(parseKlipyResponse(FIXTURE).gifs[0].id).toBe('kot-przy-klawiaturze-abc123');
  });

  it('pomija reklamy i pozycje bez sluga', () => {
    const ids = parseKlipyResponse(FIXTURE).gifs.map((gif) => gif.id);
    expect(ids).toEqual(['kot-przy-klawiaturze-abc123', 'zapasowe-warstwy']);
  });

  it('schodzi na warstwy zapasowe xs i hd oraz daje zapasowy tytuł', () => {
    const [, fallback] = parseKlipyResponse(FIXTURE).gifs;
    expect(fallback.previewUrl).toBe('https://static2.klipy.com/y/xs.gif');
    expect(fallback.sendUrl).toBe('https://static2.klipy.com/y/hd.gif');
    expect(fallback.title).toBe('GIF');
    expect(fallback.blurPreview).toBeUndefined();
  });

  it('za ciężkie md ustępuje sm/xs, a gdy nic się nie mieści, idzie NAJLŻEJSZA warstwa', () => {
    const heavy = (file: Record<string, unknown>) =>
      parseKlipyResponse({
        result: true,
        data: { data: [{ type: 'gif', slug: 'ciezki', file }] },
      }).gifs[0]?.sendUrl;
    const md = { gif: { url: 'https://static.klipy.com/h/md.gif', size: 4_000_000 } };
    const sm = { gif: { url: 'https://static.klipy.com/h/sm.gif', size: 400_000 } };
    const hd = { gif: { url: 'https://static.klipy.com/h/hd.gif', size: 9_000_000 } };
    const xs = { gif: { url: 'https://static.klipy.com/h/xs.gif', size: 90_000 } };
    expect(heavy({ md, sm, hd, xs })).toBe('https://static.klipy.com/h/sm.gif');
    // md i sm za ciężkie: idzie najlżejsza o znanej wadze, tu xs; kafelek NIE
    // wypada.
    const heavySm = { gif: { ...sm.gif, size: 2_000_000 } };
    expect(heavy({ md, sm: heavySm, hd, xs })).toBe('https://static.klipy.com/h/xs.gif');
    // …a gdy xs jest cięższe od sm, to sm — decyduje waga, nie nazwa warstwy.
    expect(heavy({ md, sm: heavySm, hd, xs: { gif: { ...xs.gif, size: 3_000_000 } } })).toBe(
      'https://static.klipy.com/h/sm.gif',
    );
    // Nigdy hd, gdy jest cokolwiek lżejszego.
    expect(heavy({ md, hd, xs: { gif: { ...xs.gif, size: 5_000_000 } } })).toBe(
      'https://static.klipy.com/h/md.gif',
    );
    // md BEZ wagi obok sm z wagą: idzie sm — warstwa bez `size` nie liczy się
    // jako mieszcząca, bo mogłaby nieść nieznane megabajty.
    expect(heavy({ md: { gif: { url: 'https://static.klipy.com/h/md.gif' } }, sm })).toBe(
      'https://static.klipy.com/h/sm.gif',
    );
    // md i sm bez wagi, xs z wagą: jedyna znana waga wygrywa.
    expect(
      heavy({
        md: { gif: { url: 'https://static.klipy.com/h/md.gif' } },
        sm: { gif: { url: 'https://static.klipy.com/h/sm.gif' } },
        xs,
      }),
    ).toBe('https://static.klipy.com/h/xs.gif');
    // Bez ŻADNEJ wagi: dawna kolejność md → hd.
    expect(
      heavy({
        md: { gif: { url: 'https://static.klipy.com/h/md.gif' } },
        hd: { gif: { url: 'https://static.klipy.com/h/hd.gif' } },
        xs: { gif: { url: 'https://static.klipy.com/h/xs.gif' } },
      }),
    ).toBe('https://static.klipy.com/h/md.gif');
  });

  it('odrzuca rendition z OBCEGO hosta, nawet gdy ścieżka kończy się na .gif', () => {
    // Regresja: parser walidował adresy przez `isGifUrl`, które przepuszcza
    // każdą ścieżkę `.gif` niezależnie od hosta — podmieniona odpowiedź API
    // wstawiłaby obcy adres do `<img src>` i do treści wiadomości.
    const page = parseKlipyResponse({
      data: {
        data: [
          {
            type: 'gif',
            slug: 'obcy-host-z-gifem',
            file: {
              sm: { gif: { url: 'https://obcy.example/pixel.gif' } },
              md: { gif: { url: 'https://obcy.example/pixel.gif' } },
            },
          },
          {
            type: 'gif',
            slug: 'mieszany',
            file: {
              // Podgląd legalny, wysyłka podmieniona — pozycja musi wypaść
              // W CAŁOŚCI, bo to `sendUrl` ląduje w bazie. (Bez pola `size`
              // `sm` nie jest kandydatem wysyłki, więc nie ma na co zejść.)
              sm: { gif: { url: 'https://static.klipy.com/ok/sm.gif' } },
              md: { gif: { url: 'https://obcy.example/pixel.gif' } },
            },
          },
        ],
      },
    });
    expect(page.gifs).toEqual([]);
  });

  it('odrzuca adresy spoza dozwolonych hostów i spoza http(s)', () => {
    const page = parseKlipyResponse({
      data: {
        data: [
          {
            type: 'gif',
            slug: 'zly-host',
            file: {
              sm: { gif: { url: 'https://zlosliwy.example/x.png' } },
              md: { gif: { url: 'https://zlosliwy.example/y.png' } },
            },
          },
          {
            type: 'gif',
            slug: 'zly-schemat',
            file: {
              sm: { gif: { url: 'javascript:alert(1)' } },
              md: { gif: { url: 'javascript:alert(1)' } },
            },
          },
        ],
      },
    });
    expect(page.gifs).toEqual([]);
  });

  it('wpuszcza blur_preview wyłącznie jako wąski data:image/jpeg;base64', () => {
    const page = parseKlipyResponse({
      data: {
        data: [
          ...[
            'url(#x)");background:url(https://zly.example/a.png',
            'data:image/png;base64,QUJDRA==',
            'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
          ].map((blur_preview, index) => ({
            type: 'gif',
            slug: `zly-blur-${index}`,
            blur_preview,
            file: {
              sm: { gif: { url: 'https://static.klipy.co/a/sm.gif' } },
              md: { gif: { url: 'https://static.klipy.co/a/md.gif' } },
            },
          })),
        ],
      },
    });
    expect(page.gifs).toHaveLength(3);
    expect(page.gifs.every((gif) => gif.blurPreview === undefined)).toBe(true);
  });

  it('brak has_next znaczy koniec listy', () => {
    expect(parseKlipyResponse({ data: { data: [] } }).hasNext).toBe(false);
  });

  it('śmieciowe wejście daje pustą stronę zamiast wyjątku', () => {
    for (const garbage of [null, undefined, 'tekst', 42, [], {}, { data: 'nie obiekt' }]) {
      expect(parseKlipyResponse(garbage)).toEqual({ gifs: [], hasNext: false });
    }
    expect(parseKlipyResponse({ data: { data: [null, 7, {}, { type: 'gif' }] } })).toEqual({
      gifs: [],
      hasNext: false,
    });
  });
});

describe('buildKlipyShareRequest', () => {
  it('składa POST ze slugiem w ścieżce i identyfikatorem w ciele', () => {
    expect(
      buildKlipyShareRequest({ apiKey: KEY, slug: 'kot-abc', customerId: CUSTOMER, query: 'kot' }),
    ).toEqual({
      url: `${KLIPY_BASE}/${KEY}/gifs/share/kot-abc`,
      body: { customer_id: CUSTOMER, q: 'kot' },
    });
  });

  it('lista startowa nie niesie frazy', () => {
    const request = buildKlipyShareRequest({
      apiKey: KEY,
      slug: 'kot-abc',
      customerId: CUSTOMER,
      query: '   ',
    });
    expect(request?.body).toEqual({ customer_id: CUSTOMER });
    expect(request?.body).not.toHaveProperty('q');
  });

  it('brak klucza, sluga albo identyfikatora daje null', () => {
    const base = { apiKey: KEY, slug: 'kot-abc', customerId: CUSTOMER, query: '' };
    expect(buildKlipyShareRequest({ ...base, apiKey: '  ' })).toBeNull();
    expect(buildKlipyShareRequest({ ...base, slug: '' })).toBeNull();
    expect(buildKlipyShareRequest({ ...base, customerId: '' })).toBeNull();
  });
});

describe('klipyApiKey', () => {
  it('przycina wartość, a brak zmiennej daje pusty napis', () => {
    expect(klipyApiKey({ VITE_KLIPY_API_KEY: '  abc  ' })).toBe('abc');
    expect(klipyApiKey({})).toBe('');
    expect(klipyApiKey({ VITE_KLIPY_API_KEY: '' })).toBe('');
    expect(klipyApiKey({ VITE_KLIPY_API_KEY: 123 })).toBe('');
  });
});
