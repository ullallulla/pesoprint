import { formatVatRate, LICENSES, type CartLine, type CartQuote } from '@app/shared';
import { Box, Trash2 } from 'lucide-react';
import { data, Link, useFetcher } from 'react-router';

import { Button } from '~/components/ui/button';
import { cartChanged, cartItemFromForm, quoteCart, readCart, removeFromCart, saveCart } from '~/lib/cart.server';
import { formatPrice } from '~/lib/format';

import type { Route } from './+types/cart';

export const meta: Route.MetaFunction = () => [{ title: 'Cart – Pesoprint' }, { name: 'robots', content: 'noindex' }];

/**
 * Prices the cart through the API every time, so it always shows today's prices. Items that can't be
 * bought any more (or that the signed-in visitor already owns) are dropped from the cookie, and the page
 * says why, once.
 */
export async function loader(args: Route.LoaderArgs) {
    const items = await readCart(args.request);
    if (items.length === 0) return { quote: null, removed: [], cartCount: 0 };

    const quote = await quoteCart(args, items);
    // `cartCount` corrects the header, whose loader counted the cart before this one dropped anything.
    const cartCount = quote.lines.length;
    if (quote.removed.length === 0) return { quote, removed: [], cartCount };

    const kept = items.filter((item) =>
        quote.lines.some((line) => line.productId === item.productId && line.type === item.type),
    );
    return data(
        { quote, removed: quote.removed, cartCount },
        { headers: { 'Set-Cookie': await saveCart(args.request, kept) } },
    );
}

export async function action({ request }: Route.ActionArgs) {
    const form = await request.formData();
    const item = cartItemFromForm(form);
    if (form.get('intent') !== 'remove' || !item) {
        throw data('Invalid cart change', { status: 400 });
    }
    return cartChanged(request, removeFromCart(await readCart(request), item), '/cart');
}

export default function Cart({ loaderData }: Route.ComponentProps) {
    const { quote, removed } = loaderData;
    const empty = !quote || quote.lines.length === 0;

    return (
        <main className='mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10'>
            <h1 className='text-3xl font-bold tracking-tight'>Your cart</h1>

            {removed.length > 0 && (
                <div className='rounded-lg border bg-muted/50 p-4 text-sm'>
                    <ul className='flex flex-col gap-1'>
                        {removed.map((item) => (
                            <li key={`${item.type}:${item.productId}`}>{removalMessage(item)}</li>
                        ))}
                    </ul>
                </div>
            )}

            {empty ? (
                <div className='flex flex-col items-start gap-4'>
                    <p className='text-muted-foreground'>Your cart is empty.</p>
                    <Button asChild variant='outline'>
                        <Link to='/models'>Browse models</Link>
                    </Button>
                </div>
            ) : (
                <div className='grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]'>
                    <section aria-label='Items'>
                        <ul className='divide-y border-y'>
                            {quote.lines.map((line) => (
                                <CartRow key={`${line.type}:${line.productId}`} line={line} />
                            ))}
                        </ul>
                    </section>
                    <Summary quote={quote} />
                </div>
            )}
        </main>
    );
}

function removalMessage(item: CartQuote['removed'][number]): string {
    if (item.reason === 'owned') return `You already own “${item.title}”, so it was taken out of your cart.`;
    return item.title
        ? `“${item.title}” is no longer for sale, so it was taken out of your cart.`
        : "A model that's no longer for sale was taken out of your cart.";
}

function CartRow({ line }: { line: CartLine }) {
    const fetcher = useFetcher<typeof action>();
    const removing = fetcher.state !== 'idle';

    return (
        <li className='flex gap-4 py-4 aria-busy:opacity-50' aria-busy={removing || undefined}>
            <Link
                to={`/models/${line.slug}`}
                tabIndex={-1}
                aria-hidden
                className='aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-md bg-muted'
            >
                {line.cover ? (
                    <img
                        src={line.cover.url}
                        alt=''
                        width={line.cover.width}
                        height={line.cover.height}
                        className='size-full object-cover'
                    />
                ) : (
                    <div className='flex size-full items-center justify-center text-muted-foreground'>
                        <Box className='size-6' />
                    </div>
                )}
            </Link>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <div className='flex items-start justify-between gap-4'>
                    <Link to={`/models/${line.slug}`} className='font-medium hover:underline'>
                        {line.title}
                    </Link>
                    <span className='font-medium tabular-nums'>{formatPrice(line.unitPriceCents)}</span>
                </div>
                <p className='text-sm text-muted-foreground'>Model file · {LICENSES[line.license].name}</p>
                <fetcher.Form method='post' className='mt-1'>
                    <input type='hidden' name='productId' value={line.productId} />
                    <input type='hidden' name='type' value={line.type} />
                    <Button
                        type='submit'
                        name='intent'
                        value='remove'
                        variant='ghost'
                        size='sm'
                        className='-ml-3 text-muted-foreground'
                        disabled={removing}
                        aria-label={`Remove ${line.title}`}
                    >
                        <Trash2 aria-hidden />
                        Remove
                    </Button>
                </fetcher.Form>
            </div>
        </li>
    );
}

function Summary({ quote }: { quote: CartQuote }) {
    const count = quote.lines.length;
    return (
        <aside aria-labelledby='summary-heading' className='flex flex-col gap-4 rounded-lg border p-5'>
            <h2 id='summary-heading' className='font-semibold'>
                Summary
            </h2>
            <dl className='grid grid-cols-[1fr_auto] gap-y-2 text-sm'>
                <dt className='text-muted-foreground'>
                    {count} {count === 1 ? 'item' : 'items'}
                </dt>
                <dd className='text-right tabular-nums'>{formatPrice(quote.subtotalCents)}</dd>
                <dt className='border-t pt-2 text-base font-semibold'>Total</dt>
                <dd className='border-t pt-2 text-right text-base font-semibold tabular-nums'>
                    {formatPrice(quote.totalCents)}
                </dd>
                <dt className='text-muted-foreground'>Includes VAT {formatVatRate(quote.vatRateBp)}</dt>
                <dd className='text-right text-muted-foreground tabular-nums'>{formatPrice(quote.taxCents)}</dd>
            </dl>
            <Button asChild>
                <Link to='/checkout'>Checkout</Link>
            </Button>
        </aside>
    );
}
