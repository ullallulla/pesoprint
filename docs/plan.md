# Pesoprint – Rebuild Plan (working name)

_Drafted 2026-11-09 from the [prototype review](./prototype-review.md) and the planning questions. M0, M1 and M2 are done and running on staging; M3 is next. The public launch moved to M6._

## 1. What we're building

**Pesoprint** (working name; the old prototype was called Pesotable) is an online shop for 3D printing. Customers can:

- **download free models** without an account
- **buy digital model files** (STL/3MF) and download them from their account library
- **order physical prints** in a colour and material of their choice, which you print and ship yourself

At first you are the only seller. The data model is designed so other creators can be added later without a rewrite.

**Goal:** a portfolio piece built properly enough to launch as a real business. That means:

- the code must be clean, tested and deployable, because employers will read it
- payments, security, tax and legal pages must be done right before going live, because customers will use it
- each milestone ends in something that can be deployed and shown

### Decisions from your answers

| Topic         | Decision                                                                                |
| ------------- | --------------------------------------------------------------------------------------- |
| Goal          | Portfolio + real business                                                               |
| Products      | Free models, paid digital files, physical prints                                        |
| Sellers       | Only you at first; data model ready for more creators                                   |
| Print options | Customer picks material + colour; price depends on the option                           |
| Accounts      | Free downloads need no account. Buying requires an account (Clerk).                     |
| Reviews       | Verified buyers only                                                                    |
| Fulfilment    | You print and ship; the admin has an order queue with tracking numbers                  |
| MVP scope     | Catalogue + search, checkout + downloads, print orders + shipping, reviews + favourites |
| Pace          | No dates; plan by milestones                                                            |
| Hosting       | Free tiers first; must be portable to a VPS or AWS/Azure/GCP later                      |
| Market        | Undecided. Default: EUR, English UI, ship to Finland first, then the EU (see §9)        |

---

## 2. Tech stack

**Architecture: option B.** A standalone API plus a separate web frontend, in one pnpm-workspaces monorepo.

```
Browser ──► web (React Router v8, SSR) ──HTTP + Clerk token──► api (Hono) ──► Postgres
   │                                                              ▲   ├────► R2 (files)
   └── uploads (presigned PUT), images, 3D previews ──► R2        │   └────► Mollie, Resend
Mollie / Clerk webhooks, file downloads ──────────────────────────┘
```

- **The API owns all data and business rules.** It is the only thing that talks to Postgres, R2 and Mollie.
- **The web app is a server-rendered frontend.** Its loaders and actions call the API over HTTP using a typed client. It has no database access, so the API boundary stays real.
- **The browser never calls the API directly.** Pages, forms and even the upload steps go through the web server, which calls the API with the user's token. So the two can run on separate hosts (as on staging) without CORS. The browser only talks to R2: uploads through presigned URLs, and public images and previews.

