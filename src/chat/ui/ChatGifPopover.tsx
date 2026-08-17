// Picker GIF-ów (KLIPY API v1, decyzja D5b). Budowanie adresów i mapowanie
// odpowiedzi siedzą w czystym `chatGifs.ts`; tutaj zostaje sieć i render.
//
// DECYZJE:
//   * Ta sama powłoka co picker emoji: dziecko `.n2chat-composer`, `useOverlay`
//     bez pozycjonowania, Escape / klik poza zamykają i oddają fokus.
//   * Błąd sieci NIE idzie do `chat.error` (to kanał rdzenia czatu — pokazuje
//     się nad kompozytorem i utknąłby po zamknięciu pickera). Komunikat żyje w
//     panelu i znika przy kolejnym zapytaniu.
//   * Każde zapytanie ma własny `AbortController`: pisanie w polu wyszukiwania
//     unieważnia poprzednie, więc wolniejsza odpowiedź nie nadpisze świeższej.
//   * Wybrany kafelek wysyła adres `md` JAKO TREŚĆ wiadomości — schemat bazy i
//     `sendMessage` zostają nietknięte.
//   * Po UDANEJ wysyłce leci zgłoszenie udostępnienia (`gifs/share/{slug}`).
//     Strzał jest „wyślij i zapomnij": bez `signal` (panel zamyka się tuż po
//     wysyłce i kontroler listy zdążyłby go przerwać), z `keepalive`, bez
//     własnego stanu i bez komunikatu — GIF poszedł do rozmowy niezależnie od
//     tego, czy statystyka doleciała.
//   * ZNAKI GRAFICZNE to OFICJALNE zasoby KLIPY z ich publicznego folderu
//     atrybucji (linkowanego z docs.klipy.com/attribution), położone jako pliki
//     statyczne w `public/klipy/`. Nie przerysowujemy ich ani nie eksportujemy
//     ponownie — to cudzy znak towarowy, ma jechać dokładnie taki, jaki wydał
//     właściciel. Vite serwuje `public/` spod korzenia, więc adres to `/klipy/…`.
//   * DWA ŁAŃCUCHY ANGIELSKIE w polskim interfejsie są wymogiem KLIPY: dokładna
//     treść zastępcza pola wyszukiwania („Search KLIPY", oznaczona w
//     dokumentacji jako REQUIRED) i formuła atrybucji („Powered by KLIPY" z
//     „API Terms of Use"). Etykieta dla czytnika ekranu zostaje polska.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { Search } from '../../components/icons';
import { useOverlay } from '../../components/useOverlay';
import {
  buildKlipySearchUrl,
  buildKlipyShareRequest,
  parseKlipyResponse,
  type KlipyGif,
} from './chatGifs';

/** Pauza w pisaniu, po której leci zapytanie do KLIPY. */
const SEARCH_DEBOUNCE_MS = 300;

/** Jedyny komunikat błędu pickera — świadomie bez szczegółów sieci. */
const LOAD_ERROR = 'Nie udało się wczytać GIF-ów.';

/** Wymagana przez KLIPY treść zastępcza pola wyszukiwania (dosłownie). */
const KLIPY_PLACEHOLDER = 'Search KLIPY';

/** Wymagana przez regulamin KLIPY formuła atrybucji (dosłownie). */
const KLIPY_ATTRIBUTION = 'Powered by KLIPY';

