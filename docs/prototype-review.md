# Pesotable – Codebase Review

_Reviewed 2026-11-09 at commit `1ba7a16`. I only read the code; I didn't change any of it. Dependencies aren't installed in this checkout, so I couldn't run the type checker, lint, build or tests. Everything below comes from reading the source._

## TL;DR

The foundation is sound for an early project. You picked sensible tools (Vite + React 19, TanStack Query, Clerk, UploadThing, Sequelize + Umzug migrations, shadcn/ui, Turborepo), and the backend is split into routes → controllers → services, which will hold up as it grows. You also recently split `app` from `index` so supertest can use it, which is a good move.

The main problems:

1. **Security.** Anyone can create or edit models (`POST` and `PUT` have no auth), and the public list exposes `fileUrl`, which for a paid-download store means giving the product away for free.
2. **The frontend doesn't build from a clean clone.** `Header.tsx` imports `./TokenDebugger`, and that file has never been committed.
3. **Template leftovers and mock data are mixed in with real code.** There's the Turborepo starter, the v0/shadcn "printables" template, and the frontend imports mock data straight from the backend folder.
4. **Tooling and CI look like they work but don't check much.** CI only lints, the backend has no lint script, the Turbo outputs point at Next.js, and the production `start` script points at a `dist/` folder that never gets created.

None of this is unusual for a project at this stage. Most of it can be fixed in an afternoon or two.

---

## What's good

- **Layered backend.** `routes/` → `controllers/` → `services/` → `models/` is clean and easy to follow. Controllers stay thin.
- **Real migrations.** Umzug migrations include `down` functions, and there's a rollback script. That's more discipline than most early projects have.
- **`app.ts` / `index.ts` split.** This lets you test the app with supertest without starting a server. There's already a first test.
- **TypeScript `strict`** is on in both apps.
- **TanStack Query** is used for fetching instead of hand-written `useEffect` fetches.
- **Admin layout route.** `<Route element={<AdminPanel/>}>` with an `<Outlet/>` and a role check is the right pattern.
- **Manual PostHog pageviews** on route change (`lib/pageview.ts`) is the correct approach for a single-page app.
- **Vite `/api` proxy** keeps the frontend same-origin in development.
- **The UploadThing middleware checks the admin role on the server**, not only in the UI.

---

## 🔴 Critical (fix before anything is deployed)

### 1. Write endpoints have no authentication or authorization

`apps/backend/src/routes/printmodels.ts:9-10`

```ts
router.post('/printmodels', printModelController.createPrintModel);
router.put('/printmodels/:id', printModelController.updatePrintModel);
```

Anyone can create a model or overwrite any model's fields. The admin check exists only in the React UI (`AdminPanel.tsx`) and in UploadThing, and a UI check isn't security. These routes need `requireAuth()` plus an admin-role check. Ideally that check is a small reusable middleware, since the same logic is already in `uploadthing.ts`.

### 2. No input validation, so clients can set any field

`controllers/printmodels.ts` passes `req.body` straight to `PrintModel.create` / `.set`. Once auth is added, a client can still send `downloads: 999999`, `rating: 5`, `featured: true` or someone else's `userId`. You already have `zod` installed, so define a create schema and an update schema and parse `req.body` with them. Those schemas can also become the shared types (see "Architecture" below).

### 3. The public list exposes paid files and drafts

`services/printmodels.ts` → `getAllPrintModels()` returns **every** row with **every** column:

- unpublished drafts (`isPublished: false`) show up on the public homepage
- `fileUrl` is sent to every visitor, so the files you plan to sell through Stripe are free to anyone who opens devtools

The public endpoint should filter `where: { isPublished: true }` and leave out `fileUrl`. Downloads should go through an endpoint that checks the user is entitled to the file and returns a short-lived signed URL.

### 4. The frontend build is broken on a clean clone

`apps/frontend/src/components/Header.tsx:13,19` imports and renders `./TokenDebugger`. The file isn't in git (and never has been), so `tsc -b && vite build` fails for anyone except you. It also looks like a debugging tool that shouldn't be in the header at all.

---

## 🟠 High

### Backend

- **Async errors aren't handled (Express 4).** If a promise rejects inside `getPrintModels` or `createPrintModel` (database down, a `null` constraint failure, a missing `userId`), Express 4 never sees the error and the request hangs. Either upgrade to Express 5, which forwards rejected promises, or wrap the handlers and add a final error-handling middleware. Note that `@types/express` is already v5 while `express` is v4, so the types don't match the runtime either.
- **The production build can't start.**
    - `tsconfig.json` has no `outDir` or `rootDir`, so `tsc` writes `.js` files next to the `.ts` sources, but `"start": "node dist/index.js"` expects `dist/`.
    - The Umzug glob is `src/migrations/*.ts` (`utils/db.ts:9`), so compiled production code won't find any migrations.
    - `target: "ES6"` is very old for Node 20+. Use `ES2022` or later.
