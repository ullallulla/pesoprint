import { cartItemKey, formatVatRate, type CartQuote } from '@app/shared';
import { SignInButton } from '@clerk/react-router';
import { getAuth } from '@clerk/react-router/server';
import { Lock } from 'lucide-react';
import { Form, Link, redirect, useNavigation } from 'react-router';

import { Button } from '~/components/ui/button';
import { ApiRequestError } from '~/lib/api.server';
import { quoteCart, readCart } from '~/lib/cart.server';
import { printOptionText } from '~/lib/print-option';
import { formatPrice } from '~/lib/format';
import { isCartChanged, startCheckout } from '~/lib/orders.server';

import type { Route } from './+types/checkout';

export const meta: Route.MetaFunction = () => [
    { title: 'Checkout – Pesoprint' },
    { name: 'robots', content: 'noindex' },
];

/**
 * The last look before paying: what's being bought and the total with its VAT, priced by the API. Paying
 * needs an account, so the files can be downloaded again later. Anything the cart page would have to
 * explain (something no longer for sale, or already owned) sends the buyer back there.
 */
export async function loader(args: Route.LoaderArgs) {
    const items = await readCart(args.request);
    if (items.length === 0) throw redirect('/cart');
    const [{ isAuthenticated }, quote] = await Promise.all([getAuth(args), quoteCart(args, items)]);
    if (quote.removed.length > 0 || quote.lines.length === 0) throw redirect('/cart');
    return { quote, signedIn: isAuthenticated };
}

const CONSENT_FIELD = 'immediateDeliveryConsent';
const CONSENT_MISSING = 'Tick the box to continue. We can only deliver the files right away if you agree to it.';

/** Creates the order and sends the buyer to Stripe's payment page. */
export async function action(args: Route.ActionArgs) {
    const { isAuthenticated } = await getAuth(args);
    if (!isAuthenticated) return redirect('/checkout');
    const items = await readCart(args.request);
    if (items.length === 0) return redirect('/cart');

    // The box is `required`, so this only happens without the browser's check. The API checks it too.
    const immediateDeliveryConsent = (await args.request.formData()).get(CONSENT_FIELD) === 'yes';
    if (!immediateDeliveryConsent) return { error: CONSENT_MISSING, consentMissing: true };

    try {
        const { paymentUrl } = await startCheckout(args, { items, immediateDeliveryConsent });
        return redirect(paymentUrl);
    } catch (error) {
        if (isCartChanged(error)) return redirect('/cart');
        // Stripe unreachable or not set up, or the account is still being created: say so and stay here.
        if (error instanceof ApiRequestError && [409, 502, 503].includes(error.status)) {
            return { error: error.message };
        }
        throw error;
    }
}

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
    const { quote, signedIn } = loaderData;
    const hasPrints = quote.lines.some((line) => line.type === 'print');
    const navigation = useNavigation();
    const paying = navigation.state !== 'idle' && navigation.formAction === '/checkout';

    return (
        <main className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10'>
            <div className='flex flex-col gap-2'>
                <h1 className='text-3xl font-bold tracking-tight'>Checkout</h1>
                <p className='text-muted-foreground'>
                    <Link to='/cart' className='underline underline-offset-4 hover:text-foreground'>
                        Back to cart
                    </Link>
                </p>
            </div>

            <OrderSummary quote={quote} />

            {hasPrints ? (
                <div className='flex flex-col gap-2 rounded-lg border bg-muted/50 p-5'>
                    <p className='font-medium'>Printed copies can&apos;t be paid for just yet</p>
                    <p className='text-sm text-muted-foreground'>
                        Print orders open very soon. To buy model files now,{' '}
                        <Link to='/cart' className='underline underline-offset-4 hover:text-foreground'>
                            remove the prints from your cart
                        </Link>
                        .
                    </p>
                </div>
            ) : signedIn ? (
                <Form method='post' className='flex flex-col gap-3'>
                    <ImmediateDeliveryConsent invalid={actionData?.consentMissing === true} />
                    {actionData?.error && (
                        <p id='checkout-error' role='alert' className='text-sm text-destructive'>
                            {actionData.error}
                        </p>
                    )}
                    <Button type='submit' size='lg' disabled={paying}>
                        <Lock aria-hidden />
                        {paying ? 'Opening the payment page…' : `Pay ${formatPrice(quote.totalCents)}`}
                    </Button>
                    <p className='text-sm text-muted-foreground'>
                        You&apos;ll pay on Stripe&apos;s secure payment page. Your files are ready to download as soon
                        as the payment goes through.
                    </p>
                </Form>
            ) : (
                <div className='flex flex-col gap-3 rounded-lg border p-5'>
                    <p className='font-medium'>Sign in to pay</p>
                    <p className='text-sm text-muted-foreground'>
                        Your purchases are kept in your account, so you can download the files again whenever you need
                        them.
                    </p>
                    <SignInButton mode='modal' forceRedirectUrl='/checkout' signUpForceRedirectUrl='/checkout'>
                        <Button className='self-start'>Sign in or create an account</Button>
                    </SignInButton>
                </div>
            )}
        </main>
    );
}

/**
 * EU rule for digital content: the 14-day right of withdrawal ends once a file is delivered, but only if
 * the buyer agreed to immediate delivery knowing that. So the box is never ticked in advance.
 */
function ImmediateDeliveryConsent({ invalid }: { invalid: boolean }) {
    return (
        <label className='flex items-start gap-3 rounded-lg border p-4 text-sm'>
            <input
                type='checkbox'
                name={CONSENT_FIELD}
                value='yes'
                required
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? 'checkout-error' : undefined}
                className='mt-0.5 size-4 shrink-0 accent-primary'
            />
            <span>
                I want the files right away. I agree that they are delivered as soon as I&apos;ve paid, and I understand
                that this ends my 14-day right of withdrawal.
            </span>
        </label>
    );
}

function OrderSummary({ quote }: { quote: CartQuote }) {
    return (
        <section aria-labelledby='summary-heading' className='rounded-lg border p-5'>
            <h2 id='summary-heading' className='sr-only'>
                Your order
            </h2>
            <ul className='flex flex-col gap-2 border-b pb-4'>
                {quote.lines.map((line) => (
                    <li key={cartItemKey(line)} className='flex justify-between gap-4'>
                        <span>
                            {line.quantity > 1 && `${line.quantity} × `}
                            {line.title}{' '}
                            <span className='text-sm text-muted-foreground'>
                                · {line.print ? `print, ${printOptionText(line.print)}` : 'model file'}
                            </span>
                        </span>
                        <span className='tabular-nums'>{formatPrice(line.unitPriceCents * line.quantity)}</span>
                    </li>
                ))}
                {quote.shippingCents > 0 && (
                    <li className='flex justify-between gap-4'>
                        <span>Shipping</span>
                        <span className='tabular-nums'>{formatPrice(quote.shippingCents)}</span>
                    </li>
                )}
            </ul>
            <dl className='grid grid-cols-[1fr_auto] gap-y-1 pt-4'>
                <dt className='font-semibold'>Total</dt>
                <dd className='text-right font-semibold tabular-nums'>{formatPrice(quote.totalCents)}</dd>
                <dt className='text-sm text-muted-foreground'>Includes VAT {formatVatRate(quote.vatRateBp)}</dt>
                <dd className='text-right text-sm text-muted-foreground tabular-nums'>{formatPrice(quote.taxCents)}</dd>
            </dl>
        </section>
    );
}
