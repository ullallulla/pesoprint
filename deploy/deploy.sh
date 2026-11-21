#!/usr/bin/env bash
# Deploys one commit of Pesoprint (docs/production-environment3.md §7.3). bin/deploy-wrapper downloads this release
# into /opt/pesoprint/releases/<sha>/ and runs `releases/<sha>/deploy.sh <sha>` while holding the deploy lock.
#
# 1. Pull the images tagged sha-<sha> (and build the backup image).
# 2. Back up the database (pre-deploy/ in the backups bucket). Stop if that fails.
# 3. Run the migrations with the new API image.
# 4. Point `current` at the new release and start it; check the API's /api/health and /readyz through Caddy.
# 5. If that fails, go back to the previous release and exit with an error. Migrations aren't undone, which is
#    why a migration must keep working with the previous release.
# 6. Remove images and releases older than the previous one (keeping the last five releases).
# 7. Record the result in /opt/pesoprint/deploy.log.
set -Eeuo pipefail

sha=${1:-}
if [[ ! $sha =~ ^[0-9a-f]{40}$ ]]; then
	echo "Usage: deploy.sh <full 40-character commit SHA>" >&2
	exit 64
fi

root=${PESOPRINT_ROOT:-/opt/pesoprint}
release="$root/releases/$sha"
here=$(cd "$(dirname "$0")" && pwd -P)
if [[ $here != "$(cd "$release" 2>/dev/null && pwd -P)" ]]; then
	echo "deploy.sh must run from $release (it's run by bin/deploy-wrapper)." >&2
	exit 64
fi

previous=''
if [[ -L $root/current ]]; then
	previous=$(cd "$root/current" && pwd -P)
	# A redeploy of the running commit has nothing to go back to.
	[[ $previous != "$release" ]] || previous=''
fi

log() {
	printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

record() {
	printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" "$*" >>"$root/deploy.log"
}

new() {
	"$release/bin/compose" "$@"
}

old() {
	"$previous/bin/compose" "$@"
}

point_current_at() {
	ln -sfn "$1" "$root/current.new"
	mv -Tf "$root/current.new" "$root/current"
}

# The API's own health check (it also checks the database), then the whole chain through Caddy: Caddy → web → API.
# Retries for a while: --wait only waited for the containers' own health checks.
check() {
	local compose=$1
	for _ in $(seq 1 10); do
		if "$compose" exec -T api node -e "
			fetch('http://localhost:3001/api/health').then(async (r) => {
				console.log('API /api/health:', r.status, await r.text());
				process.exit(r.ok ? 0 : 1);
			}, (e) => { console.log('API /api/health:', e.message); process.exit(1); });
		" && "$compose" exec -T caddy wget -q -O - http://127.0.0.1:8080/readyz | grep -qx ok; then
			log "Healthy: the API answers /api/health, and /readyz answers ok through Caddy"
			return 0
		fi
		sleep 3
	done
	log "Not healthy after 10 checks"
	return 1
}

# Failures before `current` moves leave the running release alone.
trap 'log "Deploy of $sha failed. The running release stays as it was (but migrations that ran stay applied)"; record failed' ERR

log "Deploying $sha${previous:+ (running now: $(basename "$previous"))}"
services=$(new config --services)
has() {
	grep -qx "$1" <<<"$services"
}

log "Pulling images"
new pull --quiet --ignore-buildable
if has backup || has files-backup; then
	log "Building the backup image"
	new build --quiet
fi
# The digests say exactly what runs, whatever happens to the tags later.
for image in $(new config --images | grep ':sha-' | sort -u); do
	digest=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" |
		grep -m 1 "^${image%:*}@" || true)
	log "Image: $image${digest:+ (${digest#*@})}"
done

if has backup && [[ -n $previous ]]; then
	log "Backing up the database before the deploy"
	new run --rm --no-deps backup db pre-deploy "$sha"
elif has backup; then
	log "First deploy: no database to back up yet"
else
	log "warning: the backup profile is off, so there's no pre-deploy backup"
fi

log "Running migrations"
new run --rm api node dist/migrate.mjs

trap - ERR
point_current_at "$release"
log "Starting the new release"
if new up --detach --wait --wait-timeout 180 --remove-orphans && check "$release/bin/compose"; then
	record "deployed${previous:+ (previous: $(basename "$previous"))}"
	log "Deployed $sha"
else
	log "The new release isn't healthy:"
	new ps --all --format 'table {{.Service}}\t{{.Status}}' || true
	for service in $(new ps --all --format '{{.Service}} {{.State}} {{.Health}}' |
		awk '$2 != "running" || ($3 != "" && $3 != "healthy") { print $1 }'); do
		new logs --no-color --tail 30 "$service" || true
	done
	if [[ -z $previous ]]; then
		record "failed (no previous release to go back to)"
		log "Deploy failed, and there's no previous release to go back to"
		exit 1
	fi
	log "Rolling back to $(basename "$previous")"
	point_current_at "$previous"
	if old up --detach --wait --wait-timeout 180 --remove-orphans && check "$previous/bin/compose"; then
		record "rolled back to $(basename "$previous")"
		log "Rolled back to $(basename "$previous"). The deploy of $sha failed"
	else
		record "rollback to $(basename "$previous") failed too"
		log "The rollback isn't healthy either; look at it by hand"
	fi
	exit 1
fi

log "Cleaning up"
keep=" sha-$sha ${previous:+sha-$(basename "$previous")} "
for repository in $(new config --images | grep ':sha-' | sed 's/:[^:]*$//' | sort -u); do
	for tag in $(docker image ls --format '{{.Tag}}' "$repository" | grep '^sha-' || true); do
		[[ $keep == *" $tag "* ]] || docker image rm "$repository:$tag" >/dev/null || true
	done
done
docker image prune --force >/dev/null || true
# The five newest releases stay, and always the previous one (for a rollback by hand).
# shellcheck disable=SC2012 # release names are commit SHAs, and ls sorts by time
ls -1dt "$root"/releases/*/ | tail -n +6 | while read -r old_release; do
	old_release=${old_release%/}
	[[ $old_release == "$release" || $old_release == "$previous" ]] || rm -rf "$old_release"
done
log "Done"
