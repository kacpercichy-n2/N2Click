// Obrazek GIF w dymku z zastępnikiem, automatycznym ponowieniem i ręcznym
// „Wczytaj ponownie". Czysta logika prób siedzi w `chatGifLoad.ts`.
//
// DLACZEGO: `<img>` bez zarezerwowanych wymiarów i bez `onError` znika do
// zera pikseli, gdy plik nie dojedzie (Safari nie pokazuje nawet ikony
// zepsutego obrazka). Zostawał sam znak KLIPY pod spodem — tak wyglądał dymek
// u odbiorcy 25.08.2026. Wymiarów nie znamy (wiadomość niesie sam adres), więc
// zastępnik rezerwuje stałą wysokość, a po wczytaniu obraz sam ją nadpisuje.
import { useEffect, useRef, useState } from 'react';
import { GIF_AUTO_RETRIES, gifRetryDelay, gifRetrySrc } from './chatGifLoad';

type LoadState = 'loading' | 'loaded' | 'failed';

export function ChatGifImage({ url }: { url: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>('loading');
  const timerRef = useRef<number | null>(null);

  // Nowy adres (inna wiadomość w tym samym miejscu listy) zeruje próby.
  useEffect(() => {
    setAttempt(0);
    setState('loading');
  }, [url]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const retry = (next: number): void => {
    timerRef.current = null;
    setAttempt(next);
    setState('loading');
  };

  const onError = (): void => {
    const next = attempt + 1;
    const delay = gifRetryDelay(next);
    if (delay === null) {
      setState('failed');
      return;
    }
    // Automat: odczekaj i spróbuj pod zmienionym adresem.
    timerRef.current = window.setTimeout(() => retry(next), delay);
  };

  if (state === 'failed') {
    return (
      <span className="n2chat-gif-fallback" role="status">
        <span>GIF nie wczytał się.</span>
        <button
          type="button"
          className="n2chat-gif-fallback-btn"
          // Ręczna próba ZAWSZE pod świeżym numerem, ponad próbami automatu.
          onClick={() => retry(Math.max(attempt, GIF_AUTO_RETRIES) + 1)}
        >
          Wczytaj ponownie
        </button>
        <a
          className="n2chat-gif-fallback-btn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Otwórz w nowej karcie
        </a>
      </span>
    );
  }

  return (
    <a
      className={`n2chat-gif-link${state === 'loading' ? ' is-loading' : ''}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        key={attempt}
        className="n2chat-gif"
        src={gifRetrySrc(url, attempt)}
        loading="lazy"
        alt="GIF"
        onLoad={() => setState('loaded')}
        onError={onError}
      />
    </a>
  );
}
