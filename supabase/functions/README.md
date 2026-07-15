# Supabase Edge Functions — `provision-account`

Zaufana, **serwerowa** granica zakładania kont N2Hub. Funkcja tworzy
użytkownika w `auth.users` oraz odpowiadający mu wiersz w `public.profiles`,
i może to zrobić **wyłącznie** na żądanie uwierzytelnionego administratora.

To wciąż uśpiona infrastruktura: aplikacja działa na localStorage, **nie ma
jeszcze UI administracyjnego** ani wywołania tej funkcji z frontendu, a ta
zmiana **nie wymaga żadnej migracji** (korzysta z istniejących tabel
`departments` i `profiles`).

## Granica zaufania

- Klucz `service_role` (sekret) żyje **wyłącznie w runtime Edge**, gdzie jest
  auto-wstrzykiwany. **Nigdy** nie trafia do przeglądarki ani do tego repo.
- Frontend używa tylko klucza *publishable* (patrz `src/supabase/config.ts`).
- Autoryzacja jest egzekwowana po stronie serwera: funkcja odczytuje JWT
  wywołującego, ustala jego profil i wpuszcza tylko `access_role =
  'administrator'`. Service role świadomie omija RLS — to poprawne zachowanie
  serwerowe, ale tylko za bramką autoryzacji administratora.
- Nigdzie nie logujemy treści żądania, hasła ani kluczy. `console.error`
  zawiera co najwyżej kod błędu.

## Podział plików

```
supabase/functions/provision-account/
  contract.ts   # czysty kontrakt + walidacja (bez SDK, bez globali Deno) — współdzielony z testami repo
  index.ts      # handler Deno Edge (Deno.serve, npm:@supabase/supabase-js@2)
```

`contract.ts` jest celowo pozbawiony zależności, więc konsumuje go zarówno
bundler Deno, jak i `tsc`/`vitest` repo. Testy jednostkowe kontraktu żyją w
`src/supabase/provisioning.test.ts` i importują wyłącznie `contract.ts`.

## Kontrakt żądania i odpowiedzi

`POST` z nagłówkiem `Authorization: Bearer <jwt>` i ciałem JSON:

| Pole | Typ | Uwagi |
| --- | --- | --- |
| `firstName` | string (wymagane) | przycięte, 1–100 znaków |
| `lastName` | string (opc.) | przycięte, ≤ 100, domyślnie `''` |
| `email` | string (wymagane) | trim + lowercase, walidacja formatu, opcjonalna dozwolona domena |
| `roleTitle` | string (opc.) | przycięte, ≤ 200, domyślnie `''` |
| `departmentId` | uuid \| null (opc.) | musi istnieć w `departments` |
| `managerProfileId` | uuid \| null (opc.) | profil musi być menedżerem zarządzającym `departmentId` |
| `accessRole` | `administrator` \| `manager` \| `worker` | |
| `initialPassword` | `{ mode: 'invite' }` \| `{ mode: 'temporary-password', password }` | hasło ≥ 8 znaków |

Powiązanie z menedżerem to kontrola spójności: w modelu N2Hub **nie ma** kolumny
`manager_id`. Menedżer to profil z `access_role = 'manager'`, którego
`department_id` wskazuje zarządzany dział; musi on być równy `departmentId` z
żądania.

Odpowiedź sukcesu — `201`:

```json
{
  "userId": "…",
  "email": "…",
  "accessRole": "worker",
  "mustChangePassword": true,
  "initialPasswordMode": "invite"
}
```

Hasło **nigdy** nie jest zwracane. Wybrane statusy błędów (komunikaty po
polsku): `401` brak/niepoprawna sesja, `403` brak uprawnień administratora,
`400` nieprawidłowe dane wejściowe (per-pole), `409` konto z tym e-mailem już
istnieje, `405` niedozwolona metoda, `500/502` błąd/konfiguracja serwera.

## Weryfikacja JWT

Funkcja sama waliduje token przez `serviceClient.auth.getUser(jwt)`, więc może
działać z domyślną weryfikacją JWT bramy. Autoryzacja roli i tak jest
powtórzona po stronie serwera na podstawie wiersza w `profiles`.

## Wdrożenie i sekrety

```bash
supabase functions deploy provision-account
```

Sekrety (ustawiaj **nazwami**, nigdy nie commituj wartości):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — **zarezerwowane**,
  auto-wstrzykiwane w runtime Edge; nie ustawiaj ich ręcznie.
- `PROVISION_ALLOWED_EMAIL_DOMAINS` (opc.) — lista domen po przecinku; pusta =
  dowolna domena.
- `PROVISION_ALLOWED_ORIGIN` (opc.) — jeśli ustawione, dodawany nagłówek CORS
  `Access-Control-Allow-Origin`; bez niego brak nagłówka origin.

```bash
supabase secrets set PROVISION_ALLOWED_EMAIL_DOMAINS=firma.pl
supabase secrets set PROVISION_ALLOWED_ORIGIN=https://planer.firma.pl
```
