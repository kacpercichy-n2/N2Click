-- Po nieudanym backfillu: nic nie zapisane, triggery włączone.
select t.ok((select conversation_id = '5a000000-0000-4000-8000-000000000001' from n2click.messages
  where id = 'cc000000-0000-4000-8000-0000000000f5'), 'F5: wiadomość atakującego nietknięta, import nic nie dopisał');
select t.ok((select count(*) from pg_trigger where tgrelid in ('n2click.messages'::regclass, 'n2click.conversations'::regclass,
  'n2click.conversation_members'::regclass) and not tgisinternal and tgenabled <> 'O') = 0, 'F5: triggery włączone po błędzie importu');
