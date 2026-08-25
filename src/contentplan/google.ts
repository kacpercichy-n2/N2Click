// Integracja z Dyskiem Google dla modułu Content Plan: logowanie (GIS token
// flow), Picker zakotwiczony w folderze marki, udostępnianie „anyone with link"
// dla podglądów miniatur oraz czyste budowanie adresów pliku. Port
// `planner/src/lib/google.js` do TS bez zmian architektury.
//
// GRANICE
// - Pliki NIGDY nie przechodzą przez naszą infrastrukturę: w stanie zostaje
//   wyłącznie `fileId` i metadane ({@link ContentPlanMedia}). Zero uploadu,
//   zero base64, zero Sheets API, zero refresh tokenów.
// - Skrypty Google (`gsi/client`, `apis.google.com/js/api.js`) ładują się
//   LENIWIE, dopiero przy pierwszym użyciu. Moduł importuje wyłącznie edytor
//   publikacji, który siedzi w chunku trasy `/content-plan` (patrz
//   `src/pages/routeChunks.ts`) — poza tą stroną nic się nie pobiera.
// - Konfiguracja jest MIĘKKA: sam import modułu nigdy nie rzuca, a brak
//   `VITE_GOOGLE_*` daje polski powód blokady dla `DisabledHint`
//   ({@link googleDriveDisabledReason}) zamiast wywrócenia edytora.
// - Czysta logika (cache tokenu, adresy, mapowanie wyboru Pickera) jest
//   wydzielona i testowana w node — DOM/`window` są potrzebne wyłącznie w
//   funkcjach otwierających Picker.
import type { ContentPlanMedia } from '../types';

// ---- Konfiguracja ----------------------------------------------------------

/** Zakres OAuth: aplikacja widzi WYŁĄCZNIE pliki wskazane przez Pickera. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const CLIENT_ID_VAR = 'VITE_GOOGLE_CLIENT_ID';
const API_KEY_VAR = 'VITE_GOOGLE_API_KEY';

/** Polski powód blokady przycisków Pickera przy braku konfiguracji. */
export const GOOGLE_DRIVE_MISSING_CONFIG_REASON =
  'Brak konfiguracji Google Drive: uzupełnij VITE_GOOGLE_CLIENT_ID i VITE_GOOGLE_API_KEY w .env.local';

export interface GoogleDriveConfig {
  clientId: string;
  apiKey: string;
  /** Numer projektu Google Cloud (prefiks `client_id` przed pierwszym „-") —
   *  Picker wymaga go przy zakresie `drive.file`, żeby wybrany plik dostał
   *  dostęp dla TEJ aplikacji. */
  appId: string;
}

function readVar(env: Record<string, string | undefined>, name: string): string {
  const raw = env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** CZYSTE odczytanie konfiguracji ze wstrzykniętego rekordu zmiennych.
 *  `null` = brak którejkolwiek zmiennej (moduł działa, picker jest wyłączony). */
export function resolveGoogleDriveConfig(
  env: Record<string, string | undefined>,
): GoogleDriveConfig | null {
  const clientId = readVar(env, CLIENT_ID_VAR);
  const apiKey = readVar(env, API_KEY_VAR);
  if (clientId === '' || apiKey === '') return null;
  return { clientId, apiKey, appId: clientId.split('-')[0] ?? '' };
}

/** Zmienne środowiskowe w miejscu użycia (wzorzec `src/supabase/config.ts`):
 *  w przeglądarce istnieje wyłącznie `import.meta.env`; nakładka `process.env`
 *  (node/testy) MUSI wygrywać scalanie, bo `vi.stubEnv` zmienia `process.env`,
 *  a NIE sięga do statycznego `import.meta.env` modułu (Vitest 4) — przy
 *  odwrotnej kolejności testów nie dało się odciąć od lokalnego `.env.local`.
 *  Odczyt jest LENIWY — import modułu nigdy nie rzuca. */
function readGoogleEnv(): Record<string, string | undefined> {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return { ...metaEnv, ...processEnv };
}

/** Czy Picker ma komplet konfiguracji. Nigdy nie rzuca. */
export function isGoogleDriveConfigured(): boolean {
  return resolveGoogleDriveConfig(readGoogleEnv()) !== null;
}

/** Powód blokady kontrolek Pickera (`null` = kontrolki są sprawne). */
export function googleDriveDisabledReason(): string | null {
  return isGoogleDriveConfigured() ? null : GOOGLE_DRIVE_MISSING_CONFIG_REASON;
}

function requireConfig(): GoogleDriveConfig {
  const config = resolveGoogleDriveConfig(readGoogleEnv());
  if (config === null) throw new Error(GOOGLE_DRIVE_MISSING_CONFIG_REASON);
  return config;
}

// ---- Adresy pliku (czyste) -------------------------------------------------

/** Miniatura pliku Dysku o zadanej szerokości (domyślnie 640 px). */
export function driveThumbUrl(fileId: string, width = 640): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
}

