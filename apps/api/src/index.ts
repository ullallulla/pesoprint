import { verifyWebhook } from '@clerk/backend/webhooks';
import { serve } from '@hono/node-server';

import packageJson from '../package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { createDatabase, pingDatabase } from './db/client.ts';
import { loadEnv } from './env.ts';
import { createConsoleMailer, createResendMailer } from './integrations/email.ts';
import { createStorageFromEnv } from './integrations/s3.ts';
import { createStripePayments } from './integrations/stripe.ts';
import { createClerkTokenVerifier } from './lib/auth.ts';
import { createIpHasher } from './lib/client-ip.ts';
import { flushSentry, initSentry } from './lib/sentry.ts';
import { createAdminOrdersService } from './services/admin-orders.ts';
import { createAdminReviewsService } from './services/admin-reviews.ts';
import { createCartService } from './services/cart.ts';
import { createCatalogService } from './services/catalog.ts';
import { createCategoriesService } from './services/categories.ts';
import { createDownloadsService } from './services/downloads.ts';
import { createFavouritesService } from './services/favourites.ts';
import { createLibraryService } from './services/library.ts';
import { createMaterialsService } from './services/materials.ts';
import { createOrderEmailsService } from './services/order-emails.ts';
import { createOrdersService } from './services/orders.ts';
import { createProductMediaService } from './services/product-media.ts';
import { createProductsService } from './services/products.ts';
import { createRefundsService } from './services/refunds.ts';
import { createReviewsService } from './services/reviews.ts';
import { createUsersService } from './services/users.ts';

const env = loadEnv();
if (!initSentry(env)) {
    console.warn('SENTRY_DSN is not set: errors are only logged here, not reported to Sentry.');
}
const { db, pool } = createDatabase(env.DATABASE_URL);

const signingSecret = env.CLERK_WEBHOOK_SIGNING_SECRET;
if (!signingSecret) {
    console.warn('CLERK_WEBHOOK_SIGNING_SECRET is not set: POST /api/webhooks/clerk will answer 503.');
}

const storage = createStorageFromEnv(env);
if (!storage) {
    console.warn('S3_* storage settings are not set: the upload endpoints will answer 503.');
}

const downloads = createDownloadsService(db, storage, createIpHasher(env.IP_HASH_SECRET));

const payments = env.STRIPE_SECRET_KEY
    ? createStripePayments({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET })
    : null;
if (!payments) {
    console.warn('STRIPE_SECRET_KEY is not set: checkout will answer 503.');
} else if (!payments.verifyWebhook) {
    console.warn('STRIPE_WEBHOOK_SECRET is not set: POST /api/webhooks/stripe will answer 503.');
}
// Stripe sends buyers back to the web app, and emails link to it: the first of its origins.
const siteUrl = env.WEB_ORIGINS[0]!;

const mailer = env.RESEND_API_KEY
    ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO })
    : env.NODE_ENV === 'production'
      ? null
      : createConsoleMailer();
if (!env.RESEND_API_KEY) {
    console.warn(
        mailer
            ? 'RESEND_API_KEY is not set: order emails are printed here instead of sent.'
            : 'RESEND_API_KEY is not set: order emails are queued, and sent once it is.',
    );
}
const orderEmails = createOrderEmailsService(db, mailer, { siteUrl, subjectPrefix: env.EMAIL_SUBJECT_PREFIX });
// Send an order's email right after the change that queued it, without making the request wait for it.
const sendEmailsOf = (orderId: string) => void orderEmails.deliver(orderId);

const cart = createCartService(db, storage);
const orders = createOrdersService(db, cart, payments, { siteUrl, onEmailQueued: sendEmailsOf });

const app = createApp({
    checkDatabase: () => pingDatabase(db),
    verifySessionToken: createClerkTokenVerifier({
        secretKey: env.CLERK_SECRET_KEY,
        authorizedParties: env.WEB_ORIGINS,
    }),
    verifyClerkWebhook: signingSecret ? (request) => verifyWebhook(request, { signingSecret }) : null,
    users: createUsersService(db),
    categories: createCategoriesService(db),
    materials: createMaterialsService(db),
    products: createProductsService(db, storage),
    productMedia: createProductMediaService(db, storage),
    catalog: createCatalogService(db, storage),
    cart,
    orders,
    adminOrders: createAdminOrdersService(db, { onEmailQueued: sendEmailsOf }),
    refunds: createRefundsService(db, payments, { onEmailQueued: sendEmailsOf }),
    library: createLibraryService(db, storage),
    favourites: createFavouritesService(db, storage),
    reviews: createReviewsService(db),
    adminReviews: createAdminReviewsService(db),
    verifyStripeWebhook: payments?.verifyWebhook ?? null,
    downloads,
    internalApiSecret: env.INTERNAL_API_SECRET,
    version: packageJson.version,
    startedAt: new Date(),
    logRequests: env.LOG_REQUESTS,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Pesoprint API listening on http://localhost:${info.port} (docs: /api/docs)`);
});

// Erase old IP hashes from the download log, at startup and then daily (see IP_HASH_RETENTION_DAYS).
async function forgetOldIpHashes() {
    try {
        const erased = await downloads.forgetOldIpHashes();
        if (erased > 0) console.log(`Erased the IP hash from ${erased} old downloads.`);
    } catch (error) {
        console.error('Erasing old IP hashes failed:', error);
    }
}
void forgetOldIpHashes();
setInterval(() => void forgetOldIpHashes(), 24 * 60 * 60 * 1000).unref();

// Retry order emails that failed (or were queued while no mailer was set up), at startup and then every 5 minutes.
void orderEmails.deliver();
setInterval(() => void orderEmails.deliver(), 5 * 60 * 1000).unref();

function shutdown(signal: string) {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
        void Promise.all([pool.end(), flushSentry()]).then(() => process.exit(0));
    });
    // Force exit if connections don't close in time.
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
