# Pesoprint – Production environment plan (M6), version 3

_Drafted 2026-11-19 from [production-environment1.md](./production-environment1.md), [production-environment2.md](./production-environment2.md) and their [review](./environment-review.md). Plan 1 is the base. The changes come from the review, plus one more goal: the same stack must run on the homelab, a VPS or a cloud VM. Covers the "Own domain. Production environment …", "Sentry, uptime monitoring, database backups" and "Production deploy" items of M6 in [plan.md](./plan.md). Built so far: code steps 1–4 of §13 (the stack is in [`deploy/`](../deploy/))._

## 1. Summary of the decisions

| Topic             | Decision                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portability       | Two Docker images (api, web) from GHCR and one `docker-compose.prod.yml`. Pieces that only some hosts need are **compose profiles**. Moving hosts means a new `.env` with different profiles and new DNS records; the app doesn't change                 |
| First host        | The **homelab**: a new, dedicated Debian VM on **Proxmox** that runs nothing else                                                                                                                                                                        |
| Ingress           | **Caddy on every host** is the stack's one router: it decides which paths are public and gives the app the same headers everywhere. In front of it: **Cloudflare Tunnel** on the homelab (no open ports); on a VPS or cloud VM, a tunnel or Caddy on 443 |
| Cloudflare        | Always in front until go-live, because the **Access** login gate lives there                                                                                                                                                                             |
| Hostnames         | Flat names under `allulab.eu`, so Cloudflare's free certificate covers them: `pesoprint.allulab.eu`, `pesoprint-hooks.allulab.eu`, `pesoprint-files.allulab.eu`                                                                                          |
| Public API        | **Only the webhooks.** The browser never calls the API itself; everything else on the hooks hostname answers 404                                                                                                                                         |
| Database          | **Postgres inside the stack** (profile `postgres`). A managed database (Neon, RDS, Cloud SQL) works by turning the profile off and setting `DATABASE_URL`                                                                                                |
| Network isolation | A firewall **outside the VM** (Proxmox firewall; on a VPS the provider's firewall): no inbound traffic at all with the tunnel, and no traffic to the home LAN                                                                                            |
| Remote access     | **Tailscale** on the VM. SSH listens only on the tailnet                                                                                                                                                                                                 |
| How "live"        | **Up, but hidden:** Cloudflare Access in front of the shop, Stripe in test mode through a **Stripe Sandbox**. Go-live (live keys, gate removed) is a later step, after VAT, company form and the legal pages                                             |
| Deploys           | **Manual promote.** CI pushes images for every master commit. A "Deploy production" GitHub Action (you pick the commit) connects over Tailscale and runs the deploy on the VM                                                                            |
| Monitoring        | **Sentry** (EU, free plan) for errors. One external monitor on **`/readyz`** (web → API → database). A heartbeat for the nightly backup                                                                                                                  |
| Backups           | Nightly `age`-encrypted `pg_dump` to an R2 bucket with a **bucket lock**, plus a dump before every deploy. Nightly copy of the production R2 buckets **off Cloudflare**. A restore test now and every few months                                         |
| Scaling           | **One instance** of web and API, no load balancer. The app keeps shared state in Postgres, so it can scale later. Options in §17 (optional, for later)                                                                                                   |
| Staging           | **Unchanged** (Render free + Neon + R2 staging)                                                                                                                                                                                                          |
| Repository        | **Public.** GHCR images are public too, so hosts pull them without a token. Nothing that identifies the home setup goes into the repo                                                                                                                    |
| Sign-in           | Clerk **production instance**, with **email** and **Google**                                                                                                                                                                                             |

## 2. Architecture

```
                 ┌───────────────────────────── Cloudflare ─────────────────────────────┐
Visitor ─HTTPS─► │ pesoprint.allulab.eu        Access login gate (bypass: /readyz)       │
Stripe, Clerk ─► │ pesoprint-hooks.allulab.eu  no gate                                    │
                 │ pesoprint-files.allulab.eu ──► R2 public bucket                         │
                 └───────────────┬──────────────────────────────────────────────────────┘
                                 │ Tunnel (outbound from the VM; no open port at home)
                 ┌───────────────▼────────────── VM "pesoprint-prod" ────────────────────┐
                 │ firewall outside the VM: no inbound; no home LAN                         │
                 │ docker compose:                                                         │
                 │   cloudflared ──► caddy :80 ──► web :3000 ──► api :3001 ──► postgres    │
                 │                        └─(hooks host: /api/webhooks/* only)─► api      │
                 │   backup        nightly pg_dump → age → R2 backups bucket               │
                 │   files-backup  nightly rclone of the R2 buckets → off-Cloudflare copy  │
                 │ tailscale (SSH for you and for the deploy workflow)                     │
                 └─────────────────────────────────────────────────────────────────────────┘
GitHub Actions: CI ──push──► GHCR (public images, Sentry source maps uploaded from the same build)
                "Deploy production" ──Tailscale SSH──► VM: deploy <sha>
API ──► R2 (prod buckets), Stripe (sandbox), Clerk (production), Resend, Sentry
Browser ──► R2 directly: presigned uploads (admin), signed download links, public images
```

- No service publishes a port in tunnel mode. Only `cloudflared` can reach Caddy, and only Caddy can reach web and the API.
- The web server reaches the API on the internal network (`API_URL=http://api:3001`), not through Cloudflare.
- The tunnel's free-plan limits (100 MB request bodies, about 100 s per request) don't matter here: uploads and downloads go straight to R2.

### 2.1 The same stack on other hosts

| Host                                         | Profiles                                       | In front of Caddy                                                                                              |
| -------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Homelab VM                                   | `tunnel`, `postgres`, `backup`, `files-backup` | Cloudflare Tunnel                                                                                              |
| VPS (e.g. Hetzner)                           | the same, or tls mode instead of `tunnel`      | Tunnel, or Cloudflare proxy → Caddy on 443 (Origin certificate, provider firewall open to Cloudflare IPs only) |
| Cloud VM (EC2, GCE, Azure)                   | the same; `postgres` off for a managed DB      | Tunnel, or the provider's load balancer → Caddy :80                                                            |
| Managed containers (Cloud Run, App Runner …) | not this compose file                          | The platform's ingress. Run the same images, keep the Caddy rules as the platform's routing. Not planned       |

**Rule while the gate is needed:** traffic must go through Cloudflare (tunnel or proxied DNS). With DNS-only records the Access gate silently disappears.

## 3. Hostnames and DNS (Cloudflare zone `allulab.eu`)

Cloudflare's free Universal SSL certificate covers `allulab.eu` and `*.allulab.eu`, **one level deep only**. A proxied `api.pesoprint.allulab.eu` would get no certificate at Cloudflare's edge without Advanced Certificate Manager (about $10 a month). That's why the names are flat; don't "tidy" them into `*.pesoprint.allulab.eu`.

| Hostname                                                                                                                       | Points to                     | Proxy        | Purpose                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `pesoprint.allulab.eu`                                                                                                         | the tunnel (CNAME, automatic) | proxied      | The shop. Behind Access until go-live                                                |
| `pesoprint-hooks.allulab.eu`                                                                                                   | the tunnel (CNAME, automatic) | proxied      | Stripe and Clerk webhooks only                                                       |
| `pesoprint-files.allulab.eu`                                                                                                   | R2 custom domain (set by R2)  | proxied      | Public bucket: images, GLB previews, free files                                      |
| Clerk records (`clerk.`, `accounts.`, `clkmail.`, DKIM CNAMEs under `pesoprint.allulab.eu`, as the Clerk dashboard lists them) | Clerk                         | **DNS only** | Clerk's frontend API, account portal and its emails. Clerk issues their certificates |
| Resend records (already there)                                                                                                 | Resend                        | DNS only     | Order emails from `orders@pesoprint.allulab.eu`                                      |

Zone settings: SSL/TLS mode **Full (strict)** (matters only in `tls` mode), **Always Use HTTPS** on, minimum TLS 1.2.

## 4. The homelab VM

**VM:** Debian 13 (trixie, the same base as the images). 2 vCPU, 4 GB RAM (the API makes GLB previews from STLs in memory), 40 GB disk. QEMU guest agent on, "Start at boot" on, a fixed IP (DHCP reservation).

**Software:** Docker Engine + Compose plugin, Tailscale, `unattended-upgrades`. A `deploy` user that owns `/opt/pesoprint` and is in the `docker` group. Nothing else.

**Proxmox firewall** (enabled at datacenter, node and VM level, and `firewall=1` on the VM's network device):

- In: **nothing.** The tunnel and Tailscale both connect outward.
- Out: the internet allowed. The home LAN ranges (e.g. `192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`) dropped, apart from the router's DNS if the VM uses it.
- Because the firewall is outside the VM, Docker's own iptables rules can't open anything by accident. On a VPS, use the provider's firewall for the same reason (Docker bypasses `ufw`).

**Router:** no port forwards.

**SSH:** keys only, no root login, listening only on the Tailscale address. The deploy workflow's key in `authorized_keys`:

```
restrict,command="/opt/pesoprint/bin/deploy-wrapper" ssh-ed25519 AAAA… github-deploy
```

The wrapper reads the SHA from `$SSH_ORIGINAL_COMMAND`, accepts exactly 40 lowercase hex characters and nothing else, and runs the deploy (§7.3).

**Tailscale ACL:** the VM is `tag:pesoprint-prod`, the CI runner `tag:ci`. `tag:ci` may reach only `tag:pesoprint-prod:22`. `tag:pesoprint-prod` may reach nothing on the tailnet. Your own devices may reach it on 22.

## 5. The compose stack (`deploy/` in the repo)

| File                      | What it is                                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.prod.yml` | Services `caddy`, `web`, `api`, and the profiled `cloudflared` (`tunnel`), `postgres`, `backup`, `files-backup`. Images pinned by `${IMAGE_TAG}`. Restart `unless-stopped`, health checks, **log limits on every service** |
| `docker-compose.tls.yml`  | tls mode: publishes 443 and mounts the Origin certificate. Turned on with `COMPOSE_FILE` in the host's `.env` (a profile can't add ports to a service)                                                                     |
| `Caddyfile`               | The routing and header rules (§5.1). Listens on `:80` behind a tunnel or load balancer, on `:443` with the Origin certificate in `tls` mode                                                                                |
| `env/*.example`           | One env file per service (`api.env`, `web.env`, `postgres.env`, `backup.env`, `files-backup.env`, `cloudflared.env`), placeholders only. The web container never sees database or R2 credentials                           |
| `.env.example`            | Host settings: `COMPOSE_PROFILES`, `COMPOSE_FILE` (tunnel or tls mode), `TRUSTED_PROXIES`, host names, image repository. Not the image tag: `bin/compose` takes it from the release                                        |
| `bin/deploy-wrapper`      | The small, stable entry point for SSH (§7.3). Changes rarely and is installed by hand                                                                                                                                      |
| `bin/compose`             | `docker compose` for one release: runs in `releases/<sha>/` with the host's `.env`, the `env/` files and `IMAGE_TAG=sha-<sha>`. For anything by hand: `/opt/pesoprint/current/bin/compose ps`                              |
| `deploy.sh`               | The deploy steps, downloaded per release (§7.3)                                                                                                                                                                            |
| `backup/`, `restore.sh`   | The backup jobs and the restore script (§8). `backup/` is a small image (`postgres:18-alpine` + `age` + `rclone`) built on the host, not published                                                                         |

Every service gets:

```yaml
logging:
    driver: local # rotates: 5 files × 20 MB by default
```

Postgres: `postgres:18` (the same major version as staging on Neon), data in a named volume, no published port.

On the VM: `/opt/pesoprint/releases/<sha>/` holds each release's `deploy/` files, `current` links to the running one, `env/` holds the real values (`chmod 600`, owner `deploy`), and `deploy.log` records what was deployed when.

### 5.1 Caddy: one set of rules for every host

**Routing:**

- `pesoprint.allulab.eu` → `web:3000`.
- `pesoprint-hooks.allulab.eu`: `/api/webhooks/stripe` and `/api/webhooks/clerk` → `api:3001`, request body untouched (the signatures cover the exact bytes). **Everything else: 404**, including `/api/docs`, `/api/openapi.json`, `/api/catalog/*` and `/api/downloads/*`.
- Any other host: 404.

**Headers the app relies on.** Today the API and web take the visitor's IP from the **last `X-Forwarded-For` entry** (`apps/api/src/lib/client-ip.ts:22`, `apps/web/app/lib/downloads.server.ts:14`), and the web server needs `X-Forwarded-Proto: https` for form posts (`apps/web/server.ts:22`). Caddy makes these the same on every host:

- `trusted_proxies static {$TRUSTED_PROXIES}`: the addresses allowed to tell Caddy the client IP and scheme. Tunnel or load balancer mode: `private_ranges` (only `cloudflared` or the load balancer can reach Caddy). `tls` mode behind Cloudflare: Cloudflare's published IP ranges.
- `client_ip_headers CF-Connecting-IP X-Forwarded-For`, then upstream `X-Forwarded-For {client_ip}`, a single trusted value.
- `X-Forwarded-Proto` is kept from trusted proxies (the tunnel sends `https`) and is `https` when Caddy terminates TLS itself.

No app change is needed for this. Verify on the running stack that download logs and rate limits see your real IP, and that a form post works.

## 6. Environment variables (production)

Real values live only on the VM and, where the workflow needs them, as GitHub environment secrets. Generate new secrets; don't reuse staging's.

**api.env**

| Variable                                    | Production value                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`                                  | `production` (already set in the image)                                |
| `DATABASE_URL`                              | `postgres://pesoprint:<strong password>@postgres:5432/pesoprint`       |
| `CLERK_SECRET_KEY`                          | `sk_live_…` (Clerk production instance)                                |
| `CLERK_WEBHOOK_SIGNING_SECRET`              | from the production Clerk webhook endpoint                             |
| `WEB_ORIGINS`                               | `https://pesoprint.allulab.eu`                                         |
| `INTERNAL_API_SECRET`                       | new `openssl rand -hex 32` (same value in web.env)                     |
| `IP_HASH_SECRET`                            | new `openssl rand -hex 32`                                             |
| `STRIPE_SECRET_KEY`                         | the production Sandbox's `sk_test_…`; `sk_live_…` at go-live           |
| `STRIPE_WEBHOOK_SECRET`                     | from the Sandbox's endpoint; a new live endpoint's secret at go-live   |
| `RESEND_API_KEY`                            | a new production key (Sending access, domain `pesoprint.allulab.eu`)   |
| `EMAIL_FROM` / `EMAIL_REPLY_TO`             | `Pesoprint <orders@pesoprint.allulab.eu>` / a support address you read |
| `EMAIL_SUBJECT_PREFIX`                      | `"[Test] "` until go-live, then empty                                  |
| `S3_ENDPOINT`, `S3_REGION`                  | the R2 endpoint for the buckets' jurisdiction (§12), `auto`            |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 token 1 (prod public + private buckets only)                        |
| `S3_PUBLIC_BUCKET` / `S3_PRIVATE_BUCKET`    | `pesoprint-prod-public` / `pesoprint-prod-private`                     |
| `PUBLIC_ASSETS_URL`                         | `https://pesoprint-files.allulab.eu`                                   |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`          | new (§9), environment `production`. The release comes from the image   |

**web.env**

| Variable                           | Production value                                      |
| ---------------------------------- | ----------------------------------------------------- |
| `API_URL`                          | `http://api:3001` (internal)                          |
| `API_WAKE_URL`                     | **unset** (new, §7.0; only staging on Render sets it) |
| `SITE_URL`                         | `https://pesoprint.allulab.eu`                        |
| `VITE_CLERK_PUBLISHABLE_KEY`       | `pk_live_…` (read at runtime, so one image fits all)  |
| `CLERK_SECRET_KEY`                 | `sk_live_…`                                           |
| `INTERNAL_API_SECRET`              | same as the API                                       |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | new (§9)                                              |
| `POSTHOG_*`                        | unset (no analytics, no cookie banner)                |

**cloudflared.env:** `TUNNEL_TOKEN` of the tunnel (remotely managed: its public hostnames point to `http://caddy:80`; the routing rules stay in Caddy). **backup.env:** Postgres connection, R2 endpoint + token 2 (backups bucket only), the `age` public key, the heartbeat URL. **files-backup.env:** a read-only R2 token for the two production buckets, and the destination (an `rclone` remote, §8.2).

Because the repo is public: none of these values, nor the tailnet name, VM hostname, tunnel ID, home IP or Cloudflare account IDs, goes into the repo or a workflow file.

## 7. App changes, images and deploys

### 7.0 Small app changes

1. **`/readyz` on the web server** (`apps/web/server.ts`, next to `/healthz`): calls `API_URL/api/health` with a 3 s timeout. Healthy: `200`, body `ok`, header `X-Pesoprint-Ready: 1`, `Cache-Control: no-store`. Otherwise `503` and no details. `/healthz` stays as the container's own check.
2. **`API_WAKE_URL` replaces the computed wake link.** Today the 503 "starting up" page gives the browser `new URL('/api/health', API_URL)` (`apps/web/app/lib/api.server.ts:43`), which in production would be `http://api:3001`. With the change, `wakeUrl` is only sent when `API_WAKE_URL` is set (staging: the Render API's public health URL). The self-retrying page stays; it's still useful during a deploy.
3. **Release in the image:** a `GIT_SHA` build argument becomes `ENV SENTRY_RELEASE` in both images. Not environment-specific, so the image stays neutral, and staging gets releases too.

### 7.1 CI builds and pushes images

Extend the `docker` job in `.github/workflows/ci.yml` (today `push: false`, line 63):

- Pull requests: build only (fork PRs get no secrets or write access, and the build must pass without them).
- Pushes to `master`, after `check` passes: log in to GHCR with `GITHUB_TOKEN` (`packages: write` for this job only) and push `ghcr.io/<owner>/pesoprint-api` and `pesoprint-web`, tagged `sha-<full SHA>` and `master`, with OCI labels (`source`, `revision`).
- **Sentry source maps are uploaded from inside the Docker build**, with `SENTRY_AUTH_TOKEN` as a BuildKit secret (master only). Sentry matches maps by debug IDs created during a build, so maps from the `check` job's separate build wouldn't match the image. The web build turns `sourcemap` on and deletes the `.map` files after upload, so `express.static` doesn't serve them.
- linux/amd64 only. After the first push, set both packages to **public** once.

### 7.2 The "Deploy production" workflow

`.github/workflows/deploy-production.yml`, `workflow_dispatch` only:

1. Input: a commit SHA (default: the latest master commit).
2. Runs in the GitHub environment **`production`**, limited to the `master` branch.
3. Checks that the SHA is on `master`, its CI run succeeded, and both images exist in GHCR. Records both image digests in the summary.
4. Joins the tailnet with the official Tailscale action (OAuth client tagged `tag:ci`, ephemeral node).
5. SSHes in as `deploy` (pinned host key) and sends the SHA; the forced command runs the wrapper.
6. Prints the deploy output and health check results in the workflow summary.

### 7.3 The deploy on the VM

`bin/deploy-wrapper` (stable, installed by hand):

1. Validate `$SSH_ORIGINAL_COMMAND` as a 40-character SHA. Take a lock so two deploys can't overlap.
2. Download `deploy/` at that SHA from the public repo into `releases/<sha>/` (a new directory, so a running script is never overwritten).
3. Run `releases/<sha>/deploy.sh <sha>`.

`deploy.sh <sha>`:

1. Remember the current tag. `docker compose pull` the new images.
2. **Pre-deploy backup:** run the backup job once, tagged `pre-deploy-<sha>`. Stop if it fails.
3. **Migrate:** `docker compose run --rm api node dist/migrate.mjs` with the new image.
4. Point `current` at the new release and `docker compose up -d --wait`. Check `/api/health` on the API, then `/readyz` through Caddy.
5. On failure: switch back to the previous release and tag, `up -d --wait` again, exit with an error. Migrations aren't undone.
6. Prune images other than the current and previous tags, and releases older than the last five.
7. Append to `deploy.log`.

**Migration rule:** a migration must keep working with the previous release (add first, remove in a later release), so going back one release never needs a database rollback. If one ever can't, restore the pre-deploy dump by hand (§8).

Seed: **never** in production.

## 8. Backups and the restore test

### 8.1 Database

**Nightly** (the `backup` service, 03:00 Europe/Helsinki):

1. `pg_dump --format=custom` with a Postgres 18 client.
2. A **manifest** next to it, made from the dump itself (so it always matches): row counts of `users`, `products`, `product_files`, `orders`, `order_items`, `entitlements`, `reviews`; the latest applied migration; the `pg_dump` version.
3. Encrypt both with **`age`** to a public key. The private key is **never on the VM**: password manager plus one offline copy.
4. Upload to **`pesoprint-prod-backups`** as `daily/<UTC time>.dump.age` and `.manifest.txt.age` (a new name each time: the bucket lock forbids overwrites); pre-deploy dumps as `pre-deploy/<UTC time>-<sha>.*`.
5. Ping the heartbeat URL on success.

**Retention:** lifecycle rules delete `daily/` after 35 days and `pre-deploy/` after 14. A **bucket lock** of 14 days on the whole bucket, so a compromised VM can't delete recent backups (its token could otherwise).

**Second layer on the homelab:** nightly Proxmox backup (vzdump) of the VM, for a quick restore of a broken VM. It isn't off-site, and it holds customer data unencrypted on the backup storage (see §15).

**How much can be lost:** up to a day of orders, accounts and reviews. Payments are also in Stripe. WAL archiving can come later.

### 8.2 Files

The private bucket holds what buyers paid for. A nightly `files-backup` job runs `rclone sync` of `pesoprint-prod-public` and `pesoprint-prod-private` to a destination **off Cloudflare**, with `--backup-dir` so deleted or overwritten objects are kept for 30 days. The destination is an `rclone` remote, so it moves with the host:

- Homelab: a directory on the Proxmox backup storage, mounted into the VM read-write for this container only.
- VPS or cloud: e.g. a Hetzner Storage Box, or a bucket at another provider.

It pings its own heartbeat.

### 8.3 Restore test

Once now as part of this step, then every few months and after Postgres upgrades. `restore.sh`:

1. Download a chosen dump and manifest, decrypt with the private key (on your own machine, or brought to the VM temporarily and deleted after).
2. Restore into a **throwaway** `postgres:18` container, never the live database.
3. Check: `node dist/migrate.mjs` with the deployed image finds nothing to apply, the row counts match the manifest, and the API starts against it (no Stripe, Resend or Clerk keys) and answers `/api/health`.
4. Restore one file from the files backup and compare its checksum with R2.
5. Write the date, the dump used and how long it took in the runbook (README → Production → Restore).

## 9. Sentry

- Hosted Sentry, **EU data region**, free plan. Projects `pesoprint-api` and `pesoprint-web`; staging sends to them too, tagged `staging`.
- **API:** `@sentry/node`, initialised before the app. Unexpected errors from the Hono error handler (`apps/api/src/app.ts`) and background failures such as order emails that run out of retries. Expected 4xx answers aren't reported.
- **Web:** `@sentry/react-router` on the server and in the browser. The DSN reaches the page at runtime, like the Clerk publishable key. Avoid reporting the same error twice from framework and app handlers.
- **Privacy:** `sendDefaultPii: false`, no session replay, no tracing (or a very low rate). Cookies, auth headers, request bodies, signed URLs and customer details removed before sending. Users identified by internal ID at most. Check the scrubbing with a test event.
- Email alerts for new and regressed production issues.
- **Done when:** a deliberate test error from each app shows up tagged `production`, with the right release and readable stack traces, and without personal data.

## 10. Uptime monitoring

The monitor runs **outside the homelab**, so it alerts when the house loses power or internet.

- **One HTTP monitor** (UptimeRobot free or Better Stack) on `https://pesoprint.allulab.eu/readyz`, every 5 minutes. It checks for status `200` **and** the `X-Pesoprint-Ready` header (or the body `ok`), so an Access login page or a Cloudflare error page can't look healthy. One check covers Cloudflare, the tunnel, the VM, Caddy, web, the API and Postgres.
- **Heartbeats** (healthchecks.io free) for the database backup and the files backup: an email if one doesn't arrive within 26 hours.
- Containers restart when their process **exits** (`unless-stopped`). Docker doesn't restart a container that's merely unhealthy; a hang shows up on the monitor instead.
- Optional: a Cloudflare custom error page for "origin unreachable".

## 11. Cloudflare Access (the login gate)

- An Access application for **`pesoprint.allulab.eu`**: your email (and anyone you invite) with a one-time PIN or Google. Free up to 50 users.
- **Bypass** policy for `/readyz` only. Its answer reveals nothing.
- **`pesoprint-hooks.allulab.eu`** isn't gated (Stripe and Clerk must reach it), but Caddy only lets the two webhook paths through.
- **`pesoprint-files.allulab.eu`** isn't gated (images must load).
- In tunnel mode there's no other way in, so the origin doesn't need to check the Access token. In `tls` mode on a VPS, the firewall must allow only Cloudflare's ranges.
- Crawlers can't get past the gate. The existing `robots`/`noindex` logic stays for go-live.

## 12. Third-party services

**Cloudflare Tunnel:** one tunnel `pesoprint-prod`, remotely managed, public hostnames `pesoprint.allulab.eu` and `pesoprint-hooks.allulab.eu` → `http://caddy:80`. Its token goes in `cloudflared.env` only.

**R2**

- Buckets `pesoprint-prod-public`, `pesoprint-prod-private`, `pesoprint-prod-backups`. Decide on the **EU jurisdiction** before creating them: such buckets use the `<account>.eu.r2.cloudflarestorage.com` endpoint, and a bucket can't be moved later.
- Token 1: Object Read & Write on public + private (the API). Token 2: backups bucket only. Token 3: Object Read on public + private (files backup).
- `pesoprint-files.allulab.eu` as the public bucket's custom domain, with the `r2.dev` URL **off**.
- CORS: staging's rules with only `https://pesoprint.allulab.eu` as the origin (`PUT` for presigned uploads, `GET` for GLB previews).
- Lifecycle rules and the bucket lock on the backups bucket (§8.1).

**Clerk (production instance)**

- Production instance for `pesoprint.allulab.eu`; its DNS records in Cloudflare as **DNS only**.
- Sign-in: **email** and **Google**. Google needs your own OAuth client (web) in a Google Cloud project, with the redirect URI Clerk shows, scopes email and profile, consent screen set to **"In production"** (otherwise only listed test users can sign in).
- Webhook `https://pesoprint-hooks.allulab.eu/api/webhooks/clerk` with `user.created`, `user.updated`, `user.deleted`.
- Sign up on production, set `publicMetadata.role = "admin"`; the `user.updated` webhook syncs it (or `vp run users:sync`).

**Stripe:** a **Sandbox** named "production preview", separate from the test mode staging uses, so neither receives the other's events. Webhook `https://pesoprint-hooks.allulab.eu/api/webhooks/stripe` with the same six events as staging. At go-live, a live endpoint at the same URL (§16).

**Resend:** a new production key (Sending access, domain `pesoprint.allulab.eu`, already verified).

**Sentry, UptimeRobot, healthchecks.io:** as in §9–10.

**Tailscale:** the VM joins with `tag:pesoprint-prod`. An OAuth client (auth keys, `tag:ci`) for the workflow. The ACL from §4.

**GitHub:** environment `production` limited to `master`, with secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`. `SENTRY_AUTH_TOKEN` as a repo secret for the master image builds.

## 13. Work order

### Code (small PRs, each passing `vp check`, tests and build)

1. **feat(web): `/readyz` and `API_WAKE_URL`** (§7.0 #1–2). Set `API_WAKE_URL` on staging in the same step. _Done when:_ `/readyz` answers 503 with the API stopped, and staging's starting-up page still wakes the API.
2. **ci: push images to GHCR** with `GIT_SHA` → `SENTRY_RELEASE` (§7.0 #3, §7.1). _Done when:_ a master push publishes both images and they pull anonymously.
3. **feat: Sentry in api and web**, source maps uploaded from the image build. _Done when:_ §9's check passes on staging.
4. **deploy: portable compose stack.** `deploy/` with compose, Caddyfile, env examples, wrapper, `deploy.sh`, backup, files backup and restore. Tested locally from the GHCR images in both `tunnel`-style (`:80`, `TRUSTED_PROXIES=private_ranges`) and `tls` mode (a throwaway certificate), including the webhook-only hooks host, a backup, a restore and a failing deploy that rolls back. _Done when:_ all of that works locally.
5. **ci: "Deploy production" workflow.** _Done when:_ it deploys a chosen SHA to the VM and a broken SHA rolls back.
6. **docs:** Production section in the README (setup per host type, deploy, backups, restore runbook, rotating secrets), plan.md M6 (the homelab replaces "paid hosting so the site doesn't sleep"), and the privacy policy's list of processors: **Cloudflare** (proxy, tunnel, Access, R2) and **Sentry**.

### Your clicks (step-by-step lists will come with each PR)

1. Proxmox VM, Debian, Docker, Tailscale, firewall (`firewall=1` on the NIC), `deploy` user. No router changes.
2. Cloudflare: tunnel and its two public hostnames, zone SSL settings, Access application and `/readyz` bypass.
3. R2: three buckets (jurisdiction decided), three tokens, custom domain, CORS, lifecycle rules, bucket lock.
4. Files-backup destination (a directory on the Proxmox backup storage).
5. Clerk production instance, DNS records, Google OAuth client, webhook, admin role.
6. Stripe Sandbox and its webhook. Resend production key.
7. Sentry projects and alerts. UptimeRobot monitor. Two healthchecks.io checks.
8. GitHub `production` environment and secrets. GHCR packages public.
9. First deploy, then the restore test.

## 14. Done when

- `https://pesoprint.allulab.eu` (behind the gate) serves the shop from the homelab VM, the router has no port forwards, and the home IP isn't in public DNS.
- `https://pesoprint-hooks.allulab.eu/api/docs`, `/api/openapi.json`, `/api/catalog/products` and an unknown path answer 404.
- You can sign in with email and Google on Clerk production, and you're admin.
- As admin, you create a real product with images (from `pesoprint-files.allulab.eu`) and files, buy it with a Stripe test card, receive the confirmation email (`[Test]` subject), download the file, and refund the order from the admin.
- Download logs and rate limits see your real IP. HTTPS form posts work.
- Stopping the API triggers an uptime alert; starting it clears it. Stopping the VM does the same.
- A test error from each app appears in Sentry with readable stack traces and no personal data.
- A nightly database backup and files backup exist. The restore test passes and is recorded in the runbook.
- A deploy from the GitHub button works, and a broken one rolls back.
- The VM can't reach a device on the home LAN (try `curl` to your router's admin page and to another machine).

## 15. Risks

- **Uptime** depends on home power and internet. The monitor tells you; a UPS and "start at boot" help.
- **ISP terms:** some home contracts forbid running servers. The tunnel opens no port, but check your contract before go-live.
- **Customer data at home:** names, addresses and emails on a disk in your home, and unencrypted in vzdump copies. Off-site backups are encrypted. Options: ZFS native encryption for the VM disk and the backup storage, or Neon for the database (turn off the `postgres` profile; costs about 25–35 ms per query from Finland to Frankfurt, so measure first).
- **Flat home network:** isolation rests on the Proxmox firewall. A VLAN/DMZ would be stronger if the router allows it later.
- **Single machine:** if the host dies, recovery is a new VM (or a VPS), the stack, the latest R2 dump and the files backup. The restore test proves this and shows how long it takes.
- **Cloudflare dependency:** DNS, R2, the tunnel and Access are all Cloudflare. Leaving means `tls` mode or a load balancer in front of Caddy, and a replacement for the gate. Acceptable; the stack doesn't depend on the tunnel.

## 16. Later (not part of this step)

**Go-live** (the end of M6):

- §9 #2 (VAT and company form) decided, `vat_rates` filled, `legal.ts`, the footer and email footers completed.
- **Clear the preview's test data:** a script (`vp run orders:purge-preview`, dry run first) that deletes the preview's orders and everything hanging off them (`order_items`, `entitlements`, `order_emails`, their `download_events`) and all `reviews` (only test buyers could write them). It keeps users, products, files, materials and favourites. Test-mode payments can't be refunded with live keys, so none may remain.
- Stripe account activated, live keys, a live webhook endpoint at the same URL.
- `EMAIL_SUBJECT_PREFIX` empty, the Access gate removed (`/readyz` stays fine without it), the site submitted to search engines.
- Accessibility and Lighthouse passes.

**Other open items:** staging on the same stack (`staging-pesoprint.allulab.eu`, a flat name again); WAL archiving; a VLAN/DMZ; disk encryption; PostHog analytics; an `autoheal` container if hangs turn out to happen; scaling (§17).

## 17. Scaling (optional, for later)

_Not part of this step. Nothing here needs doing before go-live; it records how the stack can grow, so today's choices don't block it._

**Today:** one VM, one `web` and one `api` container, no load balancer. That's on purpose. The likely causes of downtime are home power, the home connection, the VM and Postgres, and more containers on the same machine protect against none of them. A small shop won't come near 2 vCPUs; the only heavy work is turning uploaded STLs into GLB previews. The cost is a few seconds of the self-retrying "starting up" page during each deploy.

### 17.1 Rule to keep from now on

**No shared state in process memory.** Anything that more than one instance must agree on goes in Postgres (or R2). The code follows this today:

- The web server is stateless; sign-in lives in Clerk's cookies.
- Download rate limits are counted in Postgres under an advisory lock (`apps/api/src/services/downloads.ts:104`).
- Order emails go through the `order_emails` outbox with a Resend idempotency key per email (`apps/api/src/services/order-emails.ts:82`); refunds use Stripe idempotency keys; webhooks are idempotent.
- Migrations run once from `deploy.sh`, never on container start. (Staging's `dist/start.mjs` migrates on start, which is fine with one instance only.)

Known exception: the API's background timers (`apps/api/src/index.ts:118` forgets old IP hashes, `:122` retries order emails) run in every instance. That's safe, just repeated work. With many instances, move them to a single worker (e.g. a `worker` compose service running the same image with another command), or claim outbox rows with `FOR UPDATE SKIP LOCKED`.

Review new features against this rule (in-memory caches, counters, locks, timers).

### 17.2 Steps, in the order they'd likely be needed

| Step                     | What it gives                                           | How                                                                                                                                                                                                                                                                                                                                                                                                                                             | Needs                                                                           |
| ------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Zero-downtime deploys | No "starting up" page during deploys                    | Two copies of `web` and `api`, replaced one at a time (blue-green services, or the `docker rollout` plugin). Caddy lists both as upstreams with active health checks (`/healthz`, `/api/health`), so it only sends traffic to healthy ones                                                                                                                                                                                                      | More RAM (about 1 GB per extra API copy); `deploy.sh` changes                   |
| 2. More CPU on one host  | Handles more traffic or heavier uploads                 | `docker compose up --scale api=N web=N`, Caddy load-balancing across them (`lb_policy`, health checks). Bigger VM first; it's simpler                                                                                                                                                                                                                                                                                                           | Step 1's Caddy config                                                           |
| 3. Survive a lost host   | The shop stays up when the homelab (or a VPS) goes down | **First move the database to a managed service** (Neon or similar; `postgres` profile off, `pg_dump`/`pg_restore` at cutover), because each host's own Postgres can't be shared. Then run the stack on two hosts. In front: Cloudflare Load Balancing (paid, about $5 a month, health-checked pools), or the same tunnel token on both hosts (free, but only fails over when a host's `cloudflared` disconnects, not when the app is unhealthy) | Managed database; backups and the background timers (17.1) run on one host only |
| 4. Cloud                 | Provider-managed scaling                                | The provider's load balancer in front of Caddy on each VM (§2.1), or the same images on a managed container service with the Caddy rules recreated in its routing                                                                                                                                                                                                                                                                               | Step 3's managed database                                                       |

**Signals that it's time:** the monitor or Sentry shows deploy-time errors customers notice (step 1); CPU stays high or uploads time out (step 2); the homelab's outages start costing orders (step 3).
