#!/bin/sh
# Restore a dump over the live database.
#
# Destructive by nature: the point of a restore is to replace what is there. So
# it refuses to run without an explicit confirmation, and it says exactly what
# it is about to overwrite first.
#
#   docker compose run --rm backup /scripts/restore.sh /backups/rankroom-….dump
#
# Practise this before you need it. A backup nobody has restored is a file, not
# a recovery plan — the first time you find out whether it works should not be
# the day the disk died.

set -eu

: "${PGHOST:=db}"
: "${PGUSER:=rankroom}"
: "${PGDATABASE:=rankroom}"

dump=${1:-}

if [ -z "$dump" ]; then
	echo "usage: restore.sh <dump file>" >&2
	echo >&2
	echo "available:" >&2
	ls -1t /backups/rankroom-*.dump 2>/dev/null | head -20 >&2 || echo "  (none)" >&2
	exit 2
fi

[ -f "$dump" ] || {
	echo "no such dump: $dump" >&2
	exit 2
}

# Read it before trusting it. A dump that pg_restore cannot list is one it
# cannot restore either, and finding that out now beats finding it out halfway
# through dropping the current data.
tables=$(pg_restore --list "$dump" 2>/dev/null | grep -c 'TABLE DATA' || true)
[ "$tables" -ge 1 ] || {
	echo "$dump is not a readable archive — refusing to restore from it" >&2
	exit 1
}

echo "About to restore $dump ($tables tables) into $PGDATABASE on $PGHOST."
echo "Everything currently in that database will be replaced."

if [ "${CONFIRM:-}" != "yes" ]; then
	echo >&2
	echo "Refusing without confirmation. Re-run with CONFIRM=yes to proceed:" >&2
	echo "  docker compose run --rm -e CONFIRM=yes backup /scripts/restore.sh $dump" >&2
	exit 3
fi

# `--clean --if-exists` drops what it is about to replace, so the restore is not
# layered on top of whatever is there. Single transaction: it either lands whole
# or leaves the database as it found it.
pg_restore \
	--clean --if-exists \
	--no-owner --no-privileges \
	--single-transaction \
	--dbname="$PGDATABASE" \
	"$dump"

echo "Restored. Restart the app so it reconnects: docker compose restart app"
