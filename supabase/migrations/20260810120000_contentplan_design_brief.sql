-- Wytyczne dla grafika na publikacji Content Planu (zakładka DESIGN edytora,
-- zgłoszenie 2026-08-07). Wolny tekst wewnętrzny dla zespołu — portal klienta
-- go nie czyta. Addytywne: istniejące wiersze dostają ''.
alter table contentplan.posts
  add column if not exists design_brief text not null default '';
