-- Kolaps ról planera (decyzja 2026-07-22): lokalnie zostają DWIE role —
-- „pelne” (mapowana na chmurowe access_role=administrator) i „ograniczone”
-- (mapowana na worker; rezerwowa, obecnie nikomu nie nadawana). Każdy obecny
-- pracownik firmy ma pełne uprawnienia: każdy tworzy zadania/projekty/
-- wydarzenia i widzi cały zespół, a widoczność steruje się filtrowaniem po
-- stronie klienta (nie rolą). Dlatego wszystkie istniejące profile podbijamy
-- do administratora — gałąź administratora w politykach RLS przepuszcza
-- wszystko, więc ŻADNA polityka się nie zmienia; enum access_role
-- (administrator|manager|worker) i wartości manager/worker zostają jako
-- reprezentacja przyszłych kont „ograniczonych”. Provisioning nowych kont
-- domyślnie nadaje administratora (frontend: teamScope.emptyProvisionForm).
-- Trigger app.protect_profile_privileges przepuszcza kontekst operatora
-- (auth.uid() IS NULL), więc ta migracja danych przechodzi bez wyłączania
-- triggerów.
update public.profiles
  set access_role = 'administrator'
  where access_role <> 'administrator';