| Layer              | Choice                                                                                   | Why                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API                | **Hono** on Node + `@hono/zod-openapi`                                                   | A small, modern, fast framework that runs on any host. Routes are defined with zod schemas, which gives request validation, **generated OpenAPI docs** (a Swagger UI at `/api/docs`) and a typed client for the web app, all from one definition. That's a strong backend portfolio piece.                                                                                                             |
| Web                | **React Router v8 in framework mode** (Vite, SSR)                                        | The next step from the `react-router-dom` + Vite setup you already used. Server-side rendering gives search engines and link previews real HTML for product pages. Loaders call the API from the server, so the browser never needs the API's internals.                                                                                                                                               |
| Database           | **PostgreSQL + Drizzle ORM** (inside `apps/api`)                                         | The schema is written in TypeScript and the types come from it. Migrations are generated from the schema. It works the same on Neon (free tier) and on a self-hosted Postgres.                                                                                                                                                                                                                         |
| Validation         | **zod**, in `packages/shared`                                                            | Request and response schemas are shared by the API and the web app: one source for validation and types.                                                                                                                                                                                                                                                                                               |
| Auth               | **Clerk**: `@clerk/react-router` in web, Clerk token verification in the API             | The web app gets the user's session token and sends it as `Authorization: Bearer …`. The API verifies it and checks roles (admin role in Clerk `publicMetadata`). Users are mirrored to the database with a Clerk webhook to the API.                                                                                                                                                                  |
| File storage       | **Cloudflare R2** (S3 API), replacing UploadThing                                        | Paid files must be **private** and downloaded through short-lived signed URLs. R2 does that, has 10 GB free and no egress fees (3D files are large), and its S3 API means you can later move to AWS S3, MinIO on a VPS, or similar.                                                                                                                                                                    |
| Payments           | **Mollie** (Payments API, `@mollie/api-client`) + webhooks                               | An EU-based provider (Netherlands) with no monthly fee. Its hosted payment page offers cards, MobilePay, Klarna, Apple Pay and more. Mollie Connect leaves a path to paying out to creators later. **Unlike Stripe Checkout, Mollie doesn't collect shipping addresses or calculate VAT,** so our own checkout page handles the address, shipping rate and VAT, then sends the buyer to Mollie to pay. |
| Email              | **Resend** (free tier) + React Email                                                     | Order confirmations, download links and shipping notifications.                                                                                                                                                                                                                                                                                                                                        |
| Search             | **Postgres full-text search** (`tsvector`)                                               | No extra service to run. Enough for the first few thousand models.                                                                                                                                                                                                                                                                                                                                     |
| 3D viewer          | react-three-fiber + drei                                                                 | The preview GLB is generated from the first STL upload (meshoptimizer, at most 100k triangles), and three.js only loads when someone opens the 3D view.                                                                                                                                                                                                                                                |
| UI                 | Tailwind v4 + shadcn/ui                                                                  | Kept from the old code: reuse the theme and the page layouts you already designed.                                                                                                                                                                                                                                                                                                                     |
| Analytics / errors | PostHog + Sentry (both have free tiers)                                                  | PostHog only loads after cookie consent.                                                                                                                                                                                                                                                                                                                                                               |
| Testing            | Vitest via `vp test` (unit + integration against real Postgres), Playwright (end-to-end) |                                                                                                                                                                                                                                                                                                                                                                                                        |
| Toolchain          | **Vite+** (`vp`) on pnpm workspaces; TypeScript 7; Node 26                               | One tool for dev server, build (Vite/Rolldown), tests (Vitest), linting (Oxlint, type-aware), formatting (Oxfmt), library bundling (tsdown) and a cached task runner (`vp run`), all configured in the root `vite.config.ts`. Replaces ESLint, Prettier and Turborepo.                                                                                                                                 |
| Deploy             | **Two Docker images** (api, web) from day one                                            | They run anywhere: a free host for staging, then a VPS (Hetzner + Docker Compose + Caddy as the reverse proxy) or a cloud container service, with no code changes.                                                                                                                                                                                                                                     |

### Repository layout

```
pesoprint/
├─ apps/
│  ├─ api/                     # Hono API: owns the database and all business rules
│  │  ├─ src/
│  │  │  ├─ routes/            # HTTP layer: products, orders, checkout, downloads, reviews, admin, webhooks
│  │  │  ├─ services/          # business logic (pricing, VAT, entitlements, order status)
│  │  │  ├─ db/                # Drizzle schema, client, seed script
│  │  │  ├─ integrations/      # mollie, r2, resend, clerk
│  │  │  ├─ middleware/        # auth, admin guard, rate limiting, error handler
│  │  │  └─ env.ts             # zod-validated environment variables
│  │  ├─ drizzle/              # generated SQL migrations
│  │  ├─ tests/                # unit + integration tests (real Postgres)
│  │  └─ Dockerfile
│  └─ web/                     # React Router v8 SSR frontend, with no database access
│     ├─ app/
│     │  ├─ routes/            # pages (loaders/actions call the API)
│     │  ├─ components/        # catalog/, admin/ (one folder per feature), ui/ (shadcn)
│     │  └─ lib/               # api.server.ts (API client), forms, formatting, SEO helpers
│     ├─ server.ts             # production server (Express + the React Router adapter, trusts the host's proxy)
│     ├─ tests/e2e/            # Playwright (runs against api + web together)
│     └─ Dockerfile
├─ packages/
│  └─ shared/                  # zod schemas + types for API requests/responses (TS source, no build step)
├─ docker-compose.yml          # local Postgres (+ a test database)
├─ tsconfig.base.json
├─ pnpm-workspace.yaml
├─ .github/workflows/ci.yml
└─ .env.example                # one per app: apps/api/.env.example, apps/web/.env.example
```

