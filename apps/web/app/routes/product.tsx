import {
    isFreeDownload,
    isPaidFile,
    LICENSES,
    MAX_CART_ITEMS,
    offersPrint,
    type CatalogProduct,
    type LibraryItem,
} from '@app/shared';
import { Check, Download, FileBox, Library, Printer, ShoppingCart } from 'lucide-react';
import { data, Link, useFetcher } from 'react-router';

import { Breadcrumbs, type Crumb } from '~/components/catalog/breadcrumbs';
import { Markdown } from '~/components/catalog/markdown';
import { ProductGallery } from '~/components/catalog/product-gallery';
import { FileDownloads, type DownloadableFile } from '~/components/file-downloads';
import { Button } from '~/components/ui/button';
import { track } from '~/lib/analytics';
import { addToCart, cartChanged, isInCart, readCart } from '~/lib/cart.server';
import { getProduct } from '~/lib/catalog.server';
import { formatBytes, formatPrice, plainExcerpt } from '~/lib/format';
import { getOwned } from '~/lib/library.server';
import { pageMeta } from '~/lib/seo';
import { absoluteUrl } from '~/lib/site.server';

import type { Route } from './+types/product';

export async function loader(args: Route.LoaderArgs) {
    const [product, cart] = await Promise.all([getProduct(args.params.slug), readCart(args.request)]);
    // A free file is anyone's anyway. Otherwise a buyer gets their files here, whatever the model costs now.
    const owned = isFreeDownload(product) ? null : await getOwned(args, product.id);
    return {
        product,
        url: absoluteUrl(`/models/${product.slug}`),
        inCart: isInCart(cart, { productId: product.id, type: 'digital' }),
        owned,
    };
}

/** "Add to cart" posts here. Works without JavaScript too: the page then reloads, showing it's in the cart. */
export async function action({ params, request }: Route.ActionArgs) {
    const form = await request.formData();
    if (form.get('intent') !== 'add-to-cart') {
        throw data('Unknown action', { status: 400 });
    }
    // The product comes from the page's own slug, so only this page's file can be added, and only if it's sold.
    const product = await getProduct(params.slug);
    if (!isPaidFile(product)) {
        throw data("This model's file isn't for sale.", { status: 400 });
    }
    const added = addToCart(await readCart(request), { productId: product.id, type: 'digital' });
    if (!added.ok) {
        return { error: `Your cart is full (${MAX_CART_ITEMS} items). Check out or remove something first.` };
    }
    return cartChanged(request, added.items, `/models/${product.slug}`);
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
    if (!loaderData) return [];
    const { product, url } = loaderData;
    return pageMeta({
        title: product.title,
        description: plainExcerpt(product.description) || `${product.title}: a 3D model to download or order printed.`,
        url,
        image: product.cover?.url,
        type: 'product',
    });
};

export default function Product({ loaderData }: Route.ComponentProps) {
    const { product, inCart, owned } = loaderData;
    const crumbs: Crumb[] = [
        { label: 'Home', to: '/' },
        { label: 'Models', to: '/models' },
        ...(product.category?.parent
            ? [{ label: product.category.parent.name, to: `/categories/${product.category.parent.slug}` }]
            : []),
        ...(product.category ? [{ label: product.category.name, to: `/categories/${product.category.slug}` }] : []),
        { label: product.title },
    ];

    return (
        <main className='mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-10'>
            <Breadcrumbs items={crumbs} />

            <div className='grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
                <ProductGallery images={product.images} title={product.title} preview={product.preview} />

                <div className='flex flex-col gap-6'>
                    <h1 className='text-3xl font-bold tracking-tight'>{product.title}</h1>
                    <GetThisModel product={product} inCart={inCart} owned={owned} />
                    <Details product={product} />
                </div>
            </div>

            {product.description && (
                <section aria-labelledby='about-heading' className='max-w-3xl'>
                    <h2 id='about-heading' className='text-xl font-semibold'>
                        About this model
                    </h2>
                    <div className='mt-3'>
                        <Markdown>{product.description}</Markdown>
                    </div>
                </section>
            )}
        </main>
    );
}

/** The ways to get the model. Print orders arrive in M4, so that button is disabled. */
function GetThisModel({
    product,
    inCart,
    owned,
}: {
    product: CatalogProduct;
    inCart: boolean;
    owned: LibraryItem | null;
}) {
    return (
        <section aria-labelledby='get-heading' className='flex flex-col gap-3 rounded-lg border p-5'>
            <h2 id='get-heading' className='text-sm font-medium text-muted-foreground'>
                Get this model
            </h2>
            {isFreeDownload(product) && <FreeDownload product={product} />}
            {owned ? (
                <OwnedFile product={product} owned={owned} />
            ) : (
                isPaidFile(product) && <BuyFile product={product} inCart={inCart} />
            )}
            {offersPrint(product) && (
                <Offer
                    icon={<Printer aria-hidden />}
                    label={`Printed for you · from ${formatPrice(product.printBasePriceCents!)}`}
                    action='Order a print'
                    note='Print orders open soon. The final price depends on the material and colour.'
                />
            )}
            <p className='text-xs text-muted-foreground'>Prices include VAT.</p>
        </section>
    );
}

