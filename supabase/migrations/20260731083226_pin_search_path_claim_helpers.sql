-- Advisor 0011 (function_search_path_mutable): przypięcie search_path funkcji
-- claimowych — czytają wyłącznie auth.jwt(), więc pusty search_path wystarcza.
alter function core.has_app(text) set search_path = '';
alter function core.company_for(text) set search_path = '';
alter function core.app_role(text) set search_path = '';