**Root scripts:** `vp run dev` starts both apps, `vp check` formats, lints and type-checks everything, and `vp run test` / `vp run build` run each package's script.

**Shared package:** `packages/shared` exports its TypeScript source directly (no build step). Vite bundles it into the web app, and the API's production build bundles it too (`vp pack`, which uses tsdown).

---

## 3. Data model

Money is stored as **integer cents**. Catalogue prices are EUR and **include VAT** (what the consumer sees); orders also store a `currency`. Every order line stores a **snapshot** of the price and title at the moment of purchase.

```
users            id (Clerk user id, text PK), email, display_name, role (customer|admin|creator),
                 created_at
                 -- creator fields (bio, avatar, mollie_organization_id) are added later

categories       id, slug (unique), name, description?, parent_id? → categories, position
                 -- at most 2 levels; depth and cycles checked in the category service

products         id, slug (unique), creator_id → users, category_id? → categories,
                 title, description (markdown), status (draft|published|archived),
                 digital_price_cents?,      -- null = no file offered, 0 = free download, > 0 = paid
                 print_base_price_cents?,   -- null = not offered as a print
                 license?,                  -- one per model, Printables-style list (packages/shared)
                 size_x/y/z_mm?, print_weight_g?, featured_at?,
                 search_vector (generated tsvector), created_at, updated_at, published_at
                 -- download_count (M2) and rating_sum/rating_count (M5) are added in their milestones

product_images   id, product_id, storage_key, alt, width, height, size_bytes, position, created_at
product_files    id, product_id, kind (download|preview), format (stl|3mf|step|obj|glb),
                 filename, storage_key, size_bytes, sha256?, position, created_at

materials        id, name (PLA, PETG, …), surcharge_cents, active
colours          id, material_id, name, hex, in_stock
product_materials product_id, material_id            -- which materials each model can be printed in

orders           id, user_id, status (pending|paid|printing|shipped|delivered|cancelled|refunded),
                 currency, subtotal_cents, shipping_cents, tax_cents, total_cents,
                 mollie_payment_id, payment_method,
                 vat_country, vat_rate_bp,   -- VAT rate in basis points, e.g. 2550 = 25.5 %
                 shipping_name, shipping_address (jsonb), carrier, tracking_number,
                 created_at, paid_at, shipped_at
order_items      id, order_id, product_id, type (digital|print), material_id?, colour_id?,
                 quantity, unit_price_cents, title_snapshot

shipping_rates   id, name, countries (text[]), price_cents, active   -- e.g. "Finland – Posti parcel"
vat_rates        country_code, standard_rate_bp, valid_from        -- needed because Mollie doesn't calculate VAT
entitlements     user_id, product_id, order_id?, granted_at        -- the "who owns what" table
download_events  id, product_id, user_id?, ip_hash, created_at     -- download counts + rate limiting
reviews          id, product_id, user_id, rating (1–5), body, created_at,
                 UNIQUE(product_id, user_id)
favourites       user_id, product_id, created_at
```

**Key rules:**

- **Prices are always calculated on the server**, from `products` + `materials` at checkout. The client never sends a price.
- **Who can review:**
    - a user with an entitlement to the model (they bought it)
    - a user with a delivered print order for the model
    - for free models, a signed-in user who downloaded it while signed in