/** Adds the file to the cart without leaving the page; once it's there, links to the cart instead. */
function BuyFile({ product, inCart }: { product: CatalogProduct; inCart: boolean }) {
    const fetcher = useFetcher<typeof action>();
    // Shown as added as soon as it's sent; the loader confirms it a moment later.
    const added = inCart || (fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'add-to-cart');
    const error = fetcher.state === 'idle' ? fetcher.data?.error : null;

    return (
        <div className='flex flex-col gap-2'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                    <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                        <FileBox aria-hidden />
                        Model file · {formatPrice(product.digitalPriceCents!)}
                    </p>
                    <p className='text-sm text-muted-foreground'>
                        {added ? (
                            <span className='inline-flex items-center gap-1'>
                                <Check className='size-4' aria-hidden />
                                In your cart
                            </span>
                        ) : (
                            'Download it as often as you like once bought.'
                        )}
                    </p>
                </div>
                {added ? (
                    <Button asChild variant='outline'>
                        <Link to='/cart'>
                            <ShoppingCart aria-hidden />
                            View cart
                        </Link>
                    </Button>
                ) : (
                    <fetcher.Form
                        method='post'
                        onSubmit={() =>
                            track('added_to_cart', {
                                model: product.slug,
                                model_title: product.title,
                                item_type: 'digital',
                                price_cents: product.digitalPriceCents!,
                            })
                        }
                    >
                        <Button type='submit' name='intent' value='add-to-cart'>
                            <ShoppingCart aria-hidden />
                            Add to cart
                        </Button>
                    </fetcher.Form>
                )}
            </div>
            {error && (
                <p role='alert' className='text-sm text-destructive'>
                    {error}
                </p>
            )}
        </div>
    );
}

/** Counted the same way for free files and bought ones. */
const trackDownload = (product: CatalogProduct) => (file: DownloadableFile) =>
    track('model_downloaded', {
        model: product.slug,
        model_title: product.title,
        category: product.category?.slug ?? null,
        file_format: file.format,
        file_id: file.id,
    });

/** A model the visitor bought: its files to download instead of "Add to cart". */
function OwnedFile({ product, owned }: { product: CatalogProduct; owned: LibraryItem }) {
    return (
        <div className='flex flex-col gap-2'>
            <div>
                <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                    <Library aria-hidden />
                    In your library
                </p>
                <p className='text-sm text-muted-foreground'>
                    You own this model. Download it as often as you like, or find it any time in{' '}
                    <Link to='/library' className='underline underline-offset-4 hover:text-foreground'>
                        your library
                    </Link>
                    .
                </p>
            </div>
            {owned.files.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                    This model has no files right now. Contact us and we&apos;ll sort it out.
                </p>
            ) : (
                <FileDownloads slug={product.slug} files={owned.files} onDownload={trackDownload(product)} />
            )}
        </div>
    );
}

/** One download button per file, for anyone. */
function FreeDownload({ product }: { product: CatalogProduct }) {
    const count = product.downloadCount;
    return (
        <div className='flex flex-col gap-2'>
            <div>
                <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                    <Download aria-hidden />
                    Free download
                </p>
                <p className='text-sm text-muted-foreground'>
                    No account needed.
                    {count > 0 && ` Downloaded ${count.toLocaleString('en-IE')} ${count === 1 ? 'time' : 'times'}.`}
                </p>
            </div>
            <FileDownloads slug={product.slug} files={product.files} onDownload={trackDownload(product)} />
        </div>
    );
}

function Offer({ icon, label, action, note }: { icon: React.ReactNode; label: string; action: string; note: string }) {
    return (
        <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
                <p className='flex items-center gap-2 font-medium [&_svg]:size-4'>
                    {icon}
                    {label}
                </p>
                <p className='text-sm text-muted-foreground'>{note}</p>
            </div>
            <Button disabled>{action}</Button>
        </div>
    );
}

function Details({ product }: { product: CatalogProduct }) {
    const license = product.license ? LICENSES[product.license] : null;
    return (
        <dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm'>
            {product.size && (
                <>
                    <dt className='text-muted-foreground'>Printed size</dt>
                    <dd>
                        {product.size.x} × {product.size.y} × {product.size.z} mm
                    </dd>
                </>
            )}
            {product.printWeightG !== null && (
                <>
                    <dt className='text-muted-foreground'>Filament</dt>
                    <dd>about {product.printWeightG} g</dd>
                </>
            )}
            {license && (
                <>
                    <dt className='text-muted-foreground'>Licence</dt>
                    <dd>
                        {license.url ? (
                            <a
                                href={license.url}
                                className='underline underline-offset-4'
                                rel='license noopener noreferrer'
                            >
                                {license.name}
                            </a>
                        ) : (
                            license.name
                        )}
                    </dd>
                </>
            )}
            {product.files.length > 0 && (
                <>
                    <dt className='text-muted-foreground'>Files</dt>
                    <dd>
                        <ul>
                            {product.files.map((file) => (
                                <li key={file.filename}>
                                    {file.filename}{' '}
                                    <span className='text-muted-foreground'>
                                        ({file.format.toUpperCase()}, {formatBytes(file.sizeBytes)})
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </dd>
                </>
            )}
        </dl>
    );
}
