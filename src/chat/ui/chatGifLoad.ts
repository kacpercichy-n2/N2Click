// Czysta logika ponownego wczytywania GIF-a w dymku (bez React, bez DOM).
//
// TŁO: 25.08.2026 odbiorca na telefonie zobaczył dymek z samym znakiem KLIPY.
// Adres w bazie był poprawny, a CDN odpowiadał 200 — obrazek po prostu nie
// dojechał (pojedynczy zerwany request; w teście z 27.08 jeden z czterech
// adresów padł za pierwszym razem i wszedł za drugim). Przeglądarka nie ponawia
// nieudanego `<img>` sama, a Chromium pamięta porażkę dla TEGO SAMEGO adresu w
// obrębie dokumentu, więc ponowienie musi zmienić adres.
//
// DECYZJE:
//   * Automatyczne próby są DWIE, z rosnącym odstępem; potem oddajemy ster
//     człowiekowi (przycisk „Wczytaj ponownie"), bo dalsze bicie w padnięty
//     link tylko marnuje transfer.
//   * Ponowienie doklejamy parametrem `retry`. CDN KLIPY (Cloudflare)
//     odpowiada na taki adres tym samym plikiem (sprawdzone 27.08.2026);
//     fragment `#` nie nadawałby się, bo nie zmienia klucza pamięci obrazów.
//   * Ręczna próba zaczyna od numeru wyższego niż automatyczne, żeby nigdy nie
//     trafić w zapamiętaną porażkę.

/** Odstępy przed kolejnymi AUTOMATYCZNYMI próbami (indeks = numer próby − 1). */
export const GIF_RETRY_DELAYS_MS: readonly number[] = [1500, 4000];

/** Ile prób leci samo, zanim pokażemy przycisk. */
export const GIF_AUTO_RETRIES = GIF_RETRY_DELAYS_MS.length;

/**
 * Adres dla danej próby. Próba 0 to oryginał (wiadomość ma dokładnie ten
 * adres, więc otwarcie w nowej karcie i podgląd na liście zostają nietknięte).
 */
export function gifRetrySrc(url: string, attempt: number): string {
  if (attempt <= 0) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('retry', String(attempt));
  return parsed.toString();
}

/** Odstęp przed automatyczną próbą o danym numerze; `null` = koniec automatu. */
export function gifRetryDelay(attempt: number): number | null {
  return attempt >= 1 && attempt <= GIF_AUTO_RETRIES ? GIF_RETRY_DELAYS_MS[attempt - 1] : null;
}