- **The cart** is stored in the browser (localStorage) for the MVP. The server re-validates everything when it creates the order and the Mollie payment.
- **Checkout flow (Mollie):**
    1. Our checkout page collects the shipping address (only for print items) and the shipping method.
    2. The server re-prices everything, calculates VAT, and creates an order with status `pending`.
    3. The server creates a Mollie payment with `redirectUrl` and `webhookUrl`, then redirects the buyer to Mollie.
    4. Mollie calls our webhook with the payment id. We **fetch the payment from the Mollie API** (this is the verification) and set the order to `paid` only if Mollie says it's paid.
- **Catalogue rules enforced by the database** (CHECK constraints, M1): a published product has `published_at`, a category, at least one price, and a licence if a file is offered. Paid files must use one of the shop's own licences (Standard Digital File or Commercial Use), never CC or open-source.
- **`digital_price_cents` is never tested for truthiness.** `0` (free) and `null` (no file) mean different things; use the shared helpers.
- **Featured products:** pick any product by setting `featured_at`; the home page shows published ones, most recently featured first.
- **File access:**
    - Images and the preview GLB are in the **public** bucket and served directly. The 3D viewer is public on every product, including paid ones.
    - The **preview GLB is reduced to at most 100k triangles**. Anything the viewer shows can be saved from the browser, so reduction, not access control, is what protects paid models. Simple CAD parts are already under the limit and are shown in full detail, which is fine for free models; decide how to handle paid ones before M3 (§9).
    - Download files are in the **private** bucket. A single `canDownload(product, file, user)` check decides access: admins and the creator always; free + published for anyone; paid + published/archived with an entitlement (buyers keep access after archiving); otherwise `404`. Allowed requests are redirected to a ~5-minute signed URL.
- **Getting ready for creators:** `products.creator_id` exists from day one. In the MVP it always points to you.

---

## 4. Milestones

Each milestone ends with: CI green, deployed to staging, and a short demo you could show someone.

### M0 – Foundation ✅

- Tag the old code as `v0-prototype`, then start fresh on `master`
- Vite+ monorepo with `apps/api`, `apps/web`, `packages/shared`, plus local Postgres in Docker Compose
- **API:** Hono app with a `/api/health` route, a central error handler (consistent JSON errors), request logging, OpenAPI docs at `/api/docs`, Drizzle set up with a first migration
- **Web:** React Router app (v8) with Tailwind + shadcn, your old theme, and the header/footer layout ported over. Typed API client.
- Clerk sign-in in the web app. `requireUser` / `requireAdmin` middleware in the API that verifies the Clerk token. A Clerk webhook to the API that syncs users to the database.
- Environment variables validated with zod at startup in both apps, plus an `.env.example` for each
- CI: install (frozen lockfile) → lint → typecheck → test → build, on every PR. Postgres runs as a service container for API tests.
- Dockerfiles for both apps, deployed to a free staging host
- **Done when:** a signed-in admin sees an admin page whose data comes from an admin-only API endpoint on staging, the OpenAPI docs load, and CI blocks a failing PR

### M1 – Catalogue ✅ (2026-11-12)

- Schema: categories, products, images, files
- Admin: create, edit, publish and archive products; upload images and model files straight to R2 with presigned URLs; manage categories
- Public: home page (featured + newest), category pages, search, sorting, pagination
- Product page: image gallery, 3D viewer (GLB preview, generated from the STL), SEO meta + Open Graph tags, sitemap.xml
- 404 page, loading and error states
- A seed script with sample data
- **Done when:** you can upload a real model in the admin and find it through search on staging

### M2 – Free downloads ✅ (2026-11-13)

