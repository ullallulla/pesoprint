import Stripe from 'stripe';

/**
 * Everything the shop needs from Stripe, behind a small interface so tests can use a fake. Stripe Checkout
 * is Stripe's hosted payment page: we create a Checkout Session with the order's lines and amounts, send
 * the buyer to its URL, and learn the outcome from webhooks or by asking Stripe for the session.
 */
export interface Payments {
    createCheckout(input: CreateCheckoutInput): Promise<{ id: string; url: string }>;
    getCheckout(sessionId: string): Promise<CheckoutState>;
    /**
     * Checks a webhook's signature against its raw body and returns the Checkout Session it's about, or
     * `null` for events the shop doesn't handle. Throws {@link WebhookSignatureError} if it isn't from Stripe.
     * `null` itself when no webhook signing secret is configured.
     */
    verifyWebhook: ((rawBody: string, signature: string) => Promise<{ sessionId: string } | null>) | null;
}

export interface CreateCheckoutInput {
    orderId: string;
    email: string;
    lines: { name: string; unitAmountCents: number; quantity: number }[];
    successUrl: string;
    cancelUrl: string;
    /** Stripe allows 30 minutes to 24 hours. */
    expiresAt: Date;
}

/** What the shop needs to know about a Checkout Session. */
export interface CheckoutState {
    id: string;
    /** From the session's metadata: the order it was created for. */
    orderId: string | null;
    /** `complete` once the buyer finished on Stripe's page; not necessarily paid yet (bank transfers). */
    status: 'open' | 'complete' | 'expired';
    paid: boolean;
    /** The payment was tried and failed for good (e.g. a delayed bank payment bounced). */
    failed: boolean;
    paymentStatus: string;
    amountTotalCents: number | null;
    /** Lower case, e.g. `eur`. */
    currency: string | null;
    paymentIntentId: string | null;
    paymentMethod: string | null;
}

export class WebhookSignatureError extends Error {}

/** The events about Checkout Sessions that change an order. */
const CHECKOUT_EVENTS = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
]);

/** Payment intent states after which a completed but unpaid session will never be paid. */
const FAILED_INTENT_STATES = new Set(['canceled', 'requires_payment_method']);

/** Stripe may add statuses; anything new is treated as still open, so nothing is decided on it. */
function sessionStatus(status: string | null): CheckoutState['status'] {
    return status === 'complete' || status === 'expired' ? status : 'open';
}

export function createStripePayments({
    secretKey,
    webhookSecret,
}: {
    secretKey: string;
    webhookSecret: string | undefined;
}): Payments {
    const stripe = new Stripe(secretKey, {
        // Each instance keeps a pool of connections; retries cover brief network errors.
        maxNetworkRetries: 2,
        appInfo: { name: 'Pesoprint' },
    });

    return {
        async createCheckout({ orderId, email, lines, successUrl, cancelUrl, expiresAt }) {
            const session = await stripe.checkout.sessions.create(
                {
                    mode: 'payment',
                    line_items: lines.map((line) => ({
                        quantity: line.quantity,
                        price_data: {
                            currency: 'eur',
                            unit_amount: line.unitAmountCents,
                            product_data: { name: line.name },
                        },
                    })),
                    customer_email: email,
                    client_reference_id: orderId,
                    metadata: { order_id: orderId },
                    payment_intent_data: { metadata: { order_id: orderId } },
                    success_url: successUrl,
                    cancel_url: cancelUrl,
                    expires_at: Math.floor(expiresAt.getTime() / 1000),
                },
                // A retried request for the same order gets the same session instead of a second one.
                { idempotencyKey: `checkout-${orderId}` },
            );
            if (!session.url) throw new Error(`Stripe returned Checkout Session ${session.id} without a URL`);
            return { id: session.id, url: session.url };
        },

        async getCheckout(sessionId) {
            const session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ['payment_intent.payment_method'],
            });
            const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
            const method = intent && typeof intent.payment_method === 'object' ? intent.payment_method : null;
            const paid = session.payment_status === 'paid';
            return {
                id: session.id,
                orderId: session.metadata?.order_id ?? null,
                status: sessionStatus(session.status),
                paid,
                failed: !paid && session.status === 'complete' && !!intent && FAILED_INTENT_STATES.has(intent.status),
                paymentStatus: session.payment_status,
                amountTotalCents: session.amount_total,
                currency: session.currency,
                paymentIntentId:
                    intent?.id ?? (typeof session.payment_intent === 'string' ? session.payment_intent : null),
                paymentMethod: method?.type ?? null,
            };
        },

        verifyWebhook: webhookSecret
            ? async (rawBody, signature) => {
                  let event: Stripe.Event;
                  try {
                      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
                  } catch (error) {
                      throw new WebhookSignatureError(error instanceof Error ? error.message : 'Invalid signature');
                  }
                  if (!CHECKOUT_EVENTS.has(event.type)) return null;
                  const session = event.data.object as { object?: string; id?: string };
                  return session.object === 'checkout.session' && session.id ? { sessionId: session.id } : null;
              }
            : null,
    };
}
