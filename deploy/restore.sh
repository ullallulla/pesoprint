#!/usr/bin/env bash
# shellcheck disable=SC2016 # the single-quoted scripts run in containers, with their own variables
# The restore test (docs/production-environment3.md §8.3): restores a database backup into a throwaway Postgres and
# checks it, and restores one file from the files backup and compares it with R2. Never touches the live database.
# Needs only Docker: on your own machine, or on the host with the private key brought there for the test.
#
#   deploy/restore.sh --backup-env env/backup.env --identity ~/pesoprint-backup-key.txt \
#       [--dump daily/2026-11-21T010000Z] [--api-image ghcr.io/<owner>/pesoprint-api:sha-<sha>] \
#       [--files-env env/files-backup.env [--files-dir /mnt/files-backup] [--file <bucket>/<key>]]
#
#   --backup-env  backup.env: BACKUP_TARGET and the rclone settings of the backups bucket (DATABASE_URL is ignored)
#   --identity    the age private key (age-keygen output). Delete it from the host after the test
#   --dump        which backup, without .dump.age; default: the newest under daily/
#   --api-image   the API image that should find nothing to migrate; default: the deployed one on this host, else
#                 the newest master image
#   --files-env   files-backup.env, to also check a file; --files-dir is the host directory mounted as /backup
#   --file        which file, as <bucket>/<key>; default: a random one from the files backup
#
# The checks: the dump restores without errors; the row counts match its manifest; the API image's migrations find
# nothing to apply; the API starts against the restored database (no Stripe, Resend or Clerk keys) and answers
# /api/health; the restored file has the same SHA-256 as the one in R2.
set -Eeuo pipefail

here=$(cd "$(dirname "$0")" && pwd -P)
root=${PESOPRINT_ROOT:-/opt/pesoprint}

usage() {
	sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//' >&2
	exit 64
}

backup_env='' identity='' dump='' api_image='' files_env='' files_dir='' file=''
while [[ $# -gt 0 ]]; do
	case $1 in
		--backup-env) backup_env=$(realpath "$2") ;;
		--identity) identity=$(realpath "$2") ;;
		--dump) dump=$2 ;;
		--api-image) api_image=$2 ;;
		--files-env) files_env=$(realpath "$2") ;;
		--files-dir) files_dir=$(realpath "$2") ;;
		--file) file=$2 ;;
		*) usage ;;
	esac
	shift 2 || usage
done
[[ -f $backup_env && -f $identity ]] || usage
if [[ -z $api_image ]]; then
	repository=$(sed -n 's/^IMAGE_REPO=//p' "$root/.env" 2>/dev/null || true)
	repository=${repository:-ghcr.io/ullallulla}/pesoprint-api
	if [[ -L $root/current ]]; then
		api_image="$repository:sha-$(basename "$(cd "$root/current" && pwd -P)")"
	else
		api_image=$repository:master
	fi
fi

log() {
	printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"
}

fail() {
	log "FAILED: $*" >&2
	exit 1
}

id=pesoprint-restore-$$
network=$id
db=$id-db
tools=$id-tools
api=$id-api
db_url="postgresql://pesoprint:restore@$db:5432/pesoprint"

