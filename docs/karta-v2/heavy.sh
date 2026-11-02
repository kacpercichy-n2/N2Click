#!/bin/zsh
# Global heavy-job lock for karta-v2 workers: one tsc/vitest/build/playwright at a time.
LOCK=/tmp/n2click-heavy.lock
find "$LOCK" -maxdepth 0 -mmin +20 -exec rmdir {} \; 2>/dev/null
until mkdir "$LOCK" 2>/dev/null; do sleep 5; find "$LOCK" -maxdepth 0 -mmin +20 -exec rmdir {} \; 2>/dev/null; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM
"$@"