/** Widok pliku na Dysku (otwarcie w nowej karcie). */
export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** Osadzalny podgląd pliku (iframe). */
export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

// ---- Wybór z Pickera -> media kanału (czyste) ------------------------------

/** Dokument zwracany przez Pickera. Kształt zewnętrznego API, więc mapowanie
 *  waliduje każde pole w czasie wykonania. */
export interface PickerDocument {
  readonly id?: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly parentId?: string;
  readonly width?: number;
  readonly height?: number;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

/** Media kanału z JEDNEGO dokumentu Pickera. `null` gdy dokumentu nie da się
 *  podpiąć (brak id albo wybrany folder). Typ bierze się z `mimeType`:
 *  `video/*` => wideo, wszystko inne => obraz (parytet z aplikacją źródłową). */
export function mediaFromPickerDocument(document: PickerDocument | null | undefined): ContentPlanMedia | null {
  if (document === null || document === undefined) return null;
  const fileId = text(document.id);
  if (fileId === '') return null;
  const mimeType = text(document.mimeType);
  if (mimeType === FOLDER_MIME) return null;
  const width = positiveInt(document.width);
  const height = positiveInt(document.height);
  return {
    source: 'gdrive',
    fileId,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    type: mimeType.startsWith('video/') ? 'video' : 'image',
  };
}

/** Media kanału z WYBORU Pickera. Anulowanie (`null`) i pusty wybór dają
 *  `null`; przy multi-select liczy się PIERWSZY dokument — model domenowy
 *  niesie jedno medium na kanał. */
export function mediaFromPickerSelection(
  documents: readonly PickerDocument[] | null | undefined,
): ContentPlanMedia | null {
  if (!Array.isArray(documents) || documents.length === 0) return null;
  return mediaFromPickerDocument(documents[0]);
}

/** Folder rodzica pierwszego wybranego pliku (`null` gdy Picker go nie podał) —
 *  wejście do pamięci folderów marki. */
export function pickerParentId(
  documents: readonly PickerDocument[] | null | undefined,
): string | null {
  if (!Array.isArray(documents) || documents.length === 0) return null;
  const parentId = text(documents[0]?.parentId);
  return parentId === '' ? null : parentId;
}

// ---- Cache tokenu (czysty, z wstrzykiwanym zegarem) ------------------------

/** Margines odświeżenia: token wymieniamy 60 s PRZED wygaśnięciem. */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Domyślna ważność, gdy Google nie poda `expires_in` (jak w źródle: 1 h). */
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

export interface GoogleTokenGrant {
  accessToken: string;
  /** `expires_in` z odpowiedzi; brak/niepoprawna wartość => 3600 s. */
  expiresInSeconds?: number;
}

/**
 * Pamięć tokenu dostępu w PAMIĘCI procesu. Zwrócona funkcja oddaje ten sam
 * token, dopóki do wygaśnięcia zostało więcej niż {@link TOKEN_REFRESH_MARGIN_MS},
 * a równoległe wywołania dzielą JEDNO żądanie (dwa kliknięcia nie otwierają
 * dwóch okien logowania). Zegar jest wstrzykiwany, więc całość testuje się w node.
 */
export function createTokenCache(
  request: () => Promise<GoogleTokenGrant>,
  now: () => number = () => Date.now(),
): () => Promise<string> {
  let token = '';
  let expiresAt = 0;
  let pending: Promise<string> | null = null;

  return () => {
    if (token !== '' && now() < expiresAt - TOKEN_REFRESH_MARGIN_MS) return Promise.resolve(token);
    if (pending !== null) return pending;
    const inFlight = request().then(
      (grant) => {
        const ttl =
          typeof grant.expiresInSeconds === 'number' && grant.expiresInSeconds > 0
            ? grant.expiresInSeconds
            : DEFAULT_TOKEN_TTL_SECONDS;
        token = grant.accessToken;
        expiresAt = now() + ttl * 1000;
        pending = null;
        return token;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    pending = inFlight;
    return inFlight;
  };
}

// ---- Minimalne typy globali Google (bez @types) ----------------------------

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: string | number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(): void;
}

interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback: (error: { message?: string } | undefined) => void;
}

interface PickerView {
  setIncludeFolders(value: boolean): PickerView;
  setSelectFolderEnabled(value: boolean): PickerView;
  setParent(parentId: string): PickerView;
}

interface PickerCallbackData {
  action?: string;
  docs?: PickerDocument[];
}

interface PickerBuilder {
  setAppId(appId: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  addView(view: PickerView): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (data: PickerCallbackData) => void): PickerBuilder;
  enableFeature(feature: unknown): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface PickerApi {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId: unknown) => PickerView;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string; CANCEL: string };
}

