import { cartItemKey, formatVatRate, LICENSES, MAX_PRINT_QUANTITY, type CartLine, type CartQuote } from '@app/shared';
import { Box, Trash2 } from 'lucide-react';
import { data, Link, useFetcher } from 'react-router';

import { ColourSwatch } from '~/components/colour-swatch';
import { Button } from '~/components/ui/button';
import { Select } from '~/components/admin/form';
import {
    cartChanged,
    cartItemFromForm,
    quoteCart,
    readCart,
    removeFromCart,
    saveCart,
    setQuantity,
} from '~/lib/cart.server';
import { formatPrice } from '~/lib/format';
import { printOptionText } from '~/lib/print-option';

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
    const cartCount = quote.lines.reduce((sum, line) => sum + line.quantity, 0);
    if (quote.removed.length === 0) return { quote, removed: [], cartCount };

    const forSale = new Set(quote.lines.map(cartItemKey));
    const kept = items.filter((item) => forSale.has(cartItemKey(item)));
    return data(
        { quote, removed: quote.removed, cartCount },
        { headers: { 'Set-Cookie': await saveCart(args.request, kept) } },
    );
}

export async function action({ request }: Route.ActionArgs) {
    const form = await request.formData();
    const item = cartItemFromForm(form);
    const intent = form.get('intent');
    if (!item) throw data('Invalid cart change', { status: 400 });
    const items = await readCart(request);
    if (intent === 'remove') return cartChanged(request, removeFromCart(items, item), '/cart');
    // The item read from the form carries the new quantity, already checked against the limits.
    if (intent === 'set-quantity' && item.type === 'print') {
        return cartChanged(request, setQuantity(items, item, item.quantity), '/cart');
    }
    throw data('Invalid cart change', { status: 400 });
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
                            <li key={cartItemKey(item)}>{removalMessage(item)}</li>
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
                                <CartRow key={cartItemKey(line)} line={line} />
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
    if (item.reason === 'option_unavailable') {
        const what = item.title ? `The print of “${item.title}”` : 'A print';
        const option = item.option ? ` in ${item.option}` : '';
        return `${what}${option} is no longer available in that colour or material, so it was taken out of your cart.`;
    }
    if (item.type === 'print' && item.title) {
        return `“${item.title}” is no longer printed for sale, so it was taken out of your cart.`;
    }
    return item.title
        ? `“${item.title}” is no longer for sale, so it was taken out of your cart.`
        : "A model that's no longer for sale was taken out of your cart.";
}

function CartRow({ line }: { line: CartLine }) {
    const fetcher = useFetcher<typeof action>();
    const busy = fetcher.state !== 'idle';

    return (
        <li className='flex gap-4 py-4 aria-busy:opacity-50' aria-busy={busy || undefined}>
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
                    <span className='font-medium tabular-nums'>{formatPrice(line.unitPriceCents * line.quantity)}</span>
                </div>
                {line.print ? (
                    <p className='flex items-center gap-1.5 text-sm text-muted-foreground'>
                        {line.print.colours.length > 0 && (
                            <ColourSwatch colours={line.print.colours} className='size-3' />
                        )}
                        Print · {printOptionText(line.print)}
                        {line.quantity > 1 && ` · ${formatPrice(line.unitPriceCents)} each`}
                    </p>
                ) : (
                    <p className='text-sm text-muted-foreground'>
                        Model file{line.license && ` · ${LICENSES[line.license].name}`}
                    </p>
                )}
                <div className='mt-1 flex flex-wrap items-center gap-2'>
                    {line.print && <QuantityForm line={line} busy={busy} />}
                    <fetcher.Form method='post'>
                        <ItemFields line={line} />
                        <Button
                            type='submit'
                            name='intent'
                            value='remove'
                            variant='ghost'
                            size='sm'
                            className={line.print ? 'text-muted-foreground' : '-ml-3 text-muted-foreground'}
                            disabled={busy}
                            aria-label={`Remove ${line.title}`}
                        >
                            <Trash2 aria-hidden />
                            Remove
                        </Button>
                    </fetcher.Form>
                </div>
            </div>
        </li>
    );
}

/** The hidden fields that say which cart line a form is about. */
function ItemFields({ line }: { line: CartLine }) {
    return (
        <>
            <input type='hidden' name='productId' value={line.productId} />
            <input type='hidden' name='type' value={line.type} />
            {line.materialId && <input type='hidden' name='materialId' value={line.materialId} />}
            {line.colourOptionId && <input type='hidden' name='colourOptionId' value={line.colourOptionId} />}
        </>
    );
}

/** Changes the number of copies straight away with JavaScript; without it, with the Update button. */
function QuantityForm({ line, busy }: { line: CartLine; busy: boolean }) {
    const fetcher = useFetcher<typeof action>();
    const id = `quantity-${cartItemKey(line).replaceAll(':', '-')}`;

    return (
        <fetcher.Form method='post' className='flex items-center gap-2'>
            <ItemFields line={line} />
            <input type='hidden' name='intent' value='set-quantity' />
            <label htmlFor={id} className='text-sm text-muted-foreground'>
                Copies
            </label>
            <Select
                id={id}
                name='quantity'
                defaultValue={line.quantity}
                disabled={busy || fetcher.state !== 'idle'}
                onChange={(event) => fetcher.submit(event.currentTarget.form)}
                className='h-8 w-16'
            >
                {Array.from({ length: MAX_PRINT_QUANTITY }, (_, index) => index + 1).map((count) => (
                    <option key={count} value={count}>
                        {count}
                    </option>
                ))}
            </Select>
            <noscript>
                <Button type='submit' variant='outline' size='sm'>
                    Update
                </Button>
            </noscript>
        </fetcher.Form>
    );
}

const PARCEL_NAMES = { S: 'small', M: 'medium', L: 'large' } as const;

function Summary({ quote }: { quote: CartQuote }) {
    const count = quote.lines.reduce((sum, line) => sum + line.quantity, 0);
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
                {quote.parcelSize && (
                    <>
                        <dt className='text-muted-foreground'>Shipping ({PARCEL_NAMES[quote.parcelSize]} parcel)</dt>
                        <dd className='text-right tabular-nums'>{formatPrice(quote.shippingCents)}</dd>
                    </>
                )}
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
