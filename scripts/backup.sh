#!/bin/sh
# One backup: dump, verify, prune.
#
# Verification is not a nicety. A dump that was truncated by a full disk, a
# killed container or a network blip is still a file of roughly the right size
# sitting in the right directory, and it looks exactly like a good one until the
# day it is needed. So every dump is read back before it is kept, and a dump
# that cannot be read is deleted rather than left to be mistaken for a backup.
#
# Runs inside the `backup` service, which has pg_dump and the database password.

set -eu

: "${PGHOST:=db}"
: "${PGUSER:=rankroom}"
: "${PGDATABASE:=rankroom}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_KEEP_DAYS:=14}"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/rankroom-$stamp.dump"
partial="$target.partial"

log() {
	echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"
}

fail() {
	log "FAILED: $*"
	rm -f "$partial"
	exit 1
}

mkdir -p "$BACKUP_DIR"

# Custom format: compressed, and restorable selectively with pg_restore. Written
# to a `.partial` name first, so a crash mid-dump cannot leave something that
# looks finished.
log "dumping $PGDATABASE from $PGHOST"
pg_dump --format=custom --compress=9 --file="$partial" 2>/dev/null ||
	fail "pg_dump returned non-zero"

[ -s "$partial" ] || fail "the dump is empty"

# Read the archive's table of contents back. This is what catches truncation:
# pg_restore refuses a damaged archive, where `ls -l` cannot tell.
tables=$(pg_restore --list "$partial" 2>/dev/null | grep -c 'TABLE DATA' || true)
[ "$tables" -ge 1 ] || fail "the dump has no table data — refusing to keep it"

mv "$partial" "$target"
size=$(wc -c <"$target" | tr -d ' ')
log "kept $(basename "$target") — $size bytes, $tables tables"

# Prune only *verified* dumps, and only after a new one has been kept, so a run
# of failures never erodes the history that is still good.
removed=$(find "$BACKUP_DIR" -name 'rankroom-*.dump' -type f -mtime "+$BACKUP_KEEP_DAYS" -print -delete | wc -l)
[ "$removed" -eq 0 ] || log "pruned $removed dump(s) older than $BACKUP_KEEP_DAYS days"

# Leftovers from an interrupted run. Older than a day, so a dump in progress is
# never swept out from under itself.
find "$BACKUP_DIR" -name '*.partial' -type f -mtime +1 -delete 2>/dev/null || true

log "done"