cleanup() {
	docker rm -f "$api" "$tools" "$db" >/dev/null 2>&1 || true
	docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

started=$(date +%s)
log "Building the tools image"
docker build --quiet --tag pesoprint-backup:restore "$here/backup" >/dev/null
docker pull --quiet "$api_image" >/dev/null

docker network create "$network" >/dev/null
# Everything restored lives in memory (tmpfs) and goes away with these containers.
docker run --detach --name "$db" --network "$network" --tmpfs /var/lib/postgresql \
	-e POSTGRES_USER=pesoprint -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=pesoprint postgres:18 >/dev/null
docker run --detach --name "$tools" --network "$network" --user "$(id -u):$(id -g)" \
	--env-file "$backup_env" -e HOME=/work --tmpfs /work:mode=1777 \
	--volume "$identity:/run/age-identity:ro" --entrypoint sleep pesoprint-backup:restore infinity >/dev/null

# Runs a command in the tools container. Single-quoted `sh -c` scripts given to it expand in the container.
tools() {
	docker exec "$tools" "$@"
}

if [[ -z $dump ]]; then
	dump=$(tools sh -c 'rclone lsf "$BACKUP_TARGET/daily" --files-only --include "*.manifest.txt.age"' |
		sort | tail -n 1 | sed 's/\.manifest\.txt\.age$//')
	[[ -n $dump ]] || fail "no backups under daily/"
	dump="daily/$dump"
fi

log "Downloading and decrypting $dump"
tools sh -c '
	set -e
	rclone copyto "$BACKUP_TARGET/$1.dump.age" /work/db.dump.age
	rclone copyto "$BACKUP_TARGET/$1.manifest.txt.age" /work/manifest.txt.age
	age --decrypt --identity /run/age-identity --output /work/db.dump /work/db.dump.age
	age --decrypt --identity /run/age-identity --output /work/manifest.txt /work/manifest.txt.age
	rm /work/db.dump.age /work/manifest.txt.age
' sh "$dump" || fail "could not download or decrypt $dump"
manifest=$(tools cat /work/manifest.txt)
mapfile -t manifest_lines <<<"$manifest"
printf '  %s\n' "${manifest_lines[@]}"

log "Restoring into a throwaway Postgres"
for _ in $(seq 1 60); do
	tools pg_isready --quiet --dbname "$db_url" && break
	sleep 1
done
restore_started=$(date +%s)
tools pg_restore --no-owner --no-privileges --exit-on-error --dbname "$db_url" /work/db.dump ||
	fail "pg_restore reported errors"
restore_seconds=$(($(date +%s) - restore_started))

sql() {
	tools psql --no-psqlrc --tuples-only --no-align --quiet --dbname "$db_url" --command "$1"
}

log "Comparing row counts with the manifest"
while IFS='=' read -r key expected; do
	[[ $key == rows.* ]] || continue
	table=${key#rows.}
	actual=$(sql "select count(*) from public.$table")
	printf '  %-15s %8s  (manifest: %s)\n' "$table" "$actual" "$expected"
	[[ $actual == "$expected" ]] || fail "$table has $actual rows, the manifest says $expected"
done <<<"$manifest"
migrations=$(sql 'select count(*) from drizzle.__drizzle_migrations')
expected_migrations=$(sed -n 's/^migrations_applied=//p' <<<"$manifest")
[[ $migrations == "$expected_migrations" ]] ||
	fail "$migrations migrations in the database, the manifest says $expected_migrations"

# The image is in production mode, which requires every live key: this check runs without them. Production mode
# itself stays, so the restored database's queued order emails stay queued instead of being printed.
api_env=(-e "DATABASE_URL=$db_url" -e CLERK_SECRET_KEY=sk_test_restore_check -e LOG_REQUESTS=false
	-e SKIP_PRODUCTION_SETTINGS_CHECK=true)
log "Running the migrations of $api_image"
docker run --rm --network "$network" "${api_env[@]}" "$api_image" node dist/migrate.mjs >/dev/null ||
	fail "the migrations failed"
after=$(sql 'select count(*) from drizzle.__drizzle_migrations')
[[ $after == "$migrations" ]] ||
	fail "the API image applied $((after - migrations)) migrations the dump didn't have (was the dump taken before the last deploy?)"
log "  nothing to apply ($migrations migrations)"

log "Starting the API against the restored database"
docker run --detach --name "$api" --network "$network" "${api_env[@]}" "$api_image" >/dev/null
healthy=''
for _ in $(seq 1 30); do
	if health=$(docker exec "$api" node -e "
		fetch('http://localhost:3001/api/health').then(async (r) => {
			console.log(r.status, await r.text());
			process.exit(r.ok ? 0 : 1);
		}, () => process.exit(1));
	" 2>/dev/null); then
		healthy=yes
		break
	fi
	sleep 2
done
[[ -n $healthy ]] || {
	docker logs --tail 30 "$api" >&2
	fail "the API didn't answer /api/health"
}
log "  /api/health: $health"

file_result='not checked (no --files-env)'
if [[ -n $files_env ]]; then
	log "Restoring a file from the files backup"
	file_result=$(docker run --rm --network "$network" --user "$(id -u):$(id -g)" --env-file "$files_env" -e HOME=/work --tmpfs /work:mode=1777 \
		${files_dir:+--volume "$files_dir:/backup:ro"} --entrypoint sh pesoprint-backup:restore -c '
		set -eu
		dest=${FILES_BACKUP_DEST%/}
		file=$1
		[ -n "$file" ] || file=$(rclone lsf --recursive --files-only "$dest/current" | shuf -n 1)
		[ -n "$file" ] || { echo "the files backup is empty" >&2; exit 1; }
		bucket=${file%%/*}
		key=${file#*/}
		source=""
		for s in $FILES_BACKUP_SOURCES; do
			b=${s#*:}; b=${b%/}; b=${b##*/}
			[ "$b" != "$bucket" ] || source=${s%/}
		done
		[ -n "$source" ] || { echo "$bucket is not in FILES_BACKUP_SOURCES" >&2; exit 1; }
		rclone copyto "$dest/current/$bucket/$key" /work/restored
		restored=$(sha256sum /work/restored | cut -d " " -f 1)
		original=$(rclone cat "$source/$key" | sha256sum | cut -d " " -f 1)
		[ "$restored" = "$original" ] || { echo "$file differs from R2: $restored vs $original" >&2; exit 1; }
		echo "$file, sha256 $restored, same as in R2"
	' sh "$file") || fail "the file check failed"
	log "  $file_result"
fi

total=$(($(date +%s) - started))
cat <<EOF

Restore test passed. For the runbook (README → Production → Restore):
  Date:      $(date +%Y-%m-%d)
  Dump:      $dump
  API image: $api_image
  File:      $file_result
  Took:      $((total / 60)) min $((total % 60)) s in total, of which pg_restore $restore_seconds s
EOF
