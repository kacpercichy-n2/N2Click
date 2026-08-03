// Pamięć folderów Dysku (marka + miesiąc -> folder): klucz, mapa lokalna,
// fallback localStorage w trybie lokalnym i CICHA degradacja chmury (brak
// tabeli / błąd przejściowy). Granica bazy jest wstrzykiwana, więc test nie
// dotyka SDK ani sieci.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSupabaseDriveFolderDb,
  driveFolderKey,
  DRIVE_FOLDERS_STORAGE_KEY,
  isMissingDriveFolderTable,
  loadDriveFolder,
  parseDriveFolderMap,
  rememberDriveFolder,
  withDriveFolder,
  type DriveFolderDb,
} from './driveFolders';

// ---- Zastępczy localStorage (środowisko testów to node) ---------------------

function installLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial));
  const stub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  (globalThis as { localStorage?: Storage }).localStorage = stub;
  return store;
}

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  vi.restoreAllMocks();
});

/** Granica bazy o zadanym zachowaniu (odczyt/zapis). */
function fakeDb(behaviour: Partial<DriveFolderDb>): DriveFolderDb {
  return {
    read: behaviour.read ?? (async () => ({ folderId: null, error: null })),
    write: behaviour.write ?? (async () => ({ error: null })),
  };
}

describe('driveFolderKey', () => {
  it('składa klucz z marki i miesiąca', () => {
    expect(driveFolderKey('tetra-wave', '2026-08')).toBe('tetra-wave:2026-08');
  });

  it('pusta marka albo zły miesiąc nie dają klucza', () => {
    expect(driveFolderKey('  ', '2026-08')).toBeNull();
    expect(driveFolderKey('marka', '2026-13')).toBeNull();
    expect(driveFolderKey('marka', '2026-08-01')).toBeNull();
    expect(driveFolderKey('marka', '')).toBeNull();
  });
});

describe('mapa lokalna (czysta)', () => {
  it('czyta wyłącznie wpisy string -> niepusty string', () => {
    expect(
      parseDriveFolderMap('{"a:2026-08":"folder-1","b:2026-08":42,"c:2026-08":"  "}'),
    ).toEqual({ 'a:2026-08': 'folder-1' });
  });

  it('brak zapisu, uszkodzony JSON i tablica dają pustą mapę', () => {
    expect(parseDriveFolderMap(null)).toEqual({});
    expect(parseDriveFolderMap('{nie-json')).toEqual({});
    expect(parseDriveFolderMap('["folder"]')).toEqual({});
  });

  it('dopisanie folderu nie rusza wejścia', () => {
    const map = { 'a:2026-08': 'folder-1' };
    expect(withDriveFolder(map, 'b:2026-08', 'folder-2')).toEqual({
      'a:2026-08': 'folder-1',
      'b:2026-08': 'folder-2',
    });
    expect(map).toEqual({ 'a:2026-08': 'folder-1' });
  });
});

describe('tryb lokalny (bez chmury)', () => {
  it('zapamiętany folder wraca z localStorage', async () => {
    installLocalStorage();
    await expect(rememberDriveFolder('marka', '2026-08', 'folder-1', null)).resolves.toBe(false);
    await expect(loadDriveFolder('marka', '2026-08', null)).resolves.toBe('folder-1');
  });

  it('zapis siedzi pod własnym kluczem modułu', async () => {
    const store = installLocalStorage();
    await rememberDriveFolder('marka', '2026-08', 'folder-1', null);
    expect(JSON.parse(store.get(DRIVE_FOLDERS_STORAGE_KEY) ?? '{}')).toEqual({
      'marka:2026-08': 'folder-1',
    });
  });

  it('brak wpisu i niepoprawne wejście dają null zamiast błędu', async () => {
    installLocalStorage();
    await expect(loadDriveFolder('marka', '2026-08', null)).resolves.toBeNull();
    await expect(loadDriveFolder('', '2026-08', null)).resolves.toBeNull();
    await expect(rememberDriveFolder('marka', '2026-08', '   ', null)).resolves.toBe(false);
  });

  it('bez localStorage (SSR/prywatne okno) nic nie rzuca', async () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    await expect(rememberDriveFolder('marka', '2026-08', 'folder-1', null)).resolves.toBe(false);
    await expect(loadDriveFolder('marka', '2026-08', null)).resolves.toBeNull();
  });
});

