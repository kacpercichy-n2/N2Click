import { describe, expect, it } from 'vitest';
import { GIF_AUTO_RETRIES, gifRetryDelay, gifRetrySrc } from './chatGifLoad';

const URL_ = 'https://static.klipy.com/ii/abc/4b/90/iLFEdIA4.gif';

describe('gifRetrySrc', () => {
  it('próba 0 zwraca oryginalny adres bez zmian', () => {
    expect(gifRetrySrc(URL_, 0)).toBe(URL_);
  });

  it('kolejne próby zmieniają adres parametrem retry, żeby ominąć zapamiętaną porażkę', () => {
    expect(gifRetrySrc(URL_, 1)).toBe(`${URL_}?retry=1`);
    expect(gifRetrySrc(URL_, 3)).toBe(`${URL_}?retry=3`);
    expect(gifRetrySrc(`${URL_}?x=1`, 2)).toBe(`${URL_}?x=1&retry=2`);
  });
});

describe('gifRetryDelay', () => {
  it('daje rosnące odstępy dla prób automatycznych i null po nich', () => {
    expect(GIF_AUTO_RETRIES).toBe(2);
    expect(gifRetryDelay(1)).toBe(1500);
    expect(gifRetryDelay(2)).toBe(4000);
    expect(gifRetryDelay(3)).toBeNull();
    expect(gifRetryDelay(0)).toBeNull();
  });
});
