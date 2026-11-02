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
