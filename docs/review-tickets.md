# Review tickets

_From a codebase review on 2026-11-23 at commit `0a53c7e`, done by three independent reviewers (Claude Opus 5.5, GPT-6.2 Sol, Gemini 4 Neon). The findings were then checked against the code._

These were already fixed in `fix/review-findings`, so they aren't here:

- the restore test broken by the production settings check
- refunds that overlap losing one
- refunding a duplicate order taking away the buyer's file
- a refund arriving before the payment is recorded
- the order page removing cart lines that weren't bought
- `WEB_ORIGINS=,` passing as an empty list

**Priority:**

- **P1:** wrong money, data or access in a situation that can really happen; or customer data leaking.
- **P2:** a real gap, but unlikely or cheap to live with for now.
- **P3:** polish, or worth knowing about.

**Status:**

- **confirmed:** the problem was checked against the code.
- **likely:** follows from the code, but wasn't reproduced.

---

## P1

### T1. Stop buyers paying twice for the same cart

- **Area:** checkout · **Status:** confirmed
- **Problem:** every click on Pay creates a new pending order and a new Stripe Checkout Session. Each one stays payable for an hour, and owned files are only filtered out once a payment is recorded. A buyer who goes back from Stripe to `/cart`, or opens checkout in two tabs, can pay twice. Since `fix/review-findings`, refunding the duplicate is safe, but it still takes the admin's time and Stripe's fees.
- **Where:** `apps/api/src/services/orders.ts` (`start`, ~L223–282)
- **Do:**
    - When a buyer starts a checkout, expire their earlier open sessions (`stripe.checkout.sessions.expire`) and cancel those pending orders.
    - Alternatively, reuse an open session if its cart and total are the same.
    - Handle the race where an expired session was paid anyway: that payment's webhook still has to be recorded.
- **Done when:** paying in a second tab after starting a checkout in the first gives one paid order, not two. There's a test.

### T2. Keep customer data out of Sentry and the public deploy logs

- **Area:** privacy · **Status:** likely
- **Problem:**
    - Every `console.error` goes to Sentry (`captureConsoleIntegration`). Drizzle's query errors include the query's parameters, so a failed update of an order's shipping address sends the buyer's name, address and phone to Sentry. The `dataCollection` settings don't cover error messages, and Sentry's scrubbing only removes emails.
    - When a deploy fails, `deploy.sh` prints the last 30 log lines of each unhealthy container, and those end up in the repository's public Actions logs.
- **Where:**
    - `apps/api/src/app.ts:108`, `apps/api/src/lib/sentry.ts:38`
    - `deploy/deploy.sh:125`, `.github/workflows/deploy-production.yml`
