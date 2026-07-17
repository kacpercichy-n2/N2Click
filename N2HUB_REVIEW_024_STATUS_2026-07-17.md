# Status ustaleń z review 024 (code-review ultra) — stan na main po przejściu na architekturę cloud-authoritative (2026-07-17)

Źródło: raport `20260717-045356-024-code-review-ultra` (gałąź review-integration,
baza 77db17f). Poniżej każde ustalenie zweryfikowane względem AKTUALNEGO `main`
(po commitach 9a2718b/2d6197b/4515413: autorytatywna hydracja encji/osób/
słowników + przewód zapisu słowników i profili). Wyłącznie lista do przyszłych
fixów — bez zmian w kodzie.

## Nadal występują (do naprawy)

1. **[NADAL, krytyczne w trybie retirement] CloudSyncProvider — cicha utrata
   wiersza niemapowalnego.** Efekt lustra nadal robi `const { ops } =
   diffToCloudOps(...)` (diagnostyka ODRZUCANA) i `if (ops.length === 0)
   return;` — zmiana wyłącznie kolekcji mirrorowanych, której żaden wiersz się
   nie zmapował, nie trafia ani do chmury, ani (przy aktywnym retirement +
   `shouldSkipLocalPersist`) do localStorage. Retirement nie jest jeszcze
   włączony produkcyjnie, ale ścieżka istnieje. Po rozszerzeniu mirrora o
   słowniki/profile odrzucane diagnostyki obejmują też te rodziny.

2. **[NADAL, uśpione do czasu retirement] AppStore — regresja jawności
   konfliktu kart.** Pominięty (nie: nieudany) zapis lokalny nie ustawia
   `saveError`; kontrola „czystości" w `subscribeExternalChanges` (anyDirty ||
   saveError || conflict) przepuszcza wtedy ciche `REPLACE_FROM_STORAGE`.
   Ryzyko zawężone (zmiany są w kolejce chmury i wracają przy hydracji), ale
   twardy niezmiennik jawności konfliktu formalnie złamany.

3. **[NADAL, WZMOCNIONE przez zmianę autorytatywną] plannerData/mergeCloudEntities
   — fail-close całej hydracji przez jeden zły wiersz.** `loadPlannerSnapshot`
   wyklucza projekt/zadanie o złym okresie, ale NIE filtruje jego
   zadań/kamieni/przypisań; walidacja w reduktorze liczy teraz referencje
   wyłącznie wobec payloadu, więc osierocony wiersz odrzuca CAŁĄ hydrację
   (status „ready", zero danych). Fix: filtrować potomków wykluczonych
   projektów/zadań w plannerData (i rozważyć CHECK-i okresów w SQL).

4. **[NADAL] Brak paginacji — cichy limit 1000 wierszy PostgREST.** Wspólny
   adapter selectów (dataImport/plannerData/referenceData) nie używa
   `.range()`; przy wzroście danych (najpierw `activity_events`,
   `workload_entries`) hydracja po cichu utnie zbiór. Naprawić raz, w
   adapterze.

5. **[NADAL, zmieniona postać] Kolejka mirrora tylko w pamięci + hydracja
   autorytatywna.** Operacje niewysłane przed zamknięciem/przeładowaniem karty
   przepadają, a autorytatywna hydracja przy następnym logowaniu utrwala stan
   chmury (dawna postać: „merge cofa edycje"; obecna: „niewysłane edycje
   znikają bez śladu"). Fix kierunkowy: trwała kolejka (localStorage) albo
   drenaż przed hydracją + jawny komunikat o niewysłanych zmianach.

6. **[NADAL] migrationStatus — sonda retirement koliduje z indeksem bin.**
   Sonda wstawia wiersz `work_date: null` z onConflict 'id'; częściowy indeks
   unikalny `workload_entries_bin_pair` daje 23505 klasyfikowane jako
   „permission" (handshake trwale zablokowany przy wpisie w zasobniku), a
   nieudane remove() osieroca wiersz 0,25 h widoczny w planie.

7. **[NADAL] migrationStatus vs cloudMirror — rozjazd reguł
   `impersonatorId`.** Coverage sprawdza tylko `actorId` (migrationStatus.ts
   ~136–139), mirror odrzuca wiersz z niemapowalnym impersonatorem
   (cloudMirror.ts ~343). Handshake może przejść „czysto" mimo wierszy, które
   nigdy się nie zmirrorują.

8. **[NADAL, zawężone] merge przyjmuje `statusId: ''`.** `status_id NULL` w
   chmurze nadal mapuje się na '' i przechodzi merge (reducer by to odrzucił).
   Po synchronizacji słowników przypadek zawężony do wierszy z realnym NULL-em
   (np. z importu), ale możliwy.

9. **[NADAL, tylko dev] CloudSyncProvider — `mountedRef` a StrictMode.**
   Cleanup ustawia `mountedRef.current = false`, ciało efektu nigdy nie
   przywraca `true` — pod StrictMode hydracja utyka na „hydrating".
   Produkcja nieosiągalna; dev w trybie supabase niefunkcjonalny.

10. **[NADAL, wydajność — powierzchnia UROSŁA] cloudMirror — pełna
    serializacja przy każdym dispatchu.** Diff nadal porównuje wiersze przez
    podwójne `JSON.stringify` bez szybkiej ścieżki `before === c`, a po
    rozszerzeniu obejmuje 13 kolekcji (8 rodzin + 4 słowniki + osoby).
    Reducer zachowuje tożsamość referencji — fix jest jednolinijkowy per pętla.

11. **[NADAL, wydajność/plausible] dataImport — import wiersz-po-wierszu**
    (tysiące round-tripów przy dużej migracji; potrzebny wariant hybrydowy
    batch + fallback per wiersz).

12. **[NADAL, reużycie/plausible] Zdublowane mapowanie domena→kolumny**
    (buildery w mirrorze vs inline w imporcie, różne polityki braków; po
    dodaniu słowników w mirrorze punktów mapowania jest więcej). Wspólny moduł
    mapperów parametryzowany resolverami.

13. **[NADAL, architektura/plausible] Denylista SUPPRESSED w
    CloudSyncProvider.** Mechanizm bez defektu (nowe akcje MERGE_CLOUD_PEOPLE/
    MERGE_CLOUD_DICTIONARIES zostały dopisane), ale każda przyszła akcja typu
    bulk-replace dodana bez wpisu wyemituje masowe zapisy. Lepsza metadana
    pochodzenia akcji.

## Rozwiązane / zdezaktualizowane przez zmiany z 2026-07-17

- **Usunięcia nie propagują się między urządzeniami** — NAPRAWIONE:
  hydracja jest autorytatywna (payload zastępuje kolekcje; lokalne sieroty
  odpadają), a mirror emituje remove przy akcjach.
- **Bramka /admin na surowej roli lokalnej** — w praktyce ROZWIĄZANE
  architektonicznie: MERGE_CLOUD_PEOPLE ustawia lokalne `accessRole` z chmury,
  więc surowa i efektywna rola zbiegają się po pierwszym snapshocie
  (szczątkowe okno: kilka sekund ładowania snapshotu na starej roli tej samej
  osoby). Decyzja produktowa z raportu przestaje być pilna.

## Notatka priorytetowa (jak w raporcie, zaktualizowana)

Przed produkcyjnym włączeniem trybu retirement: naprawić 1, 2, 6 (+ 3–5 dla
poprawności wielourządzeniowej). Punkt 4 (limit 1000) najtaniej naprawić od
razu we wspólnym adapterze, zanim urosną `activity_events`.
