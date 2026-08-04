// Pamięć folderów Dysku Google modułu Content Plan: para (marka, miesiąc) →
// `folderId`, żeby kolejny wybór mediów startował od razu w tym samym miejscu.
//
// GRANICE
// - To WYGODA, nie dane krytyczne: KAŻDY błąd (brak tabeli, sieć, brak
//   localStorage) degraduje się cicho. Picker otwiera się wtedy w korzeniu
//   Dysku, a edytor nigdy nie pokazuje z tego powodu błędu.
// - Tryb chmurowy używa GŁÓWNEGO klienta (`src/supabase/client.ts`) przez
//   `.schema('contentplan')` — ŻADNEGO drugiego `createClient`; klient zostaje
//   przypięty do `n2click`.
// - Tryb lokalny (puste `VITE_SUPABASE_*`) trzyma mapę w localStorage pod
//   własnym kluczem (odpowiednik `n2planner.driveParents` z aplikacji
//   źródłowej). Zapis lokalny idzie ZAWSZE, także w trybie chmurowym — to
//   podręczny cache, gdy chmura milczy.
// - Granica bazy jest WSTRZYKIWANA (wzorzec `plannerData.ts`), więc degradacja
//   testuje się w node bez sieci i bez SDK.
import { isSupabaseConfigured } from '../supabase/config';
import { isMonthKey } from './domain';

/** Klucz localStorage z mapą „brandId:YYYY-MM" → folderId. */
export const DRIVE_FOLDERS_STORAGE_KEY = 'n2click.contentplan.driveFolders';

/** Tabela pamięci folderów w schemacie `contentplan`. */
const TABLE = 'drive_folders';
const SCHEMA = 'contentplan';

// Te same komunikaty co w `plannerData.ts`: brak tabeli/relacji (migracja
// niezaaplikowana) NIE jest błędem aplikacji — po prostu nie ma czego czytać.
const MISSING_TABLE_RE = /does not exist|PGRST205|could not find the table|schema cache|42P01/i;

/** Czy komunikat błędu oznacza brak tabeli/schematu (trwała, cicha degradacja). */
export function isMissingDriveFolderTable(message: string): boolean {
  return MISSING_TABLE_RE.test(message);
}

/** Ślad po błędzie chmury WYŁĄCZNIE w trybie deweloperskim i wyłącznie dla
 *  błędów innych niż brak tabeli. Produkcja nie pokazuje z tego powodu nic:
 *  pamięć folderu ma prawo nie zadziałać. */
function noteCloudFailure(operation: string, message: string): void {
  if (isMissingDriveFolderTable(message)) return;
  const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  if (dev) console.debug(`[contentplan] Pamięć folderów Dysku (${operation}):`, message);
}

// ---- Klucz pamięci (czysty) ------------------------------------------------

/** Klucz pary (marka, miesiąc). `null` gdy którakolwiek część jest niepoprawna
 *  — niepoprawny klucz nigdy nie trafia ani do mapy, ani do zapytania. */
export function driveFolderKey(brandId: string, monthKey: string): string | null {
  const brand = brandId.trim();
  if (brand === '' || !isMonthKey(monthKey)) return null;
  return `${brand}:${monthKey}`;
}

// ---- Mapa lokalna (czysta) -------------------------------------------------

/** Parsowanie zapisanej mapy. Wszystko, co nie jest obiektem „string → string",
 *  wraca jako pusta mapa (uszkodzony wpis nie wywraca edytora). */