- **`models/index.ts` is a trap.** Nothing imports it right now, but it calls `sync({ alter: true })`, which fights with your migrations, and it sets up `User.hasMany(PrintModel)` with an integer `User.id` while `print_models.user_id` is a Clerk **string** ID. I'd delete it, along with the `users` table / `User` model (with its `password_hash` column), because Clerk now owns users. If you need local user data later, key it on the Clerk user ID string.
- **`price` is a `FLOAT`.** Use integer cents (`INTEGER`) or `DECIMAL(10,2)` for money, especially before adding Stripe, which works in cents anyway.
- **UploadThing middleware order** (`uploadthing.ts:19-23`): it calls `clerkClient.users.getUser(userId as string)` _before_ checking that `userId` exists, so an anonymous request gets a confusing Clerk error instead of your `'No user found'`. Do the null check first.
- **`isDev: true` is hard-coded** in `app.ts:26`. Read it from `NODE_ENV`.
- **`updatePrintModel` returns 404 for every error**, including validation and database errors.

### Frontend

- **Broken links.** `FeaturedPrintables.tsx:71` and `ModelsList.tsx:124` link to `/printable/:id`, but the route is `/printModel/:id`. The header and footer also link to many routes that don't exist (`/category/*`, `/new`, `/popular`, `/free`, `/terms`, `/admin/orders`, …), and there's no catch-all 404 route, so those pages render blank.
- **The frontend imports from the backend folder.** `Header.tsx` and `ModelsList.tsx` import `../../../backend/data/prints`. This crosses the app boundary and pulls mock data into the bundle. The admin `ModelsList` is still completely mock-driven (even the published/draft split is `index % 3`), even though `/api/usermodels` already exists.
- **The detail page fetches the entire catalogue** (`PrintablePage.tsx`) and runs `.find()` on it to show one item. Add `GET /api/printmodels/:id`.
- **Hard-coded `http://localhost:3001`** in `UploadButton.tsx` / `UploadDropZone.tsx`, while axios goes through the `/api` proxy. Use the relative `/api/uploadthing` so it works through the proxy and in production.
- **The model upload form:**
    - It has no validation. A form with an empty title will submit.
    - It gives no success or error feedback, doesn't redirect, and doesn't invalidate the `['printModels']` query, so the new model won't appear until the page is refreshed.
    - "Save as Draft" does nothing, and "Publish Model" doesn't publish (publishing depends on the checkbox).
    - The image and the 3D model both use the same `modelUploader` endpoint (`blob`, any file type), and the "Current 3D Model" preview renders a `.glb` in an `<img>` tag.
    - It sends `userId` from the client. The server overrides it, which is correct, but the client shouldn't send it at all.
- **`ModelViewer` loads `models/hook.glb`**, which doesn't exist in `public/`. It also uses a relative path, so it breaks on nested routes, and it assumes a node named `hook`.

---

## 🟡 Medium (tooling, CI, repo hygiene)

- **CI** (`.github/workflows/ci.yaml`):
    - `actions/setup-node` takes `node-version`, not `version` (line 23), so the Node version setting is ignored.
    - It only runs `pnpm lint`. Add `check-types`, `test` and `build`.
    - It only runs on pushes to `main`. Add `pull_request`.
    - `pnpm install` should be `pnpm install --frozen-lockfile`.
- **Turborepo config:**
    - `turbo.json` outputs are `.next/**`, but nothing here is Next.js. They should be `dist/**`.
    - The backend has no `lint` or `check-types` script, and the frontend has no `check-types` script, so `turbo run lint` / `check-types` skip most of the code.
    - Add a `test` task to Turbo.