interface GoogleGlobals {
  google?: {
    accounts?: {
      oauth2?: { initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient };
    };
    picker?: PickerApi;
  };
  gapi?: { load(name: string, callback: () => void): void };
  document?: Document;
  location?: Location;
}

function globals(): GoogleGlobals {
  return globalThis as unknown as GoogleGlobals;
}

// ---- Leniwe ładowanie skryptów Google --------------------------------------

/** Skrypt Google Identity Services — współdzielony z importem Kalendarza
 *  (`src/gcal/googleConnect.ts`), który używa tego samego klienta OAuth. */
export const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';

/** Jednorazowe wstrzyknięcie `<script>` z dedupem po `data-src` (jak w źródle).
 *  Drugie wywołanie dla tego samego adresu czeka na ten sam element. */
export function loadScript(src: string): Promise<void> {
  const doc = globals().document;
  if (doc === undefined) {
    return Promise.reject(new Error('Dysk Google jest dostępny tylko w przeglądarce.'));
  }
  return new Promise((resolve, reject) => {
    const existing = doc.querySelector<HTMLScriptElement>(`script[data-src="${src}"]`);
    if (existing !== null) {
      if (existing.dataset.loaded === '1') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Nie udało się wczytać ${src}`)));
      return;
    }
    const script = doc.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.src = src;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Nie udało się wczytać ${src}`));
    doc.head.appendChild(script);
  });
}

// ---- Token dostępu (GIS) ---------------------------------------------------

async function requestGoogleToken(): Promise<GoogleTokenGrant> {
  const config = requireConfig();
  await loadScript(GIS_SRC);
  const oauth2 = globals().google?.accounts?.oauth2;
  if (oauth2 === undefined) throw new Error('Nie udało się uruchomić logowania Google.');
  return new Promise<GoogleTokenGrant>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: config.clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: (response) => {
        if (response.error !== undefined) {
          reject(new Error(response.error_description ?? response.error));
          return;
        }
        if (typeof response.access_token !== 'string' || response.access_token === '') {
          reject(new Error('Google nie zwróciło tokenu dostępu.'));
          return;
        }
        const expiresIn = Number(response.expires_in);
        resolve({
          accessToken: response.access_token,
          ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresInSeconds: expiresIn } : {}),
        });
      },
      error_callback: (error) => {
        reject(new Error(error?.message ?? 'Logowanie Google przerwane.'));
      },
    });
    client.requestAccessToken();
  });
}

