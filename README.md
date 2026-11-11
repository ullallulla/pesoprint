# Pesoprint

_Working name._ An online shop for 3D printing: free model downloads, paid digital files, and physical prints in the customer's choice of colour and material.

This is a rebuild of an earlier prototype ([review](docs/prototype-review.md)). The full roadmap is in [docs/plan.md](docs/plan.md). Current milestone: **M0 – Foundation**.

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
4. **Webhooks** (optional locally): add an endpoint `https://<public-url>/api/webhooks/clerk` with the `user.created`, `user.updated` and `user.deleted` events, and put its signing secret in `CLERK_WEBHOOK_SIGNING_SECRET`. Locally you need a tunnel (e.g. `cloudflared tunnel --url http://localhost:3001`). The webhook keeps the `users` table in sync.

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

## Everyday commands

| Command                                     | What it does                                                    |
| ------------------------------------------- | --------------------------------------------------------------- |
| `vp run dev`                                | Run the API and the web app in watch mode                       |
| `vp check`                                  | Format, lint and type-check everything (`vp check --fix` fixes) |
| `vp run test`                               | Run all tests (API database tests need `vp run db:up`)          |
| `vp run build`                              | Production build of every package                               |
| `vp run ready`                              | Everything CI runs: check, test, build                          |
| `vp -C apps/api run db:generate --name <x>` | Create a migration after editing `apps/api/src/db/schema.ts`    |
| `vp run db:migrate`                         | Apply pending migrations                                        |
| `vp run db:seed`                            | Add or refresh the sample catalogue (never in production)       |
| `vp run db:down`                            | Stop Postgres (data is kept in a Docker volume)                 |

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

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `master` and every pull request: `vp check`, all tests (with a Postgres service for the database tests), the production builds, and both Docker image builds.