- **Starter leftovers.** `packages/ui` (button/card/code + turbo generators), `packages/eslint-config/next.js`, and `typescript-config/nextjs.json` aren't used by either app. Either remove them or actually use the shared configs (the frontend has its own ESLint config and the backend has none).
- **Version drift.** Root TypeScript is `5.8.2` and the frontend's is `~5.7.2`. The frontend has three different form approaches installed (`react-hook-form` + `@hookform/resolvers`, `@tanstack/react-form`, and shadcn `form.tsx`, which is built on RHF). Pick one; TanStack Form is the one actually in use.
- **`three`, `@react-three/fiber` and `@react-three/drei` are in `devDependencies`** but used at runtime. Vite bundles them so it works, but they belong in `dependencies`.
- **Root `eslint.config.mjs`** imports `@eslint/js` and `typescript-eslint`, which aren't in the root `package.json`.
- **Formatting isn't consistent.** `.prettierrc` says 4 spaces and single quotes, but a lot of files (`ModelsList`, `ModelsAdminPage`, `NewModelPage`, `services/*`, `routes/*`) use 2 spaces, double quotes or no semicolons. Run `pnpm format` once and add `format:check` to CI.
- **Tests:**
    - `"test": "vitest run test"` only runs files whose path matches "test". Plain `vitest run` is clearer.
    - Importing `app` pulls in `utils/db`, which builds a `Sequelize` from `DATABASE_URL`. The health-check test probably only passes on your machine because you have a `.env`, and it will fail in CI. Consider a test database (for example a Postgres service container in CI) or making the database connection lazy.
    - Tests live in `src/tests/` and will be compiled into the build output. Exclude them in `tsconfig`.
    - `testSetup.ts` is empty.
- **Leftover debug code.** `console.log('goes here, services')`, several `console.log`s in the upload form, the `<button>ASDASD</button>` on `UploadPage`, and the `alert()`s.
- **`index.html`** still has the title "Vite + React + TS" and the Vite favicon.
- **README / onboarding.** There are no setup steps and no list of the environment variables needed (`DATABASE_URL`, `UPLOADTHING_TOKEN`, `CLERK_*`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_APP_PUBLIC_POSTHOG_*`). Add an `.env.example` for each app. The TODO list is also out of date (auth and the admin page are partly done). `apps/frontend/README.md` is the unchanged Vite template.
- **Unused config values.** `config.ts` exports `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` but nothing uses them (Clerk reads the env directly), and the `!` assertions hide missing environment variables until something breaks at runtime. Validate the environment once at startup, for example with zod, and fail fast with a clear message.

---

## 🔵 Architecture & direction

- **Share types across the monorepo.** There are three separate model shapes: backend `types.ts` (which has a stale `Printable` with `creator`, `category` and `reviews` that no longer exist), backend `PrintModelAttributes`, and frontend `types/index.ts`. Turborepo is already set up, so a `packages/shared` (or `packages/schemas`) with zod schemas and `z.infer` types would give you validation and types from one source for both apps.
- **Decide on the domain and its naming.** The code switches between "printable", "printModel", "model" and "print model", and the product page still contains template copy about **PDF/PNG/SVG, 300 DPI, Letter size, "Any PDF Reader"**, which describes printable planners, not 3D-print models. Pick one term (e.g. `Model` or `Design`) and remove the planner-template content. The same goes for tabs and categories ("Planners", "Wall Art", "Educational") that filter nothing.
- **Categories.** The UI is built around categories, but the database has no category column or table. Add a migration (a `categories` table plus a foreign key) once you settle on the taxonomy.
- **Business logic in the UI.** "Printed Model Price = price × 3" (`PrintablePage.tsx:167`) is pricing logic. It belongs on the server, especially once Stripe is involved.
- **A lot of commented-out code** (creator, reviews, originalPrice, category). Either delete it (git remembers it) or turn it into TODO issues. As it stands it makes the components hard to read.
- **Component size and duplication.** `PrintablePage.tsx` is about 430 lines. `HomePage.tsx` repeats the same grid five times. The star-rating markup is written three different ways, and the half-star ternary branches give identical classes. Small extractions like `<RatingStars/>`, `<ModelGrid/>` and `<Price/>` would help a lot.
- **Folder structure.** Everything is flat in `components/`. Consider `pages/` (route components), `features/admin`, `features/catalog`, and `components/` for shared pieces.
- **Admin access in the UI.** The "Admin", "Upload" and "Model Viewer" header links are shown to everyone. Hide them for non-admins. This is cosmetic only; the real protection is the server-side fix in Critical #1.

---

## Suggested order of work

1. Commit or remove `TokenDebugger` so the frontend builds.
2. Add an auth + admin middleware and put it on `POST` / `PUT`. Add zod validation for request bodies.
3. Make the public list show only published models and leave out `fileUrl`. Add `GET /printmodels/:id`.
4. Add async error handling (Express 5 or a wrapper) and a final error-handling middleware.
5. Fix the backend build: `outDir`, the migration glob, and the `start` script. Delete `models/index.ts`, the `User` model and the `users` table.
6. Fix CI: `node-version`, `check-types` / `test` / `build`, Turbo `dist/**` outputs, and add lint + type-check scripts to the backend.
7. Remove the mock-data imports from the frontend, wire the admin list to the real API, and fix the `/printable` links plus add a 404 route.
8. Create a shared zod schema package and remove the duplicate types.
9. Domain cleanup: naming, categories, money as cents, and removing the planner-template copy.
10. Then the features: downloads, Stripe and reviews.
