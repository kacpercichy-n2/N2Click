-- =============================================================================
-- Migracja: 20260723130000_notifications_emailed_at
--
-- Opcjonalne dublowanie powiadomień in-app mailem (Edge Function
-- `send-notification-emails`). Kolumna znaczy, że dane powiadomienie zostało już
-- ujęte w zbiorczym mailu do odbiorcy — funkcja wybiera WYŁĄCZNIE wiersze z
-- `emailed_at is null`, a po wysłaniu ustawia znacznik, więc ponowne wywołanie
-- (cron co ~5 min) nie dubluje maili. NULL (brak) = jeszcze niewysłane.
--
-- Rozszerzenie WYŁĄCZNIE addytywne: nie zmienia RLS ani semantyki in-app
-- (tabela `notifications` z 20260723120000). Domyślnie NULL, więc istniejące
-- wiersze pozostają poprawne bez backfillu.
--
-- Konwencja (patrz 20260715210000_core_schema): migracja tylko-do-przodu,
-- idempotentna (`add column if not exists`), nazwa YYYYMMDDHHMMSS_opis.sql.
-- Bez nowych polityk RLS.
-- =============================================================================

alter table public.notifications
  add column if not exists emailed_at timestamptz;

-- Selekcja wsadu przez funkcję: „niewysłane, najstarsze pierwsze”. Indeks
-- częściowy trzyma się małego (tylko dopóki wiersz czeka na wysyłkę).
create index if not exists notifications_unemailed_idx
  on public.notifications (created_at)
  where emailed_at is null;