const accessTokenCache = createTokenCache(requestGoogleToken);

/** Token dostępu do Dysku (z cache w pamięci). Rzuca po polsku przy braku
 *  konfiguracji albo przerwanym logowaniu. */
export function getAccessToken(): Promise<string> {
  return accessTokenCache();
}

// ---- Picker ----------------------------------------------------------------

interface OpenPickerOptions {
  title: string;
  multiselect?: boolean;
  view: (picker: PickerApi) => PickerView;
}

async function openPicker(options: OpenPickerOptions): Promise<PickerDocument[] | null> {
  const config = requireConfig();
  const token = await getAccessToken();
  await loadScript(GAPI_SRC);
  const gapi = globals().gapi;
  if (gapi === undefined) throw new Error('Nie udało się wczytać okna wyboru plików Google.');
  await new Promise<void>((resolve) => gapi.load('picker', resolve));
  const picker = globals().google?.picker;
  if (picker === undefined) throw new Error('Nie udało się wczytać okna wyboru plików Google.');

  return new Promise<PickerDocument[] | null>((resolve) => {
    let builder = new picker.PickerBuilder()
      .setAppId(config.appId)
      .setDeveloperKey(config.apiKey)
      .setOAuthToken(token)
      .addView(options.view(picker))
      // Origin (schemat + host + port) musi zgadzać się z listą w kliencie OAuth.
      .setOrigin(globals().location?.origin ?? '')
      .setTitle(options.title)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs ?? []);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      });
    if (options.multiselect === true) {
      builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    }
    builder.build().setVisible(true);
  });
}

export interface PickOptions {
  /** Folder startowy: zapamiętany folder marki i miesiąca. */
  parentId?: string;
}

/** Wybór MEDIÓW (multi-select). Zwraca wybrane dokumenty albo `null` przy
 *  anulowaniu. Folderów nie da się zaznaczyć — służą tylko do nawigacji. */
export function pickFromDrive(options: PickOptions = {}): Promise<PickerDocument[] | null> {
  return openPicker({
    title: 'Wybierz media z Dysku',
    multiselect: true,
    view: (picker) => {
      const view = new picker.DocsView(picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);
      if (options.parentId !== undefined && options.parentId !== '') {
        view.setParent(options.parentId);
      }
      return view;
    },
  });
}

/** Wskazanie FOLDERU marki. Zwraca `{ id, name }` albo `null` przy anulowaniu. */
export async function pickFolderFromDrive(
  options: PickOptions = {},
): Promise<{ id: string; name: string } | null> {
  const documents = await openPicker({
    title: 'Wskaż folder marki',
    view: (picker) => {
      const view = new picker.DocsView(picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true);
      if (options.parentId !== undefined && options.parentId !== '') {
        view.setParent(options.parentId);
      }
      return view;
    },
  });
  const folder = documents?.[0];
  const id = text(folder?.id);
  if (id === '') return null;
  return { id, name: text(folder?.name) };
}

// ---- Udostępnienie pliku ---------------------------------------------------

/**
 * Nadaje plikowi dostęp „każdy z linkiem, przeglądający", żeby miniatura
 * działała także bez zalogowanego konta Google. BEST-EFFORT: nigdy nie rzuca i
 * nie blokuje zapisu publikacji — zwraca tylko informację, czy się udało.
 */
export async function shareFilePublic(fileId: string): Promise<boolean> {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** Polski komunikat z dowolnego błędu integracji (wejście do stanu edytora). */
export function driveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return 'Nie udało się połączyć z Dyskiem Google.';
}
