import {
    isPaidStatus,
    ORDER_CURRENCY,
    PARCEL_SIZE_NAMES,
    SHIPPING_COUNTRIES,
    type CartLine,
    type CheckoutRequest,
    type CheckoutStart,
    type Order as OrderView,
} from '@app/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../db/client.ts';
import { entitlements, orderItems, orders, productFiles, products, users, type Order } from '../db/schema.ts';
import type { CheckoutState, Payments } from '../integrations/stripe.ts';
import type { AuthContext } from '../lib/auth.ts';
import { AppError, conflict, invalidField, notFound } from '../lib/errors.ts';
import type { CartService } from './cart.ts';

export interface OrdersService {
    /**
     * Prices the cart again, creates a pending order and a Stripe Checkout Session for it, and returns
     * the payment page's URL. Stripe's page asks for the shipping address when there are prints. Refuses a
     * cart that changed since the buyer saw it (409), and an order with model files unless the buyer agreed
     * to immediate delivery, giving up their right of withdrawal (400).
     */
    checkout(caller: AuthContext, request: CheckoutRequest): Promise<CheckoutStart>;
    /** One of the caller's orders. A pending one is first checked with Stripe, so it's up to date. */
    get(caller: AuthContext, orderId: string): Promise<OrderView>;
    /** Updates the order behind a Checkout Session from what Stripe says about it (webhooks call this). */
    syncCheckout(sessionId: string): Promise<void>;
}

export interface OrdersOptions {
    /** The web app's address, where Stripe sends the buyer back. No trailing slash. */
    siteUrl: string;
    now?: () => Date;
}

/** How long the buyer has on Stripe's page before the order is cancelled. Stripe allows 30 min to 24 h. */
export const CHECKOUT_EXPIRY_MINUTES = 60;

/** How a line reads on Stripe's page and receipt: "Vase (print: PLA, Black / Orange)". */
function stripeLineName(line: CartLine): string {
    if (!line.print) return line.title;
    const colour = line.print.colourName ? `, ${line.print.colourName}` : '';
    return `${line.title} (print: ${line.print.materialName}${colour})`;
}

const paymentsUnavailable = () => new AppError(503, 'internal_error', "Payments aren't set up on this server.");

