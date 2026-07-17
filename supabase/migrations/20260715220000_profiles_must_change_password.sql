-- =============================================================================
-- Migracja: 20260715220000_profiles_must_change_password
--
-- Dodaje flagę wymuszonej zmiany pierwszego hasła. Konta zakłada administrator
-- z hasłem tymczasowym, więc nowy profil wymaga ustawienia własnego hasła przy
-- pierwszym logowaniu. Flagę czyści WYŁĄCZNIE właściciel po udanej zmianie hasła
-- (polityka `profiles_update_self_or_admin` pozwala mu aktualizować własny
-- wiersz; trigger `app.protect_profile_privileges` blokuje tylko id/access_role/
-- department_id, więc ta kolumna jest samo-czyszczalna przez właściciela).
--
-- To bramka UX / integralności danych, NIE granica bezpieczeństwa: właściciel
-- może wyczyścić własną flagę przez API — świadoma decyzja, spójna z modelem
-- guardrails repo (autoryzacja żyje w RLS, kontrole klienta są tylko UX-em).
--
-- Migracja tylko-do-przodu; nie dotyka hostowanego projektu.
-- =============================================================================

alter table public.profiles
  add column must_change_password boolean not null default true;

comment on column public.profiles.must_change_password is
  'Bramka UX: konto z hasłem tymczasowym musi ustawić nowe hasło przy pierwszym logowaniu. Czyszczone przez właściciela po udanej zmianie hasła; nie jest granicą bezpieczeństwa.';