export function ChatGifPopover({
  apiKey,
  customerId,
  triggerRef,
  onClose,
  onSend,
}: {
  apiKey: string;
  /**
   * Stabilny, nieprzezroczysty identyfikator użytkownika — u nas chmurowe
   * `selfId`. KLIPY wymaga TEJ SAMEJ wartości w zapytaniu o listę i w
   * zgłoszeniu udostępnienia; '' znaczy „nie znamy", wtedy nie wysyłamy go
   * wcale (patrz `chatGifs.ts`).
   */
  customerId: string;
  triggerRef: RefObject<HTMLElement>;
  onClose: () => void;
  /** Wysłanie adresu jako wiadomości; `true` = poszło (panel się zamyka). */
  onSend: (url: string) => Promise<boolean>;
}) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<readonly KlipyGif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(false);

  useOverlay({ open: true, onClose, overlayRef: panelRef, triggerRef });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Lista startowa leci od razu (`trending`), każda zmiana frazy po pauzie.
  useEffect(() => {
    const controller = new AbortController();
    const run = async (): Promise<void> => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(buildKlipySearchUrl({ apiKey, query, customerId }), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`klipy ${response.status}`);
        const page = parseKlipyResponse(await response.json());
        if (controller.signal.aborted) return;
        setGifs(page.gifs);
        setLoading(false);
      } catch {
        if (controller.signal.aborted) return;
        setGifs([]);
        setError(LOAD_ERROR);
        setLoading(false);
      }
    };
    const timer = window.setTimeout(() => void run(), query.trim() === '' ? 0 : SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [apiKey, customerId, query]);

  /** Zgłoszenie udostępnienia; `null` z buildera znaczy „nie ma czego zgłaszać". */
  const registerShare = (gif: KlipyGif): void => {
    const request = buildKlipyShareRequest({ apiKey, slug: gif.id, customerId, query });
    if (request === null) return;
    void fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      keepalive: true,
    }).catch(() => {});
  };

  // Nieudana WYSYŁKA to już sprawa rdzenia czatu — `chat.error` pokazuje się
  // pod panelem, w kompozytorze. Panel zostaje otwarty z odblokowanymi
  // kafelkami, żeby dało się spróbować ponownie bez szukania przycisku.
  const pick = async (gif: KlipyGif): Promise<void> => {
    if (sending) return;
    setSending(true);
    const ok = await onSend(gif.sendUrl);
    if (ok) registerShare(gif);
    if (mountedRef.current) setSending(false);
  };

  return (
    <m.div
      ref={panelRef}
      className="n2chat-inpop"
      role="dialog"
      aria-label="GIF-y"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="n2chat-inpop-head">
        <Search size={14} aria-hidden className="n2chat-search-icon" />
        <input
          className="n2chat-search-input"
          type="search"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={KLIPY_PLACEHOLDER}
          aria-label="Szukaj GIF-ów"
        />
      </div>

      <div className="n2chat-inpop-body">
        {loading ? (
          <div className="n2chat-skeleton" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        ) : error !== '' ? (
          <p className="n2chat-error" role="status">
            {error}
          </p>
        ) : gifs.length === 0 ? (
          <p className="n2chat-empty">Brak GIF-ów dla tego hasła.</p>
        ) : (
          <div className="n2chat-gif-grid">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                className="n2chat-gif-tile"
                disabled={sending}
                onClick={() => void pick(gif)}
                // Rozmyty zastępnik KLIPY (gotowy `data:`) trzyma kafelek
                // wypełniony, zanim doleci właściwy GIF. Parser wpuszcza tu
                // wyłącznie base64-owy data URI obrazu.
                style={
                  gif.blurPreview === undefined
                    ? undefined
                    : { backgroundImage: `url(${gif.blurPreview})` }
                }
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  width={gif.previewWidth > 0 ? gif.previewWidth : undefined}
                  height={gif.previewHeight > 0 ? gif.previewHeight : undefined}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Atrybucja wymagana przez „API Terms of Use" KLIPY: znak słowny ORAZ
          logo. Nazwę dostępną niesie w całości `alt`, więc obok nie stoi już
          drugi raz ten sam tekst — czytnik ekranu przeczytałby go podwójnie.
          `width`/`height` odpowiadają proporcji zasobu (viewBox 640×107,3),
          żeby wiersz nie przeskoczył po dociągnięciu pliku. */}
      <p className="n2chat-inpop-foot">
        <img
          className="n2chat-klipy-mark"
          src="/klipy/powered-by-klipy.svg"
          alt={KLIPY_ATTRIBUTION}
          width={119}
          height={20}
        />
      </p>
    </m.div>
  );
}
