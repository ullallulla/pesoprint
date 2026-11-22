#!/bin/sh
# Pesoprint's backup jobs (docs/production-environment3.md §8). Runs in the backup image:
#
#   db-schedule           every night at BACKUP_AT: `db daily`, then a ping to HEARTBEAT_URL
#   db daily              one database backup to BACKUP_TARGET/daily/
#   db pre-deploy <sha>   one database backup to BACKUP_TARGET/pre-deploy/ (deploy.sh runs this)
#   files-schedule        every night at FILES_BACKUP_AT: `files`, then a ping to HEARTBEAT_URL
#   files                 one copy of the R2 buckets to FILES_BACKUP_DEST
#   manifest <dump>       print the manifest of a dump file (used by `db` and by restore.sh)
#
# A database backup is a `pg_dump --format=custom`, and a manifest made from that same dump (row counts of the main
# tables, the migrations in it, the pg_dump version), both encrypted with age to AGE_RECIPIENT. The unencrypted dump
# only exists in /tmp, which is in memory. The private key is never on the host.
#
# Remotes are rclone remotes, configured with environment variables (RCLONE_CONFIG_<NAME>_<OPTION>), see
# env/backup.env.example and env/files-backup.env.example.
set -eu
set -o pipefail

# The tables whose row counts go into the manifest, and which the restore test compares.
MANIFEST_TABLES='users products product_files orders order_items entitlements reviews'

log() {
	printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
	log "error: $*" >&2
	exit 1
}

# Pings HEARTBEAT_URL (healthchecks.io), or HEARTBEAT_URL/fail. Nothing happens without it. A failed ping is only
# logged: the missing ping is what raises the alarm.
heartbeat() {
	[ -n "${HEARTBEAT_URL:-}" ] || return 0
	url=$HEARTBEAT_URL
	[ "$1" = ok ] || url="$HEARTBEAT_URL/fail"
	curl -fsS -m 10 --retry 3 -o /dev/null "$url" || log "warning: could not ping the heartbeat URL"
}

# Number of data rows of one table in a custom-format dump (rows of a COPY block; COPY escapes newlines, so it's one
# row per line).
dump_rows() {
	pg_restore --data-only --schema="$2" --table="$3" --file=- "$1" |
		awk '/^COPY / { on = 1; next } /^\\\.$/ { on = 0 } on { n++ } END { print n + 0 }'
}

manifest() {
	dump=$1
	[ -f "$dump" ] || die "no dump at $dump"
	echo "pg_dump_version=$(pg_dump --version)"
	migrations=$(pg_restore --data-only --schema=drizzle --table=__drizzle_migrations --file=- "$dump" |
		awk -F '\t' '/^COPY / { on = 1; next } /^\\\.$/ { on = 0 } on { n++; if ($3 > latest) latest = $3 } END { print n + 0, latest + 0 }')
	echo "migrations_applied=${migrations% *}"
	# created_at of the newest applied migration: the "when" of its entry in apps/api/drizzle/meta/_journal.json.
	echo "latest_migration=${migrations#* }"
	for table in $MANIFEST_TABLES; do
		echo "rows.$table=$(dump_rows "$dump" public "$table")"
	done
}

