import type { ShippingAddress } from '@app/shared';
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
     * Refunds `amountCents` of a payment. `idempotencyKey` makes a repeated request (a double click, a retry)
     * return the first refund instead of refunding again.
     */
    refund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string }): Promise<void>;
    /** How much of a payment has been refunded so far, in cents, whoever refunded it (us or Stripe's dashboard). */
    getRefundedCents(paymentIntentId: string): Promise<number>;
    /**
     * Checks a webhook's signature against its raw body and returns what it's about, or `null` for events the
     * shop doesn't handle. Throws {@link WebhookSignatureError} if it isn't from Stripe. `null` itself when no
     * webhook signing secret is configured.
     */
    verifyWebhook: ((rawBody: string, signature: string) => Promise<PaymentEvent | null>) | null;
}

/** A webhook event the shop acts on: a Checkout Session changed, or a payment was (partly) refunded. */
export type PaymentEvent = { kind: 'checkout'; sessionId: string } | { kind: 'refund'; paymentIntentId: string };

/** Stripe refused or failed to make a refund; `message` is Stripe's own explanation. */
export class RefundError extends Error {}

export interface CreateCheckoutInput {
    orderId: string;
    email: string;
    lines: { name: string; unitAmountCents: number; quantity: number }[];
    /**
     * For an order with prints: the shipping charge, shown as `label`, and the countries Stripe accepts a
     * shipping address in (it asks for one, and a phone number for the delivery notice). `null`: nothing ships.
     */
    shipping: { amountCents: number; label: string; countries: readonly string[] } | null;
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
    /** The address the buyer entered, when the session asked for one. */
    shippingAddress: ShippingAddress | null;
}

export class WebhookSignatureError extends Error {}

/** The events about Checkout Sessions that change an order. */
const CHECKOUT_EVENTS = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
]);

/** Events about refunds: made (in full or part), or a pending refund that later succeeded or failed. */
const REFUND_EVENTS = new Set(['charge.refunded', 'charge.refund.updated']);

/** Payment intent states after which a completed but unpaid session will never be paid. */
const FAILED_INTENT_STATES = new Set(['canceled', 'requires_payment_method']);

/** Stripe may add statuses; anything new is treated as still open, so nothing is decided on it. */
function sessionStatus(status: string | null): CheckoutState['status'] {
    return status === 'complete' || status === 'expired' ? status : 'open';
}

function shippingAddressOf(session: Stripe.Checkout.Session): ShippingAddress | null {
    const details = session.collected_information?.shipping_details;
    const address = details?.address;
    if (!details || !address?.line1 || !address.postal_code || !address.city || !address.country) return null;
    return {
        name: details.name,
        phone: session.customer_details?.phone ?? null,
        line1: address.line1,
        line2: address.line2 || null,
        postalCode: address.postal_code,
        city: address.city,
        country: address.country,
    };
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
        async createCheckout({ orderId, email, lines, shipping, successUrl, cancelUrl, expiresAt }) {
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
                    ...(shipping && {
                        shipping_address_collection: {
                            allowed_countries:
                                shipping.countries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
                        },
                        shipping_options: [
                            {
                                shipping_rate_data: {
                                    type: 'fixed_amount',
                                    display_name: shipping.label,
                                    fixed_amount: { amount: shipping.amountCents, currency: 'eur' },
                                },
                            },
                        ],
                        phone_number_collection: { enabled: true },
                    }),
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
                shippingAddress: shippingAddressOf(session),
            };
        },

        async refund({ paymentIntentId, amountCents, idempotencyKey }) {
            try {
                await stripe.refunds.create(
                    { payment_intent: paymentIntentId, amount: amountCents, reason: 'requested_by_customer' },
                    { idempotencyKey },
                );
            } catch (error) {
                // Stripe's refusals (already refunded, too old, insufficient balance) are for the admin to read.
                if (error instanceof Stripe.errors.StripeInvalidRequestError) throw new RefundError(error.message);
                throw error;
            }
        },

        async getRefundedCents(paymentIntentId) {
            const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
            const charge = intent.latest_charge;
            return charge && typeof charge === 'object' ? charge.amount_refunded : 0;
        },

        verifyWebhook: webhookSecret
            ? async (rawBody, signature) => {
                  let event: Stripe.Event;
                  try {
                      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
                  } catch (error) {
                      throw new WebhookSignatureError(error instanceof Error ? error.message : 'Invalid signature');
                  }
                  if (CHECKOUT_EVENTS.has(event.type)) {
                      const session = event.data.object as { object?: string; id?: string };
                      return session.object === 'checkout.session' && session.id
                          ? { kind: 'checkout', sessionId: session.id }
                          : null;
                  }
                  if (REFUND_EVENTS.has(event.type)) {
                      // A charge (charge.refunded) or a refund (charge.refund.updated): both name the payment.
                      const object = event.data.object as { payment_intent?: string | { id: string } | null };
                      const intent = object.payment_intent;
                      const paymentIntentId = typeof intent === 'string' ? intent : intent?.id;
                      return paymentIntentId ? { kind: 'refund', paymentIntentId } : null;
                  }
                  return null;
              }
            : null,
    };
}