- `POST /api/downloads/:fileId` endpoint: checks the model is free and published (or that the caller is an admin or the creator), logs a download event, and returns a ~5-minute signed R2 URL. The web app's `/models/:slug/download/:fileId` route redirects to it.
- Rate limiting per IP hash (30 downloads an hour). IP hashes are erased after 7 days.
- Download counter on product cards and product pages, and a "Most downloaded" sort
- Sample products have real (placeholder) STL files and 3D previews
- Terms of use and privacy policy (who runs the shop is still a placeholder in `apps/web/app/lib/legal.ts`), and a cookie banner: PostHog (EU cloud) only loads after consent. A `model_downloaded` event for download clicks.
- Inter is served from the site instead of Google Fonts
- Staging on Render's free plan: a `/healthz` health check, a timeout for API requests, and a "starting up" page that loads by itself while a sleeping API wakes
- Maintenance commands: `users:sync` (Clerk users into the database) and `storage:cleanup` (unused files in R2)
- **Done when:** strangers can browse and download free models on staging. The public launch (own domain, production environment) moved to M6.

### M3 – Paid digital files

- Cart (digital items)
- Our own checkout page: order summary and VAT. Then a Mollie payment is created on the server and the buyer is redirected to Mollie's hosted payment page.
- Mollie webhook → fetch the payment from Mollie → order marked paid + entitlements granted. Handled idempotently, so repeated webhook calls do nothing twice. Failed, expired and cancelled payments are handled too.
- A "payment pending" return page, because the buyer may come back before the webhook arrives
- "My library" page for re-downloading purchased files
- Order confirmation email with a link to the library
- EU rule for digital content: a checkbox where the buyer agrees to immediate delivery and accepts losing the 14-day right of withdrawal
- **Done when:** a Mollie test-mode purchase gives the buyer a download in their library, and the webhook is covered by an integration test

### M4 – Physical print orders

- Admin: manage materials and colours, mark colours out of stock, choose which materials each model allows
- Product page: pick material + colour; the live price comes from the server
- Cart with both digital and print items. Our checkout page collects the shipping address and offers shipping rates from the `shipping_rates` table (start with fixed rates per region). The Mollie payment includes the order lines and the shipping address.
- Admin order queue: paid → printing → shipped (carrier + tracking number) → delivered, with filters
- Emails: order received, order shipped (with tracking)
- Customer "My orders" page showing each order's status
- **Done when:** you can complete a test print order end to end, from checkout to the "shipped" email

### M5 – Reviews & favourites

- Verified-buyer reviews (the rules in §3), with rating averages kept up to date
- Admin can hide reviews
- Favourites (heart button) and a favourites page
- **Done when:** a buyer can review a model, and a non-buyer is refused by the server, not only hidden in the UI

### M6 – Launch readiness

- Decide market, VAT and company form (§9). Fill the `vat_rates` table and make sure invoices and receipts show VAT correctly. Mollie doesn't do this for us.
- Terms of sale, refund and returns policy for prints. Update the privacy policy, and fill in who runs the shop (`apps/web/app/lib/legal.ts`) and the company details in the footer.
- Own domain. Production environment: its own database, R2 buckets, secrets, Clerk production instance (needs the domain) and webhook, and paid hosting so the site doesn't sleep. Moved here from M2.
- Sentry, uptime monitoring (moved here from M2), database backups (and test restoring one)
- Production deploy. Complete Mollie's business verification and switch to the live API key.
- Accessibility pass and Lighthouse pass
- **Done when:** you'd be comfortable taking a real customer's money

### Later (after launch)

- **Creators:** sign-up, creator profiles, Mollie Connect payouts (split payments), commission settings, moderation queue
- "Makes" gallery (buyers post photos of their prints)
- Finnish/English language versions, multiple currencies
- Discount codes, bundles
- Customers uploading their own files for a print quote

---

## 5. What to reuse from the old code

| Reuse                                                                                       | Leave behind                                                   |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Tailwind theme (`index.css`) and shadcn components                                          | Express API, Sequelize, the `users` table with `password_hash` |
| Layout/JSX of the header, footer, product card, product page and admin sidebar              | Mock data (`data/prints.ts`) and the planner-template content  |
| `ModelViewer` (react-three-fiber)                                                           | UploadThing (replaced by R2 for private files)                 |
| Clerk admin-role check (`publicMetadata.role`)                                              | Turborepo and its starter packages, Next.js configs            |
| The patterns: thin handlers → services, supertest-style HTTP tests, the `app`/`index` split | The Vite `/api` proxy (replaced by a reverse proxy)            |

