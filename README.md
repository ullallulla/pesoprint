# Pesoprint

_Working name._ An online shop for 3D printing: free model downloads, paid digital files, and physical prints in the customer's choice of colour and material.

This is a rebuild of an earlier prototype ([review](docs/prototype-review.md)). The full roadmap is in [docs/plan.md](docs/plan.md). Current milestone: **M6 – Launch readiness**. Production runs on a homelab VM, hidden behind a login gate until go-live (see [Production](#production)).

## Architecture

```
Browser ──► web (React Router v8, SSR) ──HTTP──► api (Hono) ──► Postgres
```

| Path              | What it is                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `apps/api`        | Hono API with OpenAPI docs, Drizzle ORM + Postgres. Owns all data and business rules.         |
| `apps/web`        | React Router (framework mode, server-rendered) + Tailwind + shadcn/ui. Talks only to the API. |
| `packages/shared` | Zod schemas and types shared by both apps (TypeScript source, no build step).                 |

Tooling is [Vite+](https://viteplus.dev) (`vp`): Vite, Vitest, Oxlint, Oxfmt, tsdown and a task runner in one CLI, configured in the root `vite.config.ts`.

## Requirements

- Node.js 26 (pinned in `.node-version`)
- [Vite+ CLI](https://viteplus.dev/guide/) (`vp`); it uses pnpm (version pinned in `package.json`)
- Docker, for the local Postgres database

## Getting started

```bash
vp install                              # install dependencies
cp apps/api/.env.example apps/api/.env  # API settings (database URLs, Clerk secret key)
cp apps/web/.env.example apps/web/.env  # web settings (API URL, Clerk keys)
vp run db:up                            # start Postgres (dev + test databases)
vp run db:migrate                       # apply database migrations
vp run db:seed                          # optional: sample categories and products
vp run dev                              # start the API (:3001) and the web app (:5173)
```

`vp run dev` doesn't apply migrations. After pulling changes that add one (a new file in `apps/api/drizzle/`), run `vp run db:migrate` again. Staging and production apply them on start.

- Web app: http://localhost:5173
- API docs (Swagger UI): http://localhost:3001/api/docs
- OpenAPI document: http://localhost:3001/api/openapi.json

## Authentication (Clerk)

Sign-in is handled by [Clerk](https://clerk.com). The web app sends the user's session token to the API (`Authorization: Bearer …`), and the API verifies it and checks the role.

One-time setup in the [Clerk Dashboard](https://dashboard.clerk.com):

1. **API keys**: copy the publishable key and secret key into `apps/web/.env` and `apps/api/.env`.
2. **Sessions → Customize session token**: add this claim, so the API can read roles without calling Clerk:
    ```json
    { "metadata": "{{user.public_metadata}}" }
    ```
3. **Users → your user → Public metadata**: set `{ "role": "admin" }` to get into `/admin`. Sign out and in again so your token picks up the role.
4. **Webhooks** (optional locally): add an endpoint `https://<public-url>/api/webhooks/clerk` with the `user.created`, `user.updated` and `user.deleted` events, and put its signing secret in `CLERK_WEBHOOK_SIGNING_SECRET`. Locally you need a tunnel (e.g. `cloudflared tunnel --url http://localhost:3001`). The webhook keeps the `users` table in sync. For accounts made before the webhook existed, or while it was down, run `vp run users:sync` (see below).

| Endpoint                   | Access                                  |
| -------------------------- | --------------------------------------- |
| `GET /api/me`              | Any signed-in user                      |
| `GET /api/admin/overview`  | Admins only (`metadata.role = "admin"`) |
| `POST /api/webhooks/clerk` | Clerk only (signature-verified)         |

## File storage (Cloudflare R2)

Product images, 3D previews and model files are stored in two S3-compatible buckets. Browsers upload straight to storage with presigned URLs, so large files never pass through the API. Without the `S3_*` settings the API still runs, and the upload endpoints answer 503.

| Bucket  | Holds                                 | Access                                                     |
| ------- | ------------------------------------- | ---------------------------------------------------------- |
| public  | Images and 3D previews (`.glb`)       | Public reads, served from `PUBLIC_ASSETS_URL`              |
| private | Model downloads (STL, 3MF, STEP, OBJ) | Never public; downloads go through short-lived signed URLs |

3D previews are public, so they must be decimated (low-poly) versions, never the full-resolution model.

Setup in the Cloudflare dashboard (R2 Object Storage):

1. Create two buckets, e.g. `pesoprint-dev-public` and `pesoprint-dev-private`.
2. Public bucket → Settings → Public access: enable the `r2.dev` URL (fine for development) or connect a custom domain. That URL is `PUBLIC_ASSETS_URL`.
3. On **both** buckets → Settings → CORS policy, allow uploads from the web app (add your production origin later). The public bucket also needs `GET` so the 3D viewer can load previews:

    ```json
    [
        {
            "AllowedOrigins": ["http://localhost:5173"],
            "AllowedMethods": ["GET", "PUT"],
            "AllowedHeaders": ["content-type"],
            "MaxAgeSeconds": 3600
        }
    ]
    ```

4. R2 → Manage API tokens → Create an **Object Read & Write** token limited to the two buckets. Copy the access key id and secret into `apps/api/.env`, and the S3 endpoint (`https://<account id>.r2.cloudflarestorage.com`) into `S3_ENDPOINT`.

## Payments (Stripe)

Paid files are bought through [Stripe Checkout](https://docs.stripe.com/payments/checkout), Stripe's hosted payment page. The API creates a pending order and a Checkout Session with the order's amounts, and the buyer pays on Stripe. Stripe then reports the payment to `POST /api/webhooks/stripe`. When the buyer comes back to `/orders/<id>`, the API also asks Stripe for the session, so the order is settled even before the webhook arrives. Without `STRIPE_SECRET_KEY` the API still runs, and checkout answers 503.

Setup (test mode needs no company details):

1. Create a Stripe account, and keep the dashboard in **test mode**.
2. **Developers → API keys**: copy the secret key (`sk_test_…`) into `STRIPE_SECRET_KEY` in `apps/api/.env`.
3. **Webhooks**, optional locally (the order page asks Stripe anyway):
    - Locally: install the [Stripe CLI](https://docs.stripe.com/stripe-cli), run `stripe login`, then `stripe listen --forward-to localhost:3001/api/webhooks/stripe`. It prints a `whsec_…` secret for `STRIPE_WEBHOOK_SECRET`.
    - Staging: **Developers → Webhooks → Add endpoint** `https://<api host>/api/webhooks/stripe` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` and `charge.refund.updated` (the last two record refunds, including ones made in Stripe's dashboard). Put its signing secret in the API's `STRIPE_WEBHOOK_SECRET`.

Stripe sends buyers back to the first origin in `WEB_ORIGINS`. To pay in test mode, use the card `4242 4242 4242 4242` with any future expiry date and any CVC. Other [test cards](https://docs.stripe.com/testing) decline or ask for 3-D Secure.

| Endpoint                    | Access                           |
| --------------------------- | -------------------------------- |
| `POST /api/cart/quote`      | Anyone (prices the cart)         |
| `POST /api/checkout`        | Any signed-in user               |
| `GET /api/orders/{id}`      | The buyer                        |
| `POST /api/webhooks/stripe` | Stripe only (signature-verified) |

## Everyday commands

| Command                                     | What it does                                                         |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `vp run dev`                                | Run the API and the web app in watch mode                            |
| `vp check`                                  | Format, lint and type-check everything (`vp check --fix` fixes)      |
| `vp run test`                               | Run all tests (API database tests need `vp run db:up`)               |
| `vp run build`                              | Production build of every package                                    |
| `vp run ready`                              | Everything CI runs: check, test, build                               |
| `vp -C apps/api run db:generate --name <x>` | Create a migration after editing `apps/api/src/db/schema.ts`         |
| `vp run db:migrate`                         | Apply pending migrations                                             |
| `vp run db:seed`                            | Add or refresh the sample catalogue (local database only, see below) |
| `vp run users:sync`                         | Copy every Clerk user into the `users` table (see below)             |
| `vp run storage:cleanup`                    | List (or `--delete`) files in R2 that no product uses (see below)    |
| `vp run db:down`                            | Stop Postgres (data is kept in a Docker volume)                      |

**Seeding staging.** The seed refuses any database that isn't on this computer unless you pass `--allow-remote`, and
`--env <file>` uses another settings file instead of `apps/api/.env` (files named `.env.*` are gitignored). Put the
staging `DATABASE_URL`, `CLERK_SECRET_KEY` and `S3_*`/`PUBLIC_ASSETS_URL` values in `apps/api/.env.staging`, then:

```bash
vp run db:seed --env .env.staging --allow-remote
```

It replaces only the sample products; products created in the admin are left alone.

**Syncing users.** `vp run users:sync` copies every user from Clerk into the database, as the webhook does for each
change. The Clerk key and the database come from the same settings file, so `--env .env.staging` syncs staging's Clerk
into staging's database. Users that no longer exist in Clerk are only listed; add `--prune` to delete them (a user who
created products can't be deleted, and is reported instead).

**Cleaning up storage.** `vp run storage:cleanup` lists files in the buckets that no product uses: uploads that were
never attached, and files left behind when deleting them failed. It only lists them; add `--delete` to delete them.
It only looks under `products/` and `seed/`, keeps files younger than 24 hours (an upload may be in progress), and
refuses to delete anything while files the database uses are missing from storage, which would suggest the database
and the buckets are from different environments. Use `--env .env.staging` for staging, as with the other commands.

The web app's route types are generated by React Router. If `vp check` complains about `./+types/...` imports, run `vp run --filter @app/web typegen` (or start the dev server once).

A pre-commit hook (`.vite-hooks/pre-commit`) runs `vp check --fix` on staged files.

## Docker

Both apps have production images, built from the repository root:

```bash
docker build -f apps/api/Dockerfile -t pesoprint-api .
docker build -f apps/web/Dockerfile -t pesoprint-web .

docker run --rm -e DATABASE_URL=postgres://... -e CLERK_SECRET_KEY=sk_... pesoprint-api node dist/migrate.mjs
docker run -p 3001:3001 -e DATABASE_URL=postgres://... -e CLERK_SECRET_KEY=sk_... \
    -e WEB_ORIGINS=https://<web-origin> -e CLERK_WEBHOOK_SIGNING_SECRET=whsec_... pesoprint-api
docker run -p 3000:3000 -e API_URL=http://<api-host>:3001 \
    -e VITE_CLERK_PUBLISHABLE_KEY=pk_... -e CLERK_SECRET_KEY=sk_... pesoprint-web
```

On hosts that start a container with a single command and have no pre-deploy step (e.g. Render's free plan), use
`node dist/start.mjs` as the API's command: it applies pending migrations, then starts the server. Run only one API
instance that way. If the host puts an idle API to sleep and only wakes it for requests from outside (Render's free
plan), set `API_WAKE_URL` on the web service to the API's public `/api/health` URL: the "starting up" page then asks
the visitor's browser to wake it.

The web server answers `/healthz` (the server itself is running, for the container's health check) and `/readyz`
(the API and its database answer too, for an uptime monitor: `200 ok` with an `X-Pesoprint-Ready: 1` header, otherwise
`503`).

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `master` and every pull request: `vp check`, all tests (with a Postgres service for the database tests), the production builds, and both Docker image builds.

On `master`, once those pass, CI publishes both images to GitHub's container registry:
`ghcr.io/ullallulla/pesoprint-api` and `ghcr.io/ullallulla/pesoprint-web`, tagged `sha-<full commit SHA>` (what a
deploy uses) and `master` (the latest). The commit is also built into each image as `SENTRY_RELEASE`. Pull requests
only build the images. Both packages are public, so pulling needs no login:

```bash
docker pull ghcr.io/ullallulla/pesoprint-api:master
```

## Production

Production runs the two GHCR images with the compose stack in [`deploy/`](deploy/): Caddy as the one router, the web
server, the API, and the optional Cloudflare Tunnel, Postgres and the two backup jobs (compose profiles). The plan,
with the reasons, is [docs/production-environment3.md](docs/production-environment3.md).

Today it runs on a homelab VM: `https://pesoprint.allulab.eu` through a Cloudflare Tunnel, behind a Cloudflare Access
login gate, with Stripe in a sandbox, until go-live. Stripe and Clerk reach the webhooks at
`https://pesoprint-hooks.allulab.eu`, where Caddy lets through only those two paths.

| Host                     | `COMPOSE_PROFILES` (in `/opt/pesoprint/.env`) | In front of Caddy                                                            |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------- |
| Homelab VM (today)       | `tunnel,postgres,backup,files-backup`         | Cloudflare Tunnel; no open ports                                             |
| VPS                      | the same, or tls mode instead of `tunnel`     | The tunnel, or Cloudflare's proxy → Caddy on 443 with the Origin certificate |
| Cloud VM with managed DB | `postgres` left out, `DATABASE_URL` set       | The tunnel, or the provider's load balancer → Caddy on 80                    |

### Setting up a host

1. **The machine.** A VM that runs nothing else (the homelab one: Ubuntu 24.04 LTS; the plan sizes it at 2 vCPU,
   4 GB RAM and 40 GB disk; "Start at boot" on). Docker Engine with the Compose and Buildx plugins from
   [Docker's apt repository](https://docs.docker.com/engine/install/ubuntu/), and `unattended-upgrades`.
2. **The network.** A firewall **outside** the VM (Proxmox's, or the VPS provider's), because Docker's own rules get
   around one inside it. With the tunnel: nothing inbound at all; outbound the internet, but not the home LAN
   (`10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16` dropped, with the router's DNS allowed above those rules).
   SSH only through [Tailscale](https://tailscale.com) (the VM tagged `tag:pesoprint-prod`), keys only.
3. **The `deploy` user**, in the `docker` group, owning `/opt/pesoprint`. Deploys log in as `deploy` with a key that
   may only run the deploy script. Install it, and allow the workflow's key:

    ```bash
    sudo adduser --disabled-password --gecos '' deploy
    sudo usermod -aG docker deploy
    sudo install -d -o deploy -g deploy -m 750 /opt/pesoprint
    sudo install -d -o root -g root -m 755 /opt/pesoprint/bin
    curl -fsSL https://raw.githubusercontent.com/ullallulla/pesoprint/master/deploy/bin/deploy-wrapper |
        sudo install -o root -g root -m 755 /dev/stdin /opt/pesoprint/bin/deploy-wrapper
    # ~deploy/.ssh/authorized_keys (mode 600, owned by deploy), one line:
    # restrict,command="/opt/pesoprint/bin/deploy-wrapper" ssh-ed25519 AAAA… github-deploy
    ```

4. **The settings.** `/opt/pesoprint/.env` (the host) and one file per service in `/opt/pesoprint/env/`, copied from
   the examples:

    ```bash
    mkdir -p /tmp/pp
    curl -fsSL https://codeload.github.com/ullallulla/pesoprint/tar.gz/master |
        tar -xz -C /tmp/pp --strip-components=2 --wildcards '*/deploy/.env.example' '*/deploy/env/'
    sudo install -d -o deploy -g deploy -m 700 /opt/pesoprint/env
    sudo install -o deploy -g deploy -m 600 /tmp/pp/.env.example /opt/pesoprint/.env
    for f in api web postgres backup files-backup cloudflared; do
        sudo install -o deploy -g deploy -m 600 /tmp/pp/env/$f.env.example /opt/pesoprint/env/$f.env
    done
    ```

    Edit them with `sudoedit`, and fill in **only** the empty values and the `<…>`/`...` placeholders. **Every other
    line stays**: those values are already right, and a missing line breaks something that may only show up later
    (the first production deploy failed several times on lines that had gone missing). Before the first deploy,
    compare the setting names with the examples (it prints nothing when every setting is there):

    ```bash
    for f in api web postgres backup files-backup cloudflared; do
        echo "== $f"
        diff <(grep -oE '^[A-Z0-9_]+=' /tmp/pp/env/$f.env.example | sort) \
            <(sudo grep -oE '^[A-Z0-9_]+=' /opt/pesoprint/env/$f.env | sort)
    done
    rm -rf /tmp/pp
    ```

    Postgres reads `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` **only when it creates its database**, on
    the first start. If one was wrong then, fixing the file changes nothing: while the database is still empty,
    remove it (`sudo docker rm -f pesoprint-prod-postgres-1 && sudo docker volume rm pesoprint-prod_postgres-data`)
    and deploy again. To change the password later, see [Rotating secrets](#rotating-secrets).

5. **The files backup's destination** (`FILES_BACKUP_DIR` in `.env`, `/mnt/pesoprint-files-backup`), writable by the
   backup image's user: `sudo chown 70:70 /mnt/pesoprint-files-backup`. On the homelab it's a directory on the
   Proxmox host, shared into the VM with virtiofs (Datacenter → Resource Mappings → Directory Mappings, then the VM's
   Hardware → Add → Virtiofs) and mounted with
   `pesoprint-files-backup /mnt/pesoprint-files-backup virtiofs defaults,nofail 0 0` in `/etc/fstab`. Elsewhere, any
   rclone remote (`FILES_BACKUP_DEST` in `files-backup.env`).
6. **The outside services**, listed in §12 of the plan: the Cloudflare tunnel (its public hostnames point to
   `http://caddy:80`) and Access gate (with a bypass for `/readyz`), the R2 buckets and their three tokens, Clerk's
   production instance, Stripe, Resend, Sentry, the UptimeRobot monitor on `/readyz`, two healthchecks.io checks, and
   the GitHub environment `production` (master only) with the secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`,
   `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`.

On the host, `/opt/pesoprint` then looks like this after a deploy:

```
/opt/pesoprint/
├── .env                  host settings: profiles, host names, image repository
├── env/<service>.env     one per service, mode 600
├── bin/deploy-wrapper    installed by hand; everything else comes with each release
├── releases/<sha>/       deploy/ at each deployed commit (the five newest are kept)
├── current -> releases/<sha>
└── deploy.log            one line per deploy: when, which commit, what happened
```

### Deploying

1. Merge into `master`, and wait for **CI** to finish: it builds the images the deploy needs.
2. GitHub → **Actions → Deploy production → Run workflow**. Leave the commit empty for the latest `master`, or give a
   full SHA (to go back to an earlier commit, for example).

The workflow checks that the commit is on `master`, that CI passed and that both images are public, joins the tailnet
and sends the SHA to the VM. There `deploy.sh` backs up the database (`pre-deploy/`), runs the migrations, starts the
new release and checks the API's `/api/health` and `/readyz` through Caddy. If those checks fail, it goes back to the
previous release by itself and the run fails. **Migrations aren't undone**, so a migration must keep working with the
previous release. The run's Summary page shows the deploy's output.

By hand on the VM: `sudo -u deploy /opt/pesoprint/bin/deploy-wrapper <full sha>`.

### Running things on the host

Everything goes through the release's `bin/compose`, as `deploy`:

```bash
sudo -u deploy /opt/pesoprint/current/bin/compose ps
sudo -u deploy /opt/pesoprint/current/bin/compose logs -f --tail 100 api
sudo -u deploy /opt/pesoprint/current/bin/compose up -d --no-deps --force-recreate api   # after editing env/api.env
```

A container keeps the settings it was created with, so after changing an env file, recreate that service (`restart`
isn't enough). `--no-deps` leaves Postgres alone.

### Backups

| What                          | When                                                    | Where                                                       | Kept                                                                |
| ----------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Database (`pg_dump` + counts) | nightly at `BACKUP_AT` (03:00), and before every deploy | R2 bucket `pesoprint-prod-backups`: `daily/`, `pre-deploy/` | 35 days (`daily/`), 14 days (`pre-deploy/`); bucket lock of 14 days |
| R2 buckets (all files)        | nightly at `FILES_BACKUP_AT` (03:30)                    | `FILES_BACKUP_DIR`: `current/<bucket>/` (off Cloudflare)    | deleted or overwritten files 30 days in `deleted/<day>/`            |

Database backups are encrypted with `age`. The private key is in the password manager and on one offline copy, and is
on the host only during a restore. Each job pings its own healthchecks.io check (or its `/fail` URL), so a night
without a backup sends an email. A night the VM is off is skipped, not caught up. To run one now:

```bash
sudo -u deploy /opt/pesoprint/current/bin/compose run --rm backup db daily
sudo -u deploy /opt/pesoprint/current/bin/compose run --rm files-backup files
```

### Restore

**The restore test**, every few months and after a Postgres upgrade. It restores the newest `daily/` dump into a
throwaway Postgres, compares the row counts with the dump's manifest, checks that the running API image has no
migrations to apply and starts against it, and restores one file from the files backup and compares it with R2. It
never touches the live database.

```bash
# On the desktop: bring the age private key over for the test.
scp ~/pesoprint-backup-key.txt <you>@<host>:/tmp/backup-key.txt
# On the VM:
sudo install -o deploy -g deploy -m 600 /tmp/backup-key.txt /opt/pesoprint/restore-key.txt && rm /tmp/backup-key.txt
sudo -u deploy /opt/pesoprint/current/restore.sh \
    --backup-env /opt/pesoprint/env/backup.env --identity /opt/pesoprint/restore-key.txt \
    --files-env /opt/pesoprint/env/files-backup.env --files-dir /mnt/pesoprint-files-backup
sudo rm /opt/pesoprint/restore-key.txt
```

Record each run here:

| Date       | Dump                       | API image      | File check                                             | Took                                          |
| ---------- | -------------------------- | -------------- | ------------------------------------------------------ | --------------------------------------------- |
| 2026-11-22 | `daily/2026-11-22T181617Z` | `sha-adfec49…` | one STL from the private bucket, same SHA-256 as in R2 | 8 s (pg_restore 0 s; a nearly empty database) |

**Restoring the live database** (bad data, or a new host). On a new host, first set it up as above with the same
settings and deploy the commit that was running. Then, with the private key brought over as in the test but owned by
the backup image's user:

```bash
sudo install -o 70 -g 70 -m 400 /tmp/backup-key.txt /opt/pesoprint/restore-key.txt && rm /tmp/backup-key.txt
c=/opt/pesoprint/current/bin/compose
# Pick the dump: sudo -u deploy $c run --rm --no-deps --entrypoint rclone backup lsf r2:pesoprint-prod-backups/daily
dump=daily/<stamp>
sudo -u deploy $c stop api web
sudo -u deploy $c run --rm --no-deps -v /opt/pesoprint/restore-key.txt:/run/age-identity:ro --entrypoint sh backup -c '
    set -e
    rclone copyto "$BACKUP_TARGET/$0.dump.age" /tmp/db.dump.age
    age --decrypt --identity /run/age-identity --output /tmp/db.dump /tmp/db.dump.age
    pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$DATABASE_URL" /tmp/db.dump
' "$dump"
sudo -u deploy $c run --rm api node dist/migrate.mjs
sudo -u deploy $c up -d
sudo rm /opt/pesoprint/restore-key.txt
```

`pg_restore --clean` replaces everything in the database with the dump, so everything since the dump is lost (orders
are also in Stripe). This was rehearsed against a throwaway database, not yet on the host. If R2 itself loses files,
copy them back from `FILES_BACKUP_DIR` (`current/<bucket>/`) with rclone and a token that may write to the bucket.

### Rotating secrets

Make the new value, put it in the env file(s), recreate the services that read it
(`sudo -u deploy /opt/pesoprint/current/bin/compose up -d --no-deps --force-recreate <services>`), then revoke the
old one.

| Secret                                        | New one from                                                     | Files → services                                       |
| --------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| `INTERNAL_API_SECRET`                         | `openssl rand -hex 32`                                           | api.env, web.env → `api web`                           |
| `IP_HASH_SECRET`                              | `openssl rand -hex 32` (download-limit counts start over)        | api.env → `api`                                        |
| `CLERK_SECRET_KEY`                            | Clerk (Production) → API keys                                    | api.env, web.env → `api web`                           |
| `CLERK_WEBHOOK_SIGNING_SECRET`                | Clerk → Webhooks → the endpoint → Signing Secret                 | api.env → `api`                                        |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe → the restricted key → Roll / the webhook endpoint        | api.env → `api`                                        |
| `RESEND_API_KEY`                              | Resend → API Keys (Sending access, `pesoprint.allulab.eu`)       | api.env → `api`                                        |
| R2 tokens                                     | R2 → Manage API tokens → Roll                                    | api.env → `api`; backup.env; files-backup.env          |
| `TUNNEL_TOKEN`                                | Zero Trust → the tunnel → Rotate token                           | cloudflared.env → `cloudflared`                        |
| `AGE_RECIPIENT`                               | `age-keygen` (keep the old private key until its backups expire) | backup.env → `backup`                                  |
| The Postgres password                         | `openssl rand -hex 24`, then `ALTER ROLE` (below)                | postgres.env, api.env, backup.env → `api backup`       |
| Deploy key, Tailscale OAuth client, host key  | `ssh-keygen` / Tailscale → OAuth clients / `ssh-keyscan`         | `authorized_keys` and the GitHub environment's secrets |

The Postgres password lives in the database, so change it there first:
`sudo -u deploy /opt/pesoprint/current/bin/compose exec postgres psql -U pesoprint -c "ALTER ROLE pesoprint PASSWORD '<new>'"`.