export function parseDriveFolderMap(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** Mapa z dopisanym folderem (czysta — nowy obiekt, wejście nietknięte). */
export function withDriveFolder(
  map: Readonly<Record<string, string>>,
  key: string,
  folderId: string,
): Record<string, string> {
  return { ...map, [key]: folderId };
}

function localStore(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage;
}

function readLocalMap(): Record<string, string> {
  const store = localStore();
  if (store === undefined) return {};
  try {
    return parseDriveFolderMap(store.getItem(DRIVE_FOLDERS_STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeLocalFolder(key: string, folderId: string): void {
  const store = localStore();
  if (store === undefined) return;
  try {
    store.setItem(
      DRIVE_FOLDERS_STORAGE_KEY,
      JSON.stringify(withDriveFolder(readLocalMap(), key, folderId)),
    );
  } catch {
    // Prywatne okno / pełny magazyn: pamięć folderu jest tylko wygodą.
  }
}

// ---- Granica bazy (wstrzykiwana) -------------------------------------------

export interface DriveFolderDb {
  /** `folderId` pary albo `null`, gdy pary nie ma. Błąd wraca jako komunikat. */
  read(brandId: string, monthKey: string): Promise<{ folderId: string | null; error: string | null }>;
  /** UPSERT pary (klucz główny `(brand_id, month_key)`). */
  write(brandId: string, monthKey: string, folderId: string): Promise<{ error: string | null }>;
}

interface MinimalPostgrest {
  schema(name: string): {
    from(table: string): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: string,
          ): {
            maybeSingle(): Promise<{
              data: { folder_id?: unknown } | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
      upsert(
        row: Record<string, unknown>,
        options: { onConflict: string },
      ): Promise<{ error: { message?: string } | null }>;
    };
  };
}

/** Adapter nad GŁÓWNYM klientem Supabase przepiętym na schemat `contentplan`. */
export function createSupabaseDriveFolderDb(client: unknown): DriveFolderDb {
  const postgrest = client as MinimalPostgrest;
  return {
    async read(brandId, monthKey) {
      try {
        const { data, error } = await postgrest
          .schema(SCHEMA)
          .from(TABLE)
          .select('folder_id')
          .eq('brand_id', brandId)
          .eq('month_key', monthKey)
          .maybeSingle();
        if (error) return { folderId: null, error: error.message ?? 'Błąd odczytu folderu.' };
        const folderId = typeof data?.folder_id === 'string' ? data.folder_id.trim() : '';
        return { folderId: folderId === '' ? null : folderId, error: null };
      } catch (e) {
        return { folderId: null, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async write(brandId, monthKey, folderId) {
      try {
        const { error } = await postgrest
          .schema(SCHEMA)
          .from(TABLE)
          .upsert(
            { brand_id: brandId, month_key: monthKey, folder_id: folderId },
            { onConflict: 'brand_id,month_key' },
          );
        return { error: error ? (error.message ?? 'Błąd zapisu folderu.') : null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

/** Granica bazy dla bieżącego trybu (`null` = tryb lokalny albo klient
 *  niedostępny). Import klienta jest LENIWY, żeby tryb lokalny nie wciągał SDK. */
async function resolveDb(): Promise<DriveFolderDb | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { getSupabaseClient } = await import('../supabase/client');
    return createSupabaseDriveFolderDb(getSupabaseClient());
  } catch {
    return null;
  }
}

// ---- Publiczne API ---------------------------------------------------------

/**
 * Zapamiętany folder marki na dany miesiąc. Kolejność: chmura (gdy skonfigurowana
 * i odpowiada), potem localStorage. `null` = brak pamięci, Picker startuje od
 * korzenia Dysku. NIGDY nie rzuca.
 */
export async function loadDriveFolder(
  brandId: string,
  monthKey: string,
  db?: DriveFolderDb | null,
): Promise<string | null> {
  const key = driveFolderKey(brandId, monthKey);
  if (key === null) return null;
  const database = db === undefined ? await resolveDb() : db;
  if (database !== null) {
    const { folderId, error } = await database.read(brandId.trim(), monthKey);
    // Brak tabeli i każdy inny błąd => cicho w dół, do pamięci lokalnej.
    if (error !== null) noteCloudFailure('odczyt', error);
    else if (folderId !== null) return folderId;
  }
  return readLocalMap()[key] ?? null;
}

/**
 * Zapamiętanie folderu dla pary (marka, miesiąc). Zapis lokalny idzie zawsze,
 * chmurowy best-effort. Zwraca `true`, gdy zapisała się CHMURA (w trybie
 * lokalnym zawsze `false`) — wołający i tak nie musi tego czytać.
 */
export async function rememberDriveFolder(
  brandId: string,
  monthKey: string,
  folderId: string,
  db?: DriveFolderDb | null,
): Promise<boolean> {
  const key = driveFolderKey(brandId, monthKey);
  const value = folderId.trim();
  if (key === null || value === '') return false;
  writeLocalFolder(key, value);
  const database = db === undefined ? await resolveDb() : db;
  if (database === null) return false;
  const { error } = await database.write(brandId.trim(), monthKey, value);
  if (error !== null) noteCloudFailure('zapis', error);
  return error === null;
}