---

## 6. Engineering rules (from the review)

1. **Every API route that writes data or returns private data** goes through the auth middleware and validates its input with zod. The web app's checks are only for user experience; the API enforces the rules.
2. **Only the API touches the database.** The web app gets all its data through the API.
3. **The API is the only source of truth** for prices, permissions and order status.
4. **Mollie webhooks are verified by fetching the payment from the Mollie API** (the webhook body contains only an id), and handling them is idempotent. Paid status comes only from that check, never from the browser redirect.
5. **No secrets in the client bundle.** Only `VITE_`-prefixed environment variables reach the browser; server-only settings live in `env.server.ts`.
6. **Every PR passes `vp check` (format, lint, types), tests and build.**
7. **Database changes only through Drizzle migrations.** Never `sync`.
8. **Small PRs**, one feature each. Commit messages follow Conventional Commits.

## 7. Testing strategy

- **Unit (Vitest):** price calculation, review eligibility, order status transitions, zod schemas
- **API integration (Vitest + real Postgres):** HTTP tests against the Hono app through `app.request()` (no server needed), covering auth and permissions, the Mollie webhook handler (with the Mollie client mocked to return paid, failed and expired payments), the download route. Postgres runs in Docker locally and as a service container in CI.
- **End-to-end (Playwright):** browse → free download; sign in → buy digital file (Mollie test mode); admin creates and publishes a model; print order through to "shipped"
- **Rule of thumb:** every bug fix comes with a test that would have caught it

## 8. Hosting path

| Stage           | Setup                                                                                                                                                                                                  | Cost |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Local           | Docker Compose: Postgres. File storage uses a separate R2 dev bucket (decided in M1; MinIO no longer ships prebuilt images). A tunnel (cloudflared or ngrok) so Mollie's webhooks can reach localhost. | 0 €  |
| Staging (M0–M5) | Render (two Docker web services, free plan; the API runs `node dist/start.mjs` to migrate on start), Neon Postgres (Frankfurt), R2 staging buckets with their own token, Clerk/Resend/Mollie test mode | ~0 € |
| Production (M6) | **Option A:** the same managed setup on paid tiers (~10–25 €/mo). **Option B:** a Hetzner VPS (~5 €/mo) with Docker Compose (app + Postgres + Caddy for HTTPS) and nightly backups to R2.              |      |
| Later           | The same Docker image runs on AWS ECS/App Runner, Azure Container Apps or Google Cloud Run if you want cloud experience on your CV                                                                     |      |

The Docker image and the S3-compatible storage are what keep you free to move between these.

## 9. Open decisions

These don't block M0–M2. Decide them before M3 or M4.

1. **Market & language:** Finland only, or the EU from the start? English, Finnish, or both? This affects shipping rates and the UI copy.
2. **Business & VAT:** sole trader (toiminimi) or company? Selling digital goods to EU consumers means charging VAT at the buyer's country's rate (via OSS, the EU's One-Stop Shop) once you're VAT-registered. Mollie doesn't calculate VAT, so our code does, using the `vat_rates` table. Check the current Finnish VAT registration threshold with an accountant. Selling to Finland only at first keeps VAT simple.
3. **File formats:** which formats you offer (STL only, or STL + 3MF + STEP?). GLB previews are made automatically from STLs; other formats need a hand-made `.glb`.
4. **Model licence:** personal use only, or also a commercial-use licence at a higher price?
5. **Print pricing formula:** a fixed base price per model plus a material surcharge (the plan's default), or a calculation from grams and print time?
6. **Shipping:** carriers (Posti, Matkahuolto, DHL…), flat rates vs weight-based, and which countries.
7. **Returns for printed items:** policy for misprints and damage in transit.
8. **3D previews of paid models:** the public preview keeps up to 100k triangles, so a simple paid model is shown in full detail and could be saved and printed. Before M3: a much lower limit for paid models, a deliberately rough preview, or no 3D view for paid models.