db_backup() {
	kind=$1
	: "${DATABASE_URL:?DATABASE_URL is not set}"
	: "${AGE_RECIPIENT:?AGE_RECIPIENT is not set}"
	: "${BACKUP_TARGET:?BACKUP_TARGET is not set}"

	# A new name every time, also for two backups on the same day: the bucket lock doesn't allow overwrites.
	stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
	case $kind in
		daily) name="daily/$stamp" ;;
		pre-deploy)
			sha=${2:?usage: db pre-deploy <sha>}
			name="pre-deploy/$stamp-$sha"
			;;
		*) die "usage: db daily | db pre-deploy <sha>" ;;
	esac

	work=$(mktemp -d)
	trap 'rm -rf "$work"' EXIT

	log "Dumping the database"
	pg_dump --format=custom --file="$work/db.dump" "$DATABASE_URL"
	manifest "$work/db.dump" >"$work/manifest.txt"
	sed 's/^/  /' "$work/manifest.txt"

	age --encrypt --recipient "$AGE_RECIPIENT" --output "$work/db.dump.age" "$work/db.dump"
	age --encrypt --recipient "$AGE_RECIPIENT" --output "$work/manifest.txt.age" "$work/manifest.txt"
	rm -f "$work/db.dump" "$work/manifest.txt"

	log "Uploading $name ($(du -h "$work/db.dump.age" | cut -f1) encrypted)"
	rclone copyto "$work/db.dump.age" "$BACKUP_TARGET/$name.dump.age"
	# The manifest last: a dump with a manifest is a complete backup.
	rclone copyto "$work/manifest.txt.age" "$BACKUP_TARGET/$name.manifest.txt.age"
	log "Backup done: $name"
}

files_backup() {
	: "${FILES_BACKUP_SOURCES:?FILES_BACKUP_SOURCES is not set}"
	: "${FILES_BACKUP_DEST:?FILES_BACKUP_DEST is not set}"
	keep_days=${FILES_BACKUP_KEEP_DAYS:-30}
	dest=${FILES_BACKUP_DEST%/}
	day=$(date -u +%Y-%m-%d)

	# current/<bucket> is a copy of the bucket. What a sync would delete or overwrite moves to deleted/<day>/<bucket>
	# instead, and is kept for keep_days.
	for source in $FILES_BACKUP_SOURCES; do
		bucket=${source#*:}
		bucket=${bucket%/}
		bucket=${bucket##*/}
		log "Copying $source"
		rclone sync "$source" "$dest/current/$bucket" --backup-dir "$dest/deleted/$day/$bucket" --stats-one-line --stats 0
	done

	cutoff=$(date -u -d "@$(($(date +%s) - keep_days * 86400))" +%Y-%m-%d)
	for dir in $(rclone lsf --dirs-only "$dest/deleted" 2>/dev/null || true); do
		dir=${dir%/}
		if expr "$dir" '<' "$cutoff" >/dev/null; then
			log "Removing deleted/$dir (older than $keep_days days)"
			rclone purge "$dest/deleted/$dir"
		fi
	done
	log "Files backup done"
}

# Minutes since midnight of HH:MM (or of now, without an argument). `1HHMM - 10000` avoids octal for leading zeros.
minute_of_day() {
	hhmm=${1:-$(date +%H:%M)}
	case $hhmm in
		[0-2][0-9]:[0-5][0-9]) ;;
		*) die "not a time of day (HH:MM): $hhmm" ;;
	esac
	echo $(((1${hhmm%:*} - 100) * 60 + 1${hhmm#*:} - 100))
}

# Runs a job once a day, at the first check at or after `at` (local time, TZ). A container that starts after that
# time waits for the next day; on the night clocks skip an hour the job still runs, just later. A failed job is
# logged and reported to the heartbeat, and the schedule carries on.
schedule() {
	at=$1
	shift
	target=$(minute_of_day "$at")
	last=''
	[ "$(minute_of_day)" -lt "$target" ] || last=$(date +%Y-%m-%d)
	log "Scheduled: $* every day at $at ($TZ)"
	while :; do
		today=$(date +%Y-%m-%d)
		if [ "$today" != "$last" ] && [ "$(minute_of_day)" -ge "$target" ]; then
			last=$today
			set +e
			(set -e; "$@")
			status=$?
			set -e
			if [ "$status" -eq 0 ]; then
				heartbeat ok
			else
				log "error: $* failed (exit $status)"
				heartbeat fail
			fi
		fi
		sleep 30
	done
}

command=${1:-help}
[ $# -eq 0 ] || shift
case $command in
	db) db_backup "$@" ;;
	db-schedule) schedule "${BACKUP_AT:-03:00}" db_backup daily ;;
	files) files_backup ;;
	files-schedule) schedule "${FILES_BACKUP_AT:-03:30}" files_backup ;;
	manifest) manifest "$@" ;;
	*) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
