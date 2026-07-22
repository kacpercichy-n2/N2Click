-- Spółka WYKONAWCZA projektu (decyzja 2026-07-22): jawna kolumna
-- projects.company_id -> companies(id), on delete set null (parytet z
-- profiles.company_id z 20260721160000). Kolumna jest czysto informacyjna i
-- steruje wyłącznie DOMYŚLNYM filtrem widoków po stronie klienta (osoba ze
-- spółką X bazowo widzi projekty/taski swojej spółki i filtrem dokłada inne) —
-- celowo ZERO zmian w politykach RLS: dawne zawężanie
-- app.project_in_company_scope pozostaje w projects_select jako martwa gałąź,
-- bo od 20260722121000 każdy profil jest administratorem. Tabela projects jest
-- już w publikacji supabase_realtime — bez zmian. Mirror: cloudMirror.projectRow
-- pisze company_id po lokalnym id słownika (companies mirrorują się po id);
-- hydracja plannerData czyta NULL/brak jako ''.
alter table public.projects
  add column company_id uuid references public.companies (id) on delete set null;
