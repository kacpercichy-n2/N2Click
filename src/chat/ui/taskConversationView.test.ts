import { describe, expect, it } from 'vitest';
import { buildDirectory } from './chatPeople';
import { followersSummary, isCloudTaskId, visibleFollowers } from './taskConversationView';

describe('nagłówek panelu rozmowy zadania', () => {
  it('rozpoznaje zadanie zapisane w chmurze po uuid', () => {
    expect(isCloudTaskId('3f2b7c1e-8a4d-4e2f-9b1a-0c6d5e4f3a21')).toBe(true);
    expect(isCloudTaskId('task-17')).toBe(false);
    expect(isCloudTaskId('')).toBe(false);
  });

  it('pokazuje pierwsze awatary i resztę jako licznik', () => {
    expect(visibleFollowers(['a', 'b'], 4)).toEqual({ ids: ['a', 'b'], rest: 0 });
    expect(visibleFollowers(['a', 'b', 'c', 'd', 'e', 'f'], 4)).toEqual({ ids: ['a', 'b', 'c', 'd'], rest: 2 });
  });

  it('nazywa obserwujących po polsku', () => {
    const directory = buildDirectory([{ id: 'a', firstName: 'Ola', lastName: 'Nowak', email: '' }]);
    expect(followersSummary(directory, ['a', 'x'])).toBe('Obserwują: Ola Nowak, Nieznana osoba');
    expect(followersSummary(directory, [])).toBe('Nikt nie obserwuje rozmowy');
  });
});
