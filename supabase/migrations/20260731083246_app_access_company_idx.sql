-- Advisor 0001 (unindexed_foreign_keys): indeks pod FK app_access.company_id.
create index if not exists app_access_company_id_idx on core.app_access (company_id);
