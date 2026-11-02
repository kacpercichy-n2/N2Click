# Karta v2: backlog koordynatora (do rundy poprawek)

1. Pin pokazuje „(edytowana)”. Przyczyna: `chat_set_pin` podbija `messages.edited_at` jako rewizję
   (L1-L3-CONTRACT). Poprawka: osobna kolumna `messages.revised_at` (rewizja do scalania
   zdarzeń, podbijana przez edycję, pin, odpin, kasowanie), `edited_at` tylko przy zmianie `body`.
   Klient scala po `revised_at`, etykieta „(edytowana)” tylko z `edited_at`. Właściciele: baza + czat.
2. Do sprawdzenia w chmurze: czy `MARK_NOTIFICATION_ENTRY_READ` dla wpisów `task_message` /
   `task_mention` synchronizuje się do chmury (inne urządzenie widzi przeczytane), oraz
   `recipientId` == `state.currentUserId` (id osoby lokalnej == id profilu).
3. Do sprawdzenia w chmurze: zapytanie o przypięte (limit 50), komunikaty błędów z triggerów,
   ścieżka 42501 (brak dostępu).
4. NIEZGODNOŚĆ F1/F2: baza (F1, w toku) wpuszcza broadcast klienta tylko jako `typing` na `chat:typing:<id>`;
   klient (F2, 94b79ae) wysyła i słucha „pisze…” na `chat:conv:<id>` (ChatProvider.tsx:604). Po raporcie F1:
   osobny prywatny kanał `chat:typing:<id>` w kliencie (wysyłka + odbiór), bramka bez zmian. Inny worker niż F2.
5. Testy przeglądarkowe nadpisują śledzone zrzuty w `reviews/` (T1, L4). Przed scaleniem przywrócić
   (`git checkout -- reviews/` przez koordynatora) albo przenieść wyjście skryptów do katalogu ignorowanego.