- **Do:**
    - Add a Sentry `beforeSend` (or a log helper) that drops query parameters from database errors (`DrizzleQueryError`: keep the message's first line and the Postgres error code).
    - In `deploy.sh`, write the container logs to a file on the host and print only its path (or only the service names and states).
- **Done when:** a test shows that a failing query's parameters don't reach the Sentry event, and a failed deploy doesn't print container output into the Actions log.

### T3. Paid and print-only models get no public 3D preview file

- **Area:** product media · **Status:** confirmed
- **Problem:**
    - Uploading an STL always makes a preview GLB in the **public** bucket, and the admin's "Generate preview" does too, whatever the model's price.
    - The API hides the URL for paid models, so today the file is only protected by its random name.
    - A model that was free and is then made paid keeps a preview whose URL was already public.
    - The plan says paid models have no public 3D view at all (`docs/plan.md` §3, decided 2026-11-13).
- **Where:** `apps/api/src/services/product-media.ts:141–160, 332–366`; `hasPublicPreview` in `packages/shared/src/pricing.ts`
- **Do:**
    - Only make previews when `hasPublicPreview(product)` is true. Answer 409 from `generatePreview` otherwise.
    - When a product stops being free to download, delete its preview file from storage.
    - Write a one-off script that lists or removes the existing previews of paid models.
- **Done when:** there are tests for both cases (an upload to a paid model makes no preview, and a free model made paid loses its preview), and the one-off cleanup has run on production.

### T4. Admin pages: show Stripe's refusal and the real reason for a 503

- **Area:** admin web · **Status:** confirmed
- **Problem:**
    - `runAction` turns only 400, 404, 409 and 503 into a form message. When Stripe refuses a refund, the API answers 502 with Stripe's reason, but the admin gets the error page instead.
    - Every 503 is shown as "File storage is not configured…", even when it's payments that aren't set up.
- **Where:** `apps/web/app/lib/admin.server.ts:70–89`, used by `apps/web/app/routes/admin/order.tsx:48`
- **Do:** handle 502 too, and show the API's own message for 502 and 503.
- **Done when:** there's a test where a refund refused by Stripe shows the refusal on the order page.

### T5. Clerk user sync: deletions that fail for good, and deleted users coming back

- **Area:** users · **Status:** foreign key confirmed; event order likely
- **Problem:**
    - **Deleting a product creator fails every time.** `user.deleted` for someone who created products hits `products.creator_id ON DELETE RESTRICT`. The webhook answers 500 and Svix retries for days, each retry reported to Sentry. The leftover row keeps its email, so a new account with that email fails `users.email UNIQUE`, and then hits "Your account isn't ready yet" at checkout.
    - **Deleted users can come back.** Svix doesn't guarantee event order, so a retried `user.created` or `user.updated` that arrives after `user.deleted` puts the deleted person's data back.
- **Where:** `apps/api/src/routes/webhooks.ts:104–115`, `apps/api/src/services/users.ts`
- **Do:**
    - Deleting a user who owns products: anonymise the row (clear the email and name, keep the id), answer 200, and log it.
    - Ignore `user.created` and `user.updated` older than the row's `updated_at` (Clerk sends `data.updated_at`), and keep a tombstone (e.g. `deleted_at`) so deleted ids aren't re-created.
- **Done when:** there are tests for deleting a creator, and for an update that arrives after the deletion.

### T6. A Postgres restart crashes the API

- **Area:** reliability · **Status:** confirmed
- **Problem:** `pg.Pool` has no `error` listener. When Postgres drops idle connections (e.g. when its container restarts), the pool's `error` event becomes an uncaught exception, so the API exits. Docker restarts it, but the requests in flight fail.
- **Where:** `apps/api/src/db/client.ts:9`
- **Do:**
    - Add `pool.on('error', …)` that logs the error.
    - Consider `connectionTimeoutMillis` and a `statement_timeout`, so a stuck query can't hold a request forever.
- **Done when:** restarting the postgres container while the API runs doesn't restart the API.

### T7. Checkout charges a changed total without asking

- **Area:** checkout · **Status:** confirmed
- **Problem:**
    - The interface's comment says checkout refuses a cart that changed since the buyer saw it. Only removed items cause a 409, though. A price change between the checkout page and Pay opens Stripe at the new total; Stripe shows it, but our page said something else.
    - `checkoutRequestSchema` also skips the `MAX_PRINT_LINES` limit that `cartItemsSchema` has.
- **Where:**
    - `apps/api/src/services/orders.ts:28–30, ~204`
    - `apps/web/app/routes/checkout.tsx`
    - `packages/shared/src/checkout.ts:10`
- **Do:**
    - Send the quoted `totalCents` with the checkout request, and answer 409 (`items`) when the new price differs, so the web sends the buyer back to the cart.
    - Build `checkoutRequestSchema.items` from `cartItemsSchema` plus `.min(1)`.
- **Done when:** there's a test where a price changed after the quote gives a 409, and no order or session is created.

### T8. A paid webhook can't find its order if saving the session id failed

- **Area:** checkout · **Status:** confirmed
- **Problem:**
    - The Checkout Session id is saved on the order in a separate update, after Stripe created the session.
    - `syncCheckout` finds orders only by that column. If that update failed (the database blipped), the paid webhook logs "no order here uses it" and answers 200. The money is taken and the order stays pending.
- **Where:** `apps/api/src/services/orders.ts:281, 375`
- **Do:** when no order has the session id, fall back to `state.orderId` from the session's metadata, and check that order's id and amount. Save the session id at that point.
- **Done when:** there's a test where an order without a session id is paid by its webhook.

---

## P2

### T9. A failed or reversed refund is only logged

- **Area:** refunds · **Status:** confirmed
- **Problem:** when Stripe's refunded total goes down (a pending refund failed), `applyRefunded` only does `console.error`. The order keeps showing the old amount, and for a full refund the files stay revoked although the money is back with us.
- **Where:** `apps/api/src/services/refunds.ts` (`applyRefunded`)
- **Do:**
    - Decide what should happen: record the lower amount, and if the order is no longer fully refunded, set it back to its earlier status and grant the files again.
    - At least, show the admin something more visible than a log line (a flag on the order).
    - Pairs with the plan's "Partial refunds" item: tracking refunds by Stripe refund id makes this simple (see T24).

### T10. Chargebacks aren't handled

- **Area:** payments · **Status:** confirmed
- **Problem:** `charge.dispute.*` isn't one of the webhook events the shop handles. A buyer who wins a chargeback keeps the files, and the order stays "paid". Nobody is told except by Stripe's own email.
- **Where:** `apps/api/src/integrations/stripe.ts:78–87`
- **Do:**
    - Handle `charge.dispute.created`: log it as an error (it goes to Sentry) and flag the order in the admin.
    - Decide later whether a lost dispute revokes the files.

### T11. A print can be paid for after its material runs out

- **Area:** checkout · **Status:** likely
- **Problem:** stock is checked when the session is created, and the session stays payable for an hour. If the material or colour is marked out of stock in between, the order still arrives in the print queue as paid.
- **Where:** `apps/api/src/services/cart.ts:~189`, `apps/api/src/services/orders.ts`
- **Do:** the cheapest fix is that `applyCheckout` re-checks stock for print lines and flags (doesn't reject) an order that can't be printed, so the admin contacts the buyer or refunds. Optionally, expire open sessions that contain the material when it's marked out of stock.

### T12. Shipping ignores quantity

- **Area:** shipping · **Status:** confirmed (documented interim rule)
- **Problem:** an order ships "in one parcel the size of its largest print" (`packages/shared/src/shipping.ts`), so one large print and ten cost the same €9.90 to ship, even when ten don't fit one parcel.
- **Where:** `apps/api/src/services/cart.ts:201–220`, `packages/shared/src/shipping.ts`
- **Do:** before zone shipping (M6), decide one of:
    - limit the quantity per order so the one-parcel rule holds;
    - add a parcel-size step-up by total quantity;
    - price parcels by count.

### T13. An archived model can lose the last file buyers paid for

- **Area:** product media · **Status:** confirmed
- **Problem:** `assertStillPublishable` only guards published products. Once a model is archived, its last downloadable file can be deleted from the database and storage. Buyers who own it then have an empty entry in their library.
- **Where:** `apps/api/src/services/product-media.ts:116–125, 402`
- **Do:** refuse (409) removing the last download file of a product that has entitlements, whatever its status ("upload the replacement first").

### T14. Big STL uploads can stall or crash the API

- **Area:** reliability · **Status:** likely
- **Problem:**
    - Preview generation reads up to 200 MB (`PREVIEW_MAX_SOURCE_BYTES`) into memory, parses ASCII STL with a regex over the whole string, and simplifies the mesh on the main thread, all inside the admin's request.
    - The containers have no memory limits.
    - A big upload can block every shopper's requests, outlast the web's 20 s API timeout (the admin sees "API unavailable"), or get the API killed for running out of memory.
- **Where:** `apps/api/src/lib/model-preview.ts:18–60`, `apps/api/src/services/product-media.ts:141–160`, `deploy/docker-compose.prod.yml`
- **Do:**
    - Run preview generation in a `worker_thread`, outside the request: answer right away and make the preview in the background.
    - Lower the limit for ASCII STL.
    - Set `mem_limit` on the containers so a runaway process is contained.

### T15. Rate-limit checkout and cap request bodies

- **Area:** abuse · **Status:** confirmed
- **Problem:**
    - `POST /api/checkout` has no rate limit, so a signed-in user can create pending orders and Stripe sessions in a loop (filling `orders`, hitting Stripe's rate limits).
    - Request bodies have no size limit on the API (no Hono `bodyLimit`) or on the site host in Caddy. Only the webhook host has `max_size 1MB`.
- **Where:** `apps/api/src/routes/orders.ts`, `apps/api/src/app.ts`, `deploy/Caddyfile`
- **Do:**
    - Limit checkouts per user (e.g. 10 per 10 minutes, using the same approach as the download limit).
    - Add `bodyLimit` to the API (JSON routes, e.g. 100 KB; uploads go straight to R2).
    - Add a `request_body { max_size … }` to the site in Caddy.

### T16. The site sends no security headers

- **Area:** hardening · **Status:** confirmed
- **Problem:** no `Content-Security-Policy` or `frame-ancestors`, no `X-Content-Type-Options` or `Referrer-Policy`, and HSTS only if Cloudflare adds it. The admin pages can be framed by other sites (SameSite=Lax limits the damage).
- **Where:** `deploy/Caddyfile` (or `apps/web/server.ts`)
- **Do:**
    - Add a `header` block in Caddy with `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: frame-ancestors 'none'` and HSTS.
    - Leave a full CSP for later: Clerk, Stripe, PostHog and the model viewer each need entries.

### T17. Tighten the admin's cross-site check

- **Area:** admin web · **Status:** confirmed
- **Problem:** `requireSession` lets `Origin: null` through, which is what sandboxed iframes send. Also, `new URL(origin)` throws on a malformed header, which becomes a 500 and a Sentry event.
- **Where:** `apps/web/app/lib/admin.server.ts:22–35`
- **Do:** refuse `null` on POST, PUT, PATCH and DELETE; wrap the parse and answer 403 when it fails. Optionally, check `Sec-Fetch-Site` when there's no `Origin`.

### T18. Missing indexes and a quantity check

- **Area:** database · **Status:** confirmed
- **Problem:**
    - `order_items` has no index that starts with `order_id`: the unique index on (order, product) only covers file lines (`WHERE type = 'digital'`).
    - `entitlements.order_id` and `order_items.material_id` have no index either.
    - So order views, emails and the refund's entitlement lookup read the whole table. That's harmless at today's size and gets worse as orders grow.
    - `order_items.quantity` has no `CHECK (quantity > 0)`.
- **Where:** `apps/api/src/db/schema.ts:~437, 472`
- **Do:** one migration adding `order_items(order_id)`, `order_items(material_id)`, `entitlements(order_id)` and the CHECK.

---

## P3

### T19. `check-env` mis-reads some database passwords

- **Area:** deploy · **Status:** confirmed
- **Problem:** `parse_database_url` decodes the password with `printf '%b'`, which also turns backslash sequences (`\n`, `\t`) into characters. It then splits its output on newlines. A password with a backslash, or with `%0A` in it, is reported as wrong although it's valid.
- **Where:** `deploy/bin/check-env:133–139`
- **Do:** decode only `%XX` sequences, and pass the fields NUL-separated (`printf '%s\0'`, `mapfile -d ''`).

### T20. The product page makes more API calls than it needs

- **Area:** web performance · **Status:** confirmed
- **Problem:**
    - The loader waits for the product before fetching reviews, although the reviews only need the slug from the URL.
    - `getOwned`, `getMyReview` and `isFavourite` each call `getAuth()` and `getToken()` on their own.
- **Where:** `apps/web/app/routes/product.tsx:49–58`, `apps/web/app/lib/{library,reviews,favourites}.server.ts`
- **Do:**
    - Fetch the reviews in the first `Promise.all`, using `args.params.slug`.
    - Get the token once and pass it down.
    - Later, maybe one "me and this product" endpoint.

### T21. Write down that the download limit resets at midnight UTC

- **Area:** docs · **Status:** confirmed
- **Problem:** the IP hash includes the UTC date and the limit counts per hash, so a visitor can get the daily limit at 23:59 and again at 00:00. That's acceptable for the purpose; it just isn't written down.
- **Where:** `apps/api/src/lib/client-ip.ts:46–50`
- **Do:** note it next to the limit, or count over the last 24 hours across two days' hashes if it ever matters.

### T22. Check that staging has the production settings

- **Area:** ops · **Status:** to check
- **Problem:** staging on Render runs the production image (`NODE_ENV=production`), and since #7 both the API and the web refuse to start without every production setting. If staging lacks one (e.g. `SENTRY_DSN`, `INTERNAL_API_SECRET`, `IP_HASH_SECRET`, `RESEND_API_KEY`), its next deploy fails to start.
- **Do:** compare Render's settings with `PRODUCTION_KEYS` (`apps/api/src/env.ts`) and the web's list (`apps/web/app/env.server.ts`). Write in the README which settings staging needs.

---

## Plan (`docs/plan.md`)

### T23. Decide how checkout learns the buyer's country (VAT by country, zone shipping)

- **Problem:**
    - Today VAT and shipping are fixed on our server before the Stripe session exists (`SHOP_VAT_COUNTRY`, one parcel price), and Stripe collects the address afterwards, only for orders with prints. A files-only order never gives a country.
    - VAT by the buyer's country (§9 #2, M6) and zone shipping both need the country **before** pricing.
    - With zone shipping, the buyer could also enter a different country on Stripe than the one we priced.
- **Do:** update the plan to commit to:
    - asking for the country on our checkout page, and storing it with the order as VAT evidence (OSS needs two pieces of evidence that agree);
    - for orders with prints, sending the address to Stripe instead of letting Stripe collect it, or rejecting a paid address outside the priced zone;
    - whether prices including VAT stay the same in every country (our net varies) or change per country (the cart has to know the country).

### T24. Partial refunds: key by Stripe refund, and record which order line granted which file

- **Problem:**
    - The plan's partial-refund emails use "a key per refunded amount". Two equal refunds on one order (two €4.90 prints) would then send one email.
    - An entitlement points to one order, which `fix/review-findings` works around by granting the files again from other paid orders. Per-line refunds ("close without shipping", refunding one file) need to know which line granted the file.
- **Do:**
    - Key refund emails by Stripe's refund id. That means reading refund objects instead of only `charge.amount_refunded`, which also makes T9 simple.
    - Before building per-line refunds, add a link from order items to entitlements, or keep one entitlement per order line.

### T25. Remove the outdated 3D preview sentence

- **Problem:** `docs/plan.md:188` says "The 3D viewer is public on every product, including paid ones". The next bullet, the 2026-11-13 decision, says paid and print-only models have no public 3D view.
- **Do:** delete or rewrite the first sentence, and link T3.

### T26. Digital-only orders outside `/admin/orders`

- **Problem:** files-only orders aren't shown in the admin's order list (M4), and are handled in Stripe's dashboard. That's fine for full refunds today, but VAT invoices and credit notes (M6) and partial refunds need a shop-side record of every order.
- **Do:** note in M6 that the admin order list (or a separate "all orders" view) will include files-only orders.
