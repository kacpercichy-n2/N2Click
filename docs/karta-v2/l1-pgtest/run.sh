#!/bin/zsh
# Test migracji L1 karta-v2 na prawdziwym Postgresie (Homebrew postgresql@17)
# z atrapą Supabase (stub.sql). Klaster tymczasowy w /tmp, port 54391,
# sprzątany na końcu. Nic nie dotyka hostowanej bazy.
#   zsh docs/karta-v2/l1-pgtest/run.sh
set -e
PG=/opt/homebrew/opt/postgresql@17/bin
HERE=${0:A:h}
ROOT=${HERE:h:h:h}
MIG=$ROOT/supabase/migrations
DATA=$(mktemp -d /tmp/l1pg.XXXXXX)
PORT=54391
cleanup() { $PG/pg_ctl -D $DATA -m immediate stop >/dev/null 2>&1 || true; rm -rf $DATA; }
trap cleanup EXIT INT TERM
$PG/initdb -D $DATA -U postgres -A trust >/dev/null
$PG/pg_ctl -D $DATA -o "-p $PORT -k /tmp -c listen_addresses=''" -l $DATA/log -w start >/dev/null
PSQL=($PG/psql -h /tmp -p $PORT -U postgres -d postgres -X -q -t -v ON_ERROR_STOP=1)
run() {
  echo "== ${1:t}"
  if ! $PSQL -f $1 > $DATA/out 2>&1; then cat $DATA/out; echo "FAILED in ${1:t}"; exit 1; fi
  grep -c 'NOTICE:  ok' $DATA/out | sed 's/^/   asercje ok: /'
  grep -v -e '^NOTICE:  ok' -e '^psql:.*NOTICE:  ok' -e '^ *$' -e 'skipping$' -e '^ [0-9a-f-]{36}$' $DATA/out || true
}
run $HERE/stub.sql
for f in 20260813180000_chat 20260813190000_chat_membership_hardening 20260813200000_chat_edit_stamp \
  20260813210000_chat_revision_ownership 20260813220000_chat_revision_monotonic 20260813230000_chat_insert_stamps \
  20260813240000_chat_create_group_rpc 20260813250000_chat_direct_key_integrity 20260824120000_chat_open_direct_rpc \
  20260824130000_chat_open_direct_member_lock_order 20260825120000_chat_reactions 20260825130000_chat_themes; do
  run $MIG/$f.sql
done
run $HERE/seed.sql
for f in $MIG/20261102*.sql; do run $f; done
run $HERE/scenarios.sql
# Idempotencja: ponowny import i ponowne pliki schematu nie dublują i nie powiadamiają.
run $MIG/20261102100000_task_conversations.sql
run $MIG/20261102101000_task_chat_storage.sql
run $MIG/20261102102000_task_chat_backfill.sql
run $MIG/20261102103000_task_chat_notifications.sql
run $HERE/rerun-checks.sql
echo "ALL GREEN"