describe('tryb chmurowy', () => {
  it('folder z chmury wygrywa z pamięcią lokalną', async () => {
    installLocalStorage();
    await rememberDriveFolder('marka', '2026-08', 'lokalny', null);
    const db = fakeDb({ read: async () => ({ folderId: 'chmurowy', error: null }) });
    await expect(loadDriveFolder('marka', '2026-08', db)).resolves.toBe('chmurowy');
  });

  it('zapamiętanie idzie do chmury I do pamięci lokalnej', async () => {
    installLocalStorage();
    const write = vi.fn(async () => ({ error: null }));
    await expect(
      rememberDriveFolder('marka', '2026-08', 'folder-1', fakeDb({ write })),
    ).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith('marka', '2026-08', 'folder-1');
    await expect(loadDriveFolder('marka', '2026-08', null)).resolves.toBe('folder-1');
  });

  it('BRAK TABELY (PGRST205) degraduje się cicho do pamięci lokalnej', async () => {
    installLocalStorage();
    await rememberDriveFolder('marka', '2026-08', 'lokalny', null);
    const db = fakeDb({
      read: async () => ({
        folderId: null,
        error: "Could not find the table 'contentplan.drive_folders' in the schema cache (PGRST205)",
      }),
      write: async () => ({ error: 'PGRST205: schema cache' }),
    });
    await expect(loadDriveFolder('marka', '2026-08', db)).resolves.toBe('lokalny');
    await expect(rememberDriveFolder('marka', '2026-08', 'folder-2', db)).resolves.toBe(false);
    await expect(loadDriveFolder('marka', '2026-08', null)).resolves.toBe('folder-2');
  });

  it('błąd przejściowy i wyjątek adaptera też nie wywracają edytora', async () => {
    installLocalStorage();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const db = fakeDb({
      read: async () => ({ folderId: null, error: 'TypeError: Failed to fetch' }),
      write: async () => ({ error: 'TypeError: Failed to fetch' }),
    });
    await expect(loadDriveFolder('marka', '2026-08', db)).resolves.toBeNull();
    await expect(rememberDriveFolder('marka', '2026-08', 'folder-1', db)).resolves.toBe(false);
    // Zapis lokalny i tak przeszedł: pamięć folderu jest wygodą, nie transakcją.
    await expect(loadDriveFolder('marka', '2026-08', null)).resolves.toBe('folder-1');
  });

  it('rozpoznaje komunikaty braku tabeli/relacji', () => {
    expect(isMissingDriveFolderTable('PGRST205')).toBe(true);
    expect(isMissingDriveFolderTable('relation "drive_folders" does not exist')).toBe(true);
    expect(isMissingDriveFolderTable('42P01')).toBe(true);
    expect(isMissingDriveFolderTable('TypeError: Failed to fetch')).toBe(false);
  });
});

describe('createSupabaseDriveFolderDb', () => {
  it('czyta wiersz przez schemat contentplan i parę (brand_id, month_key)', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { folder_id: 'folder-1' }, error: null }));
    const eqMonth = vi.fn(() => ({ maybeSingle }));
    const eqBrand = vi.fn(() => ({ eq: eqMonth }));
    const select = vi.fn(() => ({ eq: eqBrand }));
    const from = vi.fn(() => ({ select, upsert: vi.fn() }));
    const schema = vi.fn(() => ({ from }));

    const db = createSupabaseDriveFolderDb({ schema });
    await expect(db.read('marka', '2026-08')).resolves.toEqual({
      folderId: 'folder-1',
      error: null,
    });
    expect(schema).toHaveBeenCalledWith('contentplan');
    expect(from).toHaveBeenCalledWith('drive_folders');
    expect(select).toHaveBeenCalledWith('folder_id');
    expect(eqBrand).toHaveBeenCalledWith('brand_id', 'marka');
    expect(eqMonth).toHaveBeenCalledWith('month_key', '2026-08');
  });

  it('zapisuje upsertem po kluczu głównym pary', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ select: vi.fn(), upsert }));
    const schema = vi.fn(() => ({ from }));

    const db = createSupabaseDriveFolderDb({ schema });
    await expect(db.write('marka', '2026-08', 'folder-1')).resolves.toEqual({ error: null });
    expect(upsert).toHaveBeenCalledWith(
      { brand_id: 'marka', month_key: '2026-08', folder_id: 'folder-1' },
      { onConflict: 'brand_id,month_key' },
    );
  });

  it('wyjątek SDK wraca jako komunikat, nigdy jako rzut', async () => {
    const schema = vi.fn(() => {
      throw new Error('brak sesji');
    });
    const db = createSupabaseDriveFolderDb({ schema });
    await expect(db.read('marka', '2026-08')).resolves.toEqual({
      folderId: null,
      error: 'brak sesji',
    });
    await expect(db.write('marka', '2026-08', 'f')).resolves.toEqual({ error: 'brak sesji' });
  });
});