export function createOrdersService(
    db: Database,
    cart: CartService,
    payments: Payments | null,
    { siteUrl, now = () => new Date() }: OrdersOptions,
): OrdersService {
    /**
     * The one place an order changes because of a payment. Safe to run any number of times and at the same
     * time (a webhook and the return page often arrive together): each change only applies to a pending
     * order, so the order is paid, and its files granted, exactly once.
     */
    async function applyCheckout(order: Order, state: CheckoutState): Promise<void> {
        if (state.paid) {
            if (state.amountTotalCents !== order.totalCents || state.currency !== ORDER_CURRENCY.toLowerCase()) {
                // Never happens unless something is badly wrong: we created the session with these amounts.
                console.error(
                    `Order ${order.id}: Stripe session ${state.id} was paid ${state.amountTotalCents} ${state.currency}, ` +
                        `but the order is ${order.totalCents} ${ORDER_CURRENCY}. Not marking it paid.`,
                );
                return;
            }
            if (order.parcelSize !== null && state.shippingAddress === null) {
                // Stripe requires an address before paying, so this shouldn't happen; the order is still paid.
                console.error(`Order ${order.id} has prints, but Stripe session ${state.id} has no shipping address.`);
            }
            await db.transaction(async (tx) => {
                const [paid] = await tx
                    .update(orders)
                    .set({
                        status: 'paid',
                        paidAt: now(),
                        paymentStatus: state.paymentStatus,
                        paymentMethod: state.paymentMethod,
                        stripePaymentIntentId: state.paymentIntentId,
                        shippingAddress: order.parcelSize === null ? null : state.shippingAddress,
                    })
                    .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
                    .returning({ userId: orders.userId });
                // Already paid by an earlier call, or the buyer's account is gone.
                if (!paid?.userId) return;
                const bought = await tx
                    .select({ productId: orderItems.productId })
                    .from(orderItems)
                    .where(and(eq(orderItems.orderId, order.id), eq(orderItems.type, 'digital')));
                if (bought.length === 0) return;
                await tx
                    .insert(entitlements)
                    .values(bought.map(({ productId }) => ({ userId: paid.userId!, productId, orderId: order.id })))
                    // Owned already (e.g. two orders paid at once): the first purchase stays the record.
                    .onConflictDoNothing();
            });
        } else if (state.failed || state.status === 'expired') {
            await db
                .update(orders)
                .set({ status: 'cancelled', paymentStatus: state.paymentStatus })
                .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')));
        } else if (state.paymentStatus !== order.paymentStatus) {
            await db
                .update(orders)
                .set({ paymentStatus: state.paymentStatus })
                .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')));
        }
    }

    async function view(order: Order): Promise<OrderView> {
        const items = await db
            .select({
                productId: orderItems.productId,
                type: orderItems.type,
                title: orderItems.titleSnapshot,
                slug: products.slug,
                print: orderItems.printSnapshot,
                unitPriceCents: orderItems.unitPriceCents,
                quantity: orderItems.quantity,
            })
            .from(orderItems)
            .innerJoin(products, eq(products.id, orderItems.productId))
            .where(eq(orderItems.orderId, order.id))
            .orderBy(asc(orderItems.id));

        const productIds = items.filter((item) => item.type === 'digital').map((item) => item.productId);
        const files =
            isPaidStatus(order.status) && productIds.length > 0
                ? await db
                      .select()
                      .from(productFiles)
                      .where(and(inArray(productFiles.productId, productIds), eq(productFiles.kind, 'download')))
                      .orderBy(asc(productFiles.position), asc(productFiles.id))
                : [];

        return {
            id: order.id,
            status: order.status,
            currency: ORDER_CURRENCY,
            subtotalCents: order.subtotalCents,
            shippingCents: order.shippingCents,
            parcelSize: order.parcelSize,
            totalCents: order.totalCents,
            taxCents: order.taxCents,
            vatRateBp: order.vatRateBp,
            shippingAddress: order.shippingAddress,
            createdAt: order.createdAt.toISOString(),
            paidAt: order.paidAt?.toISOString() ?? null,
            items: items.map((item) => ({
                ...item,
                // A print line of a model whose file is also in the order gets none: the file line has them.
                files: files
                    .filter((file) => item.type === 'digital' && file.productId === item.productId)
                    .map((file) => ({
                        id: file.id,
                        format: file.format,
                        filename: file.filename,
                        sizeBytes: file.sizeBytes,
                    })),
            })),
        };
    }

    return {
        async checkout(caller, { items, immediateDeliveryConsent }) {
            if (!payments) throw paymentsUnavailable();

            const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, caller.userId));
            if (!user) {
                // The Clerk webhook that copies new accounts here hasn't arrived yet.
                throw conflict("Your account isn't ready yet. Try again in a minute.");
            }

            const quote = await cart.quote(items, caller);
            // `issues` on `items` tells the web app to send the buyer back to the cart, which explains the change.
            if (quote.removed.length > 0) {
                const message = 'Your cart has changed. Check it and try again.';
                throw conflict(message, [{ path: 'items', message }]);
            }
            if (quote.lines.length === 0) {
                throw conflict('Your cart is empty.', [{ path: 'items', message: 'Your cart is empty.' }]);
            }
            // EU rule: a file can only be delivered before the 14-day withdrawal period ends if the buyer
            // agreed to that, knowing it ends their right of withdrawal.
            const hasFiles = quote.lines.some((line) => line.type === 'digital');
            if (hasFiles && !immediateDeliveryConsent) {
                throw invalidField(
                    'immediateDeliveryConsent',
                    'Agree to immediate delivery of the files to continue. It ends your 14-day right of withdrawal.',
                );
            }

            const orderId = await db.transaction(async (tx) => {
                const [order] = await tx
                    .insert(orders)
                    .values({
                        userId: caller.userId,
                        email: user.email,
                        subtotalCents: quote.subtotalCents,
                        shippingCents: quote.shippingCents,
                        parcelSize: quote.parcelSize,
                        taxCents: quote.taxCents,
                        totalCents: quote.totalCents,
                        vatCountry: quote.vatCountry,
                        vatRateBp: quote.vatRateBp,
                        immediateDeliveryConsentAt: hasFiles ? now() : null,
                    })
                    .returning({ id: orders.id });
                await tx.insert(orderItems).values(
                    quote.lines.map((line) => ({
                        orderId: order!.id,
                        productId: line.productId,
                        type: line.type,
                        quantity: line.quantity,
                        unitPriceCents: line.unitPriceCents,
                        titleSnapshot: line.title,
                        licenseSnapshot: line.license,
                        materialId: line.materialId,
                        printSnapshot: line.print,
                    })),
                );
                return order!.id;
            });

            let session: { id: string; url: string };
            try {
                session = await payments.createCheckout({
                    orderId,
                    email: user.email,
                    lines: quote.lines.map((line) => ({
                        name: stripeLineName(line),
                        unitAmountCents: line.unitPriceCents,
                        quantity: line.quantity,
                    })),
                    shipping: quote.parcelSize && {
                        amountCents: quote.shippingCents,
                        label: `Shipping (${PARCEL_SIZE_NAMES[quote.parcelSize]} parcel)`,
                        countries: SHIPPING_COUNTRIES,
                    },
                    successUrl: `${siteUrl}/orders/${orderId}`,
                    cancelUrl: `${siteUrl}/cart`,
                    expiresAt: new Date(now().getTime() + CHECKOUT_EXPIRY_MINUTES * 60_000),
                });
            } catch (error) {
                // Nothing can pay for this order, so it isn't kept.
                await db.delete(orders).where(eq(orders.id, orderId));
                console.error(`Couldn't create a Stripe Checkout Session for order ${orderId}:`, error);
                throw new AppError(502, 'internal_error', "Couldn't start the payment. Try again in a moment.");
            }

            await db.update(orders).set({ stripeCheckoutSessionId: session.id }).where(eq(orders.id, orderId));
            return { orderId, paymentUrl: session.url };
        },

        async get(caller, orderId) {
            const find = async () =>
                (
                    await db
                        .select()
                        .from(orders)
                        .where(and(eq(orders.id, orderId), eq(orders.userId, caller.userId)))
                )[0];
            let order = await find();
            if (!order) throw notFound('Order not found.');

            // The buyer often comes back from Stripe before the webhook: ask Stripe directly.
            if (order.status === 'pending' && order.stripeCheckoutSessionId && payments) {
                try {
                    await applyCheckout(order, await payments.getCheckout(order.stripeCheckoutSessionId));
                    order = (await find())!;
                } catch (error) {
                    // The webhook will still settle it; show the order as it is.
                    console.warn(`Couldn't check order ${order.id} with Stripe:`, error);
                }
            }
            return view(order);
        },

        async syncCheckout(sessionId) {
            if (!payments) throw paymentsUnavailable();
            const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId));
            if (!order) {
                // Another environment sharing the Stripe account (e.g. local and staging in test mode).
                console.warn(`Stripe webhook for Checkout Session ${sessionId}, which no order here uses. Ignored.`);
                return;
            }
            const state = await payments.getCheckout(sessionId);
            if (state.orderId !== null && state.orderId !== order.id) {
                console.error(`Checkout Session ${sessionId} belongs to order ${state.orderId}, not ${order.id}.`);
                return;
            }
            await applyCheckout(order, state);
        },
    };
}
